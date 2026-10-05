import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, LogLevel } from '@nestjs/common';
import * as fs from 'fs';

async function bootstrap() {
  // Ensure cookies exist if passed via environment variable
  const cookiePath = '/tmp/cookies.txt';
  if (process.env.YOUTUBE_COOKIES_BASE64 && !fs.existsSync(cookiePath)) {
    try {
      const decodedCookies = Buffer.from(
        process.env.YOUTUBE_COOKIES_BASE64,
        'base64',
      ).toString('utf-8');
      fs.writeFileSync(cookiePath, decodedCookies);
      process.env.YOUTUBE_COOKIES_PATH = cookiePath;
      console.log(
        `[BOOT] Decoded YouTube cookies to ${cookiePath} (${decodedCookies.length} bytes)`,
      );
    } catch (err: any) {
      console.error('[BOOT] Failed to write decoded cookies:', err.message);
    }
  } else if (fs.existsSync(cookiePath)) {
    process.env.YOUTUBE_COOKIES_PATH = cookiePath;
    console.log(`[BOOT] Existing cookie file detected at ${cookiePath}`);
  } else {
    console.warn('[BOOT] No cookies configured. Proceeding without authentication.');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const logLevels: LogLevel[] = isProduction
    ? ['error', 'warn', 'log']
    : ['error', 'warn', 'log', 'debug', 'verbose'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  // Enable CORS and expose custom headers so React fetch() can read them
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    exposedHeaders: [
      'Content-Disposition',
      'X-Audio-Id',
      'X-Audio-Title',
      'X-Audio-Artist',
      'X-Audio-Duration',
      'X-Audio-Thumbnail',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Server running on port ${port}`);
}
bootstrap();