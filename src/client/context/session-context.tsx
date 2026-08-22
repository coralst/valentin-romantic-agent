import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import {
  type StoredSession,
  discardLegacySessions,
  loadSidebarCollapsed,
  saveSidebarCollapsed,
} from '../hooks/use-session-store';
import {
  createRemoteSession,
  deleteRemoteSession,
  fetchSessionDetail,
  fetchSessions,
  renameRemoteSession,
} from '../utils/session-api';

/** Session state managed by the context */
export interface SessionState {
  sessions: StoredSession[];
  activeSessionId: string | null;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean; // for mobile overlay
  /** True while the list, or a transcript being switched to, is in flight */
  loading: boolean;
  /** A failure worth showing next to the conversation list */
  error: string | null;
  /**
   * A one-off message shown after the list loads — currently only used to say
   * that browser-local conversations were discarded on first sign-in.
   */
  notice: string | null;
}

/** Actions the session reducer handles */
export type SessionAction =
  | { type: 'LOAD_SESSIONS'; sessions: StoredSession[]; activeId: string | null; collapsed: boolean }
  | { type: 'SET_ACTIVE'; id: string }
  | { type: 'ADD_SESSION'; session: StoredSession }
  | { type: 'INSERT_SESSION'; session: StoredSession }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'RENAME_SESSION'; id: string; title: string }
  | { type: 'UPDATE_SESSION'; id: string; messages: ChatMessage[]; preferences: PreferenceWithHistory[]; partnerName?: string | null; lastActivity?: string }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_OPEN'; open: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_NOTICE'; notice: string | null };

const initialState: SessionState = {
  sessions: [],
  activeSessionId: null,
  sidebarCollapsed: false,
  sidebarOpen: false,
  loading: true,
  error: null,
  notice: null,
};

/** Newest conversation first — the order the sidebar renders */
function byRecency(a: StoredSession, b: StoredSession): number {
  return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'LOAD_SESSIONS':
      return {
        ...state,
        sessions: [...action.sessions].sort(byRecency),
        activeSessionId: action.activeId,
        sidebarCollapsed: action.collapsed,
        loading: false,
        error: null,
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

    /**
     * Fill in a session's transcript and profile, fetched from the server.
     *
     * `lastActivity` is only overwritten when the caller supplies one. Merely
     * opening a conversation must not bump it to the top of the list — the
     * sidebar's order should reflect when someone last *said* something.
     */
    case 'UPDATE_SESSION': {
      const updated = state.sessions.map((s) => {
        if (s.id !== action.id) return s;
        return {
          ...s,
          messages: action.messages,
          preferences: action.preferences,
          messageCount: action.messages.length,
          lastActivity: action.lastActivity ?? s.lastActivity,
          partnerName: action.partnerName !== undefined ? action.partnerName : s.partnerName,
        };
      });
      updated.sort(byRecency);
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

    case 'SET_LOADING':
      return { ...state, loading: action.loading };

    case 'SET_ERROR':
      return { ...state, error: action.error, loading: false };

    case 'SET_NOTICE':
      return { ...state, notice: action.notice };

    default:
      return state;
  }
}

interface SessionContextValue {
  state: SessionState;
  activeSession: StoredSession | null;
  createSession: () => Promise<StoredSession>;
  /**
   * Insert an already-built session (e.g. one created server-side) into the
   * store without focusing it. Pair with switchSession to bring it forward.
   */
  adoptSession: (session: StoredSession) => void;
  switchSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
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
  dismissNotice: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'an unknown problem occurred';
}

/**
 * Provider that wraps children with session history state.
 *
 * The list lives on the server, keyed by the signed-in user, so a conversation
 * survives a deploy, a cache clear and a different browser. It used to live in
 * localStorage, which meant none of those held — and since the stored sessions
 * never carried any messages, switching conversations always showed an empty
 * transcript. That is the bug this replaces.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  /**
   * Which sessions already hold their full transcript.
   *
   * Switching to one of these needs no round trip, which is what keeps the demo
   * button — it seeds a session and hands us the preferences directly — from
   * re-fetching what it just supplied.
   */
  const hydrated = useRef<Set<string>>(new Set());
  const booted = useRef(false);

  useEffect(() => {
    // React 19 StrictMode mounts effects twice; the list load is idempotent but
    // the legacy discard notice is not.
    if (booted.current) return;
    booted.current = true;

    let cancelled = false;
    const discarded = discardLegacySessions();

    void (async () => {
      try {
        const sessions = await fetchSessions();
        const first = sessions[0];

        // Hydrate the conversation we are about to open *before* focusing it.
        // SessionSyncer reacts to the active id changing and reads whatever
        // messages are present at that moment, so filling them in afterwards
        // would leave the transcript blank until the next switch.
        if (first) {
          try {
            const detail = await fetchSessionDetail(first.id);
            sessions[0] = detail;
            hydrated.current.add(detail.id);
          } catch {
            // A list we can show beats a blank sidebar; the transcript will
            // arrive when they click the conversation.
          }
        }

        if (cancelled) return;
        dispatch({
          type: 'LOAD_SESSIONS',
          sessions,
          activeId: first?.id ?? null,
          collapsed: loadSidebarCollapsed(),
        });
        if (discarded > 0) {
          dispatch({
            type: 'SET_NOTICE',
            notice:
              discarded === 1
                ? 'One conversation saved only in this browser was cleared. Conversations are now kept to your account.'
                : `${discarded} conversations saved only in this browser were cleared. Conversations are now kept to your account.`,
          });
        }
      } catch (error) {
        if (cancelled) return;
        dispatch({
          type: 'SET_ERROR',
          error: `Couldn't load your conversations — ${describe(error)}.`,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId) ?? null;

  const createSession = useCallback(async (): Promise<StoredSession> => {
    const session = await createRemoteSession();
    // Brand new, so there is nothing to fetch.
    hydrated.current.add(session.id);
    dispatch({ type: 'ADD_SESSION', session });
    return session;
  }, []);

  const adoptSession = useCallback((session: StoredSession) => {
    hydrated.current.add(session.id);
    dispatch({ type: 'INSERT_SESSION', session });
  }, []);

  const switchSession = useCallback(async (id: string) => {
    if (hydrated.current.has(id)) {
      dispatch({ type: 'SET_ACTIVE', id });
      return;
    }

    dispatch({ type: 'SET_LOADING', loading: true });
    try {
      const detail = await fetchSessionDetail(id);
      hydrated.current.add(id);
      dispatch({
        type: 'UPDATE_SESSION',
        id,
        messages: detail.messages,
        preferences: detail.preferences,
        partnerName: detail.partnerName,
      });
      dispatch({ type: 'SET_LOADING', loading: false });
      dispatch({ type: 'SET_ACTIVE', id });
    } catch (error) {
      // Deliberately not switching: showing an empty transcript labelled with
      // someone's conversation is worse than staying where they were.
      dispatch({
        type: 'SET_ERROR',
        error: `Couldn't open that conversation — ${describe(error)}.`,
      });
    }
  }, []);

  const removeSession = useCallback(async (id: string) => {
    // Optimistic: the row disappears at once and comes back if the server
    // refuses, which is the right trade for a button people click decisively.
    dispatch({ type: 'DELETE_SESSION', id });
    hydrated.current.delete(id);
    try {
      await deleteRemoteSession(id);
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: `Couldn't delete that conversation — ${describe(error)}.`,
      });
    }
  }, []);

  const renameSession = useCallback(async (id: string, title: string) => {
    dispatch({ type: 'RENAME_SESSION', id, title });
    try {
      await renameRemoteSession(id, title);
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        error: `Couldn't rename that conversation — ${describe(error)}.`,
      });
    }
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

  const dismissNotice = useCallback(() => {
    dispatch({ type: 'SET_NOTICE', notice: null });
    dispatch({ type: 'SET_ERROR', error: null });
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
        dismissNotice,
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
