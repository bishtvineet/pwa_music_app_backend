import { Module } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import { ProxyManagerService } from './proxy-manager.service';

@Module({
  providers: [YoutubeService, ProxyManagerService],
  exports: [YoutubeService, ProxyManagerService],
})
export class YoutubeModule {}