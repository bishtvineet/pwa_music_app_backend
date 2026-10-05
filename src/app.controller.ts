import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { spawn } from 'child_process';
import * as fs from 'fs';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): { status: string; timestamp: number } {
    return { status: 'ok', timestamp: Date.now() };
  }

  @Get('debug-ytdlp')
  async debugYtdlp(@Query('url') url?: string): Promise<any> {
    const targetUrl = url || 'https://youtu.be/dQw4w9WgXcQ';
    const cookiePath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';

    const cookieExists = fs.existsSync(cookiePath);
    let cookieSize = 0;
    let cookiePreview = '';

    if (cookieExists) {
      const content = fs.readFileSync(cookiePath, 'utf-8');
      cookieSize = content.length;
      // Show first 3 lines to verify valid Netscape format headers (# Netscape HTTP Cookie File)
      cookiePreview = content.split('\n').slice(0, 3).join('\n');
    }

    return new Promise((resolve) => {
      const args = [
        '--list-formats',
        '--no-check-certificates',
        '--no-warnings',
        '--js-runtimes',
        'node',
        '--extractor-args',
        'youtube:player_client=mweb,tv_simply,web_creator',
        targetUrl,
      ];

      if (cookieExists) {
        args.push('--cookies', cookiePath);
      }

      const proc = spawn('yt-dlp', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));

      proc.on('close', (code) => {
        resolve({
          exitCode: code,
          cookieDiagnostics: {
            cookiePath,
            cookieExists,
            cookieSize,
            cookiePreview,
          },
          stdout: stdout.split('\n').filter(Boolean).slice(-25),
          stderr: stderr,
        });
      });
    });
  }
}