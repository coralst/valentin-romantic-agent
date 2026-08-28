/**
 * The three list-typed fields the board draws as pictures rather than as text.
 *
 * `color_palette`, `gift_shortlist` and `weekly_rhythm` are all stored as one
 * comma-separated string, because that is what a `list` field is everywhere else
 * in the registry and because a preference row holds a string. What makes these
 * three different is that the board renders them as swatches, priced rows and
 * seven bars — so each item carries a little more than a name, and the extra part
 * is separated by `@`.
 *
 * `@` rather than `:` or `-`: prices are written "£62", labels contain hyphens
 * ("trail run at first light"), and times contain colons ("until nine"). `@` is
 * the one character that appears in none of them.
 *
 * Every parser here is total. A value typed by hand, or extracted from a sentence
 * the model half-understood, must degrade to "the name, and nothing else" rather
 * than to an empty tile — the field is on file either way, and refusing to draw it
 * would make correcting it impossible.
 */

/** One named shade she wears. */
export interface PaletteShade {
  /** Her word for it: "Deep sage". Kept verbatim — it is a decision, not a hex. */
  name: string;
  /**
   * A hex to fill the swatch with, or null when the name is not one we can
   * honestly colour.
   *
   * Null is a real answer and the card must handle it: inventing #6B7A5E for a
   * shade called "her mother's blue" would be the board asserting something
   * nobody said. The tile draws those as a label with no swatch.
   */
  hex: string | null;
}

/**
 * The shades a person actually names, and what they mean in hex.
 *
 * Deliberately a dictionary rather than a colour-name library: this list is the
 * set of words that come up when someone describes what their partner wears, and
 * a full CSS-colour table would confidently render "linen" as #FAF0E6 — a white,
 * where every fabric called linen is a warm oat. Matching is on the *last* word,
 * so "deep sage", "pale sage" and "sage" all land on sage; the modifier changes
 * the shade less than getting the hue wrong would.
 */
const SHADES: Readonly<Record<string, string>> = {
  sage: '#7C8C6B',
  olive: '#77804F',
  forest: '#3E5641',
  eucalyptus: '#8FA394',
  linen: '#E7DDCD',
  oat: '#C9B7A4',
  oatmeal: '#C9B7A4',
  cream: '#F2E8DC',
  ivory: '#F4EDE2',
  camel: '#B99A6B',
  tan: '#C09A6B',
  taupe: '#B0A29A',
  stone: '#C3BBB1',
  charcoal: '#3C3B3C',
  slate: '#5D6970',
  navy: '#26374F',
  denim: '#5A7290',
  teal: '#2F6F6B',
  blush: '#F2D4D8',
  rose: '#E3A0A8',
  claret: '#8C2F45',
  burgundy: '#6B1F32',
  rust: '#A85433',
  terracotta: '#C0664A',
  ochre: '#C08A3E',
  mustard: '#C9A227',
  gold: '#B08C4F',
  lilac: '#C3AFD1',
  lavender: '#B3A5C6',
  plum: '#6F4459',
  black: '#2A2226',
  white: '#FBF7F2',
  grey: '#A9A3A0',
  gray: '#A9A3A0',
};

/**
 * Split a stored list value on commas, dropping the blanks.
 *
 * A comma followed immediately by a digit is *not* a separator: it is the
 * thousands separator inside a price, and splitting there turned "The good
 * camera@£1,200" into a £1 camera and a stray "200". A real separator is always
 * followed by a space or a letter, because the next item begins with a word.
 */
function items(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/,(?=\D|$)/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** `'Deep sage, Linen, Oat'` → three shades, the first of which leads the tile. */
export function parsePalette(value: string | null | undefined): PaletteShade[] {
  return items(value).map((name) => {
    const words = name.toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/);
    const last = words[words.length - 1] ?? '';
    return { name, hex: SHADES[last] ?? null };
  });
}

/** One thing he is weighing up, with what it costs if he said. */
export interface ShortlistItem {
  name: string;
  /** The number he named, in whatever currency he was talking in. Null if none. */
  price: number | null;
}

/**
 * `'Ceramic glaze set@62, Linen apron@34'` → two priced rows.
 *
 * A missing or unparseable price is `null`, not `0`: a shortlist item with no
 * price is an ordinary entry, and drawing it as free would be a lie about the
 * one number the card exists to compare against his budget.
 */
export function parseShortlist(value: string | null | undefined): ShortlistItem[] {
  return items(value).map((item) => {
    const [name, rawPrice] = splitOnce(item);
    const price = rawPrice === null ? null : parsePrice(rawPrice);
    return { name: name.trim(), price };
  });
}

/**
 * The money out of a written price.
 *
 * Strips the currency symbol and any thousands separator, because "£1,200" and
 * "1200" are the same number and the card compares numbers.
 */
export function parsePrice(text: string): number | null {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** How much of an evening a commitment takes — the bar's height, in three steps. */
export type RhythmWeight = 'light' | 'medium' | 'heavy';

/** One evening of her week that is already hers. */
export interface RhythmEntry {
  /** JS weekday index: 0 is Sunday, matching `Date.getDay()`. */
  weekday: number;
  /** What she does: "pottery until nine". */
  label: string;
  weight: RhythmWeight;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const WEIGHTS: Readonly<Record<string, RhythmWeight>> = {
  light: 'light',
  medium: 'medium',
  heavy: 'heavy',
};

/**
 * `'Tue@pottery until nine@heavy, Sun@bread baking@medium'` → two entries.
 *
 * An item whose first part is not a day of the week is dropped, and this is the
 * one parser here that drops anything. The chart has exactly seven columns keyed
 * on the weekday, so an entry with no day has nowhere to be drawn — where the
 * palette and the shortlist can always fall back to "the name on its own", this
 * one cannot. The weight falls back to `medium` instead of dropping the row: a
 * commitment whose size the model did not judge is still an evening she is busy.
 */
export function parseWeeklyRhythm(value: string | null | undefined): RhythmEntry[] {
  const entries: RhythmEntry[] = [];

  for (const item of items(value)) {
    const parts = item.split('@').map((part) => part.trim());
    const weekday = WEEKDAYS[(parts[0] ?? '').toLowerCase()];
    if (weekday === undefined) continue;
    entries.push({
      weekday,
      label: parts[1] ?? '',
      weight: WEIGHTS[(parts[2] ?? '').toLowerCase()] ?? 'medium',
    });
  }

  return entries;
}

/** How tall the bar is, as a percentage of the column. */
export function rhythmHeight(weight: RhythmWeight): number {
  if (weight === 'heavy') return 88;
  if (weight === 'medium') return 54;
  return 28;
}

/**
 * Split `'name@extra'` once, at the first `@`.
 *
 * Once, not on every `@`, so a label that contains one keeps it rather than
 * losing everything after it.
 */
function splitOnce(item: string): [string, string | null] {
  const at = item.indexOf('@');
  if (at === -1) return [item, null];
  return [item.slice(0, at), item.slice(at + 1)];
}
