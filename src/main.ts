import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, LogLevel } from '@nestjs/common';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  // In production (Render): only show errors, warnings, and standard app logs
  // In development: include 'debug' and 'verbose' logs
  const logLevels: LogLevel[] = isProduction
    ? ['error', 'warn', 'log']
    : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  // Enable CORS with exposed headers so React's fetch() can read custom metadata
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    exposedHeaders: [
      'Content-Disposition',
      'X-Audio-Title',
      'X-Audio-Artist',
      'X-Audio-Duration',
      'X-Audio-Thumbnail',
    ],
  });

  // Automatically validate and transform incoming payload DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`running: ${port}`);
}
bootstrap();