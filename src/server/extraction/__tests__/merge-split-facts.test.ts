import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergeSplitFacts } from '../preference-extractor';

/**
 * "She's turning 32 in June" is ONE fact.
 *
 * A real run emitted it as `important_dates:birthday_month = "June"` plus
 * `important_dates:age_turning = "32"` — two chips, one fact, and neither
 * resolved to `birthday`. Both halves now carry `field: 'birthday'`, which makes
 * the collision detectable.
 */
describe('mergeSplitFacts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins two complementary halves of one fact', () => {
    const merged = mergeSplitFacts([
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: '32', confidence: 1 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].field).toBe('birthday');
    // The longer phrasing leads, the shorter is parenthesised.
    expect(merged[0].value).toBe('June (32)');
  });

  it('keeps the containing phrasing when one value subsumes the other', () => {
    const merged = mergeSplitFacts([
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      {
        category: 'important_dates',
        field: 'birthday',
        key: 'birthday',
        value: 'turning 32 in June',
        confidence: 0.9,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('turning 32 in June');
  });

  it('takes the lowest confidence of the merged halves', () => {
    const merged = mergeSplitFacts([
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: '32', confidence: 0.6 },
    ]);

    expect(merged[0].confidence).toBe(0.6);
  });

  it('leaves distinct fields untouched', () => {
    const merged = mergeSplitFacts([
      { category: 'personality_traits', field: 'partner_name', key: 'partner_name', value: 'Mirabel', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      { category: 'hobbies', field: 'hobbies', key: 'hobbies', value: 'salsa dancing', confidence: 1 },
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.map((p) => p.field).sort()).toEqual(['birthday', 'hobbies', 'partner_name']);
  });

  it('does NOT merge two off-registry facts', () => {
    // Two allergies are two allergies. Only field-identified rows collapse.
    const merged = mergeSplitFacts([
      { category: 'food', key: 'shellfish_allergy', value: 'allergic to shellfish', confidence: 1 },
      { category: 'food', key: 'nut_allergy', value: 'allergic to walnuts', confidence: 1 },
    ]);

    expect(merged).toHaveLength(2);
  });

  it('passes through a row whose field id is not canonical', () => {
    const merged = mergeSplitFacts([
      { category: 'food', field: 'invented_field', key: 'something', value: 'a value', confidence: 1 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe('something');
  });

  it('is a no-op on an empty batch', () => {
    expect(mergeSplitFacts([])).toEqual([]);
  });

  it('does not mutate the input rows', () => {
    const input = [
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: '32', confidence: 1 },
    ];
    mergeSplitFacts(input);
    expect(input[0].value).toBe('June');
  });

  it('collapses three-way splits of the same field', () => {
    const merged = mergeSplitFacts([
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: 'June', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: '32', confidence: 1 },
      { category: 'important_dates', field: 'birthday', key: 'birthday', value: '12th', confidence: 1 },
    ]);

    expect(merged).toHaveLength(1);
  });
});
