import React, { useCallback, useState } from 'react';
import { useChatContext } from '../context/chat-context';
import { usePreferencesContext } from '../context/preferences-context';
import { useWebSocketContext } from '../context/websocket-context';
import { useOptionalSessionContext } from '../context/session-context';
import { useOptionalViewContext } from '../context/view-context';
import { useGuidedIntro } from '../demo/use-guided-intro';
import { fetchSessionPreferences, seedDemoSession } from '../utils/demo-session-api';
import { colors, insets, radii, typography } from '../design-system/tokens';
import type { StoredSession } from '../hooks/use-session-store';

/**
 * The three-question introduction, and the button that pays it off.
 *
 * It sits at the head of the chat column and shows one thing at a time: an
 * invitation, then a beat counter, then the payoff. It renders nothing at all
 * once the visitor has a profile of their own — this is a way *in*, not a
 * permanent fixture, and a demo affordance loitering above a real conversation
 * is worse than no demo affordance.
 *
 * **The whole point is that it is not a second rendering path.** `useGuidedIntro`
 * either sends the three prompts over the live socket or synthesises the events
 * the server would have sent; either way the transcript, the typing indicator,
 * the `LearnedStatus`, the profile highlight flash and the architecture drawer are
 * reached through the code they always use. So there is nothing here but a
 * button, a counter, and the payoff — no scripted chat bubbles, no fake profile.
 */

/** Which persona the payoff loads. The server owns the seeding; this names it. */
const PAYOFF_PERSONA = 'samantha';

const cardStyle: React.CSSProperties = {
  flexShrink: 0,
  margin: `${insets.tight}px ${insets.roomy}px 0`,
  padding: `${insets.snug}px ${insets.snug}px`,
  borderRadius: radii.card,
  backgroundColor: colors.linen,
  boxShadow: `0 0 0 1px ${colors.linenShade}, 0 6px 18px rgba(42,34,38,0.05)`,
  display: 'flex',
  alignItems: 'center',
  gap: insets.tight,
};

const copyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.headingFontFamily,
  fontWeight: typography.weights.normal,
  fontSize: typography.px.headingSm,
  color: colors.ink,
};

const noteStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: typography.px.smallLoose,
  lineHeight: typography.lineHeights.normal,
  color: colors.inkMuted,
};

const errorNoteStyle: React.CSSProperties = {
  ...noteStyle,
  color: colors.error,
};

const buttonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: `10px ${insets.snug}px`,
  borderRadius: radii.pill,
  backgroundColor: colors.claret,
  color: colors.onClaret,
  fontSize: typography.px.control,
  fontWeight: typography.weights.semibold,
  whiteSpace: 'nowrap',
  boxShadow: '0 8px 20px rgba(140,47,69,0.22)',
};

const busyButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.6,
  cursor: 'default',
};

const quietButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: 0,
  background: 'none',
  fontSize: typography.px.smallLoose,
  color: colors.inkMuted,
  textDecoration: 'underline',
  textDecorationColor: colors.linenShade,
  textUnderlineOffset: 3,
};

/**
 * The beat counter's dots. `◆` for beats already played, `·` for the rest —
 * both are in the shell's existing glyph vocabulary.
 */
function beatDots(beatIndex: number, beatCount: number): string {
  return Array.from({ length: beatCount }, (_, i) => (i <= beatIndex ? '◆' : '·')).join(
    ' ',
  );
}

/** Where the payoff's own request stands. */
type PayoffState = 'idle' | 'loading' | 'failed';

export function GuidedIntro() {
  const { state: chatState, dispatch: chatDispatch } = useChatContext();
  const { state: preferencesState, dispatch: preferencesDispatch } =
    usePreferencesContext();
  const { sendMessage, connectionStatus } = useWebSocketContext();
  // Both optional: the chat column renders without them in its own tests, and
  // the intro has a working path in each case.
  const sessions = useOptionalSessionContext();
  const view = useOptionalViewContext();

  const [payoff, setPayoff] = useState<PayoffState>('idle');

  const intro = useGuidedIntro({
    sessionId: chatState.sessionId,
    sendMessage,
    chatDispatch,
    preferencesDispatch,
    connectionStatus,
  });

  /**
   * Load the full profile, ending the intro.
   *
   * Through the session list when there is one: adopting the seeded session and
   * then switching to it lets `SessionSyncer` rehydrate chat and preferences the
   * way any other switch does, which keeps one path warm instead of two. The
   * transcript is carried across deliberately — the three answers the room just
   * watched land are the reason the full profile is impressive.
   *
   * `LOAD_PREFERENCES` directly otherwise. Same end state, minus the sidebar row.
   */
  const loadFullProfile = useCallback(async () => {
    setPayoff('loading');
    try {
      const { sessionId } = await seedDemoSession(PAYOFF_PERSONA);
      const preferences = await fetchSessionPreferences(sessionId);

      if (sessions) {
        const carried: StoredSession = {
          id: sessionId,
          title: 'Samantha',
          partnerName: 'Samantha',
          messages: chatState.messages,
          preferences,
          lastActivity: new Date().toISOString(),
          messageCount: chatState.messages.length,
        };
        // Adopt before switching: `SessionSyncer` reads `activeSession.messages`
        // at the instant the id changes, so a session focused before it has been
        // hydrated renders blank until the next switch.
        sessions.adoptSession(carried);
        sessions.switchSession(sessionId);
      } else {
        preferencesDispatch({ type: 'LOAD_PREFERENCES', preferences });
      }

      setPayoff('idle');
      // Only now: the dossier is the payoff, and opening it before the rows
      // arrive shows an empty board for a frame.
      view?.openDossier();
    } catch {
      // Deliberately terse and non-blocking. Whatever the room has already seen
      // stays on screen — this button adds to the story, it does not carry it.
      setPayoff('failed');
    }
  }, [chatState.messages, preferencesDispatch, sessions, view]);

  /*
   * Nothing to introduce once there is a profile, or once the visitor has said
   * something of their own.
   *
   * Both conditions are about state rather than about which persona signed in:
   * that is what actually decides whether an introduction is wanted, and it stays
   * right if someone arrives here another way.
   *
   * "Has spoken" is specifically *a user message*, not a non-empty transcript.
   * The server greets on every connect, so the transcript is essentially never
   * empty — gating on its length would hide the intro from everyone.
   */
  const hasProfile = Object.values(preferencesState.preferences).some(
    (rows) => rows.length > 0,
  );
  const hasSpoken = chatState.messages.some((message) => message.sender === 'user');
  if (intro.phase === 'idle' && (hasProfile || hasSpoken)) {
    return null;
  }

  if (intro.phase === 'running') {
    return (
      <div style={cardStyle} data-testid="guided-intro">
        <div style={copyStyle}>
          <b style={titleStyle}>
            <span aria-hidden="true">{beatDots(intro.beatIndex, intro.beatCount)}</span>{' '}
            Question {intro.beatIndex + 1} of {intro.beatCount}
          </b>
          <em style={noteStyle} data-testid="guided-intro-progress">
            {intro.source === 'live'
              ? 'Listening to Valentin as he answers.'
              : 'Playing the rehearsed answers.'}
          </em>
        </div>
        <button
          type="button"
          style={quietButtonStyle}
          onClick={intro.stop}
          data-testid="guided-intro-skip"
        >
          Skip
        </button>
      </div>
    );
  }

  if (intro.phase === 'complete') {
    return (
      <div style={cardStyle} data-testid="guided-intro">
        <div style={copyStyle}>
          <b style={titleStyle}>Three answers, five facts.</b>
          {payoff === 'failed' ? (
            <em style={errorNoteStyle} data-testid="guided-intro-error">
              The full profile could not be loaded. What you see here is still real.
            </em>
          ) : (
            <em style={noteStyle}>Now see what three years of this looks like.</em>
          )}
        </div>
        <button
          type="button"
          style={payoff === 'loading' ? busyButtonStyle : buttonStyle}
          onClick={() => void loadFullProfile()}
          disabled={payoff === 'loading'}
          data-testid="guided-intro-payoff"
        >
          {payoff === 'loading' ? 'Loading…' : 'Load the full profile  →'}
        </button>
      </div>
    );
  }

  return (
    <div style={cardStyle} data-testid="guided-intro">
      <div style={copyStyle}>
        <b style={titleStyle}>Start with three questions.</b>
        <em style={noteStyle}>
          Watch each answer become something he knows about her, as it happens.
        </em>
      </div>
      <button
        type="button"
        style={buttonStyle}
        onClick={intro.start}
        disabled={!chatState.sessionId}
        data-testid="guided-intro-start"
      >
        Show me  →
      </button>
    </div>
  );
}
