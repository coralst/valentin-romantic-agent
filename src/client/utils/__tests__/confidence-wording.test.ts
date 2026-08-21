import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { confidenceWord } from '../confidence-wording';

describe('confidenceWord', () => {
  it('maps the three bands', () => {
    expect(confidenceWord(1)).toBe('certain');
    expect(confidenceWord(0.9)).toBe('certain');
    expect(confidenceWord(0.89)).toBe('likely');
    expect(confidenceWord(0.5)).toBe('likely');
    expect(confidenceWord(0.49)).toBe('maybe');
    expect(confidenceWord(0)).toBe('maybe');
  });

  it('falls back to the most cautious word for non-finite scores', () => {
    expect(confidenceWord(Number.NaN)).toBe('maybe');
    expect(confidenceWord(Number.POSITIVE_INFINITY)).toBe('maybe');
  });

  it('is monotonic — more confidence never reads as less certain', () => {
    const rank = { maybe: 0, likely: 1, certain: 2 } as const;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(rank[confidenceWord(lo)]).toBeLessThanOrEqual(rank[confidenceWord(hi)]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
