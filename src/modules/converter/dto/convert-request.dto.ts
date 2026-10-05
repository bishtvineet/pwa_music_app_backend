import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class ConvertRequestDto {
  @IsNotEmpty({ message: 'YouTube URL is required' })
  @IsString({ message: 'YouTube URL must be a valid string' })
  @IsUrl(
    { require_protocol: true },
    { message: 'Please provide a valid URL with protocol (http/https)' },
  )
  url!: string;
}