import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/chat': {
        target: process.env.PI_BRIDGE_ORIGIN ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
