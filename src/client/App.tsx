import React, { useEffect, useRef } from 'react';
import { ChatProvider, useChatContext } from './context/chat-context';
import { PreferencesProvider, usePreferencesContext } from './context/preferences-context';
import { WebSocketProvider } from './context/websocket-context';
import { SessionProvider, useSessionContext } from './context/session-context';
import { AuthProvider } from './context/auth-context';
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

function SessionSyncer({ children }: { children: React.ReactNode }) {
  const { activeSession } = useSessionContext();
  const { dispatch: chatDispatch } = useChatContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = activeSession?.id ?? null;
    if (currentId === prevSessionIdRef.current) return;
    prevSessionIdRef.current = currentId;

    chatDispatch({
      type: 'SWITCH_SESSION',
      sessionId: currentId,
      messages: activeSession?.messages ?? [],
    });
    preferencesDispatch({
      type: 'LOAD_PREFERENCES',
      preferences: activeSession?.preferences ?? [],
    });
  }, [activeSession, chatDispatch, preferencesDispatch]);

  return <>{children}</>;
}

export function App() {
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
                <WebSocketProvider>
                  <AppLayout />
                </WebSocketProvider>
              </SessionSyncer>
            </PreferencesProvider>
          </ChatProvider>
        </SessionProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
