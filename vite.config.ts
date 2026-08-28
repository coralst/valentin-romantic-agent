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
  /*
   * Both ports come from the environment, defaulting to what they have always
   * been, so nothing changes for a normal `npm run dev` or for CI.
   *
   * They are overridable because worktrees collide on them. Two sessions running
   * E2E at once fight over 5173, and the loser silently tests the *winner's*
   * frontend against its own branch's assertions — green or red for reasons that
   * have nothing to do with the code under test. `PORT` is already the dev
   * server's own variable, so this just stops vite from hardcoding past it.
   *
   * `strictPort` is the other half. Vite's default is to step to 5174 when 5173 is
   * taken, which is the same failure wearing a friendlier face: Playwright and
   * `verify:local` both look at 5173 regardless. Refusing to start is the loud
   * version of a problem that is otherwise diagnosed by confusion.
   */
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: `http://localhost:${Number(process.env.PORT) || 3001}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${Number(process.env.PORT) || 3001}`,
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
    //
    // `infra/**` is a separate npm project: `aws-cdk-lib` lives in
    // infra/package.json, and CI installs only the root manifest. Collected from
    // here the CDK suite fails to load with ERR_MODULE_NOT_FOUND — and it passes
    // locally only because a stray infra/node_modules happens to exist, which is
    // the worst kind of green. Run it with `npm run test:infra`.
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**', 'infra/**'],
  },
});
