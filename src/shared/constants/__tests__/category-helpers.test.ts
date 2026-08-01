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
  // Assert the concrete count rather than PREFERENCE_CATEGORIES.length. The
  // implementation returns that length, so comparing against it restates the
  // implementation and would keep passing if a category were accidentally added
  // or dropped. Pinning 8 makes such a change fail here deliberately, and 8 is
  // the number documented in the README.
  it('reports the eight documented categories', () => {
    expect(preferenceCategoryCount()).toBe(8);
  });

  it('stays in sync with the category constant', () => {
    expect(preferenceCategoryCount()).toBe(PREFERENCE_CATEGORIES.length);
  });

  it('returns a positive integer', () => {
    const count = preferenceCategoryCount();
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });
});
