import { colors, radii, typography } from '../../design-system/tokens';
import { insetRing, onClaret } from './rail-tones';
import { SectionHead } from './SectionHead';
import type { FieldGap } from '../../utils/field-payoff';

interface WorthAskingProps {
  /** Already ranked by `field-payoff.ts`; this component does not reorder. */
  gaps: FieldGap[];
  /** Puts the question in the composer. */
  onAsk?: (gap: FieldGap) => void;
}

/**
 * How many gaps to list.
 *
 * The pinned nudge takes the top one, so this shows the next three. Listing all
 * eighteen would turn the module into the field list this rail exists to replace.
 */
const VISIBLE_GAPS = 3;

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  border: 'none',
  cursor: 'pointer',
  padding: '10px 12px',
  borderRadius: radii.kv,
  background: onClaret(0.06),
  boxShadow: insetRing(onClaret(0.07)),
};

const markStyle: React.CSSProperties = {
  flex: 'none',
  marginTop: 1,
  fontSize: typography.px.label,
  lineHeight: 1.4,
  color: onClaret(0.4),
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  fontWeight: typography.weights.medium,
  color: colors.onClaret,
};

const reasonStyle: React.CSSProperties = {
  // `block`, not the default inline: these are `<span>`s (a `<p>` is invalid
  // inside the `<button>` this row is), so the line break has to come from here.
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  lineHeight: 1.4,
  color: onClaret(0.5),
  marginTop: 2,
};

/**
 * The next few things worth learning, ranked by what each one unlocks rather
 * than by the order the registry happens to declare them in.
 *
 * Each row carries its own reason, so the rail never just says "empty field" —
 * it says what the answer would buy you.
 */
export function WorthAsking({ gaps, onAsk }: WorthAskingProps) {
  const visible = gaps.slice(0, VISIBLE_GAPS);
  if (visible.length === 0) return null;

  return (
    <section data-testid="brief-worth-asking">
      <SectionHead label="Worth asking next" count={gaps.length} />
      <div style={listStyle}>
        {visible.map((gap) => (
          <button
            key={gap.fieldId}
            type="button"
            style={rowStyle}
            onClick={() => onAsk?.(gap)}
            data-testid="brief-gap"
            data-field-id={gap.fieldId}
          >
            <span style={markStyle} aria-hidden="true">
              &#43;
            </span>
            <span style={bodyStyle}>
              <b style={labelStyle}>{gap.label}</b>
              <span style={reasonStyle}>{gap.reason}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
