import React, { useEffect, useRef } from 'react';
import { ChatProvider, useChatContext } from './context/chat-context';
import { PreferencesProvider, usePreferencesContext } from './context/preferences-context';
import { WebSocketProvider } from './context/websocket-context';
import { SessionProvider, useSessionContext } from './context/session-context';
import { AuthProvider } from './context/auth-context';
import { PeopleProvider } from './context/people-context';
import { TasksProvider } from './context/tasks-context';
import { OutingsProvider } from './context/outings-context';
import { ArchitectureEngineProvider } from './context/architecture-engine-context';
import { flattenPreferences, useSessionPersistence } from './hooks/use-session-persistence';
import { AppLayout } from './components/AppLayout';
import { SharedConversationView } from './components/SharedConversationView';
import { takeShareToken } from './auth/share-view';
import { colors, typography, spacing } from './design-system/tokens';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

const errorContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  padding: spacing.xxl,
  textAlign: 'center',
  fontFamily: typography.bodyFontFamily,
  backgroundColor: colors.background,
};

const errorHeadingStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xl,
  color: colors.softBurgundy,
  marginBottom: spacing.sm,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: typography.sizes.base,
  color: colors.textSecondary,
  marginBottom: spacing.md,
};

const retryButtonStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.md}px`,
  backgroundColor: colors.softBurgundy,
  color: colors.warmIvory,
  border: 'none',
  borderRadius: '8px',
  fontSize: typography.sizes.base,
  cursor: 'pointer',
  fontWeight: 600,
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={errorContainerStyle} data-testid="error-boundary">
          <h2 style={errorHeadingStyle}>Something went wrong</h2>
          <p style={errorTextStyle}>
            Valentin encountered an unexpected error. Please try refreshing.
          </p>
          <button style={retryButtonStyle} onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Keeps the live chat/preferences state and the stored session record in sync,
 * in both directions.
 *
 * Read: when the active session changes, load its transcript into chat state.
 * Write: `useSessionPersistence` debounces the live transcript back into the
 * session record, so switching away and back restores it.
 *
 * The ordering inside the switch effect is load-bearing. `SWITCH_SESSION`
 * replaces the transcript outright, so the outgoing conversation must be flushed
 * *before* that dispatch — at this point chat state still holds the outgoing
 * messages, and the persistence hook still has the outgoing session tagged as
 * their owner. Flushing afterwards would either lose them or stamp them onto the
 * incoming session.
 */
export function SessionSyncer({ children }: { children: React.ReactNode }) {
  const {
    state: sessionState,
    activeSession,
    persistSession,
    adoptSession,
    switchSession,
    reportLiveTranscript,
  } = useSessionContext();
  const { state: chatState, dispatch: chatDispatch } = useChatContext();
  const { state: preferencesState, dispatch: preferencesDispatch } = usePreferencesContext();
  const prevSessionIdRef = useRef<string | null>(null);

  /**
   * Every session id this syncer has already accounted for.
   *
   * The adoption effect below must fire at most once per id, and "is this id in
   * `sessions`?" is not enough on its own: deleting the active conversation
   * drops its row while chat state still names it for one render, which is
   * indistinguishable from a session that has just been minted. Without this the
   * conversation the user deleted would reappear in the sidebar.
   */
  const knownSessionIdsRef = useRef<Set<string>>(new Set());
  for (const session of sessionState.sessions) knownSessionIdsRef.current.add(session.id);

  const { flush, setOwner } = useSessionPersistence({
    messages: chatState.messages,
    preferences: preferencesState.preferences,
    persistSession,
  });

  useEffect(() => {
    const currentId = activeSession?.id ?? null;
    if (currentId === prevSessionIdRef.current) return;

    // Save the outgoing transcript before it is replaced below.
    flush();

    prevSessionIdRef.current = currentId;
    // Retag the hook before the incoming messages land, so any subsequent write
    // is addressed to the session those messages actually belong to.
    setOwner(currentId);

    chatDispatch({
      type: 'SWITCH_SESSION',
      sessionId: currentId,
      messages: activeSession?.messages ?? [],
    });
    preferencesDispatch({
      type: 'LOAD_PREFERENCES',
      preferences: activeSession?.preferences ?? [],
    });
  }, [activeSession, chatDispatch, preferencesDispatch, flush, setOwner]);

  /**
   * Adopt a session the server minted for us over the socket.
   *
   * The socket connects before the conversation list has arrived, so it
   * authenticates with no session id, the gateway mints one and announces it in
   * `session_init`. That event only ever reached the chat reducer, so the
   * conversation on screen belonged to no session record at all: the sidebar said
   * "No conversations yet" directly beside a live transcript, and
   * `useSessionPersistence` sat on a null owner — `write()` bails on one — so the
   * transcript was never written back either.
   *
   * Two conditions keep this narrow, and both are load-bearing:
   *
   * - Nothing is adopted while the list is still loading. `LOAD_SESSIONS` has the
   *   last word on which conversation is active, and adopting ahead of it means
   *   the switch effect above then sees the active id fall back to null and
   *   clears the transcript that had just appeared.
   * - Nothing is adopted while a conversation is already active. Then the minted
   *   session is the stray from the pre-load race, the socket is about to rebind
   *   to the active one, and — because `SESSION_INIT` keeps a non-empty
   *   transcript — the messages in hand belong to the active conversation, not to
   *   the minted id. Adopting them would stamp one conversation's transcript onto
   *   another's record.
   *
   * The live messages are carried into the record deliberately: the switch effect
   * re-dispatches `SWITCH_SESSION` from `activeSession.messages`, so adopting an
   * empty record would wipe the welcome message off the screen it just landed on.
   */
  useEffect(() => {
    if (sessionState.loading) return;
    if (sessionState.activeSessionId !== null) return;

    const liveId = chatState.sessionId;
    if (!liveId) return;
    if (knownSessionIdsRef.current.has(liveId)) return;
    knownSessionIdsRef.current.add(liveId);

    const messages = chatState.messages;
    adoptSession({
      id: liveId,
      title: null,
      partnerName: null,
      messages,
      preferences: flattenPreferences(preferencesState.preferences),
      // The last message's own timestamp, so the row does not claim activity the
      // conversation has not had. A brand new session has only the greeting.
      lastActivity: messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
      messageCount: messages.length,
    });
    // Focus it: adoption alone leaves the row unselected, and the conversation it
    // describes is the one already on screen.
    void switchSession(liveId).catch(() => {});
  }, [
    sessionState.loading,
    sessionState.activeSessionId,
    chatState.sessionId,
    chatState.messages,
    preferencesState.preferences,
    adoptSession,
    switchSession,
  ]);

  // Keep the store's view of the live transcript current, so `createSession` can
  // tell a conversation nobody has typed into from one whose messages simply have
  // not been written back yet.
  useEffect(() => {
    reportLiveTranscript(chatState.sessionId, chatState.messages);
  }, [chatState.sessionId, chatState.messages, reportLiveTranscript]);

  return <>{children}</>;
}

/**
 * Her family and his to-do list, mounted above the socket.
 *
 * Both used to live inside `AppLayout`, which was fine while they were
 * `localStorage` toys nobody else wrote to. Now the extractor discovers a sister
 * mid-conversation and the server pushes `person_update`, so the stores have to
 * be in scope where the frames arrive — and `WebSocketProvider` is above the
 * layout. Keyed on the chat's session id, exactly as they were before, which is
 * why this reads it from context rather than taking a prop.
 */
function HerRecordsProviders({ children }: { children: React.ReactNode }) {
  const { state } = useChatContext();
  return (
    <PeopleProvider sessionId={state.sessionId}>
      <TasksProvider sessionId={state.sessionId}>
        <OutingsProvider sessionId={state.sessionId}>{children}</OutingsProvider>
      </TasksProvider>
    </PeopleProvider>
  );
}

export function App() {
  /*
   * A guest on a share link gets a different app, decided before anything else.
   *
   * `takeShareToken` read `window.location` at module-eval time, which is the only
   * moment guaranteed to be before `cognito-oauth.ts` wipes the query string. The
   * branch has to be *here*, above `AuthProvider`, because that provider renders
   * `LoginScreen` for anyone not signed in — and a guest never will be. Returning
   * early also means `SessionProvider` and the socket never mount, so nothing below
   * fires an authenticated request there is no token for.
   */
  const shareToken = takeShareToken();
  if (shareToken) {
    return (
      <ErrorBoundary>
        <SharedConversationView token={shareToken} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      {/*
        AuthProvider sits inside the boundary (so a failed sign-in still renders
        the error card) and above SessionProvider, which it renders only once
        there is a token. Nothing below here ever has to ask whether it is
        authenticated.
      */}
      <AuthProvider>
        <SessionProvider>
          <ChatProvider>
            <PreferencesProvider>
              <SessionSyncer>
                <HerRecordsProviders>
                  {/*
                    Above the socket, not inside the layout, and that nesting is the
                    whole reason the engine switch does something: `WebSocketProvider`
                    reads the selected engine to pick which path it opens — `/ws` or
                    `/ws/agentcore` — and a provider mounted below it could not be
                    read. It used to sit in `AppLayout`, which is why the switch
                    redrew the diagram while the chat stayed on engine A.
                  */}
                  <ArchitectureEngineProvider>
                    <WebSocketProvider>
                      <AppLayout />
                    </WebSocketProvider>
                  </ArchitectureEngineProvider>
                </HerRecordsProviders>
              </SessionSyncer>
            </PreferencesProvider>
          </ChatProvider>
        </SessionProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
