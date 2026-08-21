import React, { useEffect, useRef } from 'react';
import { ChatProvider, useChatContext } from './context/chat-context';
import { PreferencesProvider, usePreferencesContext } from './context/preferences-context';
import { WebSocketProvider } from './context/websocket-context';
import { SessionProvider, useSessionContext } from './context/session-context';
import { useSessionPersistence } from './hooks/use-session-persistence';
import { AppLayout } from './components/AppLayout';
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
          <button
            style={retryButtonStyle}
            onClick={() => window.location.reload()}
          >
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
  const { activeSession, persistSession } = useSessionContext();
  const { state: chatState, dispatch: chatDispatch } = useChatContext();
  const { state: preferencesState, dispatch: preferencesDispatch } = usePreferencesContext();
  const prevSessionIdRef = useRef<string | null>(null);

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

  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <ChatProvider>
          <PreferencesProvider>
            <SessionSyncer>
              <WebSocketProvider>
                <AppLayout />
              </WebSocketProvider>
            </SessionSyncer>
          </PreferencesProvider>
        </ChatProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
