import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { deriveCautions } from '../components/brief/KeepInMind';
import { parseWeeklyRhythm } from './list-field-parsing';

/**
 * Her in a paragraph, and the handful of tags under it — both composed from
 * stored rows, never written by the model.
 *
 * ## Why this is deterministic
 *
 * The same reason `reminders/conversation-email.ts` assembles the mail body from
 * rows instead of asking Bedrock for it: nobody reads this before it is shown.
 * A model-written portrait would be the one place on the board where a sentence
 * about her could be *wrong* — a confabulated allergy is worse than a missing
 * one — and it would arrive a second after the panel did. Every clause below is
 * a field she is on record as having, in the words she was recorded in.
 *
 * ## Why sentences and not a table
 *
 * The board already has the table: `EverythingIKnow` lists all twenty-one fields
 * with their values. What it cannot do is read as a person. The paragraph exists
 * to be the thing you skim before a date, so it is prose, and the fields that do
 * not make prose (ring size, bra size) are deliberately not in it.
 */

/** What to look up. Matches `profile-store-context`'s accessor shape. */
export type FieldLookup = (fieldId: string) => { value: string } | null;

/** One chip under the paragraph. */
export interface SummaryTag {
  /** Stable across re-extraction — see the note in `deriveCautions`. */
  id: string;
  label: string;
  /**
   * `constraint` is drawn in the warning tone because it is a rule, not a taste:
   * "no shellfish" narrows the plan, "loves jazz" only colours it. Flattening
   * the two into one grey chip strip is how an allergy gets skimmed past.
   */
  tone: 'constraint' | 'taste';
}

/** The paragraph and its chips, derived together so they cannot disagree. */
export interface PartnerSummary {
  /** Empty when nothing is known — the caller renders its own invitation. */
  sentences: string[];
  tags: SummaryTag[];
}

/** Indexed by `RhythmEntry.weekday`, which is `Date.getDay()` — Sunday first. */
const WEEKDAY_PLURALS: readonly string[] = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

/** Trimmed field value, or null when absent or blank. */
function read(getFieldValue: FieldLookup, fieldId: string): string | null {
  const value = getFieldValue(fieldId)?.value?.trim();
  return value && value.length > 0 ? value : null;
}

/** Lowercase the first letter so a value can sit mid-sentence. */
function uncapitalize(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * The paragraph, one clause per fact, in the order you would say them.
 *
 * Each sentence is independently omitted when its field is missing, so an early
 * profile reads as a short true paragraph rather than a long one full of gaps.
 */
function buildSentences(getFieldValue: FieldLookup, name: string | null): string[] {
  const her = name ?? 'She';
  const sentences: string[] = [];

  const city = read(getFieldValue, 'home_city');
  const met = read(getFieldValue, 'how_we_met');
  if (city && met) sentences.push(`${her} lives in ${city}; you met ${uncapitalize(met)}.`);
  else if (city) sentences.push(`${her} lives in ${city}.`);
  else if (met) sentences.push(`You met ${uncapitalize(met)}.`);

  const cuisine = read(getFieldValue, 'favorite_cuisine');
  const style = read(getFieldValue, 'restaurant_style');
  if (cuisine && style) {
    sentences.push(`She loves ${uncapitalize(cuisine)}, somewhere ${uncapitalize(style)}.`);
  } else if (cuisine) {
    sentences.push(`She loves ${uncapitalize(cuisine)}.`);
  } else if (style) {
    sentences.push(`For dinner she wants somewhere ${uncapitalize(style)}.`);
  }

  const music = read(getFieldValue, 'music_genre');
  if (music) sentences.push(`She listens to ${uncapitalize(music)}.`);

  const hobbies = read(getFieldValue, 'hobbies');
  if (hobbies) sentences.push(`Her own time goes on ${uncapitalize(hobbies)}.`);

  /*
   * Her week is phrased from the parsed entries rather than the raw field, whose
   * stored form is `'Tue@pottery@heavy'` and reads as data in a sentence.
   *
   * Two at most: the paragraph is a portrait, and her whole calendar is drawn
   * properly a card below in `HerWeek`.
   */
  const said = parseWeeklyRhythm(read(getFieldValue, 'weekly_rhythm'))
    .filter((entry) => entry.label.trim().length > 0)
    .slice(0, 2)
    .map((entry) => `${entry.label.trim()} on ${WEEKDAY_PLURALS[entry.weekday]}`);
  if (said.length > 0) {
    sentences.push(`Her week: ${said.join(', and ')}.`);
  }

  const love = read(getFieldValue, 'love_language');
  if (love) sentences.push(`What lands with her is ${uncapitalize(love)}.`);

  return sentences;
}

/**
 * The chips: her constraints first, then the tastes worth seeing at a glance.
 *
 * Constraints come from `deriveCautions`, the same derivation the rail's "Keep
 * in mind" card reads, so an allergy cannot appear in one place and not the
 * other. The tastes are the short single-valued fields — a chip has room for a
 * word, not for a sentence, which is why `how_we_met` is prose-only above.
 */
const TASTE_CHIP_FIELDS: readonly { fieldId: string; prefix?: string }[] = [
  { fieldId: 'favorite_cuisine' },
  { fieldId: 'restaurant_style' },
  { fieldId: 'music_genre' },
  { fieldId: 'favorite_color' },
  { fieldId: 'fragrance_preference' },
  { fieldId: 'travel_destination' },
  { fieldId: 'love_language' },
  { fieldId: 'clothing_style' },
];

/** A taste chip has room for a word or two; past that it stops being scannable. */
const TAG_MAX = 26;

/**
 * Shorten a *taste* to chip length.
 *
 * Constraints are deliberately never put through this. "badly allergic to
 * shellfish" is 27 characters, so truncating it produced "badly allergic to
 * shellfi…" — a chip that spends its whole width on the qualifier and elides the
 * one word that says what to avoid. A constraint is a rule someone has to be able
 * to read, so it wraps to two lines instead (see `PartnerSummary`'s chip style).
 */
function truncate(value: string): string {
  return value.length <= TAG_MAX ? value : `${value.slice(0, TAG_MAX - 1).trimEnd()}…`;
}

function buildTags(
  getFieldValue: FieldLookup,
  preferences: PreferenceWithHistory[],
): SummaryTag[] {
  const tags: SummaryTag[] = [];

  for (const caution of deriveCautions(getFieldValue, preferences)) {
    tags.push({ id: `constraint:${caution.id}`, label: caution.title, tone: 'constraint' });
  }

  for (const chip of TASTE_CHIP_FIELDS) {
    const value = read(getFieldValue, chip.fieldId);
    if (!value) continue;
    tags.push({ id: `taste:${chip.fieldId}`, label: truncate(value), tone: 'taste' });
  }

  return tags;
}

/**
 * Everything the portrait block draws, from the store and nothing else.
 *
 * `name` is passed rather than read so the caller — which already has it for the
 * header — decides what an unnamed partner is called, and this module never has
 * to invent one.
 */
export function derivePartnerSummary(
  getFieldValue: FieldLookup,
  preferences: PreferenceWithHistory[],
  name: string | null,
): PartnerSummary {
  return {
    sentences: buildSentences(getFieldValue, name),
    tags: buildTags(getFieldValue, preferences),
  };
}
