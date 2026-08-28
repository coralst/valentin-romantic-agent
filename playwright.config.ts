import { defineConfig, devices } from '@playwright/test';

/*
 * Ports and the results directory all come from the environment, defaulting to what
 * they have always been — CI is unaffected.
 *
 * They are overridable because a second worktree running E2E concurrently collides
 * on 5173, 3001 *and* `test-results/`, and the collision is silent: the run that
 * loses the port tests the other branch's frontend, and the two runs overwrite each
 * other's traces. `PORT`/`VITE_PORT` are the same variables vite.config.ts reads, so
 * one pair of exports moves the whole stack:
 *
 *   PORT=3011 VITE_PORT=5183 PW_RESULTS=test-results-mine npx playwright test
 */
const BACKEND_PORT = Number(process.env.PORT) || 3001;
const FRONTEND_PORT = Number(process.env.VITE_PORT) || 5173;

export default defineConfig({
  testDir: 'e2e/tests',
  outputDir: process.env.PW_RESULTS || 'test-results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run dev:server',
      port: BACKEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: 'npm run dev',
      port: FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
