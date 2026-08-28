import { useEffect, useState } from 'react';

import type { ActionProposalPayload } from '../../shared/interfaces/ws-events';
import type { ProposalStatus } from '../hooks/use-chat-state';
import { colors, insets, radii, typography } from '../design-system/tokens';

/**
 * The one place in Valentin where a click has a consequence outside the browser.
 *
 * Everything the agent proposes — a table, a calendar entry, an email, a WhatsApp
 * nudge — arrives as one of these and does nothing until Confirm is pressed. The
 * card is therefore written to be readable rather than persuasive: the summary is
 * the provider's own words about what will happen, and there is no default
 * action, no pre-selected button and no auto-accept on timeout.
 *
 * The countdown is load-bearing, not decoration. An Ontopo checkout link is good
 * for about fifteen minutes and the server holds proposals in memory, so a card
 * left on screen goes stale — and it has to *look* stale before it is pressed,
 * rather than being a button that quietly fails.
 */

interface ProposalCardProps {
  proposal: ActionProposalPayload;
  status: ProposalStatus;
  onConfirm: (proposalId: string) => void;
  onDismiss: (proposalId: string) => void;
  /**
   * Injectable clock, for tests. Production passes nothing and reads the real
   * one every second.
   */
  now?: number;
}

/** How often the countdown re-renders. */
const TICK_MS = 1000;

/** Under this, the remaining time is shown in the colour of a warning. */
const URGENT_MS = 60 * 1000;

const cardStyle: React.CSSProperties = {
  border: `1px solid ${colors.linenShade}`,
  borderRadius: radii.panel,
  background: colors.vitrineSayGradient,
  padding: `${insets.tight}px ${insets.snug}px`,
  margin: '10px 0',
  fontFamily: typography.bodyFontFamily,
};

const eyebrowRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const titleStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingSm,
  fontWeight: typography.weights.normal,
  color: colors.ink,
  margin: '6px 0 0',
};

const summaryStyle: React.CSSProperties = {
  fontSize: typography.px.body,
  lineHeight: typography.lineHeights.normal,
  color: colors.inkMuted,
  // The summaries are written as short paragraphs by the tools, and one of them
  // quotes the exact WhatsApp message on its own line.
  whiteSpace: 'pre-wrap',
  margin: '6px 0 0',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: insets.tight,
};

const confirmStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: radii.pill,
  padding: '8px 18px',
  background: colors.accentGradient,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  cursor: 'pointer',
};

const dismissStyle: React.CSSProperties = {
  border: `1px solid ${colors.linenShade}`,
  borderRadius: radii.pill,
  padding: '8px 14px',
  background: 'transparent',
  color: colors.inkMuted,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  cursor: 'pointer',
};

const disabledStyle: React.CSSProperties = {
  ...confirmStyle,
  background: colors.linen,
  color: colors.inkFaint,
  cursor: 'not-allowed',
};

const linkStyle: React.CSSProperties = {
  fontSize: typography.px.small,
  color: colors.claret,
  marginLeft: 'auto',
};

const resolvedStyle: React.CSSProperties = {
  fontSize: typography.px.small,
  color: colors.inkMuted,
  marginTop: insets.tight,
};

/** `4m 05s`, or `expired`. Seconds are padded so the width does not jitter. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export function ProposalCard({
  proposal,
  status,
  onConfirm,
  onDismiss,
  now,
}: ProposalCardProps) {
  /*
   * Ticks only while the card can still be acted on. A resolved card keeps no
   * timer — there were four of these on screen during a long demo conversation,
   * and a second-by-second re-render each is a cost with nothing to show for it.
   */
  const [tick, setTick] = useState(() => now ?? Date.now());
  const isOpen = status === 'open';

  useEffect(() => {
    if (now !== undefined || !isOpen) return;
    const timer = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [now, isOpen]);

  const clock = now ?? tick;
  const expiresAt = new Date(proposal.expiresAt).getTime();
  /*
   * An unparseable `expiresAt` counts as expired.
   *
   * Fail closed: the alternative is `NaN > clock === false` in one place and a
   * live-looking button in another, and of the two possible mistakes, refusing
   * to book a table is the one that can be recovered by asking again.
   */
  const remaining = Number.isFinite(expiresAt) ? expiresAt - clock : 0;
  const isExpired = remaining <= 0;

  const handleConfirm = () => {
    /*
     * Re-checked here as well as in the disabled state, and again on the server.
     * The button can be pressed in the same tick the proposal lapses, and the
     * click is the authority to spend someone's money.
     */
    if (!isOpen || isExpired) return;
    onConfirm(proposal.proposalId);
  };

  return (
    <div style={cardStyle} data-testid={`proposal-${proposal.proposalId}`}>
      <div style={eyebrowRowStyle}>
        <span style={eyebrowStyle}>Valentin suggests · {proposal.service}</span>
        {isOpen && (
          <span
            style={{
              ...eyebrowStyle,
              color: isExpired || remaining < URGENT_MS ? colors.error : colors.inkFaint,
            }}
            data-testid="proposal-countdown"
          >
            {isExpired ? 'expired' : `expires in ${formatRemaining(remaining)}`}
          </span>
        )}
      </div>

      <p style={titleStyle}>{proposal.title}</p>
      <p style={summaryStyle}>{proposal.summary}</p>

      {isOpen ? (
        <div style={actionsStyle}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isExpired}
            style={isExpired ? disabledStyle : confirmStyle}
          >
            Confirm
          </button>
          <button type="button" onClick={() => onDismiss(proposal.proposalId)} style={dismissStyle}>
            Not now
          </button>
          {/*
            Present only when the provider owns the last step — an Ontopo
            checkout page, say. It is a link rather than a second confirm
            because leaving the app is a different decision to saying yes.
          */}
          {proposal.url && (
            <a href={proposal.url} target="_blank" rel="noreferrer" style={linkStyle}>
              Open in {proposal.service}
            </a>
          )}
        </div>
      ) : (
        <p style={resolvedStyle} data-testid="proposal-resolved">
          {status === 'confirmed'
            ? 'Confirmed — Valentin is carrying this out.'
            : 'Left for now. Ask again whenever you like.'}
        </p>
      )}

      {isOpen && isExpired && (
        // Said out loud rather than left as a greyed-out button. The offer behind
        // it is genuinely gone — the provider's hold has lapsed — so the useful
        // thing is to tell the user how to get another one.
        <p style={resolvedStyle} role="status">
          This offer has expired, so nothing was booked or sent. Ask Valentin to
          suggest it again.
        </p>
      )}
    </div>
  );
}
