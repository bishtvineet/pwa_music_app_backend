import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCookiesDto {
  @IsNotEmpty({ message: 'Cookie content cannot be empty' })
  @IsString()
  cookies!: string;
}