import { useEffect, useState } from 'react';

import { colors, layout, radii, typography, animation } from '../design-system/tokens';
import { prefersReducedMotion } from '../utils/motion-preference';

/**
 * One batch of discoveries, announced together.
 *
 * The id is what makes the line ephemeral-but-restartable: it changes whenever a
 * fresh batch arrives, which is the only signal the line needs to light up again
 * after it has faded. Carrying the values alone would leave two identical
 * announcements indistinguishable, so a repeated correction would never re-show.
 */
export interface LearnedAnnouncement {
  id: string;
  values: readonly string[];
}

interface LearnedStatusProps {
  /** The latest batch, or null when nothing has been learned yet. */
  announcement: LearnedAnnouncement | null;
}

/**
 * How long the line stays legible before it is gone, in ms.
 *
 * Long enough to read two or three short discoveries, short enough that it has
 * cleared before the user finishes reading Valentin's reply. Deliberately not in
 * `animation.durations`, which is contractually 200–400ms: this is a dwell time,
 * not a transition.
 */
export const LEARNED_STATUS_DWELL_MS = 4000;

/**
 * The transient "Valentin wrote that down" line — the register of an LLM's
 * "Thinking…", not of a message.
 *
 * It replaces the old inline NOTED card, which was sized and shadowed like a
 * chat bubble and stayed forever, permanently interrupting the transcript's
 * rhythm. The fact itself still lands in the profile panel; only the transcript's
 * announcement of it is ephemeral.
 *
 * The wrapper is always mounted, even with nothing to say. Two reasons, both
 * load-bearing:
 *  - it reserves the line's height, so appearing and vanishing move no message
 *    on screen — a transcript that jumped every four seconds while the user read
 *    would be worse than the card ever was;
 *  - an `aria-live` region has to exist *before* its content changes to be
 *    announced, so mounting it with the discovery would silence it.
 */
const slotStyle: React.CSSProperties = {
  // The 44px indent is the avatar (32) plus the bubble gap (12), so the line
  // starts where the agent's bubbles start rather than under their crests.
  marginLeft: layout.messageAvatarSize + 12,
  height: 20,
  marginTop: 2,
  display: 'flex',
  alignItems: 'center',
  // The height above is fixed, so a long discovery must never wrap into it.
  overflow: 'hidden',
};

/** The line itself; the fade is applied here so the whole row fades as one. */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  minWidth: 0,
  flex: 1,
};

/**
 * A bare olive tick, not the filled 22px disc the card wore.
 *
 * A disc has the visual weight of a status icon on a card; the whole point here
 * is to sit *below* the messages in the hierarchy, so the glyph carries no
 * background of its own.
 */
const tickStyle: React.CSSProperties = {
  color: colors.olive,
  fontSize: typography.px.caption,
  lineHeight: 1,
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
  flexShrink: 0,
};

/** The hairline between the eyebrow and the discoveries themselves. */
const separatorStyle: React.CSSProperties = {
  width: 12,
  height: 1,
  borderRadius: radii.pill,
  backgroundColor: colors.linenShade,
  flexShrink: 0,
};

const valuesStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.normal,
  fontSize: typography.px.labelLoose,
  color: colors.inkMuted,
  // One line, truncated: the reserved height cannot absorb a second one.
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

const animationName = 'learned-status-life';
const styleId = 'learned-status-keyframes';

/**
 * The whole life of the line in one keyframe set, rather than an entry
 * transition plus an exit transition.
 *
 * The element is unmounted at the end of the dwell, and a React unmount cannot
 * be animated without keeping a second "leaving" state around. Fading to zero
 * *inside* the same animation means the unmount happens on an already-invisible
 * element, so one timer buys both fades.
 */
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes ${animationName} {
      0% { opacity: 0; }
      10% { opacity: 1; }
      88% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

export function LearnedStatus({ announcement }: LearnedStatusProps) {
  /**
   * The batch currently on screen. It lags `announcement`, which keeps naming
   * the last thing learned long after the line has faded — the parent has no
   * reason to forget it, and asking it to would push this component's timing
   * concern up into the transcript.
   */
  const [showingId, setShowingId] = useState<string | null>(null);

  const id = announcement?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    setShowingId(id);
    const timer = setTimeout(() => setShowingId(null), LEARNED_STATUS_DWELL_MS);
    return () => clearTimeout(timer);
  }, [id]);

  const visible = announcement !== null && showingId === id;
  const reduced = prefersReducedMotion();

  if (visible && !reduced) ensureKeyframes();

  return (
    <div style={slotStyle} role="status" aria-live="polite" data-testid="learned-status-slot">
      {visible && (
        <div
          style={{
            ...rowStyle,
            // Users who asked for less motion get a plain appearance and a plain
            // disappearance; the dwell is unchanged, only the fade goes.
            ...(reduced
              ? {}
              : {
                  animation: `${animationName} ${LEARNED_STATUS_DWELL_MS}ms ${animation.easing.easeOut} both`,
                }),
          }}
          data-testid="learned-status"
          data-animated={reduced ? 'false' : 'true'}
        >
          <span style={tickStyle} aria-hidden="true">
            ✓
          </span>
          <span style={labelStyle}>Noted</span>
          <span style={separatorStyle} aria-hidden="true" />
          <span style={valuesStyle} data-testid="learned-status-values">
            {announcement.values.join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
