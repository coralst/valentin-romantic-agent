/**
 * Candidate grounds for the architecture bar across the foot of the window.
 *
 * Five of them, live-switchable with `?bar=<id>`, because this is a colour that
 * cannot be chosen from a hex value: it is 34px of dark against claret, gold and
 * linen, and the only honest way to pick is to look at all five in the real frame.
 * Once one is chosen the rest go, and `DEFAULT_BAR_THEME` becomes the only ground.
 *
 * What every candidate has in common: none of them is another red. The claret
 * already carries the icon rail, the bubbles, every CTA and the brief's meter, and
 * a fifth red band along the bottom flattens the frame into a single hue. Each is
 * a *dark jewel neighbour* of the palette rather than a neutral black, which is
 * the other failure — near-black read as a seam where the window had been cut,
 * not as part of the room.
 */

/** An RGB triple, kept unpacked so alphas can be derived for blur and feather. */
type Rgb = readonly [number, number, number];

export interface BarTheme {
  id: string;
  /** Shown to whoever is choosing, not in the app. */
  label: string;
  /** One line on what it does beside the claret. */
  note: string;
  /** Top and bottom of the bar's vertical gradient. */
  top: Rgb;
  bottom: Rgb;
  /** Copy on the bar, and its quieter form. */
  copy: string;
  copyMuted: string;
  /** The "live" pip. Warm on cool grounds, cool on warm ones, so it stays visible. */
  pip: string;
}

export const BAR_THEMES: readonly BarTheme[] = [
  {
    id: 'aubergine',
    label: 'Aubergine',
    note: 'Deep plum. Closest relative of the claret, so the foot of the window reads as the same room one storey down — without being red.',
    top: [59, 42, 58],
    bottom: [42, 30, 44],
    copy: '#F3E7EE',
    copyMuted: 'rgba(243, 231, 238, 0.62)',
    pip: '#7FC9A6',
  },
  {
    id: 'espresso',
    label: 'Espresso',
    note: 'Warm dark brown. The leather-and-linen option: the quietest of the five, and the one that fights the cream least.',
    top: [58, 44, 37],
    bottom: [42, 32, 27],
    copy: '#F3E6D9',
    copyMuted: 'rgba(243, 230, 217, 0.62)',
    pip: '#8ECFAE',
  },
  {
    id: 'bronze',
    label: 'Bronze',
    note: 'Dark olive-gold. Picks up the gold of the nudge card and the eyebrow labels, so the bar looks like part of the trim.',
    top: [60, 53, 38],
    bottom: [43, 38, 25],
    copy: '#F2E9D4',
    copyMuted: 'rgba(242, 233, 212, 0.62)',
    pip: '#8ECFAE',
  },
  {
    id: 'teal',
    label: 'Teal ink',
    note: 'Deep blue-green. The sharpest break from the red, and the one that makes the jade pip look deliberate rather than borrowed.',
    top: [31, 58, 60],
    bottom: [21, 41, 43],
    copy: '#E4F0EE',
    copyMuted: 'rgba(228, 240, 238, 0.62)',
    pip: '#F0C978',
  },
  {
    id: 'indigo',
    label: 'Indigo slate',
    note: 'Cool blue-slate. The most modern of the five; reads as chrome rather than as furniture, which flatters the diagram above it.',
    top: [46, 54, 68],
    bottom: [33, 39, 51],
    copy: '#E8ECF4',
    copyMuted: 'rgba(232, 236, 244, 0.62)',
    pip: '#F0C978',
  },
] as const;

/** The one that ships if nobody says otherwise. */
export const DEFAULT_BAR_THEME = 'aubergine';

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Slightly short of opaque, so the window behind it blurs through the bar.
 *
 * Not lower: at 0.8 the cream underneath washed every candidate out into a pastel
 * of itself, which is the opposite of what a dark ground is for.
 */
const GROUND_ALPHA = 0.94;

/** The bar's ground. */
export function barGround(theme: BarTheme): string {
  return `linear-gradient(180deg, ${rgba(theme.top, GROUND_ALPHA)} 0%, ${rgba(
    theme.bottom,
    Math.min(GROUND_ALPHA + 0.04, 1),
  )} 100%)`;
}

/**
 * The soft edge above the bar: the ground fading upward into nothing.
 *
 * A 1px hairline drew a hard rule across the window, and the eye read it as the
 * frame being cut in two. Feathering the edge lets the bar sit *under* the panels
 * instead of butting against them.
 */
export function barFeather(theme: BarTheme): string {
  return `linear-gradient(to top, ${rgba(theme.top, 0.85)} 0%, ${rgba(
    theme.top,
    0.34,
  )} 45%, ${rgba(theme.top, 0)} 100%)`;
}

/** Hairlines and dividers drawn *on* the bar. */
export function barHairline(theme: BarTheme): string {
  return rgba(
    [
      Math.round((255 + theme.top[0]) / 2),
      Math.round((255 + theme.top[1]) / 2),
      Math.round((255 + theme.top[2]) / 2),
    ],
    0.18,
  );
}

export function barThemeById(id: string | null | undefined): BarTheme {
  return BAR_THEMES.find((theme) => theme.id === id) ?? barThemeById(DEFAULT_BAR_THEME);
}

/**
 * The candidate to draw, from `?bar=<id>` and otherwise the default.
 *
 * A query parameter rather than a setting: this is a decision being made once, by
 * someone standing in front of the real window, and it should cost a URL rather
 * than a menu. An unknown or absent id falls back to the default instead of
 * throwing, so a stale link never blanks the bar.
 */
export function resolveBarTheme(search?: string): BarTheme {
  const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const requested = new URLSearchParams(query).get('bar');
  return barThemeById(requested);
}
