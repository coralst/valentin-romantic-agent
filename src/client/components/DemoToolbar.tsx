import React, { useCallback, useState } from 'react';
import { useSessionContext } from '../context/session-context';
import { useChatContext } from '../context/chat-context';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { seedDemoSession, fetchSessionPreferences, resetSession } from '../utils/demo-session-api';
import { colors, typography, radii, insets, layout, animation } from '../design-system/tokens';
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

/*
 * These controls live in one place only: the icon rail's ⚙ menu, a single 268px
 * column (`IconRail.getPopoverStyle`). So this is a stacked list of full-width
 * controls, not a horizontal toolbar — the old `display: flex` row with
 * `marginLeft: auto` was written for the deleted app header, and inside a narrow
 * popover it wrapped into a ragged 2×2 grid of mismatched pills.
 *
 * `alignItems: stretch` is what gives every control the same width; the shared
 * `layout.menuControlHeight` gives them the same height. Both are load-bearing
 * for the menu reading as one menu.
 */
const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8,
  minWidth: 0,
};

const buttonBaseStyle: React.CSSProperties = {
  height: layout.menuControlHeight,
  padding: `0 ${insets.tight}px`,
  borderRadius: radii.chip,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.medium,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `opacity ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

/** The one thing a presenter came here to do, so it carries the claret fill. */
const primaryButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: colors.claret,
  color: colors.textOnAccent,
  border: '1px solid transparent',
  boxShadow: '0 6px 16px rgba(140, 47, 69, 0.22)',
};

/**
 * Reset throws the rehearsal away, so it is claret *text* on sand rather than a
 * second filled button: in the brand's palette claret is the only colour that
 * says "this is consequential", and reusing the fill would make the destructive
 * control look exactly as inviting as the constructive one.
 */
const destructiveButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: colors.sand,
  color: colors.claret,
  border: '1px solid rgba(140, 47, 69, 0.22)',
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
  boxShadow: 'none',
};

/**
 * The status line wraps rather than stretching the menu: a network error is a
 * whole sentence, and `whiteSpace: nowrap` here would push the popover off the
 * side of the viewport.
 */
const statusBaseStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  lineHeight: 1.45,
  minWidth: 0,
};

const infoStatusStyle: React.CSSProperties = {
  ...statusBaseStyle,
  color: colors.inkMuted,
};

const errorStatusStyle: React.CSSProperties = {
  ...statusBaseStyle,
  color: colors.claret,
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
        style={isBusy ? { ...destructiveButtonStyle, ...disabledStyle } : destructiveButtonStyle}
        onClick={handleReset}
        disabled={isBusy}
        data-testid="reset-session-button"
      >
        {pending === 'reset' ? 'Resetting…' : 'Reset'}
      </button>

      {children}

      {/* Under the controls, not above them: a message that appeared above would
          push both buttons down under the cursor that just pressed one. */}
      {status && (
        <span
          style={status.tone === 'error' ? errorStatusStyle : infoStatusStyle}
          data-testid="demo-toolbar-status"
        >
          {status.message}
        </span>
      )}

      <div aria-live="polite" aria-atomic="true" style={liveRegionStyle} data-testid="demo-toolbar-live-region">
        {liveAnnouncement}
      </div>
    </div>
  );
}
