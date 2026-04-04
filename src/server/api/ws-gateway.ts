import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';
import type { EventRouter } from './event-router';

/** Minimal WebSocket connection abstraction — actual WS library wired in server entry point */
export interface WsConnection {
  id: string;
  sessionId: string | null;
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
}

/** Manages WebSocket connections and routes events through the EventRouter */
export class WsGateway {
  private connections = new Map<string, WsConnection>();

  constructor(private readonly router: EventRouter) {}

  /** Register a new client connection */
  handleConnection(conn: WsConnection): void {
    this.connections.set(conn.id, conn);

    conn.onMessage((data: string) => {
      this.handleIncomingMessage(conn, data);
    });

    conn.onClose(() => {
      this.connections.delete(conn.id);
    });
  }

  /** Send a ServerEvent to all connections bound to a session */
  broadcastToSession(sessionId: string, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const conn of this.connections.values()) {
      if (conn.sessionId === sessionId) {
        conn.send(payload);
      }
    }
  }

  /** Send a ServerEvent to a specific connection */
  sendToConnection(connectionId: string, event: ServerEvent): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.send(JSON.stringify(event));
    }
  }

  /** Get count of active connections */
  get connectionCount(): number {
    return this.connections.size;
  }

  private handleIncomingMessage(conn: WsConnection, raw: string): void {
    let parsed: ClientEvent;

    try {
      parsed = JSON.parse(raw) as ClientEvent;
    } catch {
      this.sendToConnection(conn.id, {
        type: 'error',
        payload: { code: 'PARSE_ERROR', message: 'Invalid JSON' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate envelope structure
    if (!parsed.type || typeof parsed.type !== 'string') {
      this.sendToConnection(conn.id, {
        type: 'error',
        payload: {
          code: 'VALIDATION_ERROR',
          message: 'Event must have a "type" string field',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Bind session from send_message events
    if (
      parsed.type === 'send_message' &&
      'sessionId' in parsed.payload
    ) {
      conn.sessionId = (parsed.payload as { sessionId: string }).sessionId;
    }

    // Route through EventRouter
    this.router
      .routeEvent(
        parsed.type,
        (parsed.payload ?? {}) as Record<string, unknown>,
      )
      .catch((err) => {
        this.sendToConnection(conn.id, {
          type: 'error',
          payload: {
            code: 'INTERNAL_ERROR',
            message:
              err instanceof Error
                ? err.message
                : 'An unexpected error occurred',
          },
          timestamp: new Date().toISOString(),
        });
      });
  }
}
