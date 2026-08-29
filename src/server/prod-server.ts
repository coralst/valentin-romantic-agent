import { createServer as createHttpServer } from 'http';
import { WebSocket } from 'ws';
import { createServer } from './index';
import { createExpressApp, type LogFn } from './http/express-app';
import { attachWebSocket } from './http/attach-websocket';

// --- Configuration ---
const PORT = Number(process.env.PORT) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'production';
const SHUTDOWN_TIMEOUT_MS = 10_000;

// --- Structured JSON Logger ---
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  [key: string]: unknown;
}

const log: LogFn = (level, message, meta) => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const output = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
};

// --- Server Setup ---
// createServer throws here rather than booting unauthenticated if Cognito is
// unconfigured, which is what we want: a failed health check is recoverable, a
// silently open API is not.
const { gateway, verifier, forUser, demoLogin, engine } = createServer();

const app = createExpressApp({
  verifier,
  forUser,
  connectionCount: () => gateway.connectionCount,
  log,
  demoLogin,
  engine,
});

const server = createHttpServer(app);
const { sockets } = attachWebSocket(server, { gateway, log });

// --- Start Server ---
server.listen(PORT, () => {
  log('info', 'Valentin production server started', {
    port: PORT,
    environment: NODE_ENV,
    pid: process.pid,
    dynamoTable: process.env.DYNAMO_TABLE_NAME || '(not set)',
    s3Bucket: process.env.S3_PHOTO_BUCKET || '(not set)',
    userPool: process.env.COGNITO_USER_POOL_ID || '(not set)',
  });
});

// --- Graceful Shutdown ---
let isShuttingDown = false;

function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('info', 'Graceful shutdown initiated', { signal });

  // Stop accepting new connections
  server.close(() => {
    log('info', 'HTTP server closed');
  });

  // Close all WebSocket connections with a close frame
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  }

  // Give connections time to drain, then force exit
  const forceExit = setTimeout(() => {
    log('warn', 'Forcing shutdown after timeout', {
      remainingConnections: sockets.size,
    });
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  // If all connections close before the timeout, exit cleanly
  const checkDrained = setInterval(() => {
    if (sockets.size === 0) {
      clearInterval(checkDrained);
      clearTimeout(forceExit);
      log('info', 'All connections drained, exiting');
      process.exit(0);
    }
  }, 500);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
