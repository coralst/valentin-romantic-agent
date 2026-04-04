/**
 * Smoke test: boots the backend server, verifies the health endpoint responds,
 * then exits. Used in CI to ensure dev:full would work.
 */
import { createServer } from '../src/server/index';
import express from 'express';
import { createServer as createHttpServer } from 'http';

const PORT = Number(process.env.SMOKE_PORT) || 3099;
const TIMEOUT_MS = 10_000;

async function main() {
  console.log('[smoke-test] Starting server...');

  const { httpRoutes } = createServer();

  const app = express();
  app.get('/api/health', async (_req, res) => {
    const result = await httpRoutes.health();
    res.status(result.status).json(result.body);
  });

  const server = createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start within ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    server.listen(PORT, async () => {
      clearTimeout(timer);
      console.log(`[smoke-test] Server listening on port ${PORT}`);

      try {
        const res = await fetch(`http://localhost:${PORT}/api/health`);
        if (!res.ok) {
          throw new Error(`Health check returned ${res.status}`);
        }
        const body = await res.json();
        if (body.status !== 'ok') {
          throw new Error(`Health check body unexpected: ${JSON.stringify(body)}`);
        }
        console.log('[smoke-test] Health check passed:', body);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });

    server.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  console.log('[smoke-test] All checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke-test] FAILED:', err);
  process.exit(1);
});
