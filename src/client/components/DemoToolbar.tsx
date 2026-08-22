import React, { useCallback, useState } from 'react';
import { useSessionContext } from '../context/session-context';
import { useChatContext } from '../context/chat-context';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { seedDemoSession, fetchSessionPreferences, resetSession } from '../utils/demo-session-api';
import { colors, spacing, typography, borderRadius, animation } from '../design-system/tokens';
import type { StoredSession } from '../hooks/use-session-store';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

/** Which control is currently mid-flight, if any */
type PendingAction = 'seed' | 'reset' | null;

/** Tone of the toolbar's status message */
type StatusTone = 'info' | 'error';

interface DemoToolbarStatus {
  message: string;
  tone: StatusTone;
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  marginLeft: 'auto',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: `6px ${spacing.sm}px`,
  borderRadius: borderRadius.full,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `opacity ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  background: colors.accentGradient,
  color: colors.textOnAccent,
  border: '1px solid transparent',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: colors.surface,
  color: colors.softBurgundy,
  border: `1px solid ${colors.border}`,
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const statusBaseStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  maxWidth: 260,
  lineHeight: typography.lineHeights.normal,
};

const infoStatusStyle: React.CSSProperties = {
  ...statusBaseStyle,
  color: colors.textSecondary,
};

const errorStatusStyle: React.CSSProperties = {
  ...statusBaseStyle,
  color: colors.error,
};

const liveRegionStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'an unknown problem occurred';
}

/** Wrap a seeded session id and its preferences in a StoredSession */
function buildDemoSession(
  sessionId: string,
  preferences: PreferenceWithHistory[],
): StoredSession {
  return {
    id: sessionId,
    title: 'Demo profile',
    partnerName: null,
    messages: [],
    preferences,
    lastActivity: new Date().toISOString(),
    messageCount: 0,
  };
}

interface DemoToolbarProps {
  /**
   * Extra controls rendered after the built-in ones. Lets follow-up features
   * (e.g. the Valentin Inspector toggle) join this toolbar without touching
   * AppLayout.
   */
  children?: React.ReactNode;
}

/**
 * On-stage demo controls: load a fully populated partner profile in one
 * click, and reset back to a clean slate between rehearsals.
 */
export function DemoToolbar({ children }: DemoToolbarProps) {
  const { activeSession, adoptSession, switchSession } = useSessionContext();
  const { dispatch: chatDispatch } = useChatContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();
  const { dispatch: profileDispatch } = useProfileStoreContext();

  const [pending, setPending] = useState<PendingAction>(null);
  const [status, setStatus] = useState<DemoToolbarStatus | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const announce = useCallback((message: string, tone: StatusTone) => {
    setStatus({ message, tone });
    setLiveAnnouncement(message);
  }, []);

  const handleLoadDemoProfile = useCallback(async () => {
    setPending('seed');
    setStatus(null);
    try {
      const { sessionId, preferenceCount } = await seedDemoSession();
      const preferences = await fetchSessionPreferences(sessionId);
      // Adopt then switch, so SessionSyncer sees a real session change and
      // rehydrates chat + preferences for us.
      adoptSession(buildDemoSession(sessionId, preferences));
      switchSession(sessionId);
      announce(`Demo profile loaded — ${preferenceCount} preferences`, 'info');
    } catch (error) {
      announce(`Couldn't load the demo profile — ${describeError(error)}.`, 'error');
    } finally {
      setPending(null);
    }
  }, [adoptSession, switchSession, announce]);

  const clearVisibleState = useCallback(() => {
    chatDispatch({ type: 'SWITCH_SESSION', sessionId: activeSession?.id ?? null, messages: [] });
    preferencesDispatch({ type: 'LOAD_PREFERENCES', preferences: [] });
    profileDispatch({ type: 'CLEAR_ALL_VALUES' });
  }, [activeSession, chatDispatch, preferencesDispatch, profileDispatch]);

  const handleReset = useCallback(async () => {
    const sessionId = activeSession?.id;
    if (!sessionId) {
      announce('Nothing to reset yet — no active session.', 'info');
      return;
    }
    setPending('reset');
    setStatus(null);
    try {
      await resetSession(sessionId);
      clearVisibleState();
      announce('Session reset', 'info');
    } catch (error) {
      announce(`Couldn't reset the session — ${describeError(error)}.`, 'error');
    } finally {
      setPending(null);
    }
  }, [activeSession, clearVisibleState, announce]);

  const isBusy = pending !== null;

  return (
    <div style={toolbarStyle} data-testid="demo-toolbar" role="group" aria-label="Demo controls">
      {status && (
        <span
          style={status.tone === 'error' ? errorStatusStyle : infoStatusStyle}
          data-testid="demo-toolbar-status"
        >
          {status.message}
        </span>
      )}

      <button
        type="button"
        style={isBusy ? { ...primaryButtonStyle, ...disabledStyle } : primaryButtonStyle}
        onClick={handleLoadDemoProfile}
        disabled={isBusy}
        data-testid="load-demo-profile-button"
      >
        {pending === 'seed' ? 'Loading…' : 'Load demo profile'}
      </button>

      <button
        type="button"
        style={isBusy ? { ...secondaryButtonStyle, ...disabledStyle } : secondaryButtonStyle}
        onClick={handleReset}
        disabled={isBusy}
        data-testid="reset-session-button"
      >
        {pending === 'reset' ? 'Resetting…' : 'Reset'}
      </button>

      {children}

      <div aria-live="polite" aria-atomic="true" style={liveRegionStyle} data-testid="demo-toolbar-live-region">
        {liveAnnouncement}
      </div>
    </div>
  );
}
