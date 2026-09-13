import { colors, radii, typography } from '../../design-system/tokens';
import { DossierIcon, dossierFonts, dossierType } from './dossier-icons';
import { askPillStyle } from './board-tones';
import { tileHeadStyle, tileStyle, tileTitleStyle } from './tile-tones';
import type { ProfileFieldValue } from '../../hooks/use-profile-store';

/**
 * What fits her: the two measurements a shop asks for first.
 *
 * Two, not the four that are on file. `ring_size` and `shoe_size` are still
 * extracted, still stored, still shown as ordinary rows in "Everything I know" —
 * they are simply not what this tile is for. A tile is a *glance*, and four rows
 * of numbers is a table you have to read.
 *
 * Deliberately read-only. Editing lives in one place — `EverythingIKnow`'s
 * `ProfileField`, which owns the validation, the enum handling and the
 * clear-manual-value path. A second editable surface for the same fields would be
 * a second thing to keep correct for no gain, so an unknown measurement here
 * offers `Ask` and the field list stays where you type one in.
 */

/** The two rows, and how each is labelled. */
const SIZE_ROWS: ReadonlyArray<{
  fieldId: string;
  label: string;
  /** The clause under the label, when the value itself does not carry one. */
  qualifier: string | null;
}> = [
  { fieldId: 'clothing_size', label: 'Trousers', qualifier: 'Sizes up for knits' },
  { fieldId: 'shoulder_width', label: 'Shoulders', qualifier: 'For anything tailored' },
];

const rowsStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  background: colors.sand,
  borderRadius: radii.icon,
  padding: '10px 13px',
  minWidth: 0,
};

const unknownRowStyle: React.CSSProperties = {
  ...rowStyle,
  background: 'transparent',
  boxShadow: `inset 0 0 0 1.5px ${colors.linenShade}`,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkMuted,
};

/** The Hebrew label is the row's own name, so it carries the ink of a value. */
const qualifierStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  color: colors.inkFaint,
};

/**
 * The figure.
 *
 * `whiteSpace: 'nowrap'` is the one rule this tile will not bend: "UK 10" broken
 * across two lines is the single thing a measurement may not do. The qualifier
 * gives way instead — it is under the label, where it has a whole row to wrap in.
 */
const figureStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: dossierFonts.heading,
  fontSize: dossierType.card,
  fontWeight: typography.weights.normal,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  color: colors.ink,
};

/**
 * `'UK 10 — sizes up for knitwear'` → `['UK 10', 'sizes up for knitwear']`.
 *
 * These fields are free text on purpose (see `profile-field-registry.ts`: the
 * honest answer is "a 10 in most things, an 8 in Zara"), so a stored value is
 * often a measurement *plus* a caveat. The leading clause is the figure and the
 * rest becomes the row's qualifier — nothing is dropped, and the part you read
 * across a shop stays on one line.
 *
 * Split on an em-dash, a semicolon, a bracket or a comma, in that order, because
 * those are the four ways people write the caveat.
 */
export function splitSize(value: string): [string, string | null] {
  const match = value.match(/^(.*?)(?:\s*[—–;(]\s*|,\s+)(.+)$/);
  if (!match) return [value, null];
  return [match[1].trim(), match[2].replace(/\)$/, '').trim()];
}

interface HerSizesProps {
  getFieldValue: (fieldId: string) => ProfileFieldValue | null;
  /** Fills the composer with a question about the missing measurement. */
  onAsk: (label: string) => void;
}

export function HerSizes({ getFieldValue, onAsk }: HerSizesProps) {
  const rows = SIZE_ROWS.map((row) => {
    const value = getFieldValue(row.fieldId)?.value ?? null;
    const [figure, caveat] = value ? splitSize(value) : [null, null];
    return { ...row, value, figure, qualifier: caveat ?? row.qualifier };
  });
  const known = rows.filter((row) => row.value !== null).length;

  return (
    <div style={tileStyle} data-testid="dossier-her-sizes" data-known={known}>
      <h4 style={tileHeadStyle}>
        <DossierIcon name="ruler" size={16} />
        <span style={tileTitleStyle}>What fits her</span>
      </h4>

      <div style={rowsStyle}>
        {rows.map((row) => (
          <div
            key={row.fieldId}
            style={row.value ? rowStyle : unknownRowStyle}
            data-testid={`dossier-size-${row.fieldId}`}
            data-known={row.value !== null}
          >
            <span style={labelStyle}>
              {row.label}
              {row.value && row.qualifier && (
                <span style={qualifierStyle}>{row.qualifier}</span>
              )}
            </span>
            {row.figure ? (
              <span style={figureStyle}>{row.figure}</span>
            ) : (
              <button
                type="button"
                style={askPillStyle}
                onClick={() => onAsk(askLabel(row.fieldId, row.label))}
                // Names the row it belongs to. `SIZE_ROWS` renders one of these per
                // unfilled size, and three sibling tiles render one each, so a sparse
                // profile put up to eight buttons all called "Ask" — indistinguishable
                // to a screen reader and unusable by voice.
                aria-label={`Ask about her ${row.label.toLowerCase()}`}
                data-testid={`dossier-size-ask-${row.fieldId}`}
              >
                Ask
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** What Valentin is asked to raise, phrased the way he would say it out loud. */
function askLabel(fieldId: string, label: string): string {
  if (fieldId === 'shoulder_width') return 'shoulder measurement';
  return `${label.toLowerCase()} size`;
}
