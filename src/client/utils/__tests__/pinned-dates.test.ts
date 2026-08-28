import { describe, it, expect } from 'vitest';
import { daysUntilAnnual, derivePinnedDates, nextTuBAv } from '../pinned-dates';

const NOW = new Date(2026, 7, 28, 9, 0, 0);

describe('daysUntilAnnual', () => {
  it('counts to this year’s occurrence when it is still ahead', () => {
    expect(daysUntilAnnual(8, 18, NOW)).toBe(21);
  });

  it('rolls over to next year once it has gone', () => {
    // A date in June read in August means *next* June, not a negative count.
    expect(daysUntilAnnual(5, 12, NOW)).toBeGreaterThan(280);
  });

  it('is zero on the day itself', () => {
    expect(daysUntilAnnual(7, 28, NOW)).toBe(0);
  });
});

describe('nextTuBAv', () => {
  it('finds 15 Av by asking the Hebrew calendar, not by hardcoding a date', () => {
    const date = nextTuBAv(NOW);
    // The platform may ship no Hebrew calendar data on a trimmed ICU build, which
    // is a real possibility and a legitimate null — the row is dropped rather than
    // guessed. Where the data exists, the answer is checked against Intl itself.
    if (!date) return;
    const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', {
      month: 'short',
      day: 'numeric',
    }).formatToParts(date);
    expect(parts.find((part) => part.type === 'day')?.value).toBe('15');
    expect(parts.find((part) => part.type === 'month')?.value).toMatch(/^Av/);
  });

  it('never answers with a date behind the reference day', () => {
    // Searched from a September reference, so this year's Tu B'Av has gone and the
    // second window is the one that has to be found.
    const date = nextTuBAv(new Date(2026, 8, 20));
    if (!date) return;
    expect(date.getTime()).toBeGreaterThanOrEqual(new Date(2026, 8, 20).getTime());
    expect(date.getFullYear()).toBe(2027);
  });
});

describe('derivePinnedDates', () => {
  it('pins the two annuals nobody had to enter', () => {
    const ids = derivePinnedDates(null, NOW).map((date) => date.id);
    expect(ids).toContain('valentines');
    // Tu B'Av only where the platform can place it.
    if (nextTuBAv(NOW)) expect(ids).toContain('tu-bav');
  });

  it('leads with her birthday once it is known', () => {
    const [first] = derivePinnedDates('1994-06-12', NOW);
    expect(first.id).toBe('birthday');
    expect(first.when).toMatch(/^12 Jun/);
    expect(first.daysUntil).toBeGreaterThan(0);
  });

  it('reads a bare YYYY-MM-DD as the day it says, west of Greenwich too', () => {
    // `new Date('1994-06-12')` is UTC midnight; local getters would make this the
    // 11th for anyone in the Americas.
    expect(derivePinnedDates('1994-06-12', NOW)[0].when).toMatch(/^12 /);
  });

  it('drops her birthday rather than pinning it as unknown', () => {
    // A reminder list containing "her birthday: unknown" is the app admitting the
    // one thing it should be asking about, in the place least likely to be acted on.
    expect(derivePinnedDates(null, NOW).some((date) => date.id === 'birthday')).toBe(false);
    expect(derivePinnedDates('sometime in June', NOW).some((d) => d.id === 'birthday')).toBe(
      false,
    );
  });

  it('gives Tu B’Av the shared heart and Valentine’s the plain one', () => {
    const dates = derivePinnedDates(null, NOW);
    expect(dates.find((date) => date.id === 'valentines')?.icon).toBe('heart');
    const tuBAv = dates.find((date) => date.id === 'tu-bav');
    if (tuBAv) expect(tuBAv.icon).toBe('heart-star');
  });
});
