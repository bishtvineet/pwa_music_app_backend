import { Module } from '@nestjs/common';
import { AudioService } from './audio.service';
import { YoutubeModule } from '../youtube/youtube.module'; // 1. Add this import

@Module({
  imports: [YoutubeModule],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}