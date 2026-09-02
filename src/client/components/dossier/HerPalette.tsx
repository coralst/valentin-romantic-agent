import { colors, radii, typography } from '../../design-system/tokens';
import type { PaletteShade } from '../../utils/list-field-parsing';
import { goldWash, GOLD_INK, askPillStyle } from './board-tones';
import { DossierIcon, dossierType } from './dossier-icons';
import { tileHeadStyle, tileStyle, tileTitleStyle } from './tile-tones';

/**
 * The shades she wears, and the one flower rule that outranks them.
 *
 * `favorite_color` answers "what is her colour" and has one value. This answers
 * the question a gift actually asks — what *range* is safe — because a scarf in
 * oat is a good guess and a scarf in the single colour she named as her favourite
 * may be the colour she already owns six of.
 *
 * The first shade leads, at 1.6× the width of the others: she named it first, and
 * four equal swatches say the four are interchangeable.
 *
 * A shade whose name we cannot honestly colour is drawn as a label with no
 * swatch — see `parsePalette`. Inventing a hex for "her mother's blue" would be
 * the board asserting something nobody said.
 */

const swatchRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

function swatchStyle(hex: string | null, isLead: boolean): React.CSSProperties {
  return {
    flex: isLead ? 1.6 : 1,
    height: 46,
    borderRadius: 11,
    minWidth: 0,
    background: hex ?? 'transparent',
    boxShadow: hex
      ? 'inset 0 0 0 1.5px rgba(42, 34, 38, 0.1)'
      : `inset 0 0 0 1.5px ${colors.linenShade}`,
    // A shade with no hex still has to read as a slot rather than as a gap.
    display: 'grid',
    placeItems: 'center',
    fontFamily: typography.bodyFontFamily,
    fontSize: dossierType.small,
    color: colors.inkFaint,
  };
}

/**
 * The names, as one wrapping line rather than one label under each swatch.
 *
 * Column-per-swatch is what the mockup drew and it does not survive the real
 * tile: at four shades in a 176px tile each column gets about 40px, so "Linen"
 * and "Blush" both came out as "Li…" and "Bl…" — and a colour you cannot read the
 * name of is not a colour you can ask a shop for. Wrapping gives every name its
 * full length and keeps the lead first and bold, which is the only ordering the
 * tile is asserting.
 */
const namesRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 8px',
  margin: '8px 0 2px',
};

function nameStyle(isLead: boolean): React.CSSProperties {
  return {
    fontFamily: typography.bodyFontFamily,
    fontSize: dossierType.small,
    lineHeight: 1.35,
    color: isLead ? colors.ink : colors.inkMuted,
    fontWeight: isLead ? typography.weights.semibold : typography.weights.normal,
  };
}

/**
 * The caution, pinned to the foot of the tile.
 *
 * The same `deriveCautions` the brief rail reads, so the two surfaces cannot
 * disagree about what is dangerous. It sits on the palette tile rather than in a
 * card of its own because "flowers yes — never roses" is a colour-and-object
 * instruction, and next to the swatches it is read at the moment it applies.
 */
const cautionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 'auto',
  padding: '9px 12px',
  borderRadius: radii.kv,
  background: '#FFF4E6',
  color: GOLD_INK,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.4,
  boxShadow: `inset 0 0 0 1.5px ${goldWash(0.38)}`,
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.45,
  color: colors.inkMuted,
};

interface HerPaletteProps {
  shades: PaletteShade[];
  /** The first caution, verbatim from `deriveCautions`. */
  caution: string | null;
  /** Fills the composer when there is no palette yet. */
  onAsk: () => void;
}

export function HerPalette({ shades, caution, onAsk }: HerPaletteProps) {
  return (
    <div style={tileStyle} data-testid="dossier-her-palette" data-shades={shades.length}>
      <h4 style={tileHeadStyle}>
        <DossierIcon name="palette" size={16} />
        <span style={tileTitleStyle}>Her palette</span>
      </h4>

      {shades.length === 0 ? (
        <>
          <p style={emptyStyle}>
            I don&rsquo;t know what she wears yet. Two or three shades is enough to
            stop me guessing.
          </p>
          <button
            type="button"
            style={{ ...askPillStyle, alignSelf: 'flex-start', marginTop: 10 }}
            onClick={onAsk}
            aria-label="Ask about the colours she wears"
            data-testid="palette-ask"
          >
            Ask
          </button>
        </>
      ) : (
        <>
          {/* The swatches are the picture; the names below are the content, so the
              colours are hidden from the accessibility tree and the words are not. */}
          <div style={swatchRowStyle} aria-hidden="true">
            {shades.map((shade, index) => (
              <i
                key={shade.name}
                style={swatchStyle(shade.hex, index === 0)}
                data-testid="palette-swatch"
                data-hex={shade.hex ?? undefined}
              >
                {shade.hex ? null : '—'}
              </i>
            ))}
          </div>
          <div style={namesRowStyle}>
            {shades.map((shade, index) => (
              <span key={shade.name} style={nameStyle(index === 0)}>
                {shade.name}
              </span>
            ))}
          </div>
        </>
      )}

      {caution && (
        <div style={cautionStyle} data-testid="palette-caution">
          <span style={{ color: colors.gold, display: 'flex' }} aria-hidden="true">
            <DossierIcon name="caution" size={16} />
          </span>
          {caution}
        </div>
      )}
    </div>
  );
}
