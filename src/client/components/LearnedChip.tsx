import { colors, radii, typography, layout, insets } from '../design-system/tokens';
import { confidenceWord } from '../utils/confidence-wording';

interface LearnedChipProps {
  /** The uppercase eyebrow. The mockup says "Noted". */
  label?: string;
  /** The discovery itself, e.g. "Uses she/her". */
  value: string;
  /** Raw 0–1 preference confidence; rendered as a word. */
  confidence: number;
  /** Dismisses the chip — wired to CLEAR_HIGHLIGHT by the caller. */
  onDismiss: () => void;
}

/**
 * The inline "✓ NOTED / Uses she/her / certain / ✕" card that lands in the
 * transcript when Valentin learns something (option-5d-brief.html:59-69,260-262).
 *
 * It is deliberately indented to clear the 32px agent avatar, so it reads as a
 * note *about* the exchange above it rather than as another message in it.
 */
const chipStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  // The 44px left margin is the avatar (32) plus the bubble gap (12), so the
  // chip's edge lines up with the agent bubbles rather than the avatars.
  margin: `0 0 20px ${layout.messageAvatarSize + 12}px`,
  maxWidth: '80%',
  backgroundColor: colors.surface,
  borderRadius: radii.chip,
  padding: '11px 15px',
  boxShadow:
    '0 1px 3px rgba(42, 34, 38, 0.06), 0 8px 20px rgba(42, 34, 38, 0.05)',
};

const tickStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: radii.pill,
  flexShrink: 0,
  backgroundColor: colors.olive,
  color: colors.textOnAccent,
  display: 'grid',
  placeItems: 'center',
  fontSize: typography.px.tiny,
};

const textStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const valueStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.bodyLoose,
  color: colors.ink,
  marginTop: 1,
  // Long discoveries wrap rather than shoving the confidence pill off the card.
  overflowWrap: 'break-word',
};

const confidenceStyle: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrowWide,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: colors.olive,
  backgroundColor: '#F0F2EA',
  borderRadius: radii.pill,
  padding: '4px 9px',
};

const dismissStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: colors.inkFaint,
  fontSize: typography.px.small,
  flexShrink: 0,
  padding: 0,
  lineHeight: 1,
  // A bare ✕ glyph is a 12px hit target; pad the box out without moving the
  // glyph so it stays comfortably tappable.
  width: insets.roomy,
  height: insets.roomy,
  borderRadius: radii.pill,
  display: 'grid',
  placeItems: 'center',
};

export function LearnedChip({
  label = 'Noted',
  value,
  confidence,
  onDismiss,
}: LearnedChipProps) {
  const word = confidenceWord(confidence);

  return (
    <div style={chipStyle} data-testid="learned-chip" data-confidence={word}>
      <div style={tickStyle} aria-hidden="true">
        ✓
      </div>
      <div style={textStyle}>
        <div style={labelStyle}>{label}</div>
        <div style={valueStyle}>{value}</div>
      </div>
      <span style={confidenceStyle}>{word}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={dismissStyle}
        aria-label={`Dismiss ${value}`}
      >
        ✕
      </button>
    </div>
  );
}
