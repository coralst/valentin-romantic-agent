import { describe, it, expect } from 'vitest';
import {
  FIELD_PAYOFFS,
  getFieldRank,
  getFieldReason,
  getTopFieldGap,
  rankUnfilledFields,
} from '../field-payoff';
import { PROFILE_FIELD_REGISTRY } from '../profile-field-registry';

/** Nothing known at all — the state a fresh session opens in. */
const nothingFilled = () => false;

describe('FIELD_PAYOFFS', () => {
  it('covers every field in the registry, so no field falls to rank 0', () => {
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(FIELD_PAYOFFS[field.id], `missing payoff for ${field.id}`).toBeDefined();
    }
  });

  it('names no field the registry does not have', () => {
    const registryIds = new Set(PROFILE_FIELD_REGISTRY.map((field) => field.id));
    for (const fieldId of Object.keys(FIELD_PAYOFFS)) {
      expect(registryIds.has(fieldId), `${fieldId} is not a registry field`).toBe(true);
    }
  });

  it('gives every field a distinct rank, so the ordering is unambiguous', () => {
    const ranks = Object.values(FIELD_PAYOFFS).map((payoff) => payoff.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('writes each reason as a sentence, not a field name', () => {
    for (const [fieldId, payoff] of Object.entries(FIELD_PAYOFFS)) {
      expect(payoff.reason.length, `${fieldId} reason too short`).toBeGreaterThan(15);
      expect(payoff.reason, `${fieldId} reason unpunctuated`).toMatch(/[.?]$/);
    }
  });

  it('ranks love language above zodiac sign, which is the whole point', () => {
    expect(getFieldRank('love_language')).toBeGreaterThan(getFieldRank('zodiac_sign'));
  });
});

describe('getFieldRank / getFieldReason', () => {
  it('returns 0 and null for an unknown field rather than throwing', () => {
    expect(getFieldRank('invented_field')).toBe(0);
    expect(getFieldReason('invented_field')).toBeNull();
  });
});

describe('rankUnfilledFields', () => {
  it('lists every field when nothing is known', () => {
    expect(rankUnfilledFields(nothingFilled)).toHaveLength(PROFILE_FIELD_REGISTRY.length);
  });

  it('leads with love language, not with whatever the registry declares first', () => {
    const gaps = rankUnfilledFields(nothingFilled);
    expect(gaps[0].fieldId).toBe('love_language');
    // partner_name is registry index 0 and would win a declaration-order sort.
    expect(gaps[0].fieldId).not.toBe('partner_name');
  });

  it('orders strictly by descending rank', () => {
    const ranks = rankUnfilledFields(nothingFilled).map((gap) => gap.rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it('drops a field once it is known', () => {
    const gaps = rankUnfilledFields((fieldId) => fieldId === 'love_language');
    expect(gaps.some((gap) => gap.fieldId === 'love_language')).toBe(false);
    expect(gaps[0].fieldId).toBe('anniversary');
  });

  it('returns an empty list when everything is known', () => {
    expect(rankUnfilledFields(() => true)).toEqual([]);
  });

  it('carries each field its registry label and its own reason', () => {
    const gap = rankUnfilledFields(nothingFilled).find((g) => g.fieldId === 'hobbies');
    expect(gap?.label).toBe('Hobbies');
    expect(gap?.reason).toBe(FIELD_PAYOFFS.hobbies.reason);
  });
});

describe('getTopFieldGap', () => {
  it('is the highest-payoff unanswered field', () => {
    expect(getTopFieldGap(nothingFilled)?.fieldId).toBe('love_language');
  });

  it('is null once nothing is left to ask, so the nudge can hide', () => {
    expect(getTopFieldGap(() => true)).toBeNull();
  });
});
