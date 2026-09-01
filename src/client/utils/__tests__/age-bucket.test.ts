import { describe, it, expect } from 'vitest';
import { getAge, getAgeBand, getAgeBucket, getAgeBucketFromValue } from '../age-bucket';

const TODAY = new Date(2026, 7, 21); // 21 August 2026

describe('getAge', () => {
  it('counts whole years elapsed', () => {
    expect(getAge(new Date(1988, 5, 17), TODAY)).toBe(38);
  });

  it('does not credit a birthday that has not happened yet this year', () => {
    // December 1988: still 37 in August 2026.
    expect(getAge(new Date(1988, 11, 1), TODAY)).toBe(37);
  });

  it('credits the birthday on the day itself', () => {
    expect(getAge(new Date(1988, 7, 21), TODAY)).toBe(38);
  });

  it('withholds the birthday the day before it', () => {
    expect(getAge(new Date(1988, 7, 22), TODAY)).toBe(37);
  });

  it('rejects an unparseable date rather than returning a number', () => {
    expect(getAge(new Date('not a date'), TODAY)).toBeNull();
  });

  it('rejects a future birth date', () => {
    expect(getAge(new Date(2030, 0, 1), TODAY)).toBeNull();
  });

  it('rejects an implausible age', () => {
    expect(getAge(new Date(1800, 0, 1), TODAY)).toBeNull();
  });
});

describe('getAgeBand', () => {
  it('reads 0 to 3 into the decade as early', () => {
    expect(getAgeBand(30)).toBe('early');
    expect(getAgeBand(33)).toBe('early');
  });

  it('reads 4 to 6 as mid', () => {
    expect(getAgeBand(34)).toBe('mid');
    expect(getAgeBand(36)).toBe('mid');
  });

  it('reads 7 to 9 as late', () => {
    expect(getAgeBand(37)).toBe('late');
    expect(getAgeBand(39)).toBe('late');
  });
});

describe('getAgeBucket', () => {
  it('phrases the mockup case', () => {
    // Born 17 June 1988, so 38 in August 2026 — the mockup's "mid-thirties" was
    // written against an earlier reference year; the band logic is what matters.
    expect(getAgeBucket(new Date(1990, 5, 17), TODAY)).toBe('mid-thirties');
  });

  it('phrases each decade with a word, never a number', () => {
    expect(getAgeBucket(new Date(1998, 0, 1), TODAY)).toBe('late-twenties');
    expect(getAgeBucket(new Date(1978, 0, 1), TODAY)).toBe('late-forties');
    expect(getAgeBucket(new Date(1966, 0, 1), TODAY)).toBe('early-sixties');
  });

  it('returns null under ten, where there is no decade word', () => {
    expect(getAgeBucket(new Date(2020, 0, 1), TODAY)).toBeNull();
  });

  it('returns null rather than a placeholder for an unusable date', () => {
    expect(getAgeBucket(new Date('nonsense'), TODAY)).toBeNull();
  });
});

describe('getAgeBucketFromValue', () => {
  it('accepts the ISO strings the profile store holds', () => {
    expect(getAgeBucketFromValue('1990-06-17', TODAY)).toBe('mid-thirties');
  });

  it('returns null for an absent value', () => {
    expect(getAgeBucketFromValue(null, TODAY)).toBeNull();
    expect(getAgeBucketFromValue(undefined, TODAY)).toBeNull();
    expect(getAgeBucketFromValue('', TODAY)).toBeNull();
  });

  it('returns null for a value that is not a date', () => {
    expect(getAgeBucketFromValue('sometime in the nineties', TODAY)).toBeNull();
  });

  /*
   * The regression. A birthday with no year cannot yield an age, and the app used
   * to state one anyway: `new Date('March 14')` is 14 March *2001* in V8, which the
   * old `isNaN` guard accepted, so the header read "March 14 · mid-twenties" for a
   * partner whose age nobody had mentioned.
   */
  it('withholds an age when the birthday carries no year', () => {
    expect(getAgeBucketFromValue('March 14', TODAY)).toBeNull();
    expect(getAgeBucketFromValue('14 March', TODAY)).toBeNull();
    expect(getAgeBucketFromValue('2 October', TODAY)).toBeNull();
  });

  it('withholds an age for a bare age or a bare year', () => {
    // `new Date('32')` and `new Date('1994')` are both valid dates in 2032 / 1994.
    expect(getAgeBucketFromValue('32', TODAY)).toBeNull();
    expect(getAgeBucketFromValue('1994', TODAY)).toBeNull();
  });

  it('still reads a full date written as prose', () => {
    expect(getAgeBucketFromValue('17 June 1990', TODAY)).toBe('mid-thirties');
    expect(getAgeBucketFromValue('June 17, 1990', TODAY)).toBe('mid-thirties');
  });
});
