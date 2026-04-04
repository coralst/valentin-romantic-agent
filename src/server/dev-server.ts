import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from './index';
import type { WsConnection } from './api/ws-gateway';
import type { IncomingMessage } from 'http';

const PORT = Number(process.env.PORT) || 3001;

const { gateway, httpRoutes, orchestrator } = createServer();

const app = express();
app.use(express.json());

// --- HTTP routes ---

app.get('/api/health', async (_req, res) => {
  const result = await httpRoutes.health();
  res.status(result.status).json(result.body);
});

app.post('/api/session', async (_req, res) => {
  const result = await httpRoutes.createSession();
  res.status(result.status).json(result.body);
});

app.get('/api/session/:id/preferences', async (req, res) => {
  const result = await httpRoutes.getSessionPreferences(req.params.id);
  res.status(result.status).json(result.body);
});

// --- HTTP server + WebSocket upgrade ---

const server = createHttpServer(app);
const wss = new WebSocketServer({ noServer: true });

let connectionCounter = 0;

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
      ws.on('close', handler);
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
    console.log(`[dev-server] Session initialized: ${sessionId}`);
  } catch (err) {
    console.error('[dev-server] Failed to init session:', err);
  }
});

server.listen(PORT, () => {
  console.log(`[dev-server] Valentin backend listening on http://localhost:${PORT}`);
});
