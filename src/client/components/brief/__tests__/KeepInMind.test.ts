import { describe, it, expect } from 'vitest';
import { deriveCautions, titleCase, cautionTitle } from '../KeepInMind';
import type { PreferenceWithHistory } from '../../../../shared/interfaces/preference';

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'food',
    key: 'allergies',
    value: 'shellfish',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

const noFields = () => null;

/*
 * `deriveCautions` feeds both the rail's Keep in mind and the dossier's card, and
 * had no test of its own. Both of the bugs below were found by reading a live
 * screenshot, not by the suite.
 */
describe('titleCase', () => {
  it('turns an extracted snake_case key into words', () => {
    // Screenshot-found: the rail read "Shellfish_allergy: ...", showing a database
    // identifier to a person.
    expect(titleCase('shellfish_allergy')).toBe('Shellfish allergy');
    expect(titleCase('things_to_avoid')).toBe('Things to avoid');
    expect(titleCase('things-to-avoid')).toBe('Things to avoid');
  });

  it('leaves an already-clean key alone', () => {
    expect(titleCase('allergies')).toBe('Allergies');
  });

  it('never leaves an underscore on screen', () => {
    expect(titleCase('a_b_c')).not.toMatch(/_/);
  });
});

describe('cautionTitle', () => {
  it('keeps both halves when the key adds information', () => {
    expect(cautionTitle('allergies', 'shellfish')).toBe('Allergies: shellfish');
    expect(cautionTitle('things_to_avoid', 'crowded bars')).toBe('Things to avoid: crowded bars');
  });

  it('drops the key when the value already says it', () => {
    // Screenshot-found: "Shellfish allergy: badly allergic to shellfish" — the same
    // fact twice. Matching is on a stem, so "allergy" finds "allergic".
    expect(cautionTitle('shellfish_allergy', 'badly allergic to shellfish')).toBe(
      'Badly allergic to shellfish',
    );
  });

  it('falls back to the key when there is no value', () => {
    expect(cautionTitle('allergies', '  ')).toBe('Allergies');
  });
});

describe('deriveCautions', () => {
  it('surfaces a preference whose key reads as an avoidance', () => {
    const cautions = deriveCautions(noFields, [preference()]);
    expect(cautions).toHaveLength(1);
    expect(cautions[0].title).toBe('Allergies: shellfish');
    expect(cautions[0].consequence).toBe('Check every menu before you book.');
  });

  it('ignores a preference that is not a constraint', () => {
    expect(deriveCautions(noFields, [preference({ key: 'favorite_cuisine', value: 'Thai' })])).toEqual([]);
  });

  it('keys a caution on category+key so re-extraction does not remount it', () => {
    const [caution] = deriveCautions(noFields, [preference({ id: 'a-server-id-that-changes' })]);
    expect(caution.id).toBe('food:allergies');
  });

  it('reads the surprise_preference registry field as its own caution', () => {
    const getField = (fieldId: string) =>
      fieldId === 'surprise_preference' ? { value: 'Prefers to Choose' } : null;
    const cautions = deriveCautions(getField, []);
    expect(cautions).toHaveLength(1);
    expect(cautions[0].id).toBe('surprise_preference');
  });

  it('never puts a raw snake_case key on screen', () => {
    const cautions = deriveCautions(noFields, [
      preference({ key: 'shellfish_allergy', value: 'badly allergic to shellfish' }),
      preference({ id: 'p2', category: 'personality_traits', key: 'things_to_avoid', value: 'loud bars' }),
    ]);
    expect(cautions).toHaveLength(2);
    for (const caution of cautions) expect(caution.title).not.toMatch(/_/);
  });
});
