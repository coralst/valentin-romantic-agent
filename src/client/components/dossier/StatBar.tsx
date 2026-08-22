import { colors, insets, radii, typography } from '../../design-system/tokens';
import { toneInk, type AccentTone } from './accent-tones';

/**
 * One figure on the command bar: a number, what it counts, and its family.
 *
 * `value` is a string rather than a number because two of the four are formatted
 * — "2,003" and "84%" — and formatting at the call site keeps the bar dumb.
 */
export interface Stat {
  label: string;
  value: string;
  /** Colours the figure. Same families as everywhere else on the board. */
  tone: AccentTone;
  /** The quiet line under the figure, when there is something to qualify. */
  note?: string | null;
}

/**
 * The four figures on the dossier's dark bar.
 *
 * Dark, and above the board rather than inside it, for one reason: on the old
 * header the only number was "5 of 21", a form metric, and it sat in the same
 * porcelain as everything else. The relationship's real headline numbers — how
 * long you have been together, how soon the next occasion is — were nowhere, or
 * buried three cards down. Putting them on a plum ground makes them the first
 * thing read on the page and, because the ground is dark, makes the board below
 * it read as a lighter, secondary layer instead of a competing one.
 */
const barStyle: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: insets.roomy,
  padding: `13px ${insets.roomy}px`,
  background: colors.railGradient,
  color: colors.onClaret,
  minWidth: 0,
};

const mobileBarStyle: React.CSSProperties = {
  ...barStyle,
  flexWrap: 'wrap',
  gap: 12,
  padding: `12px ${insets.tight}px`,
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: insets.roomy,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  minWidth: 0,
  flexWrap: 'wrap',
};

const valueStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingXl,
  fontWeight: typography.weights.normal,
  lineHeight: 1.05,
  letterSpacing: '-0.01em',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  // Not `inkFaint`: this sits on plum, where the light ink ramp inverts.
  color: 'rgba(251, 239, 241, 0.6)',
};

const noteStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 3,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: 'rgba(251, 239, 241, 0.72)',
};

/**
 * The figure's own dot, in its family's ink.
 *
 * The families are chosen for legibility on the *light* board, so at 22px on
 * plum some of them (the gold, the olive) lose contrast as type. The number
 * stays near-white and the family is carried by a dot beside the label instead,
 * which keeps the colour coding without making one of the four figures harder to
 * read than the others.
 */
const dotStyle = (tone: AccentTone): React.CSSProperties => ({
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: radii.pill,
  marginRight: 6,
  background: toneInk(tone),
  verticalAlign: 'middle',
});

interface StatBarProps {
  stats: Stat[];
  isMobile?: boolean;
  /** Rendered at the end of the bar — the dossier's primary action. */
  children?: React.ReactNode;
}

export function StatBar({ stats, isMobile = false, children }: StatBarProps) {
  return (
    <div style={isMobile ? mobileBarStyle : barStyle} data-testid="dossier-stat-bar">
      <ul style={listStyle}>
        {stats.map((stat) => (
          <li key={stat.label} data-testid="dossier-stat">
            <b style={valueStyle}>{stat.value}</b>
            <span style={labelStyle}>
              <i style={dotStyle(stat.tone)} aria-hidden="true" />
              {stat.label}
            </span>
            {stat.note && <span style={noteStyle}>{stat.note}</span>}
          </li>
        ))}
      </ul>
      {children && <div style={{ marginLeft: 'auto', flex: 'none' }}>{children}</div>}
    </div>
  );
}
