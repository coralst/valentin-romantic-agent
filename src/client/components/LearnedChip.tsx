import { colors, radii, typography, layout, insets } from '../design-system/tokens';
import { confidenceWord } from '../utils/confidence-wording';

/** One discovery on a card that carries several. */
export interface LearnedChipItem {
  /** The preference id, used to key the row and to address its dismissal. */
  id: string;
  /** The discovery itself, e.g. "Uses she/her". */
  value: string;
  /** Raw 0–1 preference confidence; rendered as a word. */
  confidence: number;
}

interface LearnedChipProps {
  /** The uppercase eyebrow. The mockup says "Noted". */
  label?: string;
  /** The discovery, when the card carries exactly one. Ignored if `items` is given. */
  value?: string;
  /** Raw 0–1 preference confidence for `value`. Ignored if `items` is given. */
  confidence?: number;
  /**
   * Several discoveries to list on one card.
   *
   * One sentence routinely teaches Valentin two unrelated things — "late-night
   * jazz and hiking at sunrise" is a music preference *and* a hobby — and the
   * server is right to emit them as two `preference_update` events, because
   * merging them would corrupt the dossier. Stacking two near-identical NOTED
   * cards under one message is purely a presentation failure, so the card takes
   * the whole group and gives each discovery a row.
   */
  items?: LearnedChipItem[];
  /**
   * Dismisses a discovery — wired to CLEAR_HIGHLIGHT by the caller.
   *
   * Receives the id of the row that was dismissed, so a grouped card can clear
   * one discovery without touching its siblings. Single-discovery callers that
   * already close over their own id can keep ignoring the argument.
   */
  onDismiss: (id: string) => void;
}

/**
 * The inline "✓ NOTED / Uses she/her / certain / ✕" card that lands in the
 * transcript when Valentin learns something (option-5d-brief.html:59-69,260-262).
 *
 * It is deliberately indented to clear the 32px agent avatar, so it reads as a
 * note *about* the exchange above it rather than as another message in it.
 */
const chipStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  // The 44px left margin is the avatar (32) plus the bubble gap (12), so the
  // chip's edge lines up with the agent bubbles rather than the avatars.
  margin: `0 0 20px ${layout.messageAvatarSize + 12}px`,
  maxWidth: '80%',
  backgroundColor: colors.surface,
  borderRadius: radii.chip,
  padding: '11px 15px',
  boxShadow:
    '0 1px 3px rgba(42, 34, 38, 0.06), 0 8px 20px rgba(42, 34, 38, 0.05)',
};

/**
 * The same card once it lists more than one discovery.
 *
 * The tick stops being vertically centred: against a three-row card a centred
 * tick reads as belonging to the middle discovery rather than to the eyebrow it
 * annotates.
 */
const groupedChipStyle: React.CSSProperties = {
  ...chipStyle,
  alignItems: 'flex-start',
};

const tickStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: radii.pill,
  flexShrink: 0,
  backgroundColor: colors.olive,
  color: colors.textOnAccent,
  display: 'grid',
  placeItems: 'center',
  fontSize: typography.px.tiny,
};

const textStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

/**
 * One discovery: the wording, its own confidence pill, its own ✕.
 *
 * Per-row rather than per-card controls because the discoveries are independent
 * profile facts — waving off "hiking at sunrise" must not also wave off the
 * music note that arrived in the same breath.
 */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

/**
 * Every row after the first. The hairline is what stops two stacked discoveries
 * from reading as one wrapped sentence.
 */
const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  marginTop: 7,
  paddingTop: 7,
  borderTop: `1px solid ${colors.borderSubtle}`,
};

const valueStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.bodyLoose,
  color: colors.ink,
  marginTop: 1,
  // Long discoveries wrap rather than shoving the confidence pill off the card.
  overflowWrap: 'break-word',
};

const confidenceStyle: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  fontSize: typography.px.eyebrowWide,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: colors.olive,
  backgroundColor: '#F0F2EA',
  borderRadius: radii.pill,
  padding: '4px 9px',
};

const dismissStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: colors.inkFaint,
  fontSize: typography.px.small,
  flexShrink: 0,
  padding: 0,
  lineHeight: 1,
  // A bare ✕ glyph is a 12px hit target; pad the box out without moving the
  // glyph so it stays comfortably tappable.
  width: insets.roomy,
  height: insets.roomy,
  borderRadius: radii.pill,
  display: 'grid',
  placeItems: 'center',
};

export function LearnedChip({
  label = 'Noted',
  value,
  confidence = 0,
  items,
  onDismiss,
}: LearnedChipProps) {
  /*
   * The two modes collapse into one list before rendering, so there is a single
   * layout to keep faithful to the mockup. A lone discovery has no id of its
   * own here — the caller closes over it — so the value stands in as the key,
   * which is unique within a card by construction.
   */
  const rows: LearnedChipItem[] =
    items ?? (value === undefined ? [] : [{ id: value, value, confidence }]);
  if (rows.length === 0) return null;

  // The card-level attribute keeps naming the first discovery's confidence, so
  // the single-discovery contract other surfaces read is unchanged.
  const cardWord = confidenceWord(rows[0].confidence);

  return (
    <div
      style={rows.length > 1 ? groupedChipStyle : chipStyle}
      data-testid="learned-chip"
      data-confidence={cardWord}
    >
      <div style={tickStyle} aria-hidden="true">
        ✓
      </div>
      <div style={textStyle}>
        <div style={labelStyle}>{label}</div>
        {rows.map((row, index) => {
          const word = confidenceWord(row.confidence);
          return (
            <div
              key={row.id}
              style={index === 0 ? rowStyle : dividedRowStyle}
              data-testid="learned-chip-item"
              data-confidence={word}
            >
              <div style={valueStyle}>{row.value}</div>
              <span style={confidenceStyle}>{word}</span>
              <button
                type="button"
                onClick={() => onDismiss(row.id)}
                style={dismissStyle}
                aria-label={`Dismiss ${row.value}`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
