import { describe, it, expect } from 'vitest';
import {
  deriveOccasions,
  getNextOccasion,
  getNextOccurrenceDate,
  getDaysUntilOccasion,
  occasionFallsOnDay,
} from '../occasion-derivation';
import { daysBetween } from '../calendar-days';
import type { ProfileFieldDefinition } from '../profile-field-registry';

const birthdayField: ProfileFieldDefinition = {
  id: 'birthday',
  label: 'Birthday',
  valueType: 'date',
  section: 'basics',
  mappings: [{ category: 'important_dates', key: 'birthday' }],
};

const anniversaryField: ProfileFieldDefinition = {
  id: 'anniversary',
  label: 'Anniversary',
  valueType: 'date',
  section: 'relationship',
  mappings: [{ category: 'important_dates', key: 'anniversary' }],
};

describe('deriveOccasions', () => {
  it('derives an occasion from a date field with a value', () => {
    const occasions = deriveOccasions(
      [birthdayField],
      { birthday: { value: '1990-06-15' } },
    );
    expect(occasions).toHaveLength(1);
    expect(occasions[0].fieldId).toBe('birthday');
    expect(occasions[0].label).toBe('Birthday');
    expect(occasions[0].recurrence).toBe('annual');
  });

  it('derives occasions from multiple fields', () => {
    const occasions = deriveOccasions(
      [birthdayField, anniversaryField],
      {
        birthday: { value: '1990-06-15' },
        anniversary: { value: '2015-09-20' },
      },
    );
    expect(occasions).toHaveLength(2);
  });

  it('skips fields with no value', () => {
    const occasions = deriveOccasions(
      [birthdayField, anniversaryField],
      { birthday: { value: '1990-06-15' } },
    );
    expect(occasions).toHaveLength(1);
  });

  it('skips fields with empty value', () => {
    const occasions = deriveOccasions(
      [birthdayField],
      { birthday: { value: '' } },
    );
    expect(occasions).toHaveLength(0);
  });

  it('skips fields with invalid date value', () => {
    const occasions = deriveOccasions(
      [birthdayField],
      { birthday: { value: 'not-a-date' } },
    );
    expect(occasions).toHaveLength(0);
  });

  it('marks birthday as annual recurrence', () => {
    const occasions = deriveOccasions(
      [birthdayField],
      { birthday: { value: '1990-03-01' } },
    );
    expect(occasions[0].recurrence).toBe('annual');
  });

  it('marks anniversary as annual recurrence', () => {
    const occasions = deriveOccasions(
      [anniversaryField],
      { anniversary: { value: '2015-09-20' } },
    );
    expect(occasions[0].recurrence).toBe('annual');
  });
});

describe('getNextOccasion', () => {
  it('returns null for empty occasions list', () => {
    expect(getNextOccasion([])).toBeNull();
  });

  it('returns the closest upcoming occasion', () => {
    // Reference date: 2024-03-01
    const refDate = new Date(2024, 2, 1);

    const occasions = deriveOccasions(
      [birthdayField, anniversaryField],
      {
        birthday: { value: '1990-06-15' }, // June 15 -> 106 days away
        anniversary: { value: '2015-03-10' }, // March 10 -> 9 days away
      },
    );

    const next = getNextOccasion(occasions, refDate);
    expect(next).not.toBeNull();
    expect(next!.fieldId).toBe('anniversary');
  });

  it('returns occasion happening today if daysUntil is 0', () => {
    const refDate = new Date(2024, 5, 15); // June 15
    const occasions = deriveOccasions(
      [birthdayField],
      { birthday: { value: '1990-06-15' } },
    );

    const next = getNextOccasion(occasions, refDate);
    expect(next).not.toBeNull();
    expect(next!.fieldId).toBe('birthday');
  });
});

describe('getDaysUntilOccasion', () => {
  it('calculates days for annual occasion in same year', () => {
    const refDate = new Date(2024, 0, 1); // Jan 1
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15), // June 15
      recurrence: 'annual' as const,
    };
    const days = getDaysUntilOccasion(occasion, refDate);
    // Jan 1 to Jun 15 = 166 days (2024 is leap year)
    expect(days).toBe(166);
  });

  it('wraps to next year for annual occasion that already passed', () => {
    const refDate = new Date(2024, 6, 1); // July 1
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15), // June 15
      recurrence: 'annual' as const,
    };
    const days = getDaysUntilOccasion(occasion, refDate);
    // July 1 to next June 15 = 349 days
    expect(days).toBe(349);
  });

  it('returns 0 for annual occasion on the same day', () => {
    const refDate = new Date(2024, 5, 15); // June 15
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15),
      recurrence: 'annual' as const,
    };
    const days = getDaysUntilOccasion(occasion, refDate);
    expect(days).toBe(0);
  });

  it('calculates negative days for one-time occasion in the past', () => {
    const refDate = new Date(2024, 6, 1); // July 1, 2024
    const occasion = {
      fieldId: 'event',
      label: 'Event',
      date: new Date(2024, 0, 1), // Jan 1, 2024
      recurrence: 'one-time' as const,
    };
    const days = getDaysUntilOccasion(occasion, refDate);
    expect(days).toBeLessThan(0);
  });
});

describe('occasionFallsOnDay', () => {
  it('returns true for annual occasion matching month and day', () => {
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15),
      recurrence: 'annual' as const,
    };
    expect(occasionFallsOnDay(occasion, 2024, 5, 15)).toBe(true);
  });

  it('returns true for annual occasion regardless of year', () => {
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15),
      recurrence: 'annual' as const,
    };
    expect(occasionFallsOnDay(occasion, 2030, 5, 15)).toBe(true);
  });

  it('returns false for annual occasion on wrong day', () => {
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15),
      recurrence: 'annual' as const,
    };
    expect(occasionFallsOnDay(occasion, 2024, 5, 16)).toBe(false);
  });

  it('returns false for annual occasion on wrong month', () => {
    const occasion = {
      fieldId: 'birthday',
      label: 'Birthday',
      date: new Date(1990, 5, 15),
      recurrence: 'annual' as const,
    };
    expect(occasionFallsOnDay(occasion, 2024, 4, 15)).toBe(false);
  });

  it('returns true for one-time occasion matching exact date', () => {
    const occasion = {
      fieldId: 'event',
      label: 'Event',
      date: new Date(2024, 11, 25),
      recurrence: 'one-time' as const,
    };
    expect(occasionFallsOnDay(occasion, 2024, 11, 25)).toBe(true);
  });

  it('returns false for one-time occasion on different year', () => {
    const occasion = {
      fieldId: 'event',
      label: 'Event',
      date: new Date(2024, 11, 25),
      recurrence: 'one-time' as const,
    };
    expect(occasionFallsOnDay(occasion, 2025, 11, 25)).toBe(false);
  });
});

/*
 * The bug this whole family was fixed for.
 *
 * A stored birthday of "March 14" rendered three ways at once in August 2026:
 * "March 14" in the header, "Monday 15 March / 198 days" in `NextUp`, and
 * "13 Mar / 196d" in `PinnedEveryYear`. 14 March 2027 is a **Sunday**, 197 days
 * after 29 August 2026.
 *
 * The reference date is fixed so the assertion is a date, not a shape — and 29
 * August was chosen because the span to the following March crosses a
 * daylight-saving boundary, which is what the old `Math.ceil` rounded into an
 * extra day.
 */
describe('a year-less birthday, agreed across every surface', () => {
  const REFERENCE = new Date(2026, 7, 29); // Saturday 29 August 2026

  const occasionsFor = (value: string) =>
    deriveOccasions([birthdayField], { birthday: { value } });

  it('derives one occasion from a value with no year', () => {
    expect(occasionsFor('March 14')).toHaveLength(1);
  });

  it('counts 197 days, not 198 — the daylight-saving hour is not a day', () => {
    const [occasion] = occasionsFor('March 14');
    expect(getDaysUntilOccasion(occasion, REFERENCE)).toBe(197);
  });

  it('lands on the 14th, and on a Sunday', () => {
    const [occasion] = occasionsFor('March 14');
    const next = getNextOccurrenceDate(occasion, REFERENCE);

    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(2);
    expect(next.getDate()).toBe(14);
    expect(next.getDay()).toBe(0); // Sunday
  });

  it('agrees whichever way the user wrote it', () => {
    for (const written of ['March 14', '14 March', 'Mar 14', '14th March']) {
      const [occasion] = occasionsFor(written);
      expect(getNextOccurrenceDate(occasion, REFERENCE).getDate()).toBe(14);
      expect(getDaysUntilOccasion(occasion, REFERENCE)).toBe(197);
    }
  });

  /*
   * The invariant that makes the family safe. The count and the date used to be
   * computed independently — the date by adding the count back onto today — so
   * they could not disagree without one of them being wrong. Now the date is
   * primary; assert the round trip.
   */
  it('keeps the count and the date in step', () => {
    const [occasion] = occasionsFor('March 14');
    const days = getDaysUntilOccasion(occasion, REFERENCE);
    const next = getNextOccurrenceDate(occasion, REFERENCE);

    expect(daysBetween(REFERENCE, next)).toBe(days);
  });
});

describe('deriveOccasions refuses what it cannot read', () => {
  it('drops a value that carries no day', () => {
    expect(deriveOccasions([birthdayField], { birthday: { value: 'June 1988' } })).toEqual([]);
    expect(deriveOccasions([birthdayField], { birthday: { value: 'June' } })).toEqual([]);
  });

  it('drops a bare age, which `new Date` used to read as a year', () => {
    expect(deriveOccasions([birthdayField], { birthday: { value: '32' } })).toEqual([]);
  });

  it('drops prose it cannot parse', () => {
    expect(deriveOccasions([birthdayField], { birthday: { value: 'next spring' } })).toEqual([]);
  });
});
