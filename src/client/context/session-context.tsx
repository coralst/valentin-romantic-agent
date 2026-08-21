import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import {
  type StoredSession,
  loadSessions,
  saveSessions,
  saveSession,
  deleteSession as deleteSessionFromStore,
  renameSession as renameSessionInStore,
  createNewSession,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from '../hooks/use-session-store';

/** Session state managed by the context */
export interface SessionState {
  sessions: StoredSession[];
  activeSessionId: string | null;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // for mobile overlay
}

/** Actions the session reducer handles */
export type SessionAction =
  | { type: 'LOAD_SESSIONS'; sessions: StoredSession[]; activeId: string | null; collapsed: boolean }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'ADD_SESSION'; session: StoredSession }
  | { type: 'INSERT_SESSION'; session: StoredSession }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'RENAME_SESSION'; id: string; title: string }
  | { type: 'UPDATE_SESSION'; id: string; messages: ChatMessage[]; preferences: PreferenceWithHistory[]; partnerName?: string | null }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_OPEN'; open: boolean };

const initialState: SessionState = {
  sessions: [],
  activeSessionId: null,
  sidebarCollapsed: false,
  sidebarOpen: false,
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'LOAD_SESSIONS':
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: action.activeId,
        sidebarCollapsed: action.collapsed,
      };

    case 'SET_ACTIVE':
      return {
        ...state,
        activeSessionId: action.id,
        sidebarOpen: false, // close mobile overlay on selection
      };

    case 'ADD_SESSION':
      return {
        ...state,
        sessions: [action.session, ...state.sessions],
        activeSessionId: action.session.id,
        sidebarOpen: false,
      };

    // Adds a session to the list without focusing it — the caller decides
    // when (and whether) it comes to the foreground.
    case 'INSERT_SESSION':
      return {
        ...state,
        sessions: [action.session, ...state.sessions.filter((s) => s.id !== action.session.id)],
      };

    case 'DELETE_SESSION': {
      const filtered = state.sessions.filter((s) => s.id !== action.id);
      let nextActiveId = state.activeSessionId;
      if (state.activeSessionId === action.id) {
        nextActiveId = filtered.length > 0 ? filtered[0].id : null;
      }
      return {
        ...state,
        sessions: filtered,
        activeSessionId: nextActiveId,
      };
    }

    case 'RENAME_SESSION': {
      const trimmed = action.title.trim();
      const sessions = state.sessions.map((s) =>
        s.id === action.id ? { ...s, title: trimmed.length > 0 ? trimmed : null } : s,
      );
      return { ...state, sessions };
    }

    case 'UPDATE_SESSION': {
      const updated = state.sessions.map((s) => {
        if (s.id !== action.id) return s;
        return {
          ...s,
          messages: action.messages,
          preferences: action.preferences,
          messageCount: action.messages.length,
          lastActivity: new Date().toISOString(),
          partnerName: action.partnerName !== undefined ? action.partnerName : s.partnerName,
        };
      });
      // Re-sort by lastActivity descending
      updated.sort(
        (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
      );
      return {
        ...state,
        sessions: updated,
      };
    }

    case 'TOGGLE_SIDEBAR': {
      const newCollapsed = !state.sidebarCollapsed;
      saveSidebarCollapsed(newCollapsed);
      return {
        ...state,
        sidebarCollapsed: newCollapsed,
      };
    }

    case 'SET_SIDEBAR_OPEN':
      return {
        ...state,
        sidebarOpen: action.open,
      };

    default:
      return state;
  }
}

interface SessionContextValue {
  state: SessionState;
  activeSession: StoredSession | null;
  createSession: () => StoredSession;
  /**
   * Insert an already-built session (e.g. one created server-side) into the
   * store without focusing it. Pair with switchSession to bring it forward.
   */
  adoptSession: (session: StoredSession) => void;
  switchSession: (id: string) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /**
   * Write a transcript into the session with the given id.
   *
   * Addressed by explicit id rather than "whichever session is active", because
   * the caller may be flushing the *outgoing* session's messages during a
   * switch. Writing those to the newly active session would corrupt it — see
   * the note in `use-session-persistence.ts`.
   *
   * Passing `partnerName` as `undefined` leaves the stored value untouched.
   */
  persistSession: (
    id: string,
    messages: ChatMessage[],
    preferences: PreferenceWithHistory[],
    partnerName?: string | null,
  ) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Provider that wraps children with session history state */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  // Load sessions on mount
  useEffect(() => {
    const sessions = loadSessions();
    const collapsed = loadSidebarCollapsed();
    const activeId = sessions.length > 0 ? sessions[0].id : null;
    dispatch({ type: 'LOAD_SESSIONS', sessions, activeId, collapsed });
  }, []);

  // Persist sessions whenever they change (after initial load)
  useEffect(() => {
    if (state.sessions.length > 0) {
      saveSessions(state.sessions);
    }
  }, [state.sessions]);

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  const createSession = useCallback((): StoredSession => {
    const session = createNewSession();
    saveSession(session);
    dispatch({ type: 'ADD_SESSION', session });
    return session;
  }, []);

  const adoptSession = useCallback((session: StoredSession) => {
    saveSession(session);
    dispatch({ type: 'INSERT_SESSION', session });
  }, []);

  const switchSession = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE', id });
  }, []);

  const removeSession = useCallback((id: string) => {
    deleteSessionFromStore(id);
    dispatch({ type: 'DELETE_SESSION', id });
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    renameSessionInStore(id, title);
    dispatch({ type: 'RENAME_SESSION', id, title });
  }, []);

  const persistSession = useCallback(
    (
      id: string,
      messages: ChatMessage[],
      preferences: PreferenceWithHistory[],
      partnerName?: string | null,
    ) => {
      if (!id) return;
      dispatch({ type: 'UPDATE_SESSION', id, messages, preferences, partnerName });
    },
    [],
  );

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_SIDEBAR_OPEN', open });
  }, []);

  return (
    <SessionContext.Provider
      value={{
        state,
        activeSession,
        createSession,
        adoptSession,
        switchSession,
        removeSession,
        renameSession,
        persistSession,
        toggleSidebar,
        setSidebarOpen,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

/** Consumer hook — throws if used outside SessionProvider */
export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return ctx;
}
