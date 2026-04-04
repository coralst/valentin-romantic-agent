import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../hooks/use-websocket';
import { useChatContext } from './chat-context';
import { usePreferencesContext } from './preferences-context';

interface WebSocketContextValue {
  sendMessage: (content: string) => void;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  lastError: string | null;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/** Provider that establishes the WebSocket connection and wires events to state */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { state, dispatch: chatDispatch } = useChatContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();

  const { sendMessage, connectionStatus, lastError } = useWebSocket({
    chatDispatch,
    preferencesDispatch,
    sessionId: state.sessionId,
  });

  return (
    <WebSocketContext.Provider value={{ sendMessage, connectionStatus, lastError }}>
      {children}
    </WebSocketContext.Provider>
  );
}

/** Consumer hook — throws if used outside WebSocketProvider */
export function useWebSocketContext(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return ctx;
}
