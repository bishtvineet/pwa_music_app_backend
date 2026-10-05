import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { VideoInfoDto } from './dto/video-info.dto';

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  async getVideoMetadata(sanitizedUrl: string): Promise<VideoInfoDto> {
    this.logger.debug(`[TESTING] Extracting metadata for: ${sanitizedUrl}`);

    return new Promise((resolve, reject) => {
      const cookiePath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
      const proxyUrl = process.env.YOUTUBE_PROXY_URL;

      const args = [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        sanitizedUrl,
      ];

      if (proxyUrl) {
        this.logger.log(`[PROXY] Routing request through proxy`);
        args.push('--proxy', proxyUrl);
      }

      if (fs.existsSync(cookiePath)) {
        args.push('--cookies', cookiePath);
      }

      const childProcess = spawn('yt-dlp', args);

      let stdoutData = '';
      let stderrData = '';

      childProcess.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      childProcess.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      childProcess.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(`[TESTING] yt-dlp failed with exit code: ${code}`);
          this.logger.error(`[TESTING] yt-dlp stderr: ${stderrData}`);

          if (
            stderrData.includes('Video unavailable') ||
            stderrData.includes('Private video')
          ) {
            return reject(
              new BadRequestException('Video is unavailable, private, or deleted.'),
            );
          }

          if (stderrData.includes('Sign in to confirm you’re not a bot')) {
            return reject(
              new BadRequestException(
                'YouTube bot detection triggered. Cookies or residential proxy required.',
              ),
            );
          }

          return reject(
            new InternalServerErrorException(
              `Failed to retrieve video metadata: ${stderrData.slice(0, 200)}`,
            ),
          );
        }

        try {
          const rawInfo = JSON.parse(stdoutData);
          const durationInSeconds = Number(rawInfo.duration) || 0;

          const MAX_DURATION_SECONDS = 1800; // 30 minutes
          if (durationInSeconds > MAX_DURATION_SECONDS) {
            return reject(
              new BadRequestException(
                `Video duration exceeds limit of ${MAX_DURATION_SECONDS / 60} minutes.`,
              ),
            );
          }

          const metadata: VideoInfoDto = {
            id: rawInfo.id,
            title: rawInfo.title,
            channel: rawInfo.uploader || rawInfo.channel || 'Unknown Artist',
            duration: durationInSeconds,
            durationFormatted: this.formatDuration(durationInSeconds),
            thumbnail: rawInfo.thumbnail || '',
            originalUrl: sanitizedUrl,
          };

          this.logger.debug(
            `[TESTING] Extracted metadata: "${metadata.title}" (${metadata.durationFormatted})`,
          );

          resolve(metadata);
        } catch (parseError) {
          this.logger.error('[TESTING] Failed to parse yt-dlp output', parseError);
          reject(
            new InternalServerErrorException('Failed to parse video metadata response.'),
          );
        }
      });

      childProcess.on('error', (err) => {
        this.logger.error('[TESTING] Failed to spawn yt-dlp', err);
        reject(
          new InternalServerErrorException('yt-dlp binary is missing or not executable.'),
        );
      });
    });
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const formattedMins = String(mins).padStart(2, '0');
    const formattedSecs = String(secs).padStart(2, '0');
    return `${formattedMins}:${formattedSecs}`;
  }
}