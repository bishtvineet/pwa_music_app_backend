import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  async streamMp3(
    videoId: string,
    sanitizedUrl: string,
    title: string,
    channel: string,
    thumbnailUrl: string,
    duration: number,
    res: Response,
  ): Promise<void> {
    this.logger.debug(
      `[TESTING] Processing MP3 with embedded cover art for: "${title}" (${videoId})`,
    );

    const timestamp = Date.now();
    const tempRawThumb = path.join(os.tmpdir(), `raw_thumb_${timestamp}`);
    const tempThumbJpg = path.join(os.tmpdir(), `thumb_${timestamp}.jpg`);
    const tempMp3Out = path.join(os.tmpdir(), `output_${timestamp}.mp3`);

    const sanitizedFilename = title
      .replace(/[^a-zA-Z0-9_\-\s.]/g, '')
      .trim()
      .slice(0, 100);

    const filename = `${sanitizedFilename || 'audio'}.mp3`;
    const encodedFilename = encodeURIComponent(filename);

    const cleanup = () => {
      [tempRawThumb, tempThumbJpg, tempMp3Out].forEach((filePath) => {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (_) {}
        }
      });
    };

    try {
      // 1. Fetch thumbnail image bytes and convert to true baseline JPEG via FFmpeg
      let hasValidCover = false;
      if (thumbnailUrl) {
        try {
          const imgRes = await fetch(thumbnailUrl);
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            fs.writeFileSync(tempRawThumb, Buffer.from(arrayBuffer));

            await new Promise<void>((resolve, reject) => {
              const convert = spawn('ffmpeg', [
                '-y',
                '-i',
                tempRawThumb,
                '-frames:v',
                '1',
                '-q:v',
                '2',
                tempThumbJpg,
              ]);
              convert.on('close', (code) => {
                if (code === 0) resolve();
                else
                  reject(
                    new Error(`Thumbnail conversion failed with code ${code}`),
                  );
              });
              convert.on('error', reject);
            });

            hasValidCover = fs.existsSync(tempThumbJpg);
            this.logger.debug(
              `[TESTING] Successfully converted thumbnail to genuine JPEG`,
            );
          }
        } catch (imgErr: any) {
          this.logger.warn(
            `[TESTING] Could not process thumbnail image: ${imgErr?.message}`,
          );
        }
      }

      // 2. Build FFmpeg arguments for writing seekable MP3 with ID3v2.3
      const ffmpegArgs: string[] = ['-i', 'pipe:0'];

      if (hasValidCover) {
        ffmpegArgs.push(
          '-i',
          tempThumbJpg,
          '-map',
          '0:a',
          '-map',
          '1:0',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '192k',
          '-c:v',
          'copy',
          '-disposition:v:0',
          'attached_pic',
        );
      } else {
        ffmpegArgs.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k');
      }

      ffmpegArgs.push(
        '-id3v2_version',
        '3',
        '-metadata',
        `title=${title}`,
        '-metadata',
        `artist=${channel}`,
        '-metadata',
        `album_artist=${channel}`,
        '-metadata',
        `album=${channel} Singles`,
        '-y',
        tempMp3Out,
      );

      // 3. Spawn yt-dlp with proxy argument
      const ytdlpArgs = [
        '-f',
        'ba/b',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '-o',
        '-',
        sanitizedUrl,
      ];

      const proxyUrl = process.env.YOUTUBE_PROXY_URL;
      if (proxyUrl) {
        ytdlpArgs.push('--proxy', proxyUrl);
      }

      const cookiePath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
      if (fs.existsSync(cookiePath)) {
        ytdlpArgs.push('--cookies', cookiePath);
      }

      const ytdlpProc = spawn('yt-dlp', ytdlpArgs);
      const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

      ytdlpProc.stdout.pipe(ffmpegProc.stdin);

      ytdlpProc.stderr.on('data', (d) =>
        this.logger.verbose(`[yt-dlp] ${d.toString().trim()}`),
      );
      ffmpegProc.stderr.on('data', (d) =>
        this.logger.verbose(`[ffmpeg] ${d.toString().trim()}`),
      );

      await new Promise<void>((resolve, reject) => {
        ffmpegProc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
        ffmpegProc.on('error', reject);
        ytdlpProc.on('error', reject);
      });

      // 4. Set Headers for React PWA Download & Metadata Extraction
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
      );

      res.setHeader('X-Audio-Id', videoId);
      res.setHeader('X-Audio-Title', encodeURIComponent(title));
      res.setHeader('X-Audio-Artist', encodeURIComponent(channel));
      res.setHeader('X-Audio-Duration', duration ? String(duration) : '0');
      res.setHeader('X-Audio-Thumbnail', encodeURIComponent(thumbnailUrl || ''));

      // 5. Stream the final MP3 file to response
      const fileStream = fs.createReadStream(tempMp3Out);
      fileStream.pipe(res);

      fileStream.on('close', () => {
        cleanup();
      });

      res.on('close', () => {
        cleanup();
      });
    } catch (err: any) {
      this.logger.error('[TESTING] Streaming failed', err);
      cleanup();
      if (!res.headersSent) {
        res
          .status(500)
          .json({ message: 'Conversion failed', error: err?.message });
      }
    }
  }
}