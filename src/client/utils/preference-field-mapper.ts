import type { PreferenceCategory } from '../../shared/interfaces/preference';
import { PROFILE_FIELD_REGISTRY } from './profile-field-registry';
import { isProfileFieldId } from '../../shared/constants/profile-fields';

/**
 * Resolving an extracted preference onto a profile field.
 *
 * This module used to be an exact-string lookup: a `Map` keyed
 * `"category:key.toLowerCase()"`, built from the registry's `mappings`, returning
 * `null` on any miss. That worked for exactly one data path — the seeded demo
 * fixture, whose keys were authored to match the table verbatim — and dropped
 * live extraction on the floor. Real model runs emitted `birthday_month`,
 * `age_turning`, `salsa_dancing`, `pronouns`, `shellfish_allergy`; none were in
 * the table, every one resolved to `null`, and nothing reached the profile.
 *
 * The durable fix is upstream: extraction now names a canonical field id
 * directly (`src/shared/constants/profile-fields.ts`), so `resolveByFieldId` is
 * the primary route. This module remains the fallback for preferences that carry
 * no field id — pre-existing rows, seeded data, and any future model that omits
 * it — and it is now forgiving rather than exact.
 *
 * Three layers, cheapest first:
 *   1. exact match on the normalized key
 *   2. synonym table
 *   3. token-subset match against registry mappings
 */

/** Lazy-initialized lookup map from "category:normalizedKey" to fieldId */
let lookupMap: Map<string, string> | null = null;

/**
 * Normalize a preference key into a comparable form.
 *
 * Handles the shapes extraction actually produces: `snake_case`, `kebab-case`,
 * `Title Case`, trailing punctuation, doubled whitespace, and plurals. The
 * plural rule is deliberately conservative — never strip on `ss` ("dress"),
 * `us` ("status") or `is` ("this").
 */
export function normalizeKey(key: string): string {
  const flattened = key
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    // Drop anything that is not a letter, digit or space (apostrophes, colons,
    // trailing question marks from prose-shaped keys).
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return flattened.split(' ').map(singularize).join(' ');
}

/** Conservative singularizer for a single token. */
function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ss') || token.endsWith('us') || token.endsWith('is')) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/**
 * Synonyms for keys the model reaches for that the registry does not list.
 *
 * Every entry here was observed in, or is an obvious neighbour of, real
 * extraction output. Keys are stored already normalized (so singular, spaced).
 *
 * `null` marks a key that is *deliberately* not a profile field, so the dev
 * warning stays quiet for it: an allergy is consumed by `KeepInMind.tsx` via
 * substring matching on the key, and is not a dropped discovery.
 */
const KEY_SYNONYMS: Readonly<Record<string, string | null>> = {
  // --- partner_name ---
  'partner name': 'partner_name',
  'first name': 'partner_name',
  'given name': 'partner_name',
  'her name': 'partner_name',
  'spouse name': 'partner_name',
  'wife name': 'partner_name',
  name: 'partner_name',
  // --- nickname ---
  'pet name': 'nickname',
  nickname: 'nickname',
  'short name': 'nickname',
  // --- birthday ---
  birthday: 'birthday',
  'birth date': 'birthday',
  birthdate: 'birthday',
  'birth day': 'birthday',
  'birthday month': 'birthday',
  'birth month': 'birthday',
  'birthday date': 'birthday',
  dob: 'birthday',
  age: 'birthday',
  'age turning': 'birthday',
  'turning age': 'birthday',
  // --- zodiac_sign ---
  zodiac: 'zodiac_sign',
  'zodiac sign': 'zodiac_sign',
  'star sign': 'zodiac_sign',
  'sun sign': 'zodiac_sign',
  // --- anniversary ---
  anniversary: 'anniversary',
  'wedding anniversary': 'anniversary',
  'wedding date': 'anniversary',
  // --- relationship_duration ---
  'together since': 'relationship_duration',
  'dating since': 'relationship_duration',
  'relationship duration': 'relationship_duration',
  'relationship length': 'relationship_duration',
  'year together': 'relationship_duration',
  // --- how_we_met ---
  'how we met': 'how_we_met',
  'how they met': 'how_we_met',
  'meeting story': 'how_we_met',
  // --- love_language ---
  'love language': 'love_language',
  'primary love language': 'love_language',
  primary: 'love_language',
  // --- favorite_cuisine ---
  cuisine: 'favorite_cuisine',
  'favorite cuisine': 'favorite_cuisine',
  'favourite cuisine': 'favorite_cuisine',
  'favorite food': 'favorite_cuisine',
  'favourite food': 'favorite_cuisine',
  'food preference': 'favorite_cuisine',
  'favorite restaurant': 'favorite_cuisine',
  // --- music_genre ---
  genre: 'music_genre',
  'music genre': 'music_genre',
  'favorite genre': 'music_genre',
  'favorite music': 'music_genre',
  'music preference': 'music_genre',
  'favorite artist': 'music_genre',
  'favorite band': 'music_genre',
  // --- hobbies ---
  hobby: 'hobbies',
  activity: 'hobbies',
  interest: 'hobbies',
  pastime: 'hobbies',
  'favorite activity': 'hobbies',
  dancing: 'hobbies',
  'salsa dancing': 'hobbies',
  // --- travel_destination ---
  'dream destination': 'travel_destination',
  'favorite destination': 'travel_destination',
  destination: 'travel_destination',
  'bucket list': 'travel_destination',
  'travel destination': 'travel_destination',
  'dream trip': 'travel_destination',
  // --- clothing_style ---
  'clothing style': 'clothing_style',
  style: 'clothing_style',
  'fashion style': 'clothing_style',
  aesthetic: 'clothing_style',
  // --- favorite_color ---
  'favorite color': 'favorite_color',
  'favourite color': 'favorite_color',
  'favourite colour': 'favorite_color',
  'favorite colour': 'favorite_color',
  color: 'favorite_color',
  colour: 'favorite_color',
  // --- fragrance_preference ---
  fragrance: 'fragrance_preference',
  perfume: 'fragrance_preference',
  scent: 'fragrance_preference',
  // --- gift_budget ---
  budget: 'gift_budget',
  'gift budget': 'gift_budget',
  'price range': 'gift_budget',
  'spending limit': 'gift_budget',
  // --- wish_list ---
  'wish list': 'wish_list',
  wishlist: 'wish_list',
  want: 'wish_list',
  'gift idea': 'wish_list',
  // --- surprise_preference ---
  'surprise preference': 'surprise_preference',
  surprise: 'surprise_preference',
  'like surprise': 'surprise_preference',
  // --- next_occasion ---
  'next occasion': 'next_occasion',
  'upcoming occasion': 'next_occasion',
  occasion: 'next_occasion',
  'next date': 'next_occasion',
  'planning for': 'next_occasion',
  // --- home_city ---
  'home city': 'home_city',
  city: 'home_city',
  'lives in': 'home_city',
  'based in': 'home_city',
  location: 'home_city',
  // --- restaurant_style ---
  'restaurant style': 'restaurant_style',
  'dining style': 'restaurant_style',
  atmosphere: 'restaurant_style',
  vibe: 'restaurant_style',
  // --- reminder_lead_time ---
  'reminder lead time': 'reminder_lead_time',
  'lead time': 'reminder_lead_time',
  notice: 'reminder_lead_time',
  'reminder timing': 'reminder_lead_time',
  // --- search_radius ---
  'search radius': 'search_radius',
  radius: 'search_radius',
  'travel distance': 'search_radius',
  // --- notify_email ---
  //
  // Bare `email` is safe here where a bare `name` would not be: nothing else in
  // the registry holds an address, so there is no second field this could be
  // filed under by mistake.
  email: 'notify_email',
  'email address': 'notify_email',
  'notify email': 'notify_email',
  'notification email': 'notify_email',
  'reminder email': 'notify_email',
  'my email': 'notify_email',
  'contact email': 'notify_email',

  // --- deliberately NOT profile fields (see `KeepInMind.tsx`) ---
  allergy: null,
  'food allergy': null,
  'shellfish allergy': null,
  dislike: null,
  avoid: null,
  intolerance: null,
  pronoun: null,
  gender: null,
};

/**
 * Categories with exactly one plausible profile field, used as a last resort.
 *
 * Extraction likes to put the *value* in the key: the observed
 * `hobbies:loves_salsa_dancing` and `hobbies:salsa_dancing` are not key names at
 * all, they are the fact restated. No synonym table can enumerate those, but the
 * category already tells us where it belongs — a `hobbies` preference is a hobby,
 * whatever the key says.
 *
 * Only categories with one plausible *fallback* field are listed. `food` is
 * deliberately absent: a `food` preference may be a cuisine OR an allergy, and
 * defaulting an allergy into `favorite_cuisine` would be worse than dropping it.
 * Likewise `gifts`, `personality_traits` and `important_dates` span several fields.
 *
 * `travel` now spans three fields — destination, home city, search radius — and
 * still defaults to the destination, because that is the only one of the three a
 * *model* invents a key for. A home city and a radius arrive through named paths
 * (the location button, the dossier's own enum) whose keys always match a registry
 * mapping exactly, so they never reach this fallback.
 */
const CATEGORY_DEFAULT_FIELD: Partial<Record<PreferenceCategory, string>> = {
  hobbies: 'hobbies',
  music: 'music_genre',
  travel: 'travel_destination',
  love_language: 'love_language',
};

/** Build the lookup map from registry mappings, keys normalized. */
function buildLookupMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of PROFILE_FIELD_REGISTRY) {
    for (const mapping of field.mappings) {
      map.set(`${mapping.category}:${normalizeKey(mapping.key)}`, field.id);
    }
  }
  return map;
}

/** Get or create the lookup map */
function getLookupMap(): Map<string, string> {
  if (!lookupMap) {
    lookupMap = buildLookupMap();
  }
  return lookupMap;
}

/**
 * Last-resort match: does the key's token set cover a registry mapping?
 *
 * Catches wordier phrasings of a mapping that is already present — "favourite
 * cuisine type" against `favorite cuisine` — without inventing matches, since
 * every token of the mapping must appear in the key. Restricted to multi-token
 * mappings: single generic tokens ("style", "name") are handled by the synonym
 * layer, and matching them loosely here would pull unrelated keys in.
 */
function resolveByTokenSubset(category: PreferenceCategory, normalized: string): string | null {
  const keyTokens = new Set(normalized.split(' ').filter(Boolean));
  if (keyTokens.size === 0) return null;

  for (const field of PROFILE_FIELD_REGISTRY) {
    for (const mapping of field.mappings) {
      if (mapping.category !== category) continue;
      const mappingTokens = normalizeKey(mapping.key).split(' ').filter(Boolean);
      if (mappingTokens.length < 2) continue;
      if (mappingTokens.every((token) => keyTokens.has(token))) {
        return field.id;
      }
    }
  }
  return null;
}

/**
 * Resolve a canonical field id supplied directly by extraction.
 *
 * The preferred route. Returns null for anything outside the canonical set, so a
 * stale or hallucinated id falls through to key resolution rather than creating
 * a phantom field.
 */
export function resolveByFieldId(fieldId: string | null | undefined): string | null {
  if (!fieldId) return null;
  const trimmed = fieldId.trim();
  return isProfileFieldId(trimmed) ? trimmed : null;
}

/**
 * Resolve a preference category+key to a profile field identifier.
 * Returns null if the key names no profile field.
 */
export function resolveField(category: PreferenceCategory, key: string): string | null {
  if (!key) return null;
  const normalized = normalizeKey(key);
  if (!normalized) return null;

  // A key that is already a canonical field id (extraction now sets key = field
  // id when it identifies one) resolves without consulting the table at all.
  const asFieldId = resolveByFieldId(key.trim());
  if (asFieldId) return asFieldId;

  // 1. exact match on the normalized key, scoped to the category
  const exact = getLookupMap().get(`${category}:${normalized}`);
  if (exact) return exact;

  // 2. synonyms. A `null` entry is an intentional non-field, and is returned as
  //    null without falling through to the fuzzy layer.
  if (Object.prototype.hasOwnProperty.call(KEY_SYNONYMS, normalized)) {
    return KEY_SYNONYMS[normalized] ?? null;
  }

  // 3. token-subset match against the registry
  const bySubset = resolveByTokenSubset(category, normalized);
  if (bySubset) return bySubset;

  // 4. single-field categories: the category alone identifies the field.
  return CATEGORY_DEFAULT_FIELD[category] ?? null;
}

/**
 * True when a key is known to name something other than a profile field.
 *
 * Lets the ingestion hook stay quiet about allergies and pronouns while still
 * warning loudly about a genuinely unresolvable discovery.
 */
export function isIntentionalNonField(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    Object.prototype.hasOwnProperty.call(KEY_SYNONYMS, normalized) &&
    KEY_SYNONYMS[normalized] === null
  );
}

/**
 * Reset the lookup map (useful for testing when registry changes).
 */
export function resetMapper(): void {
  lookupMap = null;
}
