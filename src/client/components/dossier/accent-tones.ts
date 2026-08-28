import { colors, radii, typography } from '../../design-system/tokens';
import { cardStyle } from './board-tones';

/**
 * The dossier's semantic accent families — one hue per kind of knowledge.
 *
 * This is the whole argument of the command-centre redesign
 * (`docs/design/profile-redesign/05-command-center.html`). The board it replaces
 * was not ugly, it was *flat*: every card sat on the same sand at the same size
 * with the same claret trim, so nothing told you where to look and grouping had
 * to be read rather than seen. Here the hue does the grouping — occasions are
 * always claret, gifts always gold, hard facts always teal — so a glance sorts
 * the board before a word of it is read.
 *
 * Three of the seven are the palette's own (`claret`, `gold`, `olive`), because
 * the redesign must not invent a second brand. The other four are the smallest
 * set of additions that keeps seven families distinguishable at a 3px rail: a
 * terracotta, a plum-violet, a teal and a mauve, all at the same chroma and
 * lightness as the claret so no family shouts louder than another.
 *
 * They live here rather than in `design-system/tokens.ts` for the reason
 * `board-tones.ts` gives: these are compositions for one surface, not palette
 * entries, and `tokens.ts` is held to an 8px-grid/contract test.
 */

export type AccentTone =
  /** Occasions, countdowns, anything with a date attached. */
  | 'date'
  /** Gifts, budget, orders. */
  | 'gift'
  /** Food, drink, places — what she likes. */
  | 'taste'
  /** Mood, music, memory. */
  | 'mood'
  /** Sizes, logistics, hard data. */
  | 'fact'
  /** Confirmed, verified, settled. */
  | 'grow'
  /** Her people: family, names, birthdays. */
  | 'kin';

interface AccentFamily {
  /** The 3px rail and the ink for the family's own type. */
  ink: string;
  /** The card ground when the card is tinted rather than sand. */
  tint: string;
  /** What the family means, for the board legend and for aria copy. */
  label: string;
}

export const ACCENT_TONES: Record<AccentTone, AccentFamily> = {
  date: { ink: colors.claret, tint: '#FDEEF1', label: 'Occasions' },
  gift: { ink: colors.gold, tint: '#FBF2E4', label: 'Gifts' },
  taste: { ink: '#B5654A', tint: '#FBEDE7', label: 'Taste' },
  mood: { ink: '#7E6491', tint: '#F5F0F9', label: 'Mood & memory' },
  fact: { ink: '#4E7C86', tint: '#EAF2F4', label: 'Facts' },
  grow: { ink: colors.olive, tint: '#EFF2E9', label: 'Confirmed' },
  kin: { ink: '#A05A7A', tint: '#F9EDF3', label: 'Her people' },
};

/** The accent ink for a family, for callers that only need the one value. */
export function toneInk(tone: AccentTone): string {
  return ACCENT_TONES[tone].ink;
}

interface TonedCardOptions {
  /**
   * Ground the card in its family's tint instead of sand.
   *
   * Used sparingly — one or two cards a screen. If every card is tinted the
   * board is back to being flat, only in seven colours instead of one.
   */
  tinted?: boolean;
}

/**
 * A board card wearing its family's colours: the standard sand card plus a 3px
 * left rail in the family's ink.
 *
 * A `borderLeft` rather than the mockup's `::before`, because the board styles
 * inline and a pseudo-element needs a stylesheet. The visual result is identical
 * and `box-sizing` is already global, so the rail costs no layout.
 */
export function tonedCardStyle(
  tone: AccentTone,
  { tinted = false }: TonedCardOptions = {},
): React.CSSProperties {
  const family = ACCENT_TONES[tone];
  return {
    ...cardStyle,
    background: tinted ? family.tint : cardStyle.background,
    borderLeft: `3px solid ${family.ink}`,
    // The rail eats 3px of the card's left inset, so give it back rather than
    // letting the first column of type sit 3px closer to the edge than the last.
    paddingLeft: 15,
  };
}

/**
 * The count pill beside a card title, in the card's own family rather than the
 * board-wide claret-on-petal.
 *
 * Same shape as `cardCountStyle`; only the two colours move, so a tinted pill
 * still reads as the same species of control everywhere on the board.
 */
export function toneCountStyle(tone: AccentTone): React.CSSProperties {
  const family = ACCENT_TONES[tone];
  return {
    flex: 'none',
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.caption,
    fontWeight: typography.weights.medium,
    color: family.ink,
    background: family.tint,
    borderRadius: radii.pill,
    padding: '3px 9px',
    whiteSpace: 'nowrap',
  };
}

/**
 * The small square glyph that opens a card title.
 *
 * Carries the family colour at the start of the line, so the hue is legible even
 * to someone reading the board one card at a time rather than at a glance — and
 * so the grouping survives a monochrome print or a colour-blind reader, who
 * still gets the icon and the title.
 */
export function toneGlyphStyle(tone: AccentTone): React.CSSProperties {
  const family = ACCENT_TONES[tone];
  return {
    flex: 'none',
    width: 18,
    height: 18,
    borderRadius: 5,
    display: 'grid',
    placeItems: 'center',
    background: family.tint,
    color: family.ink,
    fontSize: typography.px.tiny,
    fontStyle: 'normal',
    lineHeight: 1,
  };
}
