import { colors, typography } from '../../design-system/tokens';
import type { ShortlistItem } from '../../utils/list-field-parsing';
import { parsePrice } from '../../utils/list-field-parsing';
import { askPillStyle, linenWash } from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';
import { tileHeadStyle, tileStyle, tileTitleStyle } from './tile-tones';

/**
 * What he is weighing up, priced against what he usually spends.
 *
 * Deliberately not her wish list. `wish_list` is what *she* has said she wants;
 * this is what *he* is considering, with numbers on it. Folding the two together
 * would put a price on her own words and lose the only thing this tile does, which
 * is answer "can I afford the one I want to buy".
 *
 * The bar compares the *cheapest* shortlisted item against the budget rather than
 * the total: he is buying one of these, not all four, and a bar showing £209 of an
 * £80 budget would be a number nobody is deciding anything with.
 */

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: `1.5px solid ${linenWash(0.55)}`,
};

const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.35,
};

const priceStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  fontVariantNumeric: 'tabular-nums',
};

/** Over budget: greyed rather than hidden, because he may still choose it. */
const overStyle: React.CSSProperties = { color: colors.inkFaint };

const budgetStyle: React.CSSProperties = { marginTop: 'auto', paddingTop: 12 };

const budgetLabelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 10,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

const budgetFigureStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  color: colors.ink,
  whiteSpace: 'nowrap',
};

const barStyle: React.CSSProperties = {
  height: 10,
  borderRadius: 99,
  background: colors.sand,
  marginTop: 7,
  overflow: 'hidden',
  boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
};

function fillStyle(fraction: number): React.CSSProperties {
  return {
    display: 'block',
    height: '100%',
    // Clamped at 100 so an over-budget pick fills the bar rather than overflowing
    // its own rounded corner, which reads as a bug and not as "too expensive".
    width: `${Math.min(100, Math.max(0, fraction * 100))}%`,
    borderRadius: 99,
    background: `linear-gradient(90deg, #C4566E, ${colors.claret})`,
  };
}

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.inkMuted,
};

/** The currency he wrote, kept — "£62" and "$62" are different sentences. */
function currencyOf(budget: string | null): string {
  const match = budget?.match(/[£$€₪]/);
  return match ? match[0] : '£';
}

interface GiftShortlistProps {
  items: ShortlistItem[];
  /** The `gift_budget` value, verbatim: "Around $80 for everyday gestures". */
  budget: string | null;
  onAsk: () => void;
}

export function GiftShortlist({ items, budget, onAsk }: GiftShortlistProps) {
  const symbol = currencyOf(budget);
  const budgetAmount = budget ? parsePrice(budget) : null;
  const priced = items.filter((item) => item.price !== null);
  const cheapest = priced.length > 0
    ? priced.reduce((low, item) => ((item.price ?? 0) < (low.price ?? 0) ? item : low))
    : null;

  return (
    <div style={tileStyle} data-testid="dossier-gift-shortlist" data-items={items.length}>
      <h4 style={tileHeadStyle}>
        <DossierIcon name="gift" size={16} />
        <span style={tileTitleStyle}>Gift shortlist</span>
      </h4>

      {items.length === 0 ? (
        <>
          <p style={emptyStyle}>
            Nothing shortlisted. Tell me what you are considering and what it costs,
            and I&rsquo;ll hold it against your usual.
          </p>
          <button
            type="button"
            style={{ ...askPillStyle, alignSelf: 'flex-start', marginTop: 10 }}
            onClick={onAsk}
            data-testid="shortlist-ask"
          >
            Ask
          </button>
        </>
      ) : (
        items.map((item, index) => {
          const over =
            budgetAmount !== null && item.price !== null && item.price > budgetAmount;
          return (
            <div
              key={item.name}
              style={index === 0 ? rowStyle : dividedRowStyle}
              data-testid="shortlist-row"
              data-over={over ? 'true' : undefined}
            >
              <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
                <DossierIcon name="gift" size={16} />
              </span>
              <span style={over ? { ...nameStyle, ...overStyle } : nameStyle}>
                {item.name}
              </span>
              {item.price !== null && (
                <span style={over ? { ...priceStyle, ...overStyle } : priceStyle}>
                  {symbol}
                  {item.price}
                </span>
              )}
            </div>
          );
        })
      )}

      {cheapest && budgetAmount !== null && cheapest.price !== null && (
        <div style={budgetStyle} data-testid="shortlist-budget">
          <div style={budgetLabelStyle}>
            <span>{cheapest.name} against her usual</span>
            <b style={budgetFigureStyle}>
              {symbol}
              {cheapest.price} / {symbol}
              {budgetAmount}
            </b>
          </div>
          <div
            style={barStyle}
            role="img"
            aria-label={`${symbol}${cheapest.price} of a ${symbol}${budgetAmount} budget`}
          >
            <i style={fillStyle(cheapest.price / budgetAmount)} />
          </div>
        </div>
      )}
    </div>
  );
}
