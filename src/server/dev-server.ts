import { createServer as createHttpServer } from 'http';
import { createServer } from './index';
import { createExpressApp, type LogFn } from './http/express-app';
import { attachWebSocket } from './http/attach-websocket';
import { isAuthDisabled } from './auth/token-verifier';

const PORT = Number(process.env.PORT) || 3001;

/**
 * Plain-text logging, because a human is reading this terminal. The route table
 * and the WebSocket handling are shared with prod-server.ts — they used to be
 * duplicated here and had already drifted apart.
 */
const log: LogFn = (level, message, meta) => {
  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = `[dev-server] ${message}${suffix}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

const { gateway, verifier, forUser } = createServer();

const app = createExpressApp({
  verifier,
  forUser,
  connectionCount: () => gateway.connectionCount,
  log,
});

const server = createHttpServer(app);
attachWebSocket(server, { gateway, log });

server.listen(PORT, () => {
  console.log(`[dev-server] Valentin backend listening on http://localhost:${PORT}`);
  if (isAuthDisabled()) {
    console.log(
      '[dev-server] auth bypass ON — send `dev:<name>` as the token to act as ' +
        'different users, or nothing at all to be "anonymous".',
    );
  }
});
