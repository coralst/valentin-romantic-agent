import { describe, it, expect } from 'vitest';
import {
  isPreferenceCategory,
  getCategoryLabel,
  preferenceCategoryCount,
} from '../category-helpers';
import { PREFERENCE_CATEGORIES } from '../categories';

describe('isPreferenceCategory', () => {
  it('returns true for every known category', () => {
    for (const category of PREFERENCE_CATEGORIES) {
      expect(isPreferenceCategory(category)).toBe(true);
    }
  });

  it('returns false for an unknown string', () => {
    expect(isPreferenceCategory('weather')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPreferenceCategory('')).toBe(false);
  });
});

describe('getCategoryLabel', () => {
  it('returns the display label for a known category', () => {
    expect(getCategoryLabel('food')).toBe('Food');
    expect(getCategoryLabel('love_language')).toBe('Love Language');
  });

  it('returns undefined for an unknown category', () => {
    expect(getCategoryLabel('weather')).toBeUndefined();
  });
});

describe('preferenceCategoryCount', () => {
  it('matches the length of the category constant', () => {
    expect(preferenceCategoryCount()).toBe(PREFERENCE_CATEGORIES.length);
  });

  it('returns a positive integer', () => {
    const count = preferenceCategoryCount();
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });
});
