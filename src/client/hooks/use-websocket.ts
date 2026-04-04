import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent, ServerEvent } from '../../shared/interfaces/ws-events';
import type { ChatAction } from './use-chat-state';
import type { PreferencesAction } from './use-preferences-state';

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wsUrl = url ?? `ws://${window.location.host}/ws`;

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
    };

    ws.onmessage = (event) => {
      try {
        const serverEvent = JSON.parse(event.data as string) as ServerEvent;
        if (serverEvent.type === 'error') {
          setLastError(serverEvent.payload.message);
        }
        dispatchServerEvent(serverEvent, chatDispatch, preferencesDispatch);
      } catch {
        // Malformed message — ignore
      }
    };

    ws.onclose = () => {
      clearTimers();
      setConnectionStatus('reconnecting');
      chatDispatch({ type: 'SET_CONNECTION', status: 'reconnecting' });

      const delay = getBackoffDelay(reconnectAttemptRef.current);
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
    },
    [sessionId],
  );

  return { sendMessage, connectionStatus, lastError };
}
