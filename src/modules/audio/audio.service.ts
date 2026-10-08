import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { ProxyManagerService } from '../youtube/proxy-manager.service';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private readonly proxyManager: ProxyManagerService) {}

  private getValidCookiePath(): string | null {
    const candidatePath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
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
      this.logger.warn(`Cookie check error: ${err?.message}`);
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
    directStreamUrl?: string,
  ): Promise<void> {
    this.logger.debug(`[DOWNLOAD] MP3 stream initiated for: "${title}" (${videoId})`);

    const sanitizedFilename = title
      .replace(/[^a-zA-Z0-9_\-\s.]/g, '')
      .trim()
      .slice(0, 100);

    const filename = `${sanitizedFilename || 'audio'}.mp3`;
    const encodedFilename = encodeURIComponent(filename);

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

    // If we have a direct stream URL from Piped/Cobalt, feed directly into FFmpeg
    if (directStreamUrl) {
      this.logger.log(`[STREAM] Feeding direct audio stream into FFmpeg`);
      const ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', directStreamUrl,
        '-vn',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-id3v2_version', '3',
        '-metadata', `title=${title}`,
        '-metadata', `artist=${channel}`,
        '-f', 'mp3',
        'pipe:1',
      ];

      const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
      res.on('close', () => {
        try { ffmpegProc.kill('SIGTERM'); } catch (_) {}
      });

      ffmpegProc.stdout.pipe(res);
      return;
    }

    // yt-dlp -> FFmpeg pipeline with proxy support
    const cookiePath = this.getValidCookiePath();
    const activeProxy = this.proxyManager.getCurrentProxy() || process.env.YOUTUBE_PROXY_URL;

    if (activeProxy) {
      this.logger.log(`[STREAM] Streaming via proxy: ${this.proxyManager.maskProxy(activeProxy)} -> FFmpeg`);
    } else {
      this.logger.log(`[STREAM] Streaming via direct local yt-dlp -> FFmpeg`);
    }

    const ytdlpArgs = [
      '-f', '140/ba[ext=m4a]/ba/b',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--buffer-size', '1M',
      '--http-chunk-size', '10M',
      '--extractor-args', 'youtube:player_client=android,web',
      '-o', '-',
      sanitizedUrl,
    ];

    if (activeProxy) {
      ytdlpArgs.push('--proxy', activeProxy);
    }
    if (cookiePath) {
      ytdlpArgs.push('--cookies', cookiePath);
    }

    const ffmpegArgs = [
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-id3v2_version', '3',
      '-metadata', `title=${title}`,
      '-metadata', `artist=${channel}`,
      '-f', 'mp3',
      'pipe:1',
    ];

    const ytdlpProc = spawn('yt-dlp', ytdlpArgs);
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

    const killProcs = () => {
      try { ytdlpProc.kill('SIGTERM'); } catch (_) {}
      try { ffmpegProc.kill('SIGTERM'); } catch (_) {}
    };

    res.on('close', killProcs);

    ytdlpProc.stdout.pipe(ffmpegProc.stdin);
    ffmpegProc.stdout.pipe(res);
  }
}