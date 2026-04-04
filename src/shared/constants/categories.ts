import type { PreferenceCategory } from '../interfaces/preference';

/** All defined preference categories */
export const PREFERENCE_CATEGORIES: readonly PreferenceCategory[] = [
  'food',
  'hobbies',
  'music',
  'travel',
  'gifts',
  'love_language',
  'important_dates',
  'personality_traits',
] as const;

interface CategoryMeta {
  label: string;
  description: string;
}

/** Display labels and descriptions for each preference category */
export const CATEGORY_LABELS: Record<PreferenceCategory, CategoryMeta> = {
  food: {
    label: 'Food',
    description: 'Dietary preferences, favorite cuisines, restaurants',
  },
  hobbies: {
    label: 'Hobbies',
    description: 'Activities, sports, creative pursuits',
  },
  music: {
    label: 'Music',
    description: 'Genres, artists, concert preferences',
  },
  travel: {
    label: 'Travel',
    description: 'Destinations, travel style, bucket list',
  },
  gifts: {
    label: 'Gifts',
    description: 'Gift preferences, wish list items, price range',
  },
  love_language: {
    label: 'Love Language',
    description: 'How they express and receive love',
  },
  important_dates: {
    label: 'Important Dates',
    description: 'Birthdays, anniversaries, milestones',
  },
  personality_traits: {
    label: 'Personality Traits',
    description: 'Temperament, social style, values',
  },
};
