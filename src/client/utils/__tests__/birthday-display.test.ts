import { describe, it, expect } from 'vitest';
import { formatBirthdayValue, isFullBirthday } from '../birthday-display';

/*
 * Screenshot-found. A live run put `age_turning = "32"` into the `birthday` field —
 * deliberately, so the two halves of "she's turning 32 in June" can be merged — and
 * the rail rendered "1 January 2032", because `new Date('32')` is a *valid* Date and
 * the isNaN guard let it through. Fabricated data presented as fact is worse than
 * an absent field, which is what these tests exist to prevent.
 */
describe('isFullBirthday', () => {
  it('accepts a value carrying day, month and year', () => {
    expect(isFullBirthday('1988-06-17')).toBe(true);
    expect(isFullBirthday('17 June 1988')).toBe(true);
    expect(isFullBirthday('June 17, 1988')).toBe(true);
  });

  it('rejects a bare age, which Date reads as a year', () => {
    // The bug itself: new Date('32') -> 1 January 2032.
    expect(isFullBirthday('32')).toBe(false);
  });

  it('rejects a bare year, which Date silently gives a day and a month', () => {
    expect(isFullBirthday('1988')).toBe(false);
    expect(isFullBirthday('2032')).toBe(false);
  });

  it('rejects a month and year with no day', () => {
    // new Date('June 1988') is valid and means the 1st — a day nobody supplied.
    expect(isFullBirthday('June 1988')).toBe(false);
  });

  it('rejects a month with no year', () => {
    expect(isFullBirthday('June')).toBe(false);
  });

  it('rejects the merged partial fact', () => {
    expect(isFullBirthday('June (32)')).toBe(false);
  });

  it('accepts a genuine first of the month', () => {
    // Day 1 is ambiguous with Date's default, so it needs the digit present.
    expect(isFullBirthday('1988-06-01')).toBe(true);
    expect(isFullBirthday('1 June 1988')).toBe(true);
  });
});

describe('formatBirthdayValue', () => {
  it('formats a full date the way the mockup says it', () => {
    expect(formatBirthdayValue('1988-06-17')).toBe('17 June 1988');
  });

  it('hands back a partial value verbatim rather than inventing a date', () => {
    expect(formatBirthdayValue('June (32)')).toBe('June (32)');
    expect(formatBirthdayValue('June')).toBe('June');
  });

  it('never renders an age as a calendar date', () => {
    // The exact regression: this must not become "1 January 2032".
    expect(formatBirthdayValue('32')).toBe('32');
    expect(formatBirthdayValue('32')).not.toMatch(/2032/);
  });

  it('returns null for nothing at all', () => {
    expect(formatBirthdayValue(null)).toBeNull();
    expect(formatBirthdayValue(undefined)).toBeNull();
    expect(formatBirthdayValue('   ')).toBeNull();
  });
});
