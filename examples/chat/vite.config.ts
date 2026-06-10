import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const bridgeOrigin = process.env.PI_BRIDGE_ORIGIN ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api/chat': {
        target: bridgeOrigin,
        changeOrigin: true,
      },
      '/api/workspace': {
        target: bridgeOrigin,
        changeOrigin: true,
      },
    },
  },
});
