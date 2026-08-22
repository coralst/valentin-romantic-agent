import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';
import type { ChatAction } from './use-chat-state';
import type { PreferencesAction } from './use-preferences-state';
import {
  publishInboundWsEvent,
  publishOutboundWsEvent,
} from '../utils/ws-event-observer';
import { getAccessToken, invalidateAccessToken } from '../auth/token-store';

/** Return type of the useWebSocket hook */
export interface UseWebSocketReturn {
  sendMessage: (content: string) => void;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  lastError: string | null;
}

/** Configuration for the WebSocket hook */
interface UseWebSocketOptions {
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
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }
    clearTimers();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      chatDispatch({ type: 'SET_CONNECTION', status: 'connected' });
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
        if (ws.readyState !== WebSocket.OPEN) return;

        const frame: ClientEvent = {
          type: 'auth',
          payload: {
            token: token ?? '',
            ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
          },
          timestamp: new Date().toISOString(),
        };
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
        dispatchServerEvent(serverEvent, chatDispatch, preferencesDispatch);
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onclose = (event) => {
      clearTimers();
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

  // Auto-connect on mount, clean up on unmount
  useEffect(() => {
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
  }, [connect, clearTimers]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !sessionId) {
        return;
      }
      const event: ClientEvent = {
        type: 'send_message',
        payload: { sessionId, content },
        timestamp: new Date().toISOString(),
      };
      wsRef.current.send(JSON.stringify(event));
      publishOutboundWsEvent(event);
    },
    [sessionId],
  );

  return { sendMessage, connectionStatus, lastError };
}
