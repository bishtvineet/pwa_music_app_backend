export class VideoInfoDto {
  id!: string;
  title!: string;
  channel!: string;
  duration!: number; // in seconds
  durationFormatted!: string; // e.g. "03:45"
  thumbnail!: string;
  originalUrl!: string;
  streamM4aUrl?: string; // Optional non-breaking addition
}