import { describe, expect, it } from 'vitest';
import { atLocalMidnight, hasFullDate, parseStoredDate } from '../stored-date';

describe('parseStoredDate — the shapes we store', () => {
  it('reads an ISO date', () => {
    expect(parseStoredDate('1990-06-17')).toEqual({ year: 1990, month: 5, day: 17 });
  });

  it('reads an ISO date with a time part hanging off it', () => {
    expect(parseStoredDate('1990-06-17T00:00:00.000Z')).toEqual({
      year: 1990,
      month: 5,
      day: 17,
    });
  });

  it('reads month-first prose, with and without a year', () => {
    expect(parseStoredDate('March 14')).toEqual({ year: null, month: 2, day: 14 });
    expect(parseStoredDate('March 14, 1990')).toEqual({ year: 1990, month: 2, day: 14 });
    expect(parseStoredDate('Mar 14')).toEqual({ year: null, month: 2, day: 14 });
  });

  it('reads day-first prose, with and without a year', () => {
    expect(parseStoredDate('2 October')).toEqual({ year: null, month: 9, day: 2 });
    expect(parseStoredDate('17 June 1988')).toEqual({ year: 1988, month: 5, day: 17 });
  });

  it('tolerates ordinal suffixes and stray whitespace', () => {
    expect(parseStoredDate('  14th March  ')).toEqual({ year: null, month: 2, day: 14 });
    expect(parseStoredDate('June 1st, 1988')).toEqual({ year: 1988, month: 5, day: 1 });
  });

  it('accepts "Sept", the abbreviation people write with four letters', () => {
    expect(parseStoredDate('Sept 18')).toEqual({ year: null, month: 8, day: 18 });
  });
});

/*
 * Each of these used to render as a confident date somewhere in the rail. They are
 * the whole reason this module exists, so they are asserted individually rather
 * than in a loop — a failure should name the value that regressed.
 */
describe('parseStoredDate — what it refuses to guess', () => {
  it('refuses a bare age, which `new Date` read as a year', () => {
    // new Date('32') -> 1 January 2032, and every isNaN guard let it through.
    expect(parseStoredDate('32')).toBeNull();
  });

  it('refuses a bare year, which `new Date` gave a day and a month', () => {
    expect(parseStoredDate('1988')).toBeNull();
  });

  it('refuses a month with no day, which `new Date` read as the 1st', () => {
    expect(parseStoredDate('June 1988')).toBeNull();
    expect(parseStoredDate('June')).toBeNull();
  });

  it('refuses prose it cannot read', () => {
    expect(parseStoredDate('next Friday')).toBeNull();
    expect(parseStoredDate('sometime in the spring')).toBeNull();
  });

  it('refuses empty and absent values', () => {
    expect(parseStoredDate('')).toBeNull();
    expect(parseStoredDate('   ')).toBeNull();
    expect(parseStoredDate(null)).toBeNull();
    expect(parseStoredDate(undefined)).toBeNull();
  });

  it('refuses a day the month does not have', () => {
    expect(parseStoredDate('31 February')).toBeNull();
    expect(parseStoredDate('2023-02-30')).toBeNull();
    expect(parseStoredDate('April 31')).toBeNull();
  });

  it('allows 29 February without a year, and rejects it in a common year', () => {
    // "her birthday is 29 February" is a real thing to say; rejecting it would
    // lose the fact rather than record it partially.
    expect(parseStoredDate('29 February')).toEqual({ year: null, month: 1, day: 29 });
    expect(parseStoredDate('2024-02-29')).toEqual({ year: 2024, month: 1, day: 29 });
    expect(parseStoredDate('2023-02-29')).toBeNull();
  });
});

describe('hasFullDate', () => {
  it('is true only when a year came with the day and month', () => {
    expect(hasFullDate('1990-06-17')).toBe(true);
    expect(hasFullDate('17 June 1988')).toBe(true);
    expect(hasFullDate('March 14')).toBe(false);
    expect(hasFullDate('1988')).toBe(false);
    expect(hasFullDate(null)).toBe(false);
  });
});

describe('atLocalMidnight', () => {
  it('builds a local-midnight date in the year it is given', () => {
    const parts = parseStoredDate('March 14')!;
    const date = atLocalMidnight(parts, 2027);

    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(14);
    expect(date.getHours()).toBe(0);
  });

  it('is local, not UTC — the bug that split one March into the 13th and the 15th', () => {
    const date = atLocalMidnight({ year: null, month: 2, day: 14 }, 2027);
    // Read back with the same local getters it was built with, the day is stable
    // whichever side of Greenwich the test runs on.
    expect(date.getDate()).toBe(14);
  });
});
