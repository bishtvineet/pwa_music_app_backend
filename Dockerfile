# ==========================================
# Stage 1: Build the NestJS application
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for compilation
COPY package*.json ./
RUN npm ci

# Copy source code and build configs
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# ==========================================
# Stage 2: Production runtime image
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime binaries: python3, ffmpeg, ca-certificates, curl
RUN apk add --no-cache \
    python3 \
    ffmpeg \
    ca-certificates \
    curl

# Install standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install production-only Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript output from builder stage
COPY --from=builder /app/dist ./dist

# Create entrypoint script:
# 1. Strips carriage returns & newlines before decoding Base64 cookies to prevent Alpine BusyBox truncation.
# 2. Exports YOUTUBE_COOKIES_PATH for NestJS / yt-dlp.
# 3. Executes the application via node directly.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'if [ -n "$YOUTUBE_COOKIES_BASE64" ]; then' \
    '  echo "[entrypoint] Decoding YouTube cookies from base64..."' \
    '  echo "$YOUTUBE_COOKIES_BASE64" | tr -d "\r\n" | base64 -d > /tmp/cookies.txt' \
    '  export YOUTUBE_COOKIES_PATH=/tmp/cookies.txt' \
    '  echo "[entrypoint] Cookies written to /tmp/cookies.txt"' \
    'fi' \
    'exec node dist/main.js' \
    > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
# Defaults to 3001; cloud platforms like Render override this via runtime env
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/app/entrypoint.sh"]