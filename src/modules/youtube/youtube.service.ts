import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { VideoInfoDto } from './dto/video-info.dto';
import { ProxyManagerService } from './proxy-manager.service';
import { NetworkMode } from '../converter/dto/convert-request.dto';

interface CircuitState {
  isYtDlpBlocked: boolean;
  blockedAt: number | null;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  // Set LAPTOP_BACKEND_URL in Render environment (e.g. https://vineetbisht.tail02b0f1.ts.net)
  private readonly laptopUrl =
    process.env.LAPTOP_BACKEND_URL?.replace(/\/$/, '') || '';
  private isLaptopOnline = false;

  private circuit: CircuitState = {
    isYtDlpBlocked: false,
    blockedAt: null,
  };

  constructor(private readonly proxyManager: ProxyManagerService) {
    if (this.laptopUrl) {
      this.checkLaptopHealth();
      setInterval(() => this.checkLaptopHealth(), 2 * 60 * 1000);
    }
  }

  async checkLaptopHealth(): Promise<boolean> {
    if (!this.laptopUrl) {
      this.isLaptopOnline = false;
      return false;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${this.laptopUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      this.isLaptopOnline = res.ok;
      return res.ok;
    } catch {
      this.isLaptopOnline = false;
      return false;
    }
  }

  public getLaptopStatus() {
    return {
      configured: Boolean(this.laptopUrl),
      online: this.isLaptopOnline,
      url: this.laptopUrl,
    };
  }

  public getLaptopUrl(): string {
    return this.laptopUrl;
  }

  public resetCircuit(reason: string = 'Manual trigger'): void {
    this.circuit = { isYtDlpBlocked: false, blockedAt: null };
    this.logger.log(`[CIRCUIT] Local yt-dlp circuit reset. Reason: ${reason}`);
  }

  public extractVideoId(url: string): string {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new BadRequestException('Invalid YouTube URL');
    return match[1];
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

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

  // ==========================================
  // FAST ENGINE: YouTube Official oEmbed (~200ms)
  // ==========================================
  async extractViaOembed(
    videoId: string,
    originalUrl: string,
  ): Promise<VideoInfoDto> {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`oEmbed failed with status: ${res.status}`);
    }

    const data: any = await res.json();

    return {
      id: videoId,
      title: data.title || 'Unknown Title',
      channel: data.author_name || 'YouTube Artist',
      duration: 0,
      durationFormatted: '--:--',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      originalUrl,
      streamM4aUrl: `/converter/stream/${videoId}`,
    };
  }

  // ==========================================
  // DIAGNOSTIC HELPER: yt-dlp Subprocess
  // ==========================================
  public runYtDlpProcess(
    sanitizedUrl: string,
    proxyUrl: string | null,
    useCookies = true,
  ): Promise<VideoInfoDto> {
    return new Promise((resolve, reject) => {
      const cookiePath = useCookies ? this.getValidCookiePath() : null;

      const args = [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--flat-playlist',
        sanitizedUrl,
      ];

      if (proxyUrl) args.push('--proxy', proxyUrl);
      if (cookiePath) {
        args.push(
          '--cookies',
          cookiePath,
          '--extractor-args',
          'youtube:player_client=android,web',
        );
      }

      const child = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(
            new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 150)}`),
          );
        }

        try {
          const raw = JSON.parse(stdout);
          const duration = Number(raw.duration) || 0;
          let thumbnail = raw.thumbnail || '';
          if (
            !thumbnail &&
            Array.isArray(raw.thumbnails) &&
            raw.thumbnails.length > 0
          ) {
            thumbnail =
              raw.thumbnails[raw.thumbnails.length - 1]?.url || '';
          }

          resolve({
            id: raw.id,
            title: raw.title,
            channel:
              raw.uploader || raw.channel || raw.artist || 'Unknown Artist',
            duration,
            durationFormatted: this.formatDuration(duration),
            thumbnail,
            originalUrl: sanitizedUrl,
            streamM4aUrl: `/converter/stream/${raw.id}`,
          });
        } catch {
          reject(new Error('Failed to parse yt-dlp JSON'));
        }
      });

      child.on('error', (err) =>
        reject(new Error(`yt-dlp spawn error: ${err.message}`)),
      );
    });
  }

  // ==========================================
  // DIAGNOSTIC ENDPOINT HANDLER: extractViaYtDlp
  // ==========================================
  async extractViaYtDlp(
    sanitizedUrl: string,
    useCookies = true,
  ): Promise<VideoInfoDto> {
    const activeProxy = this.proxyManager.getCurrentProxy();

    if (activeProxy) {
      try {
        this.logger.log(
          `[YT-DLP] Extraction via proxy: ${this.proxyManager.maskProxy(activeProxy)}`,
        );
        return await this.runYtDlpProcess(sanitizedUrl, activeProxy, useCookies);
      } catch (proxyErr: any) {
        this.logger.warn(
          `[YT-DLP] Proxy failed (${proxyErr.message}). Disabling this proxy.`,
        );
        this.proxyManager.markProxyAsFailed(activeProxy);
      }
    }

    const envProxy = process.env.YOUTUBE_PROXY_URL || null;
    return this.runYtDlpProcess(sanitizedUrl, envProxy, useCookies);
  }

  // ==========================================
  // DIAGNOSTIC / RELAY: Laptop Relay via Tailscale
  // ==========================================
  async extractViaLaptop(url: string): Promise<VideoInfoDto> {
    if (!this.laptopUrl) {
      throw new BadRequestException(
        'LAPTOP_BACKEND_URL is not configured on this host.',
      );
    }
    if (!this.isLaptopOnline) {
      await this.checkLaptopHealth();
      if (!this.isLaptopOnline) {
        throw new BadRequestException(
          'Laptop relay is offline or unreachable via Tailscale.',
        );
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${this.laptopUrl}/converter/info`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, networkMode: 'laptop-direct' }),
    });
    clearTimeout(timeout);

    if (!res.ok)
      throw new Error(`Laptop rejected extraction: HTTP ${res.status}`);
    return (await res.json()) as VideoInfoDto;
  }

  // ==========================================
  // MASTER METADATA PIPELINE
  // ==========================================
  async getVideoMetadata(
    sanitizedUrl: string,
    mode?: NetworkMode,
  ): Promise<VideoInfoDto> {
    const videoId = this.extractVideoId(sanitizedUrl);

    // If client explicitly requests laptop relay extraction
    if (mode === 'laptop-relay') {
      try {
        return await this.extractViaLaptop(sanitizedUrl);
      } catch (err: any) {
        this.logger.warn(
          `Laptop metadata extraction failed: ${err.message}. Falling back to instant oEmbed.`,
        );
      }
    }

    // Default primary fast path: YouTube oEmbed
    try {
      return await this.extractViaOembed(videoId, sanitizedUrl);
    } catch (err: any) {
      this.logger.error(`oEmbed extraction failed: ${err.message}`);
      throw new InternalServerErrorException(
        'Unable to retrieve video metadata.',
      );
    }
  }
}