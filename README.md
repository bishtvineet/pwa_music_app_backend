# 🎵 PWA Music Player Engine (Backend API)

A high-performance, stateless audio transcoding and metadata extraction service built with **NestJS**, **FFmpeg**, and **yt-dlp**. 

Engineered specifically as a companion backend for an offline-first **iOS Safari React PWA**, allowing zero-cost personal music archiving with zero cloud storage dependency. The service runs seamlessly within **Render's Free Tier (512 MB RAM limit)** with strict resource management and automated YouTube bot evasion.

---

## 🌟 Key Highlights

- **Stateless Pipeline:** Zero persistent disk or cloud database overhead. Audio is transcoded on-the-fly and piped directly to the client.
- **Client-Centric Offline Storage:** Optimized to pass raw MP3 binaries and rich headers (`X-Audio-*`) directly to client-side **IndexedDB** on iOS (iPhone 16 Pro Max Safari PWA).
- **ID3v2.3 + Cover Art Muxing:** Converts modern YouTube WebP thumbnails into true baseline JPEGs and embeds them alongside ID3v2.3 tags (`TIT2`, `TPE1`, `APIC`), ensuring native compatibility with iOS Lock Screen/Dynamic Island, Windows Explorer, and VLC.
- **Bot Evasion on Cloud Datacenters:** Entrypoint script dynamically decodes Base64-encoded cookie files (`YOUTUBE_COOKIES_BASE64`) to bypass YouTube's IP blocks and bot captchas on cloud infrastructure.
- **Multi-Stage Docker Packaging:** Alpine-based build keeps image size minimal and runtime memory consumption below 250 MB.

---

## 🏗️ Architecture & Data Flow

```text
[ React PWA / iPhone ]
        │
        ├── 1. POST /converter/info ──────────────┐
        │   (Pre-fetch Title, Artist, Thumbnail)   ▼
        │                                   [ yt-dlp Metadata ]
        │                                         │
        ├── 2. POST /converter/download ──────────┤
        │                                         ▼
        │                              [ yt-dlp Audio Stream ]
        │                                         │ (pipe:0)
        │                                         ▼
        │                              [ FFmpeg Transcoder ] <─── [ JPEG Converter ]
        │                                         │                (Thumbnails)
        │                                         ▼
        │                              [ Seekable MP3 + ID3v2.3 ]
        │                                         │
        ▼                                         ▼
[ iOS IndexedDB Storage ] <─── (Stream + Headers: X-Audio-*)