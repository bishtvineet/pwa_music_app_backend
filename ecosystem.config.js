module.exports = {
  apps: [
    {
      name: 'yt-audio-backend',
      script: 'dist/main.js',
      // Fixed to 2 workers to leave CPU headroom for other local projects
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
    },
  ],
};