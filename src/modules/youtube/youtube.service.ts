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

interface CircuitState {
  isYtDlpBlocked: boolean;
  blockedAt: number | null;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  // Laptop Proxy Configuration (set LAPTOP_BACKEND_URL in Render env)
  private readonly laptopUrl = process.env.LAPTOP_BACKEND_URL?.replace(/\/$/, '') || '';
  private isLaptopOnline = false;

  private circuit: CircuitState = {
    isYtDlpBlocked: false,
    blockedAt: null,
  };

  private readonly CIRCUIT_RESET_MS = 30 * 60 * 1000;

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
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.laptopUrl}/health`, { signal: controller.signal });
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

  // ==========================================
  // ENGINE 1: YouTube Official oEmbed (Cloud Safe, Never Blocked)
  // ==========================================
  async extractViaOembed(videoId: string, originalUrl: string): Promise<VideoInfoDto> {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

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
  // ENGINE 2: Laptop Relay (Tailscale Funnel)
  // ==========================================
  async extractViaLaptop(url: string): Promise<VideoInfoDto> {
    if (!this.laptopUrl) {
      throw new BadRequestException('LAPTOP_BACKEND_URL is not configured.');
    }
    if (!this.isLaptopOnline) {
      await this.checkLaptopHealth();
      if (!this.isLaptopOnline) {
        throw new BadRequestException('Laptop relay is currently offline or unreachable.');
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(`${this.laptopUrl}/converter/info/ytdlp`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`Laptop rejected extraction with status ${res.status}`);
    return (await res.json()) as VideoInfoDto;
  }

  // ==========================================
  // Helper: Low-level yt-dlp process spawn
  // ==========================================
  private runYtDlpProcess(sanitizedUrl: string, proxyUrl: string | null, useCookies = true): Promise<VideoInfoDto> {
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
        args.push('--cookies', cookiePath, '--extractor-args', 'youtube:player_client=android,web');
      }

      const child = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 150)}`));
        }

        try {
          const raw = JSON.parse(stdout);
          const duration = Number(raw.duration) || 0;
          let thumbnail = raw.thumbnail || '';
          if (!thumbnail && Array.isArray(raw.thumbnails) && raw.thumbnails.length > 0) {
            thumbnail = raw.thumbnails[raw.thumbnails.length - 1]?.url || '';
          }

          resolve({
            id: raw.id,
            title: raw.title,
            channel: raw.uploader || raw.channel || raw.artist || 'Unknown Artist',
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

      child.on('error', (err) => reject(new Error(`yt-dlp spawn error: ${err.message}`)));
    });
  }

  // ==========================================
  // ENGINE 3: Resilient yt-dlp (Proxy First -> Direct Fallback)
  // ==========================================
  async extractViaYtDlp(sanitizedUrl: string, useCookies = true): Promise<VideoInfoDto> {
    const activeProxy = this.proxyManager.getCurrentProxy();

    // 1. Try active proxy from pool first
    if (activeProxy) {
      try {
        this.logger.log(`[YT-DLP] Attempting extraction via proxy: ${this.proxyManager.maskProxy(activeProxy)}`);
        const result = await this.runYtDlpProcess(sanitizedUrl, activeProxy, useCookies);
        this.logger.log(`[YT-DLP] Proxy extraction succeeded for: ${result.title}`);
        return result;
      } catch (proxyErr: any) {
        this.logger.warn(`[YT-DLP] Proxy failed (${proxyErr.message}). Disabling this proxy.`);
        // Eject bad proxy permanently
        this.proxyManager.markProxyAsFailed(activeProxy);
      }
    }

    // 2. Direct fallback (Runs if proxy failed OR pool is completely exhausted)
    const envProxy = process.env.YOUTUBE_PROXY_URL || null;
    this.logger.log(`[YT-DLP] Running via standard connection (${envProxy ? 'via env proxy' : 'direct local'})...`);
    return this.runYtDlpProcess(sanitizedUrl, envProxy, useCookies);
  }

  // ==========================================
  // MASTER METADATA PIPELINE (Auto Failover)
  // ==========================================
  async getVideoMetadata(sanitizedUrl: string): Promise<VideoInfoDto> {
    const videoId = this.extractVideoId(sanitizedUrl);

    // 1. Try local/proxy yt-dlp (runs when circuit is closed)
    if (!this.circuit.isYtDlpBlocked) {
      try {
        return await this.extractViaYtDlp(sanitizedUrl, true);
      } catch (err: any) {
        this.logger.warn(`[METADATA] Local/Proxy yt-dlp failed: ${err.message}`);
        this.circuit = { isYtDlpBlocked: true, blockedAt: Date.now() };
      }
    }

    // 2. Try Laptop Relay if Render has it configured and it's online
    if (this.laptopUrl && this.isLaptopOnline) {
      try {
        this.logger.log(`[METADATA] Routing extraction to Laptop Relay: ${this.laptopUrl}`);
        return await this.extractViaLaptop(sanitizedUrl);
      } catch (err: any) {
        this.logger.warn(`[METADATA] Laptop relay failed: ${err.message}`);
      }
    }

    // 3. Failover: Official YouTube oEmbed (Never blocked by cloud IPs)
    try {
      this.logger.debug(`[METADATA] Using YouTube oEmbed for: ${videoId}`);
      return await this.extractViaOembed(videoId, sanitizedUrl);
    } catch (err: any) {
      this.logger.error(`[METADATA] oEmbed extraction failed: ${err.message}`);
    }

    throw new InternalServerErrorException('Unable to retrieve video metadata.');
  }
}