import { colors, radii, typography } from '../../design-system/tokens';
import type { FieldGap } from '../../utils/field-payoff';
import {
  askPillStyle,
  cardCountStyle,
  cardEmptyStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  CARD_HAIRLINE,
} from './board-tones';

interface WorthAskingNextProps {
  /** Already ranked by `field-payoff.ts`; this component does not reorder. */
  gaps: FieldGap[];
  onAsk?: (gap: FieldGap) => void;
}

/**
 * How many gaps the board lists.
 *
 * More than the rail's three, because the board has the room — but not all
 * every field, or the ranking stops meaning anything and the card becomes the field
 * ladder that "Everything I know" already is, one card down.
 */
const VISIBLE_GAPS = 4;

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '10px 0',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: CARD_HAIRLINE,
};

/**
 * The rank medallion.
 *
 * The number is the point of this card: the queue is ordered by what each answer
 * unlocks (`field-payoff.ts`), not by how many fields are empty in a section, so
 * the ranking has to be visible or the card reads as an arbitrary list.
 */
const rankStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: radii.pill,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  background: colors.claret,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.medium,
  lineHeight: 1,
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
  color: colors.ink,
};

const reasonStyle: React.CSSProperties = {
  margin: '1px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  lineHeight: 1.4,
  color: colors.inkMuted,
};

/**
 * The discovery queue, ranked by payoff rather than by count.
 *
 * Each row carries its own reason, so the card never just says "empty field" —
 * it says what the answer would buy you.
 */
export function WorthAskingNext({ gaps, onAsk }: WorthAskingNextProps) {
  const visible = gaps.slice(0, VISIBLE_GAPS);

  return (
    <section style={cardStyle} data-testid="dossier-worth-asking">
      <div style={cardHeadStyle}>
        <h2 style={cardTitleStyle}>Worth asking next</h2>
        {gaps.length > 0 && (
          <span style={cardCountStyle}>{gaps.length} unknown</span>
        )}
      </div>

      {visible.length === 0 ? (
        <p style={cardEmptyStyle} data-testid="dossier-worth-asking-empty">
          Nothing left on my list — you have told me everything her profile
          asks for.
        </p>
      ) : (
        visible.map((gap, index) => (
          <div
            key={gap.fieldId}
            style={index === 0 ? rowStyle : dividedRowStyle}
            data-testid="dossier-gap"
            data-field-id={gap.fieldId}
          >
            <div style={rankStyle} aria-hidden="true">
              {index + 1}
            </div>
            <div style={bodyStyle}>
              <b style={labelStyle}>{gap.label}</b>
              <p style={reasonStyle}>{gap.reason}</p>
            </div>
            <button
              type="button"
              style={askPillStyle}
              onClick={() => onAsk?.(gap)}
              aria-label={`Ask about her ${gap.label.toLowerCase()}`}
            >
              Ask
            </button>
          </div>
        ))
      )}
    </section>
  );
}
