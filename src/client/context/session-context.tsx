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
import { takeSignInSession } from '../auth/initial-session';
import { takeResumeSession } from '../auth/resume-session';
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

/**
 * Whether anyone has actually said anything in this transcript.
 *
 * The agent's welcome message does not count: it is sent on every connect, so a
 * conversation nobody has typed into still holds one message. "Has the user
 * spoken?" is the only reading that separates a conversation worth keeping from
 * a blank one.
 */
function hasUserTurn(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.sender === 'user');
}

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
  /**
   * Start a conversation — or hand back the one already on screen if nobody has
   * said anything in it yet. See the note on the implementation.
   */
  createSession: () => Promise<StoredSession>;
  /**
   * Insert an already-built session (e.g. one created server-side) into the
   * store without focusing it. Pair with switchSession to bring it forward.
   */
  adoptSession: (session: StoredSession) => void;
  /**
   * Re-read the whole conversation list from the server.
   *
   * Needed by anything that makes the server mint conversations the client did not
   * ask for one at a time — `POST /session/seed` creates one per fixture
   * conversation, five for the demo profile. Those callers used to `adoptSession` a
   * single locally-invented row instead, so the sidebar showed "Demo profile" where
   * the account had five real, titled, back-dated conversations, and the other four
   * only appeared after a page reload.
   *
   * `focusId` is hydrated before the list is dispatched, so the transcript is
   * present the moment the conversation is focused.
   */
  refreshSessions: (focusId?: string | null) => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  /**
   * Tell the store what the *live* transcript currently holds, and for which
   * session. Called by `SessionSyncer`, which is the only place that sees chat
   * state and session state at once.
   *
   * `createSession` needs it. The stored record lags the screen by up to the
   * persistence debounce, so a conversation that has just been typed into still
   * looks empty in `sessions` — and reusing it would drop the turn in flight
   * into a conversation the user believes they left.
   */
  reportLiveTranscript: (sessionId: string | null, messages: ChatMessage[]) => void;
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

  /**
   * Fetch the list, hydrate the conversation about to be focused, and dispatch.
   *
   * Extracted from the boot effect so `refreshSessions` cannot drift from it: a
   * second copy of "which one do we open, and is its transcript loaded" is how the
   * sidebar and the server come to disagree.
   *
   * `focusId` undefined means "decide as if booting" — the sign-in session, else the
   * newest. Passing an explicit id (the seeder does) focuses that one.
   */
  const loadSessionList = useCallback(async (focusId?: string | null): Promise<void> => {
    const sessions = await fetchSessions();

    /*
     * Which conversation to open.
     *
     * The one the sign-in just created wins over the newest one in the list,
     * and it wins even when the list does not mention it. `listSessions` is a
     * GSI query and a GSI is eventually consistent, so a session seeded
     * milliseconds ago can be missing from the answer — and then the app
     * would decide the account is empty and create a second conversation,
     * beside the one it was handed. Trusting the id the login returned makes
     * a fresh sign-in land on exactly one conversation, deterministically.
     */
    /*
     * A `/?s=<id>` link outranks the newest conversation but not an explicit
     * `focusId` or a session the sign-in just created. It is read here rather
     * than in an effect because the auth gate wipes the query string long before
     * one could run — see `auth/resume-session.ts`.
     */
    const linkedId = focusId !== undefined ? null : takeResumeSession();
    const activeId =
      focusId !== undefined
        ? focusId
        : takeSignInSession() ?? linkedId ?? sessions[0]?.id ?? null;

    // Hydrate the conversation we are about to open *before* focusing it.
    // SessionSyncer reacts to the active id changing and reads whatever
    // messages are present at that moment, so filling them in afterwards
    // would leave the transcript blank until the next switch.
    if (activeId) {
      try {
        const detail = await fetchSessionDetail(activeId);
        // Only a detail that is actually the conversation we asked for. A
        // malformed or mismatched answer used to be pushed into the list as a row
        // with the wrong id — or no id — which then failed the `some()` check
        // below and silently left nothing selected.
        if (detail.id !== activeId) throw new Error('session detail id mismatch');
        const index = sessions.findIndex((s) => s.id === activeId);
        // Appended rather than dropped when the list has not caught up: it
        // is a real conversation, and `LOAD_SESSIONS` sorts by recency, so
        // it lands where it belongs.
        if (index >= 0) sessions[index] = detail;
        else sessions.push(detail);
        hydrated.current.add(detail.id);
      } catch {
        // A list we can show beats a blank sidebar; the transcript will
        // arrive when they click the conversation.
      }
    }

    dispatch({
      type: 'LOAD_SESSIONS',
      sessions,
      /*
       * Only if it survived hydration: focusing an id that is in no row leaves
       * the sidebar with nothing selected beside a live transcript.
       *
       * An id that came from a link falls back to the newest conversation instead
       * of to nothing. A link can be stale or belong to another account — in
       * which case the detail fetch 404s, which is the correct answer, since every
       * session route is scoped to the authenticated user — and landing someone on
       * a blank app because they clicked an old email is a worse outcome than
       * quietly opening what they do have.
       */
      activeId: sessions.some((s) => s.id === activeId)
        ? activeId
        : linkedId
          ? sessions[0]?.id ?? null
          : null,
      collapsed: loadSidebarCollapsed(),
    });
  }, []);

  const refreshSessions = useCallback(
    async (focusId?: string | null) => {
      try {
        await loadSessionList(focusId);
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          error: `Couldn't load your conversations — ${describe(error)}.`,
        });
      }
    },
    [loadSessionList],
  );

  useEffect(() => {
    // React 19 StrictMode mounts effects twice; the list load is idempotent but
    // the legacy discard notice is not.
    if (booted.current) return;
    booted.current = true;

    let cancelled = false;
    const discarded = discardLegacySessions();

    void (async () => {
      try {
        await loadSessionList();
        if (cancelled) return;
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

  /*
   * Latest values for `createSession` to consult, held in refs so the callback
   * keeps a stable identity — it is passed into the sidebar, and a new function
   * on every keystroke would churn every consumer of this context.
   */
  const activeSessionRef = useRef<StoredSession | null>(activeSession);
  activeSessionRef.current = activeSession;
  const liveTranscriptRef = useRef<{ id: string | null; hasUserTurn: boolean }>({
    id: null,
    hasUserTurn: false,
  });

  const reportLiveTranscript = useCallback((sessionId: string | null, messages: ChatMessage[]) => {
    liveTranscriptRef.current = { id: sessionId, hasUserTurn: hasUserTurn(messages) };
  }, []);

  const createSession = useCallback(async (): Promise<StoredSession> => {
    /*
     * Idempotent while the conversation on screen is still untouched.
     *
     * "+ New conversation" used to POST unconditionally, so every click on it
     * from a blank conversation left the previous blank one behind as a
     * permanent 0-message row. Nothing distinguishes the two — they have the
     * same empty transcript and the same "New conversation" label — so the
     * honest answer to "give me a new conversation" is the empty one they are
     * already looking at.
     *
     * Untouched has to be judged against the live transcript as well as the
     * stored record: the record is written on a debounce, so a conversation
     * typed into a moment ago still reads as empty here.
     */
    const current = activeSessionRef.current;
    const live = liveTranscriptRef.current;
    const liveIsUntouched = live.id !== current?.id || !live.hasUserTurn;
    const storedIsUntouched =
      current !== null &&
      (current.messages.length > 0 ? !hasUserTurn(current.messages) : current.messageCount === 0);

    if (current !== null && storedIsUntouched && liveIsUntouched) {
      // SET_ACTIVE rather than a no-op: on mobile this is what closes the
      // overlay, which is the only feedback the tap gets.
      dispatch({ type: 'SET_ACTIVE', id: current.id });
      return current;
    }

    const session = await createRemoteSession();
    // Brand new, so there is nothing to fetch.
    hydrated.current.add(session.id);
    dispatch({ type: 'ADD_SESSION', session });
    return session;
  }, []);

  /**
   * Whether a conversation has already been created for an empty account.
   *
   * A ref, and checked before the request goes out rather than after it comes
   * back: React can run this effect again — a re-render, a `notice` dispatch —
   * long before a POST completes, and two of those in flight at once is two
   * conversations. Cleared only when the account is known to have one, so a
   * failure leaves it set and the app asks the visitor rather than hammering the
   * endpoint.
   */
  const ensuringRef = useRef(false);

  /**
   * The account always has a conversation to be in.
   *
   * This is the other half of gating the socket on a known session. The socket
   * only ever resumes now — it will not mint one — so somebody has to create the
   * first conversation, and doing it here, once, from the one place that knows
   * how many exist, is what makes it deterministic. It covers a brand-new
   * account and the moment after the last conversation is deleted with the same
   * code.
   *
   * Deliberately not `createSession()`: that one is allowed to hand back the
   * conversation already on screen, and here there is provably none.
   */
  useEffect(() => {
    if (state.loading || state.error) return;

    if (state.sessions.length > 0) {
      ensuringRef.current = false;
      return;
    }
    if (ensuringRef.current) return;
    ensuringRef.current = true;

    void (async () => {
      try {
        const session = await createRemoteSession();
        hydrated.current.add(session.id);
        dispatch({ type: 'ADD_SESSION', session });
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          error: `Couldn't start a conversation — ${describe(error)}.`,
        });
      }
    })();
  }, [state.loading, state.error, state.sessions.length]);

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
        refreshSessions,
        switchSession,
        reportLiveTranscript,
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

/**
 * The same value, or null outside a provider.
 *
 * For surfaces that live inside the chat column but only need sessions for one
 * optional affordance — the guided intro's "load the full profile", which has a
 * working path that does not touch the session list. `ChatPanel` renders without
 * a SessionProvider in its own tests, and degrading is the honest answer there.
 * Same reasoning as `useOptionalViewContext`.
 */
export function useOptionalSessionContext(): SessionContextValue | null {
  return useContext(SessionContext);
}
