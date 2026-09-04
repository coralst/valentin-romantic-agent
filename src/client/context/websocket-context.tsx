import React, { createContext, useContext } from 'react';
import { useWebSocket } from '../hooks/use-websocket';
import { useChatContext } from './chat-context';
import { usePreferencesContext } from './preferences-context';
import { useOptionalPeopleContext } from './people-context';
import { useOptionalTasksContext } from './tasks-context';
import { useOptionalOutingsContext } from './outings-context';
import { useArchitectureEngineContext } from './architecture-engine-context';

interface WebSocketContextValue {
  sendMessage: (content: string) => void;
  confirmAction: (proposalId: string) => void;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  lastError: string | null;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/** Provider that establishes the WebSocket connection and wires events to state */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { state, dispatch: chatDispatch } = useChatContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();
  /*
   * Optional on purpose. `PeopleProvider`, `TasksProvider` and `OutingsProvider`
   * sit above this one in `App` so that `person_update`, `task_update` and
   * `outing_update` have somewhere to land, but plenty of tests mount the socket
   * without any of them — and a connection that refused to open without a family
   * tree attached would have the dependency backwards.
   */
  const people = useOptionalPeopleContext();
  const tasks = useOptionalTasksContext();
  const outings = useOptionalOutingsContext();

  /*
   * The engine switch in the icon rail decides which backend this socket talks to.
   *
   * This is the line that makes the switch a real control rather than a drawing:
   * `useWebSocket` turns the engine into a path — `/ws` for the baseline service,
   * `/ws/agentcore` for the AgentCore proxy — and the ALB routes on exactly that.
   * Changing it changes `wsUrl`, which `connect` depends on, so the current socket
   * is closed and a new one is opened against the other engine.
   *
   * The reconnect carries the same session id, so the conversation is *resumed* on
   * the other engine rather than restarted: the same history, answered by the other
   * architecture, which is the only version of this comparison worth showing.
   */
  const { engine } = useArchitectureEngineContext();

  const { sendMessage, confirmAction, connectionStatus, lastError } = useWebSocket({
    chatDispatch,
    preferencesDispatch,
    peopleDispatch: people?.dispatch,
    tasksDispatch: tasks?.dispatch,
    outingsDispatch: outings?.dispatch,
    sessionId: state.sessionId,
    engine,
  });

  return (
    <WebSocketContext.Provider
      value={{ sendMessage, confirmAction, connectionStatus, lastError }}
    >
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
