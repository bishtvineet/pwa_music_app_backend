import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { AudioModule } from './modules/audio/audio.module';
import { ConverterModule } from './modules/converter/converter.module';

@Module({
  imports: [YoutubeModule, AudioModule, ConverterModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
