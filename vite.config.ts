import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
      '@server': path.resolve(__dirname, 'src/server'),
    },
  },
  server: {
    proxy: {
      '/ws': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Preserve Vitest's built-in excludes (node_modules, dist, .idea, etc.)
    // instead of replacing them; only add the Playwright e2e dir on top.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
