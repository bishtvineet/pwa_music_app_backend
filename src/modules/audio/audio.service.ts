import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  private getValidCookiePath(): string | null {
    const candidatePath =
      process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
    const writeablePath = '/tmp/runtime_cookies.txt';

    try {
      if (fs.existsSync(candidatePath)) {
        const stats = fs.statSync(candidatePath);
        if (stats.size > 50) {
          // Copy to a writeable scratchpad so yt-dlp can update session cookies freely
          fs.copyFileSync(candidatePath, writeablePath);
          return writeablePath;
        }
      }
    } catch (err: any) {
      this.logger.warn(`Could not verify cookie file: ${err?.message}`);
    }

    return null;
  }

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
      `[DOWNLOAD] Fast direct MP3 stream initiated for: "${title}" (${videoId})`,
    );

    const sanitizedFilename = title
      .replace(/[^a-zA-Z0-9_\-\s.]/g, '')
      .trim()
      .slice(0, 100);

    const filename = `${sanitizedFilename || 'audio'}.mp3`;
    const encodedFilename = encodeURIComponent(filename);

    const cookiePath = this.getValidCookiePath();

    // 1. Build yt-dlp arguments
    const ytdlpArgs: string[] = [
      '-f',
      'ba/b',
      '-N',
      '4',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--buffer-size',
      '128K', // Keeps stdout pipe full so FFmpeg never waits on empty stdin
      // Tell yt-dlp to prefer the Android/Web client to avoid throttling
      '--extractor-args',
      'youtube:player_client=android,web',
      '-o',
      '-',
      sanitizedUrl,
    ];

    if (process.env.YOUTUBE_PROXY_URL) {
      ytdlpArgs.push('--proxy', process.env.YOUTUBE_PROXY_URL);
    }

    if (cookiePath) {
      this.logger.debug(`[DOWNLOAD] Applying cookies from: ${cookiePath}`);
      ytdlpArgs.push('--cookies', cookiePath);
    } else {
      this.logger.debug('[DOWNLOAD] No valid cookies found. Proceeding with anonymous mode.');
    }

    // 2. Configure FFmpeg for memory pipe (pipe:0 -> pipe:1) at 128k
    const ffmpegArgs: string[] = [
      '-i',
      'pipe:0',
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
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
      '-f',
      'mp3',
      'pipe:1',
    ];

    const ytdlpProc = spawn('yt-dlp', ytdlpArgs);
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

    let isTerminated = false;
    const killProcs = () => {
      if (!isTerminated) {
        isTerminated = true;
        try {
          ytdlpProc.kill('SIGTERM');
        } catch (_) {}
        try {
          ffmpegProc.kill('SIGTERM');
        } catch (_) {}
      }
    };

    res.on('close', killProcs);

    ytdlpProc.stderr.on('data', (data) => {
      const msg = data.toString();
      // If yt-dlp complains about invalid or expired cookies, log a warning without killing immediately
      if (msg.includes('cookies') || msg.includes('Sign in') || msg.includes('403')) {
        this.logger.warn(`[yt-dlp stderr] ${msg.trim()}`);
      }
    });

    ytdlpProc.on('error', (err) => {
      this.logger.error(`yt-dlp error: ${err.message}`);
      killProcs();
    });

    ffmpegProc.on('error', (err) => {
      this.logger.error(`ffmpeg error: ${err.message}`);
      killProcs();
    });

    // 3. Set headers
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

    // 4. Connect streams: yt-dlp -> ffmpeg -> Express res
    ytdlpProc.stdout.pipe(ffmpegProc.stdin);
    ffmpegProc.stdout.pipe(res);
  }
}