import {
  PipeTransform,
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class YoutubeUrlPipe implements PipeTransform<string, string> {
  private readonly logger = new Logger(YoutubeUrlPipe.name);

  // Regex handles:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/shorts/VIDEO_ID
  // - https://m.youtube.com/watch?v=VIDEO_ID
  // - Query strings like ?si=..., &t=..., &feature=share
  private readonly youtubeRegex =
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

  transform(value: string): string {
    this.logger.debug(`[TESTING] Incoming raw URL for validation: "${value}"`);

    if (!value || typeof value !== 'string') {
      this.logger.warn(`Validation failed: URL is empty or not a string`);
      throw new BadRequestException('A valid YouTube URL string is required');
    }

    const trimmedUrl = value.trim();
    const match = trimmedUrl.match(this.youtubeRegex);

    if (!match || !match[1]) {
      this.logger.warn(`[TESTING] Invalid YouTube URL pattern: "${trimmedUrl}"`);
      throw new BadRequestException(
        'Invalid YouTube URL. Please provide a standard watch, shorts, or youtu.be link.',
      );
    }

    const videoId = match[1];
    const sanitizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

    this.logger.debug(`[TESTING] Extracted Video ID: ${videoId}`);
    this.logger.debug(`[TESTING] Sanitized Canonical URL: ${sanitizedUrl}`);

    return sanitizedUrl;
  }
}