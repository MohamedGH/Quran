import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/audio-proxy': {
        target: 'https://cdn.islamic.network/quran/audio/128/ar.alafasy',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/audio-proxy/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
  },
});
