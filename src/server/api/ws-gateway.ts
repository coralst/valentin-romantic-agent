import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';
import type { AuthContext, TokenVerifier } from '../auth/token-verifier';
import type { AgentOrchestratorInterface } from '../agent/agent-orchestrator';
import type {
  ScopedStorageOptions,
  StorageInterface,
} from '../persistence/storage-interface';
import type { EventRouter } from './event-router';
import { withUserScope } from '../logging';

/** Minimal WebSocket connection abstraction — actual WS library wired in server entry point */
export interface WsConnection {
  id: string;
  /**
   * The session this connection is bound to, or null before authentication.
   *
   * **Server-assigned only.** It used to be set from the client's own
   * `send_message` payload, which let any connection bind to any session id and
   * receive that session's agent output. See {@link WsGateway.broadcastToSession}.
   */
  sessionId: string | null;
  send(data: string): void;
  close(code: number, reason: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
}

/**
 * The slice of the per-user object graph a socket needs.
 *
 * Declared here rather than imported from `index.ts` — that module imports this
 * one, so naming its `UserServices` type would close a cycle.
 */
export interface WsUserServices {
  store: Pick<StorageInterface, 'getSession'>;
  orchestrator: Pick<AgentOrchestratorInterface, 'initSession'>;
  eventRouter: Pick<EventRouter, 'routeEvent'>;
}

/** Builds the per-user graph once a connection's identity is known */
export type ForUserFn = (
  userId: string,
  opts?: ScopedStorageOptions,
) => WsUserServices;

/**
 * Close codes, in the 4000–4999 range reserved for applications.
 *
 * The client distinguishes them: 4401 means "refresh the token and reconnect
 * with the same sessionId", everything else means "back off and retry".
 */
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_AUTH_TIMEOUT = 4408;

/** How long a connection may stay unauthenticated before it is dropped */
const DEFAULT_AUTH_TIMEOUT_MS = 5_000;

interface ConnectionState {
  conn: WsConnection;
  auth: AuthContext | null;
  services: WsUserServices | null;
  authTimer: ReturnType<typeof setTimeout> | null;
  /** Guards against two `auth` frames racing each other */
  authInFlight: boolean;
}

export interface WsGatewayDeps {
  verifier: TokenVerifier;
  forUser: ForUserFn;
  /** Overridable so tests don't wait five seconds */
  authTimeoutMs?: number;
}

/**
 * Manages WebSocket connections, authenticates them, and routes their events.
 *
 * Every connection is a small state machine: it starts `unauthenticated`, where
 * the only honoured event is `auth`. Anything else closes it. That is what makes
 * the authorization story elsewhere trivial — by the time an event reaches the
 * EventRouter, the router itself is already bound to one user's store.
 */
export class WsGateway {
  private connections = new Map<string, ConnectionState>();
  private readonly verifier: TokenVerifier;
  private readonly forUser: ForUserFn;
  private readonly authTimeoutMs: number;

  constructor(deps: WsGatewayDeps) {
    this.verifier = deps.verifier;
    this.forUser = deps.forUser;
    this.authTimeoutMs = deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  }

  /** Register a new client connection, unauthenticated */
  handleConnection(conn: WsConnection): void {
    const state: ConnectionState = {
      conn,
      auth: null,
      services: null,
      authTimer: null,
      authInFlight: false,
    };

    state.authTimer = setTimeout(() => {
      state.authTimer = null;
      if (!state.auth) {
        conn.close(WS_CLOSE_AUTH_TIMEOUT, 'Authentication timeout');
      }
    }, this.authTimeoutMs);
    // Don't hold the process open on an idle unauthenticated socket.
    state.authTimer.unref?.();

    this.connections.set(conn.id, state);

    conn.onMessage((data: string) => {
      void this.handleIncomingMessage(state, data);
    });

    conn.onClose(() => {
      if (state.authTimer) clearTimeout(state.authTimer);
      this.connections.delete(conn.id);
    });
  }

  /**
   * Send a ServerEvent to every connection of `userId` bound to `sessionId`.
   *
   * The userId is not redundant with the sessionId. It is the reason this needs
   * no ownership check: `conn.sessionId` is only ever assigned by
   * {@link authenticate}, after reading the session through that user's own
   * scoped store, so a match here already implies ownership. Keep it that way —
   * the moment `sessionId` becomes settable from a client payload this method
   * turns into a cross-tenant read.
   */
  broadcastToSession(
    userId: string,
    sessionId: string,
    event: ServerEvent,
  ): void {
    const payload = JSON.stringify(event);
    for (const state of this.connections.values()) {
      if (state.auth?.userId === userId && state.conn.sessionId === sessionId) {
        state.conn.send(payload);
      }
    }
  }

  /** Send a ServerEvent to a specific connection */
  sendToConnection(connectionId: string, event: ServerEvent): void {
    const state = this.connections.get(connectionId);
    if (state) {
      state.conn.send(JSON.stringify(event));
    }
  }

  /** Get count of active connections, authenticated or not */
  get connectionCount(): number {
    return this.connections.size;
  }

  private sendError(conn: WsConnection, code: string, message: string): void {
    conn.send(
      JSON.stringify({
        type: 'error',
        payload: { code, message },
        timestamp: new Date().toISOString(),
      } satisfies ServerEvent),
    );
  }

  private async handleIncomingMessage(
    state: ConnectionState,
    raw: string,
  ): Promise<void> {
    const { conn } = state;
    let parsed: ClientEvent;

    try {
      parsed = JSON.parse(raw) as ClientEvent;
    } catch {
      this.sendError(conn, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }

    // Validate envelope structure
    if (!parsed.type || typeof parsed.type !== 'string') {
      this.sendError(
        conn,
        'VALIDATION_ERROR',
        'Event must have a "type" string field',
      );
      return;
    }

    if (parsed.type === 'auth') {
      await this.authenticate(state, (parsed.payload ?? {}) as
        | { token?: string; sessionId?: string });
      return;
    }

    // Unauthenticated connections get exactly one chance, spent above.
    if (!state.auth || !state.services) {
      conn.close(WS_CLOSE_UNAUTHENTICATED, 'Authentication required');
      return;
    }

    // Expiry is checked per event rather than on a timer: no background work,
    // and no connection killed mid-turn. The client refreshes and reconnects
    // with the same sessionId, so nothing is lost.
    if (state.auth.expiresAt * 1000 <= Date.now()) {
      conn.close(WS_CLOSE_UNAUTHENTICATED, 'Token expired');
      return;
    }

    // A send_message may only address the session this connection is bound to.
    if (parsed.type === 'send_message') {
      const requested = (parsed.payload as { sessionId?: string })?.sessionId;
      if (requested !== conn.sessionId) {
        this.sendError(
          conn,
          'SESSION_MISMATCH',
          'This connection is not bound to that session',
        );
        return;
      }
    }

    const { eventRouter } = state.services;

    try {
      // The one place the user is stamped onto the ambient log scope. Everything
      // this event touches — the orchestrator, the extractor, the store, the
      // shared Bedrock client — logs under this user, which is what lets the
      // single process-wide span bridge route `aws_span` events back to the
      // connection that caused them instead of guessing from a session id.
      await withUserScope(state.auth.userId, () =>
        eventRouter.routeEvent(
          parsed.type,
          (parsed.payload ?? {}) as Record<string, unknown>,
        ),
      );
    } catch (err) {
      this.sendError(
        conn,
        'INTERNAL_ERROR',
        err instanceof Error ? err.message : 'An unexpected error occurred',
      );
    }
  }

  /**
   * Verify the first frame, then either resume the requested session or mint one.
   */
  private async authenticate(
    state: ConnectionState,
    payload: { token?: string; sessionId?: string },
  ): Promise<void> {
    const { conn } = state;

    if (state.auth || state.authInFlight) {
      this.sendError(conn, 'ALREADY_AUTHENTICATED', 'Already authenticated');
      return;
    }
    state.authInFlight = true;

    let auth: AuthContext;
    try {
      auth = await this.verifier.verify(payload.token ?? '');
    } catch {
      state.authInFlight = false;
      // Deliberately no detail: the client cannot act on *why* beyond
      // refreshing, and the reason belongs in the server log, not on the wire.
      conn.close(WS_CLOSE_UNAUTHENTICATED, 'Invalid token');
      return;
    }

    if (state.authTimer) {
      clearTimeout(state.authTimer);
      state.authTimer = null;
    }

    state.auth = auth;
    state.services = this.forUser(auth.userId);
    state.authInFlight = false;

    conn.send(
      JSON.stringify({
        type: 'auth_ok',
        payload: { userId: auth.userId, isDemo: auth.isDemo },
        timestamp: new Date().toISOString(),
      } satisfies ServerEvent),
    );

    try {
      if (payload.sessionId) {
        // Reading it through this user's scoped store *is* the ownership proof:
        // the key includes the caller's own id, so someone else's session simply
        // misses. A miss must not fall through to initSession — silently minting
        // a replacement is how a reconnect loses a conversation.
        const session = await state.services.store.getSession(payload.sessionId);
        if (!session) {
          this.sendError(
            conn,
            'SESSION_NOT_FOUND',
            'No such session for this user',
          );
          return;
        }
        conn.sessionId = payload.sessionId;
        return;
      }

      const { sessionId, welcomeMessage } =
        await state.services.orchestrator.initSession();
      conn.sessionId = sessionId;
      conn.send(
        JSON.stringify({
          type: 'session_init',
          payload: { sessionId, welcomeMessage },
          timestamp: new Date().toISOString(),
        } satisfies ServerEvent),
      );
    } catch (err) {
      this.sendError(
        conn,
        'SESSION_ERROR',
        err instanceof Error ? err.message : 'Could not open a session',
      );
    }
  }
}
