/**
 * Presentation-ready demo partner profile.
 *
 * This fixture exists so a live demo can start from a fully populated partner
 * profile instead of a blank panel — the server seeds it into a fresh session
 * via `POST /api/session/seed`.
 *
 * CONTRACT: every `category` + `key` pair below must match a `mappings` entry in
 * `src/client/utils/profile-field-registry.ts` verbatim. The client resolves a
 * preference to a profile field through `resolveField(category, key)`; an
 * unmatched pair silently falls out of the profile panel. The registry-coverage
 * tests in `src/server/api/__tests__/http-routes.test.ts` fail if a mapping
 * ever drifts.
 *
 * SECOND CONTRACT: every row also carries the `fieldId` that pair resolves to.
 * The client can derive it from the registry; the server cannot, because the
 * registry lives under `src/client/` and the server reads preferences straight
 * out of storage to build Valentin's system prompt. `fieldId` is the only handle
 * it has. Omitting it made a fully-seeded Samantha invisible to him — he greeted
 * her partner as a stranger and believed all twenty-one fields were still blank.
 *
 * The persona is fictional. No real person, and no identifying detail.
 */

import type { ExtractedPreference } from '../persistence/storage-interface';

/**
 * Synthetic source message id for seeded preferences.
 *
 * `savePreference` requires a `sourceMessageId`, but seeded data was never
 * extracted from a real conversation turn — there is no message to point at.
 * A clearly-labelled constant keeps demo rows distinguishable from genuine
 * extractions in storage and in logs.
 */
export const DEMO_SEED_SOURCE_MESSAGE_ID = 'demo-seed';

/**
 * The seeded preferences, one per profile registry field.
 *
 * The count is deliberately not written down here. It was "18" for three
 * revisions after the registry grew, and a stale number in a doc comment is
 * worse than none — `http-routes.test.ts` asserts the one-per-field contract.
 *
 * List-valued fields (`hobbies`, `wish list`) are comma-separated: that is the
 * serialization the client's list editor round-trips (see the
 * "Comma-separated values" input placeholder in `ProfileField.tsx`).
 * Date-valued fields use ISO `YYYY-MM-DD`. Enum-valued fields use an option
 * from the field's `enumOptions` verbatim.
 */
export const DEMO_PROFILE_PREFERENCES: readonly ExtractedPreference[] = [
  // --- Basics ---
  {
    category: 'personality_traits',
    key: 'name',
    fieldId: 'partner_name',
    value: 'Samantha',
    confidence: 0.97,
  },
  {
    category: 'personality_traits',
    key: 'nickname',
    fieldId: 'nickname',
    value: 'Sam',
    confidence: 0.91,
  },
  {
    category: 'important_dates',
    key: 'birthday',
    fieldId: 'birthday',
    value: '1994-06-12',
    confidence: 0.95,
  },
  {
    category: 'personality_traits',
    key: 'zodiac sign',
    fieldId: 'zodiac_sign',
    value: 'Gemini',
    confidence: 0.86,
  },

  // --- Relationship ---
  {
    category: 'important_dates',
    key: 'anniversary',
    fieldId: 'anniversary',
    value: '2021-09-18',
    confidence: 0.94,
  },
  {
    category: 'personality_traits',
    key: 'how we met',
    fieldId: 'how_we_met',
    value: 'A rainy Sunday pottery class where we both made the same lopsided mug',
    confidence: 0.89,
  },
  {
    category: 'love_language',
    key: 'primary',
    fieldId: 'love_language',
    value: 'Quality Time',
    confidence: 0.92,
  },
  {
    category: 'important_dates',
    key: 'together since',
    fieldId: 'relationship_duration',
    value: '2019-03-02',
    confidence: 0.88,
  },

  // --- Interests ---
  {
    category: 'food',
    key: 'favorite cuisine',
    fieldId: 'favorite_cuisine',
    value: 'Northern Italian — anything with brown butter and sage',
    confidence: 0.93,
  },
  {
    category: 'music',
    key: 'genre',
    fieldId: 'music_genre',
    value: 'Indie folk, the kind with close harmonies',
    confidence: 0.84,
  },
  {
    category: 'hobbies',
    key: 'hobbies',
    fieldId: 'hobbies',
    value: 'pottery, sunrise trail runs, watercolour sketching, bread baking',
    confidence: 0.9,
  },
  {
    category: 'travel',
    key: 'dream destination',
    fieldId: 'travel_destination',
    value: 'Kyoto during cherry blossom season',
    confidence: 0.87,
  },

  // --- Style & Aesthetics ---
  {
    category: 'gifts',
    key: 'clothing style',
    fieldId: 'clothing_style',
    value: 'Relaxed and tactile — linen, oversized knits, one good silk scarf',
    confidence: 0.81,
  },
  {
    category: 'gifts',
    key: 'favorite color',
    fieldId: 'favorite_color',
    value: 'Deep sage green',
    confidence: 0.96,
  },
  {
    category: 'gifts',
    key: 'fragrance',
    fieldId: 'fragrance_preference',
    value: 'Warm and woody — fig, cedar, a little vanilla',
    confidence: 0.79,
  },

  // --- Sizes ---
  //
  // Both scales, the way someone who has actually bought her something writes it
  // down. Confidence is high because a size is either known or it is not — there
  // is no "probably a 6" that is worth acting on.
  //
  // Deliberately absent from `demo-history.ts`: the transcripts are pinned to
  // the profile by `__tests__/demo-personas.test.ts`, and inventing a line where
  // she announces her ring size to make the numbers match would be a worse
  // demo than a panel that simply knows something the visible history does not.
  // Valentin is meant to remember more than the last five conversations.
  {
    category: 'gifts',
    key: 'clothing size',
    fieldId: 'clothing_size',
    value: 'UK 10 / EU 38 — sizes up for knitwear',
    confidence: 0.9,
  },
  {
    category: 'gifts',
    key: 'shoe size',
    fieldId: 'shoe_size',
    value: 'UK 6 / EU 39',
    confidence: 0.94,
  },
  {
    category: 'gifts',
    key: 'ring size',
    fieldId: 'ring_size',
    value: 'UK M (US 6)',
    confidence: 0.82,
  },

  // --- Gifts & Celebrations ---
  {
    category: 'gifts',
    key: 'budget',
    fieldId: 'gift_budget',
    value: 'Around $80 for everyday gestures, more for milestones',
    confidence: 0.78,
  },
  {
    category: 'gifts',
    key: 'wish list',
    fieldId: 'wish_list',
    value: 'ceramic glaze set, linen apron, hardback poetry anthology, trail shoes',
    confidence: 0.85,
  },
  {
    category: 'gifts',
    key: 'surprise preference',
    fieldId: 'surprise_preference',
    // 'Prefers to Choose' rather than 'Loves Surprises', which is the only
    // registry value that raises a caution. `KeepInMind` returns null on an
    // empty caution list, so with the cheerful option seeded the card was
    // unreachable from the demo path in both the brief rail and the dossier
    // board — the one widget a complete profile could never show.
    value: 'Prefers to Choose',
    confidence: 0.83,
  },
] as const;
