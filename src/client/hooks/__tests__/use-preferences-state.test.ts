import { describe, it, expect } from 'vitest';
import { preferencesReducer, type PreferencesState } from '../use-preferences-state';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';

/**
 * `MERGE_PREFERENCE`, which exists because the other two actions cannot do this.
 *
 * The store keys a preference on `(sessionId, category, key)` but stamps a fresh
 * uuid on every write, so the same fact saved twice comes back with two different
 * ids. That is the case these tests pin: one fact, one row, whatever the id says.
 */

function emptyState(): PreferencesState {
  const preferences = {} as PreferencesState['preferences'];
  for (const category of PREFERENCE_CATEGORIES) preferences[category] = [];
  return { preferences, recentlyUpdated: new Set(), discovered: new Set() };
}

function row(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-1',
    category: 'travel',
    key: 'home city',
    fieldId: 'home_city',
    value: "Ra'anana",
    confidence: 1,
    sourceMessageId: 'location-consent',
    createdAt: '2026-09-03T09:00:00.000Z',
    updatedAt: '2026-09-03T09:00:00.000Z',
    history: [],
    ...overrides,
  };
}

describe('MERGE_PREFERENCE', () => {
  it('adds a fact that is not there yet', () => {
    const next = preferencesReducer(emptyState(), {
      type: 'MERGE_PREFERENCE',
      preference: row(),
    });

    expect(next.preferences.travel).toHaveLength(1);
    expect(next.preferences.travel[0].value).toBe("Ra'anana");
  });

  it('replaces the same fact rather than listing it twice, even with a new id', () => {
    const first = preferencesReducer(emptyState(), {
      type: 'MERGE_PREFERENCE',
      preference: row(),
    });

    const second = preferencesReducer(first, {
      type: 'MERGE_PREFERENCE',
      // A second save of the same city: same (category, key), different id. This
      // is exactly what the store returns, and what `UPDATE_PREFERENCE` misses.
      preference: row({ id: 'pref-2', value: 'Haifa' }),
    });

    expect(second.preferences.travel).toHaveLength(1);
    expect(second.preferences.travel[0].id).toBe('pref-2');
    expect(second.preferences.travel[0].value).toBe('Haifa');
  });

  it('leaves a different fact in the same category alone', () => {
    const withOther = preferencesReducer(emptyState(), {
      type: 'MERGE_PREFERENCE',
      preference: row({ id: 'pref-9', key: 'search radius', value: '10 km' }),
    });

    const next = preferencesReducer(withOther, {
      type: 'MERGE_PREFERENCE',
      preference: row(),
    });

    expect(next.preferences.travel.map((p) => p.key).sort()).toEqual([
      'home city',
      'search radius',
    ]);
  });

  it('highlights the row but does not announce it as a discovery', () => {
    const next = preferencesReducer(emptyState(), {
      type: 'MERGE_PREFERENCE',
      preference: row(),
    });

    expect(next.recentlyUpdated.has('pref-1')).toBe(true);
    // The user typed this themselves a moment ago — "✓ noted" would be telling
    // them what they just said.
    expect(next.discovered.size).toBe(0);
  });
});
