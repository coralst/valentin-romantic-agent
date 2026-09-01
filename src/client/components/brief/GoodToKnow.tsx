import { colors, insets, radii, typography } from '../../design-system/tokens';
import { insetRing, onClaret, RAIL_HAIRLINE } from './rail-tones';

/** One reference fact, shown as `label value` in a pill. */
export interface Chip {
  fieldId: string;
  /** The faint prefix — "Coffee", "Flowers". Kept short enough to stay one line. */
  label: string;
  /** The answer as it fits the pill, or null when the field is still empty. */
  value: string | null;
  /**
   * The answer in full, before it was cut to fit.
   *
   * Separate from `value` because the truncation happens in the data, not in CSS —
   * so building the accessible name from `value` put the ellipsis in it too, and
   * "Food: Northern Italian —…" was all a screen reader could ever say. The full
   * text is what goes in `aria-label` and `title`; the pill still shows the short
   * form. Absent when nothing was cut.
   */
  fullValue?: string | null;
}

interface GoodToKnowProps {
  chips: Chip[];
  /** Focuses the matching field elsewhere. An empty chip is a call to action. */
  onChipClick?: (fieldId: string) => void;
}

const stripStyle: React.CSSProperties = {
  // `flex: none` is the whole point of this module: it is pinned below the
  // scroll region, not inside it. Sizes and the coffee order are reference data
  // you glance at, and they were dying below the fold of a 1384px scroll in an
  // 872px box (option-5d-brief.html:171-173).
  flex: 'none',
  padding: '10px 16px 11px',
  // Side margins rather than padding, so the hairline stops short of the rail's
  // edges and reads as a divider between blocks instead of a full-bleed rule.
  margin: `0 ${insets.tight}px`,
  borderTop: RAIL_HAIRLINE,
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 7,
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

const chipsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
};

const chipBaseStyle: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.3,
  borderRadius: radii.pill,
  padding: '5px 10px',
};

const filledChipStyle: React.CSSProperties = {
  ...chipBaseStyle,
  background: onClaret(0.09),
  color: colors.onClaret,
};

/** An outline, not a fill: an unanswered chip is a hole, and should look like one. */
const emptyChipStyle: React.CSSProperties = {
  ...chipBaseStyle,
  background: 'transparent',
  boxShadow: insetRing(onClaret(0.14)),
  color: onClaret(0.45),
};

const chipLabelStyle: React.CSSProperties = {
  // `text-decoration: none` on an `<s>` in the mockup — the element was chosen
  // for brevity, not for a strikethrough. Rendered as a plain faint prefix.
  textDecoration: 'none',
  color: onClaret(0.5),
};

const chipValueStyle: React.CSSProperties = {
  fontWeight: typography.weights.medium,
};

const emptyAllStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: onClaret(0.45),
};

/**
 * The pinned strip of small reference facts at the foot of the scroll region.
 *
 * Filled chips read `label value`; unfilled ones become `+ label` prompts, so
 * the gaps in the profile are visible without a second "missing fields" module.
 */
export function GoodToKnow({ chips, onChipClick }: GoodToKnowProps) {
  return (
    <div style={stripStyle} data-testid="brief-good-to-know">
      <div style={headStyle}>
        <span style={labelStyle}>Good to know</span>
      </div>
      <div style={chipsStyle}>
        {chips.length === 0 && <span style={emptyAllStyle}>Nothing noted yet.</span>}
        {chips.map((chip) => {
          const isEmpty = chip.value === null;
          // The full answer where one is available, so neither the accessible name
          // nor the tooltip inherits the pill's ellipsis.
          const spoken = chip.fullValue ?? chip.value;
          return (
            <button
              key={chip.fieldId}
              type="button"
              style={isEmpty ? emptyChipStyle : filledChipStyle}
              onClick={() => onChipClick?.(chip.fieldId)}
              data-testid="brief-chip"
              data-empty={isEmpty ? 'true' : 'false'}
              title={isEmpty ? undefined : `${chip.label}: ${spoken}`}
              aria-label={isEmpty ? `Add ${chip.label}` : `${chip.label}: ${spoken}`}
            >
              {isEmpty ? (
                `+ ${chip.label}`
              ) : (
                <>
                  <span style={chipLabelStyle}>{chip.label}</span>{' '}
                  <b style={chipValueStyle}>{chip.value}</b>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
