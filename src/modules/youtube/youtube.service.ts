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

  private getValidCookiePath(): string | null {
    const candidatePath =
      process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
    const writeablePath = '/tmp/runtime_cookies.txt';

    try {
      if (fs.existsSync(candidatePath)) {
        const stats = fs.statSync(candidatePath);
        if (stats.size > 50) {
          fs.copyFileSync(candidatePath, writeablePath);
          return writeablePath;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Could not verify cookie file: ${err?.message}`);
    }

    return null;
  }

  async getVideoMetadata(sanitizedUrl: string): Promise<VideoInfoDto> {
    this.logger.debug(`[METADATA] Extracting metadata for: ${sanitizedUrl}`);

    // Try fast anonymous flat extraction first (bypasses auth/reload bugs)
    try {
      return await this.executeYtDlpMetadata(sanitizedUrl, false);
    } catch (primaryErr: any) {
      const errMsg = primaryErr?.message || '';
      // If the track is age-restricted or private, retry with cookies
      if (
        errMsg.includes('Sign in') ||
        errMsg.includes('Private') ||
        errMsg.includes('bot')
      ) {
        this.logger.warn(
          `[METADATA] Anonymous extraction required authentication. Retrying with session cookies...`,
        );
        return await this.executeYtDlpMetadata(sanitizedUrl, true);
      }
      throw primaryErr;
    }
  }

  private executeYtDlpMetadata(
    sanitizedUrl: string,
    useCookies: boolean,
  ): Promise<VideoInfoDto> {
    return new Promise((resolve, reject) => {
      const proxyUrl = process.env.YOUTUBE_PROXY_URL;
      const cookiePath = useCookies ? this.getValidCookiePath() : null;

      const args = [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        // Extract top-level metadata without probing video/audio formats
        '--flat-playlist',
        sanitizedUrl,
      ];

      if (proxyUrl) {
        args.push('--proxy', proxyUrl);
      }

      if (cookiePath) {
        args.push(
          '--cookies',
          cookiePath,
          '--extractor-args',
          'youtube:player_client=default,web_embedded',
        );
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
          this.logger.error(`[METADATA] yt-dlp exit code: ${code}`);
          this.logger.error(`[METADATA] yt-dlp stderr: ${stderrData}`);

          if (
            stderrData.includes('Video unavailable') ||
            stderrData.includes('Private video')
          ) {
            return reject(
              new BadRequestException(
                'Video is unavailable, private, or deleted.',
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

          // Resolve best available thumbnail from flat playlist output
          let thumbnail = rawInfo.thumbnail || '';
          if (!thumbnail && Array.isArray(rawInfo.thumbnails) && rawInfo.thumbnails.length > 0) {
            thumbnail = rawInfo.thumbnails[rawInfo.thumbnails.length - 1]?.url || '';
          }

          const metadata: VideoInfoDto = {
            id: rawInfo.id,
            title: rawInfo.title,
            channel:
              rawInfo.uploader ||
              rawInfo.channel ||
              rawInfo.artist ||
              'Unknown Artist',
            duration: durationInSeconds,
            durationFormatted: this.formatDuration(durationInSeconds),
            thumbnail,
            originalUrl: sanitizedUrl,
            streamM4aUrl: `/converter/stream/${rawInfo.id}`,
          };

          this.logger.debug(
            `[METADATA] Extracted successfully: "${metadata.title}" (${metadata.durationFormatted})`,
          );

          resolve(metadata);
        } catch (parseError) {
          this.logger.error(
            '[METADATA] Failed to parse yt-dlp JSON output',
            parseError,
          );
          reject(
            new InternalServerErrorException(
              'Failed to parse video metadata response.',
            ),
          );
        }
      });

      childProcess.on('error', (err) => {
        this.logger.error('[METADATA] Failed to spawn yt-dlp', err);
        reject(
          new InternalServerErrorException(
            'yt-dlp binary is missing or not executable.',
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