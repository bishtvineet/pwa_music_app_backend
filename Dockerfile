# Stage 1: Build the NestJS application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production runtime image
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime binaries: python3, ffmpeg, curl, ca-certificates
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    ca-certificates \
    curl

# Install the standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist

# Create an entrypoint startup script to decode cookies if provided
RUN echo '#!/bin/sh' > /app/entrypoint.sh \
    && echo 'if [ -n "$YOUTUBE_COOKIES_BASE64" ]; then' >> /app/entrypoint.sh \
    && echo '  echo "Decoding YouTube cookies from base64..."' >> /app/entrypoint.sh \
    && echo '  echo "$YOUTUBE_COOKIES_BASE64" | base64 -d > /tmp/cookies.txt' >> /app/entrypoint.sh \
    && echo '  export YOUTUBE_COOKIES_PATH=/tmp/cookies.txt' >> /app/entrypoint.sh \
    && echo 'fi' >> /app/entrypoint.sh \
    && echo 'exec node dist/main.js' >> /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]