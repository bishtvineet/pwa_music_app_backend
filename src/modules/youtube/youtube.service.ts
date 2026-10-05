import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { VideoInfoDto } from './dto/video-info.dto';

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  async getVideoMetadata(sanitizedUrl: string): Promise<VideoInfoDto> {
    this.logger.debug(`[TESTING] Extracting metadata for: ${sanitizedUrl}`);

    return new Promise((resolve, reject) => {
      // yt-dlp arguments for JSON extraction only
      const args = [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--prefer-free-formats',
        sanitizedUrl,
      ];

      // Safe access to global Node process.env
      if (process.env.YOUTUBE_COOKIES_PATH) {
        args.push('--cookies', process.env.YOUTUBE_COOKIES_PATH);
      }

      // Renamed from 'process' to 'childProcess' to prevent shadowing global process
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

          if (stderrData.includes('Video unavailable') || stderrData.includes('Private video')) {
            return reject(new BadRequestException('Video is unavailable, private, or deleted.'));
          }

          if (stderrData.includes('Sign in to confirm you’re not a bot')) {
            return reject(
              new BadRequestException(
                'YouTube bot detection triggered. Cookies are required to access this video.',
              ),
            );
          }

          return reject(
            new InternalServerErrorException('Failed to retrieve video metadata from YouTube.'),
          );
        }

        try {
          const rawInfo = JSON.parse(stdoutData);

          const durationInSeconds = Number(rawInfo.duration) || 0;

          // Reject excessively long videos to preserve Render memory/CPU
          const MAX_DURATION_SECONDS = 1800; // 30 minutes
          if (durationInSeconds > MAX_DURATION_SECONDS) {
            this.logger.warn(
              `[TESTING] Video exceeds max allowed length: ${durationInSeconds}s > ${MAX_DURATION_SECONDS}s`,
            );
            return reject(
              new BadRequestException(
                `Video duration exceeds maximum allowed limit of ${MAX_DURATION_SECONDS / 60} minutes.`,
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

          this.logger.debug(`[TESTING] Successfully extracted metadata for: "${metadata.title}"`);
          this.logger.debug(
            `[TESTING] Duration: ${metadata.durationFormatted}, Channel: ${metadata.channel}`,
          );

          resolve(metadata);
        } catch (parseError) {
          this.logger.error('[TESTING] Failed to parse yt-dlp JSON output', parseError);
          reject(new InternalServerErrorException('Failed to parse video metadata response.'));
        }
      });

      childProcess.on('error', (err) => {
        this.logger.error('[TESTING] Failed to spawn yt-dlp process. Is yt-dlp installed?', err);
        reject(
          new InternalServerErrorException(
            'yt-dlp binary is missing or not executable on the host system.',
          ),
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