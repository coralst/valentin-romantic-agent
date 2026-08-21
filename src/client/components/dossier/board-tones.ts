import { colors, radii, typography } from '../../design-system/tokens';

/**
 * The translucent inks and shared surfaces the dossier board is built from.
 *
 * Same reasoning as `brief/rail-tones.ts`: `full-profile.html` composes its
 * whole board out of two or three base hues at a dozen different alphas — the
 * gold tint alone appears at .10/.13/.16/.18/.28/.30/.32/.65 — and opacity is
 * not a palette entry. Fifteen `goldTint13`-style tokens would be worse than a
 * function, and `design-system/` is the UI Designer's lane anyway.
 *
 * These are the *light-ground* counterparts to the rail's dark-ground helpers.
 */

/** `colors.gold` as channels, for `rgba()` composition. */
const GOLD_RGB = '176, 140, 79';

/** `colors.linenShade` as channels — the board's hairline ink. */
const LINEN_SHADE_RGB = '229, 217, 210';

/** Gold over the light board at `alpha` — chip fills, spine dots, warning rings. */
export function goldWash(alpha: number): string {
  return `rgba(${GOLD_RGB}, ${alpha})`;
}

/** The board's hairline ink at `alpha`, for the fainter row dividers. */
export function linenWash(alpha: number): string {
  return `rgba(${LINEN_SHADE_RGB}, ${alpha})`;
}

/**
 * The deep gold used for *type* on a gold wash (`full-profile.html:104`).
 *
 * Neither `colors.gold` nor `colors.goldLight` is legible as small copy on a
 * 13%-gold fill, so the mockup tints with gold and writes in this darker one.
 */
export const GOLD_INK = '#7A5C22';

/** The same ink at `alpha`, for the secondary half of an act-by chip. */
export function goldInk(alpha: number): string {
  return `rgba(122, 92, 34, ${alpha})`;
}

/** The heading ink on the warning card (`full-profile.html:112`). */
export const WARN_HEADING_INK = '#8A6A2C';

/** The warning card's ground (`full-profile.html:111`). */
export const WARN_GROUND = '#FBF3E8';

/** The olive "loved it" pill's ground (`full-profile.html:155`). */
export const OLIVE_GROUND = '#F0F2EA';

/** The board's standard 1px divider between rows inside a card. */
export const CARD_HAIRLINE = `1px solid ${colors.linenShade}`;

/** The lighter divider between the 18 registry fields (`full-profile.html:166`). */
export const FIELD_HAIRLINE = `1px solid ${linenWash(0.55)}`;

/** An inset ring, used instead of a border so it never affects layout. */
export function insetRing(color: string): string {
  return `inset 0 0 0 1px ${color}`;
}

/**
 * The board's default card: sand, 26px, and a shadow just deep enough to lift
 * it off the porcelain shell (`full-profile.html:74-75`).
 *
 * Cards spread this rather than importing a component wrapper so each one can
 * override its ground — `.pale`, `.mind` — without a variant prop explosion.
 */
export const cardStyle: React.CSSProperties = {
  background: colors.sand,
  borderRadius: radii.card,
  padding: '16px 18px 18px',
  boxShadow: '0 1px 3px rgba(42, 34, 38, 0.05)',
  // A grid item's default `min-width: auto` sizes it to its widest unbreakable
  // child, which lets one long extracted value force the whole 3-column board
  // wider than the window.
  minWidth: 0,
};

/** `.card.pale` — porcelain with a ring instead of a fill (`:76`). */
export const paleCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: colors.porcelain,
  boxShadow: insetRing(colors.linenShade),
};

/** The wide-tracked uppercase eyebrow every card is introduced by (`:78-79`). */
export const cardTitleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.tiny,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

/** The claret-on-petal count pill beside a card title (`:80-81`). */
export const cardCountStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  fontWeight: typography.weights.medium,
  color: colors.claret,
  background: colors.petal,
  borderRadius: radii.pill,
  padding: '3px 9px',
  whiteSpace: 'nowrap',
};

/** The row a card title sits on (`:77`). */
export const cardHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  marginBottom: 13,
};

/** The petal "Ask" pill used on unknown fields and in the discovery queue. */
export const askPillStyle: React.CSSProperties = {
  flex: 'none',
  border: 'none',
  cursor: 'pointer',
  background: colors.petal,
  color: colors.claret,
  borderRadius: radii.pill,
  padding: '5px 11px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  fontWeight: typography.weights.medium,
  whiteSpace: 'nowrap',
};

/** The quiet copy a card falls back to when it has nothing to show. */
export const cardEmptyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  lineHeight: 1.5,
  color: colors.inkMuted,
};
