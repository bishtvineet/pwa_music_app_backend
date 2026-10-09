import {
  Controller,
  Post,
  Body,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Query,
  Get,
} from '@nestjs/common';
import { Response } from 'express';
import { YoutubeService } from '../youtube/youtube.service';
import { AudioService } from '../audio/audio.service';
import { ConvertRequestDto, NetworkMode } from './dto/convert-request.dto';
import { VideoInfoDto } from '../youtube/dto/video-info.dto';
import { YoutubeUrlPipe } from '../../common/pipes/youtube-url.pipe';
import { UpdateCookiesDto } from './dto/update-cookies.dto';
import * as fs from 'fs';

@Controller('converter')
export class ConverterController {
  private readonly logger = new Logger(ConverterController.name);

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly audioService: AudioService,
  ) {}

  // 1. PRIMARY: Instant oEmbed info endpoint (~200ms)
  @Post('info')
  @HttpCode(HttpStatus.OK)
  async getVideoInfo(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
    @Body('networkMode') networkMode?: NetworkMode,
  ): Promise<VideoInfoDto> {
    return this.youtubeService.getVideoMetadata(sanitizedUrl, networkMode);
  }

  // 2. DIAGNOSTIC: Test YouTube Official oEmbed directly
  @Post('info/oembed')
  @HttpCode(HttpStatus.OK)
  async getInfoOembed(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
  ): Promise<VideoInfoDto> {
    const videoId = this.youtubeService.extractVideoId(sanitizedUrl);
    return this.youtubeService.extractViaOembed(videoId, sanitizedUrl);
  }

  // 3. DIAGNOSTIC: Test local yt-dlp directly
  @Post('info/ytdlp')
  @HttpCode(HttpStatus.OK)
  async getInfoYtDlp(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
  ): Promise<VideoInfoDto> {
    return this.youtubeService.extractViaYtDlp(sanitizedUrl, true);
  }

  // 4. DIAGNOSTIC: Test Laptop Relay directly
  @Post('info/laptop')
  @HttpCode(HttpStatus.OK)
  async getInfoLaptop(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
  ): Promise<VideoInfoDto> {
    return this.youtubeService.extractViaLaptop(sanitizedUrl);
  }

  // 5. STATUS: Check Laptop connectivity
  @Get('laptop-status')
  getLaptopStatus() {
    return this.youtubeService.getLaptopStatus();
  }

  // 6. DOWNLOAD / STREAM MP3
  @Post('download')
  async downloadMp3(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
    @Body() body: ConvertRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const title = body?.title || 'audio';
    const channel = body?.channel || 'YouTube';
    const id = body?.id || this.youtubeService.extractVideoId(sanitizedUrl);
    const thumbnail = body?.thumbnail || '';
    const duration = body?.duration || 0;
    const mode: NetworkMode = body?.networkMode || 'cloud';

    await this.audioService.streamMp3(
      id,
      sanitizedUrl,
      title,
      channel,
      thumbnail,
      duration,
      res,
      mode,
      this.youtubeService.getLaptopUrl(),
    );
  }

  // 7. THUMBNAIL PROXY
  @Get('thumbnail')
  async getThumbnailProxy(
    @Query('url') imageUrl: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!imageUrl) {
      throw new BadRequestException('Image URL query parameter is required.');
    }

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        res.status(response.status).end();
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
    }
  }

  // 8. COOKIE SYNC (Resets circuit breaker automatically)
  @Post('cookies')
  @HttpCode(HttpStatus.OK)
  async updateCookies(
    @Body() body: UpdateCookiesDto,
  ): Promise<{ success: boolean; message: string; byteCount: number }> {
    const content = body.cookies?.trim();

    if (
      !content ||
      (!content.includes('.youtube.com') && !content.includes('youtube.com'))
    ) {
      throw new BadRequestException(
        'Invalid format. Must be a valid Netscape-formatted YouTube cookies.txt file containing .youtube.com entries.',
      );
    }

    const primaryPath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
    const runtimePath = '/tmp/runtime_cookies.txt';

    try {
      fs.writeFileSync(primaryPath, content, 'utf-8');
      fs.writeFileSync(runtimePath, content, 'utf-8');
      process.env.YOUTUBE_COOKIES_PATH = primaryPath;

      this.youtubeService.resetCircuit('Fresh cookies synced via drawer');

      return {
        success: true,
        message:
          'YouTube cookies successfully updated and circuit breaker reset.',
        byteCount: Buffer.byteLength(content),
      };
    } catch (err: any) {
      throw new BadRequestException(`Could not save cookies: ${err.message}`);
    }
  }
}