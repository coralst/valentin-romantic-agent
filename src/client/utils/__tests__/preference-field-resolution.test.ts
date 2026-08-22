import { describe, it, expect, beforeEach } from 'vitest';
import {
  isIntentionalNonField,
  normalizeKey,
  resolveByFieldId,
  resolveField,
  resetMapper,
} from '../preference-field-mapper';
import {
  LIVE_EXTRACTION_ROWS,
  REALISTIC_KEY_VARIANTS,
  type LiveExtractionRow,
} from './live-extraction-fixture';
import { PROFILE_FIELD_IDS } from '../../../shared/constants/profile-fields';

/**
 * The regression suite for the bug where the entire brief rail stayed at
 * "0 OF 18 KNOWN" during a real conversation.
 *
 * Deliberately does NOT use `DEMO_PROFILE_PREFERENCES`. That fixture's keys were
 * authored to match the registry verbatim, so a test built on it passes whether
 * or not resolution works on real input — which is precisely how the original bug
 * survived a fully green suite. Everything here is driven by
 * `live-extraction-fixture.ts`, captured from real Bedrock output.
 */
describe('field resolution against real extraction output', () => {
  beforeEach(() => {
    resetMapper();
  });

  const resolvable = (rows: readonly LiveExtractionRow[]) =>
    rows.filter((r) => r.expectedFieldId !== null);

  describe('captured live Bedrock keys', () => {
    it.each(resolvable(LIVE_EXTRACTION_ROWS))(
      'resolves $category:$key -> $expectedFieldId',
      ({ category, key, expectedFieldId }) => {
        expect(resolveField(category, key)).toBe(expectedFieldId);
      },
    );

    it('resolves EVERY resolvable live row — none may silently drop', () => {
      const dropped = resolvable(LIVE_EXTRACTION_ROWS).filter(
        (row) => resolveField(row.category, row.key) === null,
      );
      expect(dropped).toEqual([]);
    });

    it('leaves off-registry facts unresolved but marked intentional', () => {
      const offRegistry = LIVE_EXTRACTION_ROWS.filter((r) => r.expectedFieldId === null);
      expect(offRegistry.length).toBeGreaterThan(0);
      for (const row of offRegistry) {
        expect(resolveField(row.category, row.key)).toBeNull();
      }
    });
  });

  describe('realistic key shape variants', () => {
    it.each(REALISTIC_KEY_VARIANTS)(
      'resolves $category:$key -> $expectedFieldId',
      ({ category, key, expectedFieldId }) => {
        expect(resolveField(category, key)).toBe(expectedFieldId);
      },
    );
  });

  describe('the specific keys from the reported bug', () => {
    // The live run emitted chips reading Samantha, she/her, 32, June. The first
    // three of these resolved to null before the fix, so the rail never moved.
    it('routes a birth month to birthday', () => {
      expect(resolveField('important_dates', 'birthday_month')).toBe('birthday');
      expect(resolveField('important_dates', 'birth_month')).toBe('birthday');
    });

    it('routes an age to birthday rather than dropping it', () => {
      expect(resolveField('important_dates', 'age')).toBe('birthday');
      expect(resolveField('important_dates', 'age_turning')).toBe('birthday');
    });

    it('routes a snake_case partner name to partner_name', () => {
      expect(resolveField('personality_traits', 'partner_name')).toBe('partner_name');
    });

    it('routes the tool description’s own example key', () => {
      // `favorite_cuisine` is the example in EXTRACT_PREFERENCES_TOOL's own
      // description, and it resolved to null before the fix.
      expect(resolveField('food', 'favorite_cuisine')).toBe('favorite_cuisine');
    });
  });

  describe('resolveByFieldId', () => {
    it.each([...PROFILE_FIELD_IDS])('accepts the canonical id %s', (id) => {
      expect(resolveByFieldId(id)).toBe(id);
    });

    it('trims surrounding whitespace', () => {
      expect(resolveByFieldId('  birthday  ')).toBe('birthday');
    });

    it('rejects an id outside the canonical set', () => {
      expect(resolveByFieldId('made_up_field')).toBeNull();
      expect(resolveByFieldId('')).toBeNull();
      expect(resolveByFieldId(null)).toBeNull();
      expect(resolveByFieldId(undefined)).toBeNull();
    });
  });

  describe('a key that is already a canonical field id', () => {
    // Extraction now sets key = field id when it identifies one, so this is the
    // hot path in production.
    it.each([...PROFILE_FIELD_IDS])('resolves %s regardless of category', (id) => {
      expect(resolveField('personality_traits', id)).toBe(id);
      expect(resolveField('gifts', id)).toBe(id);
    });
  });

  describe('normalizeKey', () => {
    it('collapses separators and casing to one form', () => {
      const forms = ['birth_month', 'Birth Month', 'birth-month', '  birth   month  ', 'BIRTH_MONTH'];
      const normalized = new Set(forms.map(normalizeKey));
      expect(normalized.size).toBe(1);
      expect([...normalized][0]).toBe('birth month');
    });

    it('strips punctuation', () => {
      expect(normalizeKey("her name?")).toBe('her name');
      expect(normalizeKey('birthday:')).toBe('birthday');
    });

    it('singularizes conservatively', () => {
      expect(normalizeKey('hobbies')).toBe('hobby');
      expect(normalizeKey('interests')).toBe('interest');
      // Must NOT mangle these.
      expect(normalizeKey('dress')).toBe('dress');
      expect(normalizeKey('status')).toBe('status');
    });

    it('returns empty string for a key with no usable characters', () => {
      expect(normalizeKey('   ')).toBe('');
      expect(normalizeKey('!!!')).toBe('');
    });
  });

  describe('isIntentionalNonField', () => {
    it('is true for constraint keys consumed by KeepInMind', () => {
      expect(isIntentionalNonField('allergies')).toBe(true);
      expect(isIntentionalNonField('shellfish_allergy')).toBe(true);
      expect(isIntentionalNonField('pronouns')).toBe(true);
    });

    it('is false for a key that genuinely names nothing', () => {
      expect(isIntentionalNonField('favourite_sandwich_filling')).toBe(false);
    });
  });

  describe('robustness', () => {
    it('never throws on degenerate input', () => {
      expect(resolveField('food', '')).toBeNull();
      expect(resolveField('food', '   ')).toBeNull();
      expect(resolveField('food', '???')).toBeNull();
    });

    it('does not invent a match in a multi-field category', () => {
      // `personality_traits`, `important_dates`, `gifts` and `food` each span
      // several fields, so an unrecognised key there must stay unresolved rather
      // than be guessed into the wrong one.
      expect(resolveField('personality_traits', 'favourite sandwich filling')).toBeNull();
      expect(resolveField('important_dates', 'favourite sandwich filling')).toBeNull();
      expect(resolveField('gifts', 'favourite sandwich filling')).toBeNull();
    });

    it('falls back to the category default only in single-field categories', () => {
      // A deliberate trade. A `hobbies` preference is a hobby whatever the key
      // says — extraction routinely puts the value in the key
      // (`hobbies:loves_salsa_dancing`), and no synonym table can enumerate
      // those. Dropping them is worse than routing them by category.
      expect(resolveField('hobbies', 'loves_salsa_dancing')).toBe('hobbies');
      expect(resolveField('music', 'listens_to_a_lot_of_bachata')).toBe('music_genre');
      expect(resolveField('travel', 'wants_to_see_the_azores')).toBe('travel_destination');

      // `food` is excluded on purpose: a food preference may be a cuisine or an
      // allergy, and routing an allergy into `favorite_cuisine` would be wrong.
      expect(resolveField('food', 'badly_allergic_to_shellfish')).toBeNull();
    });

    it('is stable across repeated calls', () => {
      const a = resolveField('important_dates', 'birthday_month');
      const b = resolveField('important_dates', 'birthday_month');
      expect(a).toBe(b);
      expect(a).toBe('birthday');
    });
  });
});
