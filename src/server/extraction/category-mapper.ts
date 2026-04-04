import type { PreferenceCategory } from '../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';

/** Map a raw category string from extraction output to a valid PreferenceCategory.
 *  Returns null for unknown categories (caller should skip). */
export function mapCategory(raw: string): PreferenceCategory | null {
  const normalized = raw.trim().toLowerCase();

  if ((PREFERENCE_CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as PreferenceCategory;
  }

  // Common aliases
  const aliases: Record<string, PreferenceCategory> = {
    food_and_drink: 'food',
    cuisine: 'food',
    dining: 'food',
    hobby: 'hobbies',
    activity: 'hobbies',
    activities: 'hobbies',
    sport: 'hobbies',
    sports: 'hobbies',
    songs: 'music',
    artist: 'music',
    artists: 'music',
    destination: 'travel',
    destinations: 'travel',
    vacation: 'travel',
    gift: 'gifts',
    present: 'gifts',
    presents: 'gifts',
    love_languages: 'love_language',
    lovelanguage: 'love_language',
    dates: 'important_dates',
    anniversary: 'important_dates',
    birthday: 'important_dates',
    personality: 'personality_traits',
    traits: 'personality_traits',
    trait: 'personality_traits',
  };

  const mapped = aliases[normalized];
  if (mapped) {
    return mapped;
  }

  // Unknown category — caller should skip
  console.warn(`[category-mapper] Unknown category: "${raw}" — skipping`);
  return null;
}
