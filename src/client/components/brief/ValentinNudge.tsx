import { colors, insets, radii, typography } from '../../design-system/tokens';
import { goldTint } from './rail-tones';

interface ValentinNudgeProps {
  /** The line Valentin says. Comes from `field-payoff.ts`, already in his voice. */
  reason: string;
  /** Puts the ask in the composer. */
  onAsk?: () => void;
  /** Dismisses this nudge so the next-ranked gap takes the slot. */
  onLater?: () => void;
}

const nudgeStyle: React.CSSProperties = {
  // Pinned, like the chip strip: this is the one prompt that should never be
  // scrolled past (option-5d-brief.html:200-202).
  flex: 'none',
  margin: `0 ${insets.tight}px 10px`,
  borderRadius: radii.panel,
  padding: '13px 14px 14px',
  background: colors.nudgeGradient,
  color: colors.onGold,
  boxShadow: '0 10px 26px rgba(0, 0, 0, 0.30), inset 0 0 0 1px rgba(255, 246, 230, 0.35)',
  position: 'relative',
};

/**
 * A 1px ring floating 4px outside the card.
 *
 * A pseudo-element in the mockup; here it is a real absolutely-positioned box
 * because there is no cascade to hang an `::after` on. It is what makes the eye
 * land here first, without any animation.
 */
const ringStyle: React.CSSProperties = {
  position: 'absolute',
  inset: -4,
  // 4px further out than the card's 18px, so the ring stays concentric with it.
  borderRadius: radii.panel + 4,
  pointerEvents: 'none',
  boxShadow: `0 0 0 1px ${goldTint(0.28)}`,
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const crestStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: radii.pill,
  overflow: 'hidden',
  flex: 'none',
  background: colors.porcelain,
  boxShadow: '0 1px 4px rgba(74, 24, 38, 0.28)',
};

const crestImageStyle: React.CSSProperties = {
  width: '122%',
  height: '122%',
  objectFit: 'cover',
};

const eyebrowStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(74, 24, 38, 0.72)',
};

const reasonStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  lineHeight: 1.45,
  marginTop: 8,
  fontWeight: typography.weights.medium,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 11,
};

const askButtonStyle: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  // A dark claret button on gold, rather than gold on claret: it is the only
  // filled control in the rail and has to out-contrast the card it sits on.
  background: '#6E2334',
  color: '#FFF3DC',
  borderRadius: radii.pill,
  padding: '8px 15px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontWeight: typography.weights.medium,
  boxShadow: '0 4px 12px rgba(74, 24, 38, 0.32)',
};

const laterButtonStyle: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  background: 'transparent',
  color: 'rgba(74, 24, 38, 0.62)',
  boxShadow: 'none',
  borderRadius: radii.pill,
  padding: '8px 4px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  fontWeight: typography.weights.medium,
};

/**
 * Valentin's pinned prompt: the single highest-payoff thing he does not yet know.
 *
 * Solid gold on the claret ground, so it is the loudest thing in the rail, and
 * his crest speaks the line so it reads as Valentin talking rather than as a
 * system banner.
 */
export function ValentinNudge({ reason, onAsk, onLater }: ValentinNudgeProps) {
  return (
    <div style={nudgeStyle} data-testid="brief-nudge">
      <div style={ringStyle} aria-hidden="true" />
      <div style={headStyle}>
        <div style={crestStyle}>
          <img src="/logo.png" alt="" style={crestImageStyle} />
        </div>
        <div style={eyebrowStyle}>Valentin suggests</div>
      </div>
      <p style={reasonStyle}>{reason}</p>
      <div style={actionsStyle}>
        <button type="button" style={askButtonStyle} onClick={onAsk} data-testid="brief-nudge-ask">
          Ask me about it
        </button>
        <button
          type="button"
          style={laterButtonStyle}
          onClick={onLater}
          data-testid="brief-nudge-later"
        >
          Later
        </button>
      </div>
    </div>
  );
}
