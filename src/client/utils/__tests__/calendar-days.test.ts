import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, midnight } from '../calendar-days';

describe('midnight', () => {
  it('strips the clock time and keeps the calendar day', () => {
    const stripped = midnight(new Date(2026, 7, 29, 20, 16, 43));
    expect(stripped.getFullYear()).toBe(2026);
    expect(stripped.getMonth()).toBe(7);
    expect(stripped.getDate()).toBe(29);
    expect(stripped.getHours()).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween(new Date(2026, 7, 29), new Date(2026, 7, 30))).toBe(1);
    expect(daysBetween(new Date(2026, 7, 29), new Date(2026, 8, 29))).toBe(31);
  });

  it('is zero on the same day regardless of the clock', () => {
    expect(daysBetween(new Date(2026, 7, 29, 23, 59), new Date(2026, 7, 29, 0, 1))).toBe(0);
  });

  it('goes negative once the target is behind', () => {
    expect(daysBetween(new Date(2026, 7, 29), new Date(2026, 7, 22))).toBe(-7);
  });

  /*
   * The regression this module was extracted for.
   *
   * 29 August 2026 to 14 March 2027 is 197 calendar days, and a DST boundary falls
   * between them — so the elapsed milliseconds are 197 days plus an hour. The old
   * `Math.ceil` turned that hour into a 198th day, which `NextUp` then rendered as
   * "Monday 15 March" for a Sunday birthday.
   */
  it('absorbs a daylight-saving hour instead of rounding it up to a day', () => {
    expect(daysBetween(new Date(2026, 7, 29), new Date(2027, 2, 14))).toBe(197);
  });

  it('counts across a DST boundary in both directions', () => {
    // Whatever the local zone does in these windows, a span and its reverse must
    // agree in magnitude — an asymmetry is the stray-hour bug returning.
    const from = new Date(2026, 9, 1);
    const to = new Date(2027, 3, 1);
    expect(daysBetween(from, to)).toBe(-daysBetween(to, from));
  });
});

describe('addDays', () => {
  it('adds days at local midnight without mutating the input', () => {
    const start = new Date(2026, 7, 29, 14, 30);
    const later = addDays(start, 3);

    expect(later.getDate()).toBe(1);
    expect(later.getMonth()).toBe(8);
    expect(later.getHours()).toBe(0);
    expect(start.getDate()).toBe(29);
  });

  it('round-trips with daysBetween across a DST boundary', () => {
    const start = new Date(2026, 7, 29);
    expect(daysBetween(start, addDays(start, 197))).toBe(197);
  });
});
