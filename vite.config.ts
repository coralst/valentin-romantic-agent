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
    // instead of replacing them; only add ours on top.
    //
    // `.claude/**` holds agent worktrees — full copies of this repo. Without it
    // vitest globs into them and runs every test several times over, which
    // exhausts memory rather than merely being slow.
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
  },
});
