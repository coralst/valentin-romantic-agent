import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import type { WsConnection, WsGateway } from '../api/ws-gateway';
import type { LogFn } from './express-app';
import { isWebSocketPath } from '../agent/engine';

export interface AttachWebSocketDeps {
  gateway: WsGateway;
  log: LogFn;
}

export interface WebSocketHandle {
  /** Every socket currently open, for graceful shutdown */
  sockets: Set<WebSocket>;
}

/**
 * Wire the WebSocket upgrade path onto an existing HTTP server.
 *
 * Note what is *not* here any more: this used to call
 * `orchestrator.initSession()` for every connection, which meant a new session
 * on every connect **and every reconnect** — and `use-websocket.ts` reconnects
 * with exponential backoff, so a flaky network quietly shredded a conversation
 * into orphaned sessions. Session opening now happens inside the gateway's auth
 * handler, where the client can name the session it wants to resume.
 */
export function attachWebSocket(
  server: Server,
  deps: AttachWebSocketDeps,
): WebSocketHandle {
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  let connectionCounter = 0;

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    // `/ws` and `/ws/agentcore` both, on both engines. The second is an ALB
    // routing label rather than a second protocol — see `agent/engine.ts` for why
    // the engine is decided by `AGENT_ENGINE` and not by the path a socket
    // arrived on.
    if (isWebSocketPath(request.url)) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const connId = `conn-${++connectionCounter}`;
    sockets.add(ws);

    deps.log('info', 'WebSocket connection established', { connId });

    const conn: WsConnection = {
      id: connId,
      // Assigned by the gateway once the caller's identity — and their
      // ownership of the session — is established. Never from a client payload.
      sessionId: null,
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      },
      close: (code: number, reason: string) => {
        deps.log('info', 'Closing WebSocket connection', { connId, code, reason });
        ws.close(code, reason);
      },
      onMessage: (handler: (data: string) => void) => {
        ws.on('message', (raw) => handler(raw.toString()));
      },
      onClose: (handler: () => void) => {
        ws.on('close', () => {
          sockets.delete(ws);
          handler();
          deps.log('info', 'WebSocket connection closed', { connId });
        });
      },
    };

    deps.gateway.handleConnection(conn);
  });

  return { sockets };
}
