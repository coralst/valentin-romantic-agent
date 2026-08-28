import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../hooks/use-websocket';
import { useChatContext } from './chat-context';
import { usePreferencesContext } from './preferences-context';
import { useOptionalPeopleContext } from './people-context';
import { useOptionalTasksContext } from './tasks-context';

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
  /*
   * Optional on purpose. `PeopleProvider` and `TasksProvider` sit above this one
   * in `App` so that `person_update` and `task_update` have somewhere to land,
   * but plenty of tests mount the socket without either — and a connection that
   * refused to open without a family tree attached would have the dependency
   * backwards.
   */
  const people = useOptionalPeopleContext();
  const tasks = useOptionalTasksContext();

  const { sendMessage, connectionStatus, lastError } = useWebSocket({
    chatDispatch,
    preferencesDispatch,
    peopleDispatch: people?.dispatch,
    tasksDispatch: tasks?.dispatch,
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
