import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // /audio-proxy/7.mp3  →  https://cdn.islamic.network/quran/audio/128/ar.alafasy/7.mp3
      // Same-origin from the browser's perspective → no CORS, SW can read ArrayBuffer → IDB
      '/audio-proxy': {
        target: 'https://cdn.islamic.network/quran/audio/128/ar.alafasy',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/audio-proxy/, ''),
      },
    },
  },
});