import {
  IsNotEmpty,
  IsString,
  IsUrl,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class ConvertRequestDto {
  @IsNotEmpty({ message: 'YouTube URL is required' })
  @IsString({ message: 'YouTube URL must be a valid string' })
  @IsUrl(
    { require_protocol: true },
    { message: 'Please provide a valid URL with protocol (http/https)' },
  )
  url!: string;

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  thumbnail?: string;

  @IsOptional()
  @IsNumber()
  duration?: number;
}