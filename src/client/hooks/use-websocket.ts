import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';
import type { ChatAction } from './use-chat-state';
import type { PreferencesAction } from './use-preferences-state';
import type { PeopleStoreAction } from './use-people-store';
import type { TaskStoreAction } from './use-task-store';
import {
  publishInboundWsEvent,
  publishOutboundWsEvent,
} from '../utils/ws-event-observer';
import {
  getAccessToken,
  invalidateAccessToken,
  peekVisitorId,
} from '../auth/token-store';

/** Return type of the useWebSocket hook */
export interface UseWebSocketReturn {
  sendMessage: (content: string) => void;
  /**
   * Accept a proposal. This is the authority to act: the server executes the
   * held tool on receipt without going back through the model, so nothing calls
   * this except a click on a Confirm button.
   */
  confirmAction: (proposalId: string) => void;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  lastError: string | null;
}

/**
 * The two boards that fill in mid-conversation but are not the chat or the
 * preferences.
 *
 * Optional, because both stores are mounted by providers a test may not have:
 * `useWebSocket` is exercised on its own, and a socket that refuses to connect
 * without a family tree attached would be the wrong dependency direction.
 */
export interface LiveBoardDispatchers {
  peopleDispatch?: React.Dispatch<PeopleStoreAction>;
  tasksDispatch?: React.Dispatch<TaskStoreAction>;
}

/** Configuration for the WebSocket hook */
interface UseWebSocketOptions extends LiveBoardDispatchers {
  chatDispatch: React.Dispatch<ChatAction>;
  preferencesDispatch: React.Dispatch<PreferencesAction>;
  sessionId: string | null;
  url?: string;
}


const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;

/**
 * The server's close codes for "you are not authenticated" and "you took too
 * long to say who you are". Both mean the same thing to us: get a fresh token
 * before trying again, rather than reconnecting with the token just rejected.
 */
export const WS_CLOSE_UNAUTHENTICATED = 4401;
export const WS_CLOSE_AUTH_TIMEOUT = 4408;

/** Reconnect sooner after an auth failure than after a network one */
const AUTH_RETRY_DELAY = 500;

/** Calculate exponential backoff delay capped at MAX_RECONNECT_DELAY */
export function getBackoffDelay(attempt: number): number {
  const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_RECONNECT_DELAY);
}

/** Dispatch a ServerEvent to the appropriate reducer */
export function dispatchServerEvent(
  event: ServerEvent,
  chatDispatch: React.Dispatch<ChatAction>,
  preferencesDispatch: React.Dispatch<PreferencesAction>,
  boards: LiveBoardDispatchers = {},
): void {
  switch (event.type) {
    case 'session_init':
      chatDispatch({
        type: 'SESSION_INIT',
        sessionId: event.payload.sessionId,
        welcomeMessage: event.payload.welcomeMessage,
      });
      break;

    case 'agent_message':
      chatDispatch({ type: 'RECEIVE_MESSAGE', message: event.payload.message });
      break;

    case 'action_proposal':
      // Its own event rather than prose in a message, because it has to be
      // accepted with a click — see `ActionProposalPayload`.
      chatDispatch({ type: 'RECEIVE_PROPOSAL', proposal: event.payload });
      break;

    case 'typing_start':
      chatDispatch({ type: 'SET_TYPING', isTyping: true });
      break;

    case 'typing_stop':
      chatDispatch({ type: 'SET_TYPING', isTyping: false });
      break;

    case 'preference_update':
      if (event.payload.isNew) {
        preferencesDispatch({ type: 'ADD_PREFERENCE', preference: event.payload.preference });
      } else {
        preferencesDispatch({ type: 'UPDATE_PREFERENCE', preference: event.payload.preference });
      }
      break;

    // Both boards are on screen while he is talking, so a relative or a
    // commitment he just mentioned has to appear without a reload — the same
    // reason `preference_update` exists. `MERGE_*` rather than an isNew branch:
    // the frame says whether the *server* considered it new, which is not the
    // same question as whether this client already holds the row.
    case 'person_update':
      boards.peopleDispatch?.({ type: 'MERGE_PERSON', person: event.payload.person });
      break;

    case 'task_update':
      boards.tasksDispatch?.({ type: 'MERGE_TASK', task: event.payload.task });
      break;

    case 'connection_status':
      chatDispatch({ type: 'SET_CONNECTION', status: event.payload.status });
      break;

    case 'auth_ok':
      // Nothing to store: the connection is now bound to this user server-side,
      // and `session_init` (or the resumed session) follows.
      break;

    case 'error':
      // Errors are surfaced via lastError state
      break;

    case 'pong':
      // Heartbeat acknowledged — no action needed
      break;
  }
}

/** Hook managing a WebSocket connection with auto-reconnect and heartbeat */
export function useWebSocket({
  chatDispatch,
  preferencesDispatch,
  peopleDispatch,
  tasksDispatch,
  sessionId,
  url,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'reconnecting' | 'disconnected'
  >('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  /**
   * The session to resume, read at connect time.
   *
   * A ref rather than a `connect` dependency: naming `sessionId` in the callback's
   * deps would tear down and rebuild the socket every time someone switched
   * sessions in the sidebar.
   */
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;
  /**
   * The family-tree and to-do dispatchers, read at delivery time.
   *
   * A ref for the same reason `sessionIdRef` is one, and more urgently: both are
   * keyed on the session they write to, so naming them in `connect`'s deps would
   * tear the socket down and rebuild it every time the user picked a different
   * conversation — mid-turn, if he was typing.
   */
  const boardsRef = useRef<LiveBoardDispatchers>({ peopleDispatch, tasksDispatch });
  boardsRef.current = { peopleDispatch, tasksDispatch };
  /**
   * Whether the server has accepted this connection's `auth` frame.
   *
   * The gateway honours exactly one pre-auth event and *closes the connection*
   * on any other (ws-gateway.ts), so the window between `onopen` and `auth_ok`
   * is not merely unusable — sending into it destroys the socket and loses the
   * turn. The window is real rather than theoretical: the auth frame waits on
   * `getAccessToken()`, which may go to the network to refresh, and a session id
   * minted by `/api/demo/login` is already in state before the socket opens, so
   * nothing else was stopping a send.
   */
  const isAuthedRef = useRef(false);
  /**
   * Turns sent before `auth_ok` arrived, replayed in order once it does.
   *
   * Queued rather than dropped, because a dropped send is invisible: `ChatPanel`
   * puts the user's own bubble on screen itself, so a lost turn looks exactly
   * like an agent that chose not to answer.
   */
  const pendingSendsRef = useRef<ClientEvent[]>([]);
  /**
   * The session this connection is bound to, server-side.
   *
   * `undefined` until the `auth` frame goes out, then the id that frame asked to
   * resume, or `null` while waiting for the server to mint one (it answers with
   * `session_init`).
   *
   * Tracked because the gateway binds a connection to exactly one session at auth
   * time and refuses a `send_message` for any other ('SESSION_MISMATCH'). The
   * socket outlives session switches — it deliberately does not name `sessionId`
   * as a dependency — so without this the binding silently drifts away from the
   * session the app is showing. In production it drifted on the very first page
   * load: the socket opens before `/api/demo/login`'s session reaches chat state,
   * so the server minted one, and every turn afterwards was refused.
   */
  const boundSessionRef = useRef<string | null | undefined>(undefined);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wsUrl = url ?? (
    window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`
  );

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    heartbeatTimerRef.current = setInterval(() => {
      // Authenticated too: a ping is an ordinary event to the gateway, so one
      // landing before `auth_ok` would close the connection it exists to keep.
      if (isAuthedRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        const ping: ClientEvent = {
          type: 'ping',
          payload: {},
          timestamp: new Date().toISOString(),
        };
        wsRef.current.send(JSON.stringify(ping));
        publishOutboundWsEvent(ping);
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  const connect = useCallback(() => {
    // Clean up any existing connection. `onclose` is dropped first: this close is
    // intentional, and letting the old socket's handler run would schedule a
    // second, competing reconnect behind the one being made here.
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    boundSessionRef.current = undefined;
    isAuthedRef.current = false;
    clearTimers();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      /*
       * Open is not yet usable, so it is not yet reported as `connected`.
       *
       * "Connected" means "a turn sent now will be answered", which is only true
       * after `auth_ok`. Anything reading this — the connection banner, and the
       * guided intro deciding between the live socket and its script — wants that
       * meaning rather than the transport's.
       */
      isAuthedRef.current = false;
      setLastError(null);
      reconnectAttemptRef.current = 0;
      startHeartbeat();

      /*
       * Authenticate in the first frame.
       *
       * Not a handshake header (browsers cannot set them), not `?token=` — the
       * CloudFront origin policy strips query strings on /ws, and a token in a
       * URL would sit in CloudFront and ALB access logs forever. The server
       * honours exactly one event until this arrives and closes the connection
       * if it does not.
       *
       * Passing the current session id makes this a *resume*: without it the
       * server mints a new session, which is what used to shred history on
       * every reconnect.
       */
      void (async () => {
        const token = await getAccessToken();
        const visitorId = peekVisitorId();
        if (ws.readyState !== WebSocket.OPEN) return;

        const frame: ClientEvent = {
          type: 'auth',
          payload: {
            token: token ?? '',
            ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
            // The socket must land in the same corner of the shared demo
            // account as `apiFetch` does, or the sidebar and the conversation
            // would disagree about which sessions exist.
            ...(visitorId ? { visitorId } : {}),
          },
          timestamp: new Date().toISOString(),
        };
        // Recorded before the send, because the server binds to whatever this
        // frame asks for: an id to resume, or nothing, meaning "mint one and tell
        // me in `session_init`".
        boundSessionRef.current = sessionIdRef.current ?? null;
        ws.send(JSON.stringify(frame));
        // Deliberately not published to the inspector: the frame carries a
        // bearer token and the inspector panel is on screen during demos.
      })();
    };

    ws.onmessage = (event) => {
      try {
        const serverEvent = JSON.parse(event.data as string) as ServerEvent;
        publishInboundWsEvent(serverEvent);
        if (serverEvent.type === 'error') {
          setLastError(serverEvent.payload.message);
        }
        if (serverEvent.type === 'session_init') {
          // The server only sends this when it minted the session, so this is the
          // one way to learn which session the connection ended up bound to.
          boundSessionRef.current = serverEvent.payload.sessionId;
        }
        if (serverEvent.type === 'auth_ok') {
          // Only now is the connection able to carry a turn. Flush in order, so
          // a queued turn keeps its place ahead of whatever is typed next.
          isAuthedRef.current = true;
          setConnectionStatus('connected');
          chatDispatch({ type: 'SET_CONNECTION', status: 'connected' });

          const queued = pendingSendsRef.current;
          pendingSendsRef.current = [];
          for (const frame of queued) {
            if (ws.readyState !== WebSocket.OPEN) break;
            // A turn addressed to a session the app has since left is stale: the
            // server would answer SESSION_MISMATCH, and showing the room an error
            // for a turn it has moved on from is worse than not replaying it.
            const target = (frame.payload as { sessionId?: string }).sessionId;
            if (target && sessionIdRef.current && target !== sessionIdRef.current) {
              continue;
            }
            ws.send(JSON.stringify(frame));
            publishOutboundWsEvent(frame);
          }
        }
        dispatchServerEvent(
          serverEvent,
          chatDispatch,
          preferencesDispatch,
          boardsRef.current,
        );
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onclose = (event) => {
      clearTimers();
      isAuthedRef.current = false;
      setConnectionStatus('reconnecting');
      chatDispatch({ type: 'SET_CONNECTION', status: 'reconnecting' });

      const rejectedUs =
        event.code === WS_CLOSE_UNAUTHENTICATED ||
        event.code === WS_CLOSE_AUTH_TIMEOUT;

      if (rejectedUs) {
        // Reconnecting with the same rejected token would just be refused
        // again. Mark it stale so the next attempt refreshes first; if the
        // refresh fails the auth provider signs out and unmounts this hook.
        invalidateAccessToken();
      }

      // Still backs off on repeated failures — an auth loop must not become a
      // hot loop against Cognito.
      const delay = rejectedUs
        ? Math.max(AUTH_RETRY_DELAY, getBackoffDelay(reconnectAttemptRef.current - 1))
        : getBackoffDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      setLastError('WebSocket connection error');
    };
  }, [wsUrl, chatDispatch, preferencesDispatch, clearTimers, startHeartbeat]);

  /**
   * Whether there is a conversation to connect *about*.
   *
   * Load-bearing, and the whole fix for the pile of empty conversations. The
   * gateway reads an `auth` frame with no session id as "mint me one", and this
   * hook used to connect the instant it mounted — before `GET /api/sessions` had
   * answered, so the frame never carried an id. Every page load therefore left a
   * session behind: the list arrives a moment later, the app moves onto whichever
   * conversation it names, and the minted one is orphaned — then shows up as an
   * empty "New conversation" row on the next load. Three reloads, four rows.
   *
   * Remove this and that returns. The rule it encodes is that the client decides
   * which session is live and the socket only ever *resumes* one;
   * `SessionProvider` guarantees there is always one to resume, which is what
   * keeps this from meaning "no socket, ever".
   *
   * It is deliberately a boolean rather than the id itself: a session *switch* is
   * handled by the rebind effect below, which knows what the server actually
   * bound to, and naming the id here would rebuild the socket twice for one
   * switch. What this tracks is only "does the app have a conversation at all" —
   * which also drops the socket when the last conversation is deleted, instead of
   * leaving it bound to a session that no longer exists.
   */
  const hasSession = sessionId !== null;

  // Connect once there is a session to resume, clean up on unmount.
  useEffect(() => {
    if (!hasSession) return;
    connect();

    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionStatus('disconnected');
    };
  }, [hasSession, connect, clearTimers]);

  /**
   * Rebind when the app moves to a session this connection is not bound to.
   *
   * Reconnecting is the rebind: the fresh `auth` frame names the new session, and
   * the server resumes it rather than minting one, so nothing is lost. The
   * alternative — naming `sessionId` in `connect`'s dependencies — would rebuild
   * the socket on every render that changes it, including the ones where it has
   * not actually moved.
   */
  useEffect(() => {
    const bound = boundSessionRef.current;
    // `undefined`: no `auth` frame yet, so the one about to go out will carry the
    // current id. `null`: the server is minting, and `session_init` will say what.
    if (bound === undefined || bound === null) return;
    if (!sessionId || sessionId === bound) return;
    connect();
  }, [sessionId, connect]);

  /**
   * Send one client event, or hold it until the connection can carry it.
   *
   * Shared by `sendMessage` and `confirmAction` because the rules are properties
   * of the gateway rather than of either event: a frame sent before `auth_ok`
   * closes the socket, and a frame naming a session this connection is not bound
   * to earns a SESSION_MISMATCH.
   */
  const sendFrame = useCallback(
    (event: ClientEvent) => {
      /*
       * Held until the connection is authenticated, and dropped only when there
       * is no connection at all.
       *
       * Sending early does not merely fail — the gateway closes the socket on a
       * pre-auth event, which loses this turn *and* forces a reconnect. Waiting
       * costs the few hundred milliseconds the token takes.
       */
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      // Also held while the connection is bound to a different session: the
      // rebinding reconnect is already on its way, and this turn flushes once it
      // has authenticated. Sending now would only earn a SESSION_MISMATCH.
      if (!isAuthedRef.current || boundSessionRef.current !== sessionId) {
        pendingSendsRef.current.push(event);
        return;
      }

      wsRef.current.send(JSON.stringify(event));
      publishOutboundWsEvent(event);
    },
    [sessionId],
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId) return;
      sendFrame({
        type: 'send_message',
        payload: { sessionId, content },
        timestamp: new Date().toISOString(),
      });
    },
    [sessionId, sendFrame],
  );

  const confirmAction = useCallback(
    (proposalId: string) => {
      if (!sessionId) return;
      /*
       * Queued like a turn if the socket is not ready yet, which is the right
       * trade even though a held confirmation may arrive after the proposal has
       * expired: the server checks `expiresAt` itself and refuses, so the worst
       * case is a clear "that offer has expired" rather than a stale booking.
       */
      sendFrame({
        type: 'confirm_action',
        payload: { sessionId, proposalId },
        timestamp: new Date().toISOString(),
      });
    },
    [sessionId, sendFrame],
  );

  return { sendMessage, confirmAction, connectionStatus, lastError };
}
