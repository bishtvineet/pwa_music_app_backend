import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { Readable } from 'stream';
import { ProxyManagerService } from '../youtube/proxy-manager.service';
import { NetworkMode } from '../converter/dto/convert-request.dto';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private readonly proxyManager: ProxyManagerService) {}

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
      this.logger.warn(`Cookie check error: ${err?.message}`);
    }
    return null;
  }

  /**
   * Relay the MP3 download stream directly from Laptop over Tailscale
   */
  private async relayFromLaptop(
    laptopUrl: string,
    bodyPayload: any,
    res: Response,
  ): Promise<boolean> {
    try {
      this.logger.log(
        `[RELAY] Forwarding download stream to Laptop: ${laptopUrl}/converter/download`,
      );

      const controller = new AbortController();
      const response = await fetch(`${laptopUrl}/converter/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bodyPayload, networkMode: 'laptop-direct' }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        this.logger.error(
          `[RELAY ERROR] Laptop returned status ${response.status}`,
        );
        return false;
      }

      if (res.headersSent) return true;

      res.setHeader(
        'Content-Type',
        response.headers.get('content-type') || 'audio/mpeg',
      );
      const disposition = response.headers.get('content-disposition');
      if (disposition) res.setHeader('Content-Disposition', disposition);

      const stream = Readable.fromWeb(response.body as any);

      stream.on('error', (err) => {
        this.logger.warn(`Relay stream error: ${err.message}`);
        controller.abort();
        if (!res.writableEnded) res.end();
      });

      res.on('close', () => {
        controller.abort();
      });

      stream.pipe(res);
      return true;
    } catch (err: any) {
      this.logger.error(
        `[RELAY EXCEPTION] Failed to stream from laptop: ${err.message}`,
      );
      return false;
    }
  }

  async streamMp3(
    videoId: string,
    sanitizedUrl: string,
    title: string,
    channel: string,
    thumbnailUrl: string,
    duration: number,
    res: Response,
    networkMode: NetworkMode = 'cloud',
    laptopUrl?: string,
  ): Promise<void> {
    this.logger.log(
      `[DOWNLOAD] Stream requested: "${title}" (${videoId}) | Mode: [${networkMode}]`,
    );

    // MODE 2: Explicit Laptop Relay delegation
    if (networkMode === 'laptop-relay') {
      if (laptopUrl) {
        const success = await this.relayFromLaptop(
          laptopUrl,
          {
            url: sanitizedUrl,
            title,
            channel,
            thumbnail: thumbnailUrl,
            duration,
            id: videoId,
          },
          res,
        );
        if (success) return;
      }
      this.logger.warn(
        `[RELAY] Laptop unavailable. Falling back to local/cloud processing.`,
      );
    }

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

    // Determine Proxy Usage:
    // - laptop-direct: activeProxy = null (0 proxies consumed)
    // - cloud / laptop-proxy: activeProxy = current proxy from pool
    let activeProxy: string | null = null;

    if (networkMode === 'laptop-direct') {
      this.logger.log(
        `[STREAM] Mode is LAPTOP-DIRECT: Zero proxy usage. Using local residential connection.`,
      );
      activeProxy = null;
    } else {
      activeProxy =
        this.proxyManager.getCurrentProxy() ||
        process.env.YOUTUBE_PROXY_URL ||
        null;
      if (activeProxy) {
        this.logger.log(
          `[STREAM] Streaming via proxy: ${this.proxyManager.maskProxy(activeProxy)} -> FFmpeg`,
        );
      } else {
        this.logger.log(
          `[STREAM] Streaming without proxy (Direct connection) -> FFmpeg`,
        );
      }
    }

    const cookiePath = this.getValidCookiePath();

    const ytdlpArgs = [
      '-f',
      '140/ba[ext=m4a]/ba/b',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--buffer-size',
      '1M',
      '--http-chunk-size',
      '10M',
      '--extractor-args',
      'youtube:player_client=android,web',
      '-o',
      '-',
      sanitizedUrl,
    ];

    if (activeProxy) {
      ytdlpArgs.push('--proxy', activeProxy);
    }
    if (cookiePath) {
      ytdlpArgs.push('--cookies', cookiePath);
    }

    const ffmpegArgs = [
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
      '-f',
      'mp3',
      'pipe:1',
    ];

    const ytdlpProc = spawn('yt-dlp', ytdlpArgs);
    const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

    let isCleanedUp = false;
    const cleanup = (reason: string) => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      try {
        ytdlpProc.kill('SIGTERM');
      } catch (_) {}
      try {
        ffmpegProc.kill('SIGTERM');
      } catch (_) {}

      if (!res.writableEnded) {
        res.end();
      }
    };

    ytdlpProc.stdout.on('error', (err: any) => {
      if (err.code !== 'EPIPE') this.logger.warn(`ytdlp stdout: ${err.message}`);
      cleanup('ytdlp stdout error');
    });

    ffmpegProc.stdin.on('error', (err: any) => {
      if (err.code !== 'EPIPE') this.logger.warn(`ffmpeg stdin: ${err.message}`);
      cleanup('ffmpeg stdin error');
    });

    ffmpegProc.stdout.on('error', (err: any) => {
      if (err.code !== 'EPIPE')
        this.logger.warn(`ffmpeg stdout: ${err.message}`);
      cleanup('ffmpeg stdout error');
    });

    ytdlpProc.on('error', (err) => {
      this.logger.error(`yt-dlp spawn failure: ${err.message}`);
      cleanup('ytdlp spawn error');
    });

    ffmpegProc.on('error', (err) => {
      this.logger.error(`ffmpeg spawn failure: ${err.message}`);
      cleanup('ffmpeg spawn error');
    });

    ytdlpProc.on('close', async (code) => {
      if (code !== 0) {
        this.logger.warn(`[STREAM INTERRUPTED] yt-dlp exited with code ${code}.`);

        if (activeProxy) {
          this.proxyManager.markProxyAsFailed(activeProxy);
        }

        // MODE 1 FAILOVER: If running on Render and proxy fails, failover to Laptop Relay
        if (networkMode === 'cloud' && laptopUrl && !res.headersSent) {
          this.logger.log(
            `[STREAM FAILOVER] Proxy failed on cloud. Delegating to Laptop Relay.`,
          );
          cleanup('failover to laptop');
          await this.relayFromLaptop(
            laptopUrl,
            {
              url: sanitizedUrl,
              title,
              channel,
              thumbnail: thumbnailUrl,
              duration,
              id: videoId,
            },
            res,
          );
          return;
        }

        cleanup('ytdlp exited with error');
      }
    });

    ffmpegProc.on('close', () => {
      cleanup('ffmpeg finished');
    });

    res.on('close', () => {
      cleanup('client disconnected');
    });

    ytdlpProc.stdout.pipe(ffmpegProc.stdin);
    ffmpegProc.stdout.pipe(res);
  }
}