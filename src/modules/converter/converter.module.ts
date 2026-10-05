import { Module } from '@nestjs/common';
import { ConverterController } from './converter.controller';
import { ConverterService } from './converter.service';
import { YoutubeModule } from '../youtube/youtube.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [YoutubeModule, AudioModule],
  controllers: [ConverterController],
  providers: [ConverterService],
})
export class ConverterModule {}