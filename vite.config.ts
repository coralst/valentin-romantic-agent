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
    // `infra/**` is a separate npm project: `aws-cdk-lib` lives in
    // infra/package.json, and CI installs only the root manifest. Collected from
    // here the CDK suite fails to load with ERR_MODULE_NOT_FOUND — and it passes
    // locally only because a stray infra/node_modules happens to exist, which is
    // the worst kind of green. Run it with `npm run test:infra`.
    exclude: [...configDefaults.exclude, 'e2e/**', 'infra/**'],
  },
});
