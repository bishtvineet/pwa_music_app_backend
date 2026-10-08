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
  Get
} from '@nestjs/common';
import { Response } from 'express';
import { YoutubeService } from '../youtube/youtube.service';
import { AudioService } from '../audio/audio.service';
import { ConvertRequestDto } from './dto/convert-request.dto';
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
  ) { }

  @Post('info')
  @HttpCode(HttpStatus.OK)
  async getVideoInfo(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: ConvertRequestDto,
  ): Promise<VideoInfoDto> {
    this.logger.debug(`[TESTING] Controller handling /info for: ${sanitizedUrl}`);
    return this.youtubeService.getVideoMetadata(sanitizedUrl);
  }

  @Post('download')
  async downloadMp3(
    @Body('url', YoutubeUrlPipe) sanitizedUrl: string,
    @Body() body: ConvertRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.debug(`[TESTING] Controller handling /download for: ${sanitizedUrl}`);

    // If frontend already provided title/channel from /info, use them immediately!
    // Otherwise fallback to basic placeholders — NO 6-second network wait!
    const title = (body as any)?.title || 'audio';
    const channel = (body as any)?.channel || 'YouTube';
    const id = (body as any)?.id || '';
    const thumbnail = (body as any)?.thumbnail || '';
    const duration = (body as any)?.duration || 0;

    await this.audioService.streamMp3(
      id,
      sanitizedUrl,
      title,
      channel,
      thumbnail,
      duration,
      res,
    );
  }

  // Add this route to your ConverterController
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
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
    }
  }

  // Inside ConverterController:
  @Post('cookies')
@HttpCode(HttpStatus.OK)
async updateCookies(
  @Body() body: UpdateCookiesDto,
): Promise<{ success: boolean; message: string; byteCount: number }> {
  this.logger.log('====================================================');
  this.logger.log('[COOKIES-UPDATE] Received cookie sync request from client');

  const content = body.cookies?.trim();

  // Validate Netscape format for YouTube
  if (
    !content ||
    (!content.includes('.youtube.com') && !content.includes('youtube.com'))
  ) {
    this.logger.error('[COOKIES-UPDATE] Validation failed: Missing youtube.com domain identifiers');
    this.logger.log('====================================================');
    throw new BadRequestException(
      'Invalid format. Must be a valid Netscape-formatted YouTube cookies.txt file containing .youtube.com entries.',
    );
  }

  const primaryPath = process.env.YOUTUBE_COOKIES_PATH || '/tmp/cookies.txt';
  const runtimePath = '/tmp/runtime_cookies.txt';

  try {
    // 1. Write to the primary file (mounted from host, persists on Windows)
    fs.writeFileSync(primaryPath, content, 'utf-8');
    const primaryStats = fs.statSync(primaryPath);

    // 2. Write directly to the runtime scratchpad (used directly by yt-dlp)
    fs.writeFileSync(runtimePath, content, 'utf-8');
    const runtimeStats = fs.statSync(runtimePath);

    // 3. Keep environment pointer synced
    process.env.YOUTUBE_COOKIES_PATH = primaryPath;

    // Log verification details for docker logs
    this.logger.log(`[COOKIES-UPDATE] Primary file written: ${primaryPath} (${primaryStats.size} bytes)`);
    this.logger.log(`[COOKIES-UPDATE] Runtime file written: ${runtimePath} (${runtimeStats.size} bytes)`);
    this.logger.log('[COOKIES-UPDATE] First 2 lines preview:');
    content
      .split('\n')
      .slice(0, 2)
      .forEach((line) => this.logger.log(`  > ${line}`));
    this.logger.log('[COOKIES-UPDATE] Cookies successfully reloaded into active memory!');
    this.logger.log('====================================================');

    return {
      success: true,
      message: 'YouTube cookies successfully updated and reloaded.',
      byteCount: primaryStats.size,
    };
  } catch (err: any) {
    this.logger.error(`[COOKIES-UPDATE] Failed to write cookie files: ${err.message}`);
    this.logger.log('====================================================');
    throw new BadRequestException(`Could not save cookies: ${err.message}`);
  }
}
}