import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createServer } from './index';
import type { WsConnection } from './api/ws-gateway';
import type { IncomingMessage } from 'http';

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

function log(level: LogEntry['level'], message: string, meta?: Record<string, unknown>): void {
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
}

// --- Server Setup ---
const { gateway, httpRoutes, orchestrator } = createServer();

const app = express();
app.use(express.json());

// --- Request ID Middleware ---
app.use((req, _res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.headers['x-request-id'] = requestId;
  next();
});

// --- Health Check ---
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    connections: gateway.connectionCount,
    environment: NODE_ENV,
  });
});

// --- HTTP Routes ---
app.post('/api/session', async (_req, res) => {
  const result = await httpRoutes.createSession();
  res.status(result.status).json(result.body);
});

app.get('/api/session/:id/preferences', async (req, res) => {
  const result = await httpRoutes.getSessionPreferences(req.params.id);
  res.status(result.status).json(result.body);
});

// --- HTTP Server + WebSocket Upgrade ---
const server = createHttpServer(app);
const wss = new WebSocketServer({ noServer: true });

let connectionCounter = 0;
const activeWebSockets = new Set<WebSocket>();

server.on('upgrade', (request: IncomingMessage, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', async (ws: WebSocket) => {
  const connId = `conn-${++connectionCounter}`;
  activeWebSockets.add(ws);

  log('info', 'WebSocket connection established', { connId });

  const conn: WsConnection = {
    id: connId,
    sessionId: null,
    send: (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    onMessage: (handler: (data: string) => void) => {
      ws.on('message', (raw) => handler(raw.toString()));
    },
    onClose: (handler: () => void) => {
      ws.on('close', () => {
        activeWebSockets.delete(ws);
        handler();
        log('info', 'WebSocket connection closed', { connId });
      });
    },
  };

  gateway.handleConnection(conn);

  // Auto-init session on first connection
  try {
    const { sessionId, welcomeMessage } = await orchestrator.initSession();
    conn.sessionId = sessionId;
    conn.send(
      JSON.stringify({
        type: 'session_init',
        payload: { sessionId, welcomeMessage },
        timestamp: new Date().toISOString(),
      }),
    );
    log('info', 'Session initialized', { connId, sessionId });
  } catch (err) {
    log('error', 'Failed to init session', {
      connId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- Start Server ---
server.listen(PORT, () => {
  log('info', 'Valentin production server started', {
    port: PORT,
    environment: NODE_ENV,
    pid: process.pid,
    dynamoTable: process.env.DYNAMO_TABLE_NAME || '(not set)',
    s3Bucket: process.env.S3_PHOTO_BUCKET || '(not set)',
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
  for (const ws of activeWebSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  }

  // Give connections time to drain, then force exit
  const forceExit = setTimeout(() => {
    log('warn', 'Forcing shutdown after timeout', {
      remainingConnections: activeWebSockets.size,
    });
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  // If all connections close before the timeout, exit cleanly
  const checkDrained = setInterval(() => {
    if (activeWebSockets.size === 0) {
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
