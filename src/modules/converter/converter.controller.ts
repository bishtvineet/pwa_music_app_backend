import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ConvertRequestDto } from './dto/convert-request.dto';
import { YoutubeUrlPipe } from '../../common/pipes/youtube-url.pipe';
import { YoutubeService } from '../youtube/youtube.service';
import { AudioService } from '../audio/audio.service';
import { VideoInfoDto } from '../youtube/dto/video-info.dto';

@Controller('converter')
export class ConverterController {
  private readonly logger = new Logger(ConverterController.name);

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly audioService: AudioService,
  ) {}

  @Post('info')
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: ConvertRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.debug(`[TESTING] Controller handling /download for: ${sanitizedUrl}`);

    const metadata = await this.youtubeService.getVideoMetadata(sanitizedUrl);

    await this.audioService.streamMp3(
      metadata.id,
      sanitizedUrl,
      metadata.title,
      metadata.channel,
      metadata.thumbnail,
      metadata.duration,
      res,
    );
  }
}