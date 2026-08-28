import { colors, radii, typography } from '../../design-system/tokens';
import { DossierIcon, dossierType, dossierFonts } from './dossier-icons';
import { askPillStyle, cardStyle, cardTitleStyle } from './board-tones';
import type { ProfileFieldValue } from '../../hooks/use-profile-store';

/**
 * Her clothing, shoe and ring size — the three facts you look up standing in a
 * shop with your phone out.
 *
 * They already exist as three ordinary rows of the `sizes` section inside
 * `EverythingIKnow`, and they still do; nothing is duplicated as *data*. What this
 * card adds is reachability. In the field list they are three 13px key/value rows
 * two thirds of the way down a 21-row table, indistinguishable from "Favourite
 * Colour" — so the one moment they matter, the moment you are holding a jumper and
 * have thirty seconds, is the moment they are hardest to find.
 *
 * So they get a card at the top of the board with the value set at 34px. Read at
 * arm's length, in a shop, in bad light. That is the whole design brief.
 *
 * Deliberately read-only. Editing lives in one place — `EverythingIKnow`'s
 * `ProfileField`, which owns the validation, the enum handling and the
 * clear-manual-value path. A second editable surface for the same three fields
 * would be a second thing to keep correct for no gain, so an unknown size here
 * offers `Ask` (which fills the composer) and the field list stays the place you
 * type one in.
 */

/** The three fields, in the order you would be asked for them in a shop. */
const SIZE_FIELDS: ReadonlyArray<{ fieldId: string; label: string }> = [
  { fieldId: 'clothing_size', label: 'Clothes' },
  { fieldId: 'shoe_size', label: 'Shoes' },
  { fieldId: 'ring_size', label: 'Ring' },
];

interface HerSizesProps {
  getFieldValue: (fieldId: string) => ProfileFieldValue | null;
  /** Fills the composer with a question about the missing size. */
  onAsk: (label: string) => void;
  isMobile?: boolean;
}

/** The board's own card, spread rather than reinvented. */
const wrapperStyle: React.CSSProperties = {
  ...cardStyle,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  marginBottom: -2,
  color: colors.claret,
};

/** The shared eyebrow, tinted claret so the icon and the word carry one colour. */
const headTextStyle: React.CSSProperties = {
  ...cardTitleStyle,
  flex: 'none',
  color: colors.claret,
};

/**
 * Three across on desktop, three across on mobile too.
 *
 * The values are short — "UK 10", "39", "M" — so even at 320px three columns give
 * each about 90px, which fits. Stacking them would push the ring size below the
 * fold of the card for no benefit.
 */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
};

const cellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '11px 12px',
  borderRadius: radii.kv,
  background: colors.sand,
  minWidth: 0,
};

const unknownCellStyle: React.CSSProperties = {
  ...cellStyle,
  background: 'transparent',
  boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  color: colors.inkMuted,
};

/**
 * The value, at 34px.
 *
 * `overflowWrap: 'break-word'` rather than truncation: a real answer is sometimes
 * "UK 10 / EU 38", and half of that is worse than two lines of all of it.
 */
const valueStyle: React.CSSProperties = {
  fontFamily: dossierFonts.heading,
  fontSize: dossierType.figure,
  fontWeight: typography.weights.normal,
  lineHeight: 1.05,
  letterSpacing: '-0.01em',
  color: colors.ink,
  overflowWrap: 'break-word',
  minWidth: 0,
};

const askButtonStyle: React.CSSProperties = {
  ...askPillStyle,
  alignSelf: 'flex-start',
  marginTop: 2,
};

/** The qualifier under a size, when the stored answer carries one. */
const qualifierStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.35,
  color: colors.inkMuted,
};

/**
 * "UK 10 / EU 38 — sizes up for knitwear" → `['UK 10 / EU 38', 'sizes up for knitwear']`.
 *
 * These fields are free text on purpose (see `profile-field-registry.ts`: the
 * honest answer is "a 10 in most things, an 8 in Zara"), which means the stored
 * value is often a measurement *plus* a caveat. Setting the whole sentence at 34px
 * made the card three lines tall and buried the number it exists to show; setting
 * the whole sentence at 15px threw away the reason for the card. So the leading
 * clause is the figure and the rest is a note under it — nothing is dropped, and
 * the part you read across a shop is the part that is large.
 *
 * Split on an em-dash, a semicolon, a bracket or a comma, in that order, because
 * those are the four ways people actually write the caveat. No match means the
 * whole value is the figure.
 */
function splitSize(value: string): [string, string | null] {
  const match = value.match(/^(.*?)(?:\s*[—–;(]\s*|,\s+)(.+)$/);
  if (!match) return [value, null];
  return [match[1].trim(), match[2].replace(/\)$/, '').trim()];
}

const footStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.5,
  color: colors.inkFaint,
};

export function HerSizes({ getFieldValue, onAsk, isMobile = false }: HerSizesProps) {
  const entries = SIZE_FIELDS.map((field) => {
    const value = getFieldValue(field.fieldId)?.value ?? null;
    const [figure, qualifier] = value ? splitSize(value) : [null, null];
    return { ...field, value, figure, qualifier };
  });
  const known = entries.filter((entry) => entry.value !== null).length;

  return (
    <section style={wrapperStyle} data-testid="dossier-her-sizes" data-known={known}>
      <div style={headStyle}>
        <DossierIcon name="ruler" size={20} />
        <span style={headTextStyle}>Her sizes</span>
      </div>

      <div style={gridStyle}>
        {entries.map((entry) => (
          <div
            key={entry.fieldId}
            style={entry.value ? cellStyle : unknownCellStyle}
            data-testid={`dossier-size-${entry.fieldId}`}
            data-known={entry.value !== null}
          >
            <span style={labelStyle}>{entry.label}</span>
            {entry.figure ? (
              <>
                <span
                  style={{
                    ...valueStyle,
                    // A long figure at 34px would wrap to three lines in a 90px
                    // cell, so it steps down rather than pushing the card taller
                    // than the two beside it.
                    fontSize: entry.figure.length > 8 ? dossierType.card : valueStyle.fontSize,
                  }}
                >
                  {entry.figure}
                </span>
                {entry.qualifier && <span style={qualifierStyle}>{entry.qualifier}</span>}
              </>
            ) : (
              <button
                type="button"
                style={askButtonStyle}
                onClick={() => onAsk(entry.label === 'Ring' ? 'ring size' : `${entry.label.toLowerCase()} size`)}
                data-testid={`dossier-size-ask-${entry.fieldId}`}
              >
                Ask
              </button>
            )}
          </div>
        ))}
      </div>

      {!isMobile && (
        <p style={footStyle}>
          {known === SIZE_FIELDS.length
            ? 'All three on file. Edit them in Everything I know, below.'
            : 'The three you want in a shop. Ask, and I’ll file the answer here.'}
        </p>
      )}
    </section>
  );
}
