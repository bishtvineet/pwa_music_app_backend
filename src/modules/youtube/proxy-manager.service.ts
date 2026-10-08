import { Injectable, Logger } from '@nestjs/common';
import { PROXY_PROVIDERS } from '../../config/proxy.config';

@Injectable()
export class ProxyManagerService {
  private readonly logger = new Logger(ProxyManagerService.name);
  private pool: string[] = [];
  private deadProxies: Set<string> = new Set();
  private currentIndex = 0;

  constructor() {
    this.refreshPool();
  }

  refreshPool(): void {
    const list: string[] = [];
    for (const [key, provider] of Object.entries(PROXY_PROVIDERS)) {
      if (provider.enabled) {
        list.push(...provider.proxies);
        this.logger.log(`[PROXY POOL] Loaded ${provider.proxies.length} proxies from ${provider.name} (${key})`);
      }
    }
    this.pool = list;
    this.deadProxies.clear();
    this.logger.log(`[PROXY POOL] Total initial active proxies: ${this.pool.length}`);
  }

  getCurrentProxy(): string | null {
    if (this.pool.length === 0) return null;
    return this.pool[this.currentIndex % this.pool.length];
  }

  rotate(): void {
    if (this.pool.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.pool.length;
    this.logger.warn(`[PROXY ROTATE] Switched to index #${this.currentIndex}: ${this.maskProxy(this.getCurrentProxy())}`);
  }

  /**
   * Permanently disable a dead/blocked proxy from the pool for this runtime.
   * If all proxies are removed, pool length becomes 0 and calls drop to direct local yt-dlp.
   */
  markProxyAsFailed(failedProxy: string | null): void {
    if (!failedProxy) return;

    const index = this.pool.indexOf(failedProxy);
    if (index !== -1) {
      this.pool.splice(index, 1);
      this.deadProxies.add(failedProxy);
      this.logger.error(
        `[PROXY REMOVED] Permanently disabled proxy: ${this.maskProxy(failedProxy)}. Remaining active proxies: ${this.pool.length}`,
      );

      if (this.pool.length === 0) {
        this.logger.warn(`[PROXY POOL EXHAUSTED] All proxies failed. Fallback locked permanently to Direct Local yt-dlp.`);
      } else {
        this.currentIndex = this.currentIndex % this.pool.length;
        this.logger.log(`[PROXY FAILOVER] Next ready proxy: ${this.maskProxy(this.getCurrentProxy())}`);
      }
    }
  }

  public maskProxy(proxy: string | null): string {
    if (!proxy) return 'None';
    try {
      const url = new URL(proxy);
      return `${url.protocol}//${url.username ? '***:***@' : ''}${url.host}`;
    } catch {
      return proxy;
    }
  }
}