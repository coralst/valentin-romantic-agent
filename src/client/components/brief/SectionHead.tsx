import { colors, typography } from '../../design-system/tokens';
import { RAIL_HAIRLINE, onClaret } from './rail-tones';

interface SectionHeadProps {
  /** The eyebrow label, e.g. "Next up". Rendered uppercase by CSS, not by copy. */
  label: string;
  /** Optional gold count on the right, e.g. the 2 beside "Keep in mind". */
  count?: number;
  /** Shows the ⚠ glyph before the count — the rail's only warning mark. */
  warn?: boolean;
}

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  // 20px above / 9px below: the label belongs to the block under it, so the gap
  // above is more than twice the gap below (option-5d-brief.html:103).
  margin: '20px 0 9px',
  paddingBottom: 7,
  borderBottom: RAIL_HAIRLINE,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.26em',
  textTransform: 'uppercase',
  color: onClaret(0.55),
};

const countStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.tiny,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.04em',
  color: colors.goldLight,
};

const warnStyle: React.CSSProperties = {
  flex: 'none',
  color: colors.goldLight,
  fontSize: typography.px.label,
  lineHeight: 1,
};

/**
 * The rail's section divider: a wide-tracked uppercase label with a hairline
 * under it, and an optional gold count.
 *
 * Every module in the brief is introduced by one of these, which is how eleven
 * unrelated blocks in a 306px column stay legible as a single list.
 */
export function SectionHead({ label, count, warn }: SectionHeadProps) {
  return (
    <div style={headStyle} data-testid={`brief-section-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span style={labelStyle}>{label}</span>
      {warn && (
        <span style={warnStyle} aria-hidden="true">
          &#9888;
        </span>
      )}
      {/* The number alone announces as "21", which tells a screen-reader user
          nothing. The visible glyph stays bare; the name says what it counts. */}
      {count !== undefined && (
        <span style={countStyle} aria-label={`${count} in ${label}`}>
          {count}
        </span>
      )}
    </div>
  );
}
