import type { PreferenceCategory } from '../../../shared/interfaces/preference';

/**
 * Preference keys captured from REAL Bedrock extraction runs.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `DEMO_PROFILE_PREFERENCES`
 *
 * The seeded demo fixture was authored so that every `category` + `key` pair
 * matches a registry `mappings` entry verbatim. That makes it useless as a
 * regression guard for field resolution: it only ever exercises the one data
 * path that was built to fit it. 574 tests and every committed screenshot used
 * it, and all of them missed a bug where live extraction resolved to `null` for
 * every single preference and the profile rail stayed empty.
 *
 * These rows are the opposite: verbatim output from `npx tsx probe-keys.ts`
 * against `us.anthropic.claude-sonnet-4-5` over three runs of the same two
 * turns, before the fix. Note that no two runs agree on the key — which is the
 * whole point. Nothing in this file may be "tidied" to match the registry; the
 * messiness IS the fixture.
 *
 * Turn 1: "Her name's Mirabel and she uses she/her. She's turning 32 in June."
 * Turn 2: "She loves salsa dancing and she is badly allergic to shellfish."
 */
export interface LiveExtractionRow {
  category: PreferenceCategory;
  key: string;
  value: string;
  /**
   * The profile field this fact belongs to, or null when it legitimately belongs
   * to no registry field (an allergy, pronouns).
   */
  expectedFieldId: string | null;
}

/** Run 1 of 3. */
export const LIVE_EXTRACTION_RUN_1: readonly LiveExtractionRow[] = [
  {
    category: 'important_dates',
    key: 'birthday',
    value: 'June (turning 32)',
    expectedFieldId: 'birthday',
  },
  {
    category: 'hobbies',
    key: 'dancing',
    value: 'loves salsa dancing',
    expectedFieldId: 'hobbies',
  },
  {
    category: 'food',
    key: 'shellfish_allergy',
    value: 'badly allergic to shellfish',
    expectedFieldId: null,
  },
];

/** Run 2 of 3 — the split-fact run: age and birth month arrived separately. */
export const LIVE_EXTRACTION_RUN_2: readonly LiveExtractionRow[] = [
  {
    category: 'important_dates',
    key: 'birthday_month',
    value: 'June',
    expectedFieldId: 'birthday',
  },
  {
    category: 'important_dates',
    key: 'age_turning',
    value: '32',
    expectedFieldId: 'birthday',
  },
  {
    category: 'hobbies',
    key: 'loves_salsa_dancing',
    value: 'loves salsa dancing',
    expectedFieldId: 'hobbies',
  },
  {
    category: 'food',
    key: 'shellfish_allergy',
    value: 'badly allergic to shellfish',
    expectedFieldId: null,
  },
];

/** Run 3 of 3. */
export const LIVE_EXTRACTION_RUN_3: readonly LiveExtractionRow[] = [
  {
    category: 'important_dates',
    key: 'birthday_month',
    value: 'June',
    expectedFieldId: 'birthday',
  },
  {
    category: 'personality_traits',
    key: 'name',
    value: 'Mirabel',
    expectedFieldId: 'partner_name',
  },
  {
    category: 'personality_traits',
    key: 'pronouns',
    value: 'she/her',
    expectedFieldId: null,
  },
  {
    category: 'hobbies',
    key: 'salsa_dancing',
    value: 'loves salsa dancing',
    expectedFieldId: 'hobbies',
  },
];

/** Every observed row, across all runs. */
export const LIVE_EXTRACTION_ROWS: readonly LiveExtractionRow[] = [
  ...LIVE_EXTRACTION_RUN_1,
  ...LIVE_EXTRACTION_RUN_2,
  ...LIVE_EXTRACTION_RUN_3,
];

/**
 * Additional realistic key shapes that extraction is free to produce.
 *
 * Not verbatim captures, but the same families: casing, punctuation, plurals,
 * and wordier phrasings. A resolver that handles the captures but not these is
 * one model temperature change away from the original bug.
 */
export const REALISTIC_KEY_VARIANTS: readonly LiveExtractionRow[] = [
  {
    category: 'personality_traits',
    key: 'Partner Name',
    value: 'Mirabel',
    expectedFieldId: 'partner_name',
  },
  {
    category: 'personality_traits',
    key: 'first_name',
    value: 'Mirabel',
    expectedFieldId: 'partner_name',
  },
  {
    category: 'important_dates',
    key: 'birth-month',
    value: 'June',
    expectedFieldId: 'birthday',
  },
  {
    category: 'important_dates',
    key: '  birthday  ',
    value: 'June 12',
    expectedFieldId: 'birthday',
  },
  {
    category: 'food',
    key: 'favourite_cuisine',
    value: 'Thai',
    expectedFieldId: 'favorite_cuisine',
  },
  {
    category: 'food',
    key: 'favorite cuisine type',
    value: 'Thai',
    expectedFieldId: 'favorite_cuisine',
  },
  {
    category: 'hobbies',
    key: 'hobbies',
    value: 'pottery',
    expectedFieldId: 'hobbies',
  },
  {
    category: 'hobbies',
    key: 'interests',
    value: 'pottery',
    expectedFieldId: 'hobbies',
  },
  {
    category: 'music',
    key: 'favorite_artist',
    value: 'Buena Vista Social Club',
    expectedFieldId: 'music_genre',
  },
  {
    category: 'gifts',
    key: 'favourite colour',
    value: 'deep green',
    expectedFieldId: 'favorite_color',
  },
  {
    category: 'travel',
    key: 'dream_destination',
    value: 'Lisbon',
    expectedFieldId: 'travel_destination',
  },
  {
    category: 'love_language',
    key: 'love_language',
    value: 'Quality Time',
    expectedFieldId: 'love_language',
  },
  {
    category: 'gifts',
    key: 'perfume',
    value: 'something woody',
    expectedFieldId: 'fragrance_preference',
  },
];
