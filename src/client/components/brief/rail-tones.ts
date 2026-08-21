import { colors } from '../../design-system/tokens';

/**
 * The two translucent inks the brief rail is built from.
 *
 * Every surface inside the rail — hairlines, section labels, chips, idea cards —
 * is one of two colours at some opacity over the claret gradient, never a new
 * hue. That is what makes a 306px column of eleven modules read as one panel.
 *
 * These are helpers rather than tokens because opacity is not a palette entry:
 * `option-5d-brief.html` uses the porcelain ink at nine different alphas
 * (.035 → .62) and the gold tint at six. Enumerating fifteen `onClaret08`-style
 * tokens would be worse than a function, and `design-system/` is not this
 * component's file to edit anyway.
 */

/** `colors.onClaret` (#FBEFF1) as channels, for `rgba()` composition. */
const ON_CLARET_RGB = '251, 239, 241';

/**
 * The mockup's gold *tint* base (#E0BA7C, option-5d-brief.html:94 onward).
 *
 * Deliberately lighter than `colors.gold`/`goldLight`, which are text-weight
 * golds: a fill or a ring at those values goes muddy against the dark claret,
 * so the mockup tints with a brighter gold and paints type with the darker one.
 */
const GOLD_TINT_RGB = '224, 186, 124';

/** Porcelain ink over the claret ground at `alpha`. */
export function onClaret(alpha: number): string {
  return `rgba(${ON_CLARET_RGB}, ${alpha})`;
}

/** The gold tint over the claret ground at `alpha`. */
export function goldTint(alpha: number): string {
  return `rgba(${GOLD_TINT_RGB}, ${alpha})`;
}

/** The 1px divider under a section label, and between the pinned blocks. */
export const RAIL_HAIRLINE = `1px solid ${onClaret(0.13)}`;

/** The lighter divider between rows *inside* a module. */
export const ROW_HAIRLINE = `1px solid ${onClaret(0.08)}`;

/** An inset ring, used instead of a border so it never affects layout. */
export function insetRing(color: string): string {
  return `inset 0 0 0 1px ${color}`;
}

/** Primary copy on the rail. */
export const railText = colors.onClaret;
