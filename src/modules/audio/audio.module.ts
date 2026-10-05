import { Module } from '@nestjs/common';
import { AudioService } from './audio.service';

@Module({
  providers: [AudioService],
  exports: [AudioService], // <-- Crucial: Must be exported
})
export class AudioModule {}