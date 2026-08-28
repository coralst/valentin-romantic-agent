import { describe, it, expect } from 'vitest';
import { deriveTogetherDays, formatTogetherDays } from '../together-days';

describe('deriveTogetherDays', () => {
  const now = new Date('2026-08-22T09:30:00');

  it('counts whole days from the anniversary', () => {
    expect(deriveTogetherDays('2026-08-01', now)).toBe(21);
  });

  it('reads a bare date as that calendar day regardless of the local offset', () => {
    // `new Date('2026-08-21')` is UTC midnight, which is 21 Aug in London and
    // 20 Aug in California. The figure must be the same in both.
    expect(deriveTogetherDays('2026-08-21', now)).toBe(1);
    expect(deriveTogetherDays('2026-08-22', now)).toBe(0);
  });

  it('does not move during the day', () => {
    const morning = deriveTogetherDays('2020-06-12', new Date('2026-08-22T00:05:00'));
    const night = deriveTogetherDays('2020-06-12', new Date('2026-08-22T23:55:00'));
    expect(morning).toBe(night);
  });

  it('has no figure rather than a guess when there is no anniversary', () => {
    expect(deriveTogetherDays(null, now)).toBeNull();
    expect(deriveTogetherDays(undefined, now)).toBeNull();
    expect(deriveTogetherDays('', now)).toBeNull();
    expect(deriveTogetherDays('sometime in June', now)).toBeNull();
  });

  it('refuses a future anniversary instead of reporting negative days', () => {
    expect(deriveTogetherDays('2027-01-01', now)).toBeNull();
  });
});

describe('formatTogetherDays', () => {
  it('groups thousands, because the figure is set large', () => {
    expect(formatTogetherDays(2003)).toBe('2,003');
    expect(formatTogetherDays(7)).toBe('7');
  });
});
