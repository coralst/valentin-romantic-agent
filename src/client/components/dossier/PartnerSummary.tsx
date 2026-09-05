import { colors, radii, typography } from '../../design-system/tokens';
import type { PartnerSummary as Summary, SummaryTag } from '../../utils/partner-summary';
import {
  askPillStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldWash,
  GOLD_INK,
  insetRing,
} from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';

/**
 * Her in a paragraph, with her constraints and tastes as chips beneath it.
 *
 * First card on the board because it is the only one that answers "who is she"
 * in one reading. Everything below it is a drill-down: the timeline is when, the
 * registry is every field, the tree is her people.
 *
 * THE PARAGRAPH IS CODE-COMPOSED — see `utils/partner-summary.ts`. Nothing here
 * is model-authored, so nothing here can be a confident sentence about a fact she
 * never gave. If it reads a little plainly, that is the trade being made.
 */

const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
};

/**
 * The portrait paragraph, set larger than body copy.
 *
 * It is the one block on the board meant to be *read* rather than scanned, and
 * at `dossierType.body` it looked like another card's supporting text.
 */
const paragraphStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.card,
  lineHeight: 1.55,
  color: colors.ink,
};

const emptyStyle: React.CSSProperties = {
  ...paragraphStyle,
  color: colors.inkMuted,
};

const tagRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 7,
  marginTop: 14,
};

const tasteTagStyle: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: radii.pill,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  color: colors.inkMuted,
  background: colors.porcelain,
  boxShadow: insetRing(colors.linenShade),
  whiteSpace: 'nowrap',
};

/**
 * A constraint wears the board's warning tone, not the neutral one.
 *
 * "No shellfish" and "loves jazz" are different kinds of fact: one narrows the
 * plan and the other decorates it. Drawn identically, the allergy gets skimmed —
 * which is the failure mode worth spending a colour on.
 */
const constraintTagStyle: React.CSSProperties = {
  ...tasteTagStyle,
  background: '#FBF3E8',
  color: GOLD_INK,
  fontWeight: typography.weights.semibold,
  boxShadow: insetRing(goldWash(0.45)),
  /*
   * Constraints wrap; tastes do not.
   *
   * A constraint is never shortened — see `truncate` in `partner-summary.ts` —
   * because eliding "…allergic to shellfi…" loses the only word that matters. So
   * it needs somewhere to go when it is long, and two lines in a chip is a
   * cheaper price than an unreadable rule.
   */
  whiteSpace: 'normal',
};

interface PartnerSummaryProps {
  summary: Summary;
  /** Her name, for the empty state's invitation. Null before it is known. */
  name: string | null;
  /** Drops a question into the composer — the board's one way of asking. */
  onAsk: () => void;
}

function Tag({ tag }: { tag: SummaryTag }) {
  return (
    <span
      style={tag.tone === 'constraint' ? constraintTagStyle : tasteTagStyle}
      data-testid={`summary-tag-${tag.id}`}
      data-tone={tag.tone}
    >
      {tag.label}
    </span>
  );
}

export function PartnerSummary({ summary, name, onAsk }: PartnerSummaryProps) {
  const { sentences, tags } = summary;
  const her = name ?? 'her';

  return (
    <section style={wrapperStyle} data-testid="dossier-partner-summary">
      <div style={cardHeadStyle}>
        <span style={{ color: colors.claret, display: 'flex' }} aria-hidden="true">
          <DossierIcon name="quote" size={18} />
        </span>
        <h2 style={cardTitleStyle}>In a nutshell</h2>
        <button
          type="button"
          style={askPillStyle}
          onClick={onAsk}
          data-testid="summary-ask"
        >
          Tell me more
        </button>
      </div>

      {sentences.length === 0 ? (
        <p style={emptyStyle} data-testid="summary-empty">
          I don&rsquo;t know enough about {her} yet to write this. Tell me where you
          both live, what she likes to eat, and what she listens to — it fills in as
          you talk.
        </p>
      ) : (
        <p style={paragraphStyle} data-testid="summary-paragraph">
          {sentences.join(' ')}
        </p>
      )}

      {tags.length > 0 && (
        <div style={tagRowStyle} data-testid="summary-tags">
          {tags.map((tag) => (
            <Tag key={tag.id} tag={tag} />
          ))}
        </div>
      )}
    </section>
  );
}
