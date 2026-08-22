/**
 * Temporary local config for the session-lifecycle work.
 *
 * Identical to vite.config.ts except the proxy target and port: ~20 sibling
 * worktrees share this machine and :3001/:3031 are already held by other runs.
 * Delete once the session-lifecycle branch is verified.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const BACKEND = 'http://localhost:3411';

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
    port: 5411,
    strictPort: true,
    proxy: {
      '/ws': { target: BACKEND, ws: true },
      '/api': { target: BACKEND },
    },
  },
});
