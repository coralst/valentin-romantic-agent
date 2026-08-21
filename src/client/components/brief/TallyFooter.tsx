import { colors, insets, radii, typography } from '../../design-system/tokens';
import { onClaret, RAIL_HAIRLINE } from './rail-tones';

interface TallyFooterProps {
  filled: number;
  total: number;
  /** Opens the full-profile surface. Absent until Stage 5 lands it. */
  onOpenFullProfile?: () => void;
}

const footStyle: React.CSSProperties = {
  flex: 'none',
  padding: `12px ${insets.snug}px 15px`,
  borderTop: RAIL_HAIRLINE,
  // A black wash rather than a lighter claret: it seats the footer *into* the
  // rail's gradient, which is already darkest at the bottom.
  background: 'rgba(0, 0, 0, 0.10)',
};

const ticksStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

/**
 * One tick per field, rather than a continuous bar.
 *
 * A bar at 5/18 reads as "28% done", which frames the profile as a chore with a
 * finish line. Discrete ticks read as "five things known" — countable, and
 * every new one is a visible event.
 */
const tickBaseStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: radii.pill,
  background: onClaret(0.18),
};

const tickOnStyle: React.CSSProperties = {
  ...tickBaseStyle,
  background: colors.goldLight,
};

const labelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginTop: 8,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrowWide,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: onClaret(0.5),
};

const linkStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.medium,
  color: colors.goldLight,
  textDecoration: 'none',
};

/**
 * Progress, demoted out of the headline slot and into the footer.
 *
 * This is what replaces `CompletionSummary`: the same two numbers, but read as a
 * quiet tally at the bottom of the rail rather than as the second thing on screen.
 */
export function TallyFooter({ filled, total, onOpenFullProfile }: TallyFooterProps) {
  return (
    <div style={footStyle} data-testid="brief-tally">
      <div
        style={ticksStyle}
        role="progressbar"
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${filled} of ${total} fields known`}
      >
        {Array.from({ length: total }, (_, index) => (
          <i key={index} style={index < filled ? tickOnStyle : tickBaseStyle} />
        ))}
      </div>
      <div style={labelRowStyle}>
        <span style={labelStyle}>
          {filled} of {total} known
        </span>
        {onOpenFullProfile && (
          <button type="button" style={linkStyle} onClick={onOpenFullProfile}>
            Full profile &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
