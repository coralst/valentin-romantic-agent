import { describe, it, expect, beforeEach } from 'vitest';
import { resolveField, resetMapper } from '../preference-field-mapper';

describe('resolveField', () => {
  beforeEach(() => {
    resetMapper();
  });

  it('resolves a known category+key to the correct fieldId', () => {
    expect(resolveField('personality_traits', 'name')).toBe('partner_name');
  });

  it('resolves case-insensitively on the key', () => {
    expect(resolveField('personality_traits', 'Name')).toBe('partner_name');
    expect(resolveField('personality_traits', 'NAME')).toBe('partner_name');
  });

  it('resolves birthday mapping', () => {
    expect(resolveField('important_dates', 'birthday')).toBe('birthday');
    expect(resolveField('important_dates', 'birth date')).toBe('birthday');
  });

  it('resolves anniversary mapping', () => {
    expect(resolveField('important_dates', 'anniversary')).toBe('anniversary');
  });

  it('resolves love language mapping', () => {
    expect(resolveField('love_language', 'primary')).toBe('love_language');
  });

  it('resolves food-related mappings', () => {
    expect(resolveField('food', 'favorite cuisine')).toBe('favorite_cuisine');
    expect(resolveField('food', 'cuisine')).toBe('favorite_cuisine');
  });

  it('resolves music genre mapping', () => {
    expect(resolveField('music', 'genre')).toBe('music_genre');
  });

  it('resolves hobby mappings', () => {
    expect(resolveField('hobbies', 'hobbies')).toBe('hobbies');
    expect(resolveField('hobbies', 'hobby')).toBe('hobbies');
  });

  it('resolves travel destination mappings', () => {
    expect(resolveField('travel', 'dream destination')).toBe('travel_destination');
  });

  it('resolves gift-related mappings', () => {
    expect(resolveField('gifts', 'budget')).toBe('gift_budget');
    expect(resolveField('gifts', 'wish list')).toBe('wish_list');
  });

  it('returns null for an unmapped category+key', () => {
    expect(resolveField('food', 'unknown_key')).toBeNull();
  });

  it('returns null for a valid multi-field category with an unknown key', () => {
    // `music` used to be asserted here. It is now a single-field category: any
    // `music` preference routes to `music_genre`, because extraction routinely
    // puts the value in the key ("music:listens_to_bachata") and silently
    // dropping those was the bug this branch fixes. Categories that span several
    // fields still refuse to guess — see `preference-field-resolution.test.ts`.
    expect(resolveField('personality_traits', 'nonexistent')).toBeNull();
    expect(resolveField('important_dates', 'nonexistent')).toBeNull();
  });

  it('routes any music preference to music_genre', () => {
    expect(resolveField('music', 'nonexistent')).toBe('music_genre');
  });

  it('handles repeated calls consistently', () => {
    const first = resolveField('personality_traits', 'name');
    const second = resolveField('personality_traits', 'name');
    expect(first).toBe(second);
    expect(first).toBe('partner_name');
  });
});
