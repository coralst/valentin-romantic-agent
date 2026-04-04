import { describe, it, expect } from 'vitest';
import {
  validateMessageContent,
  validatePreference,
  validateSessionId,
} from '../message-validator';

describe('validateMessageContent', () => {
  it('rejects an empty string', () => {
    const result = validateMessageContent('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a whitespace-only string', () => {
    const result = validateMessageContent('   \t\n  ');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts a valid non-empty string', () => {
    const result = validateMessageContent('Hello Valentin');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe('validatePreference', () => {
  const validPref = {
    category: 'food',
    key: 'cuisine',
    value: 'Italian',
    confidence: 0.85,
  };

  it('accepts a valid preference', () => {
    const result = validatePreference(validPref);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects null', () => {
    const result = validatePreference(null);
    expect(result.valid).toBe(false);
  });

  it('rejects a non-object', () => {
    const result = validatePreference('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects an invalid category', () => {
    const result = validatePreference({ ...validPref, category: 'invalid_cat' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('category');
  });

  it('rejects confidence below 0', () => {
    const result = validatePreference({ ...validPref, confidence: -0.1 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Confidence');
  });

  it('rejects confidence above 1', () => {
    const result = validatePreference({ ...validPref, confidence: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Confidence');
  });

  it('accepts confidence at boundary 0', () => {
    const result = validatePreference({ ...validPref, confidence: 0 });
    expect(result.valid).toBe(true);
  });

  it('accepts confidence at boundary 1', () => {
    const result = validatePreference({ ...validPref, confidence: 1 });
    expect(result.valid).toBe(true);
  });

  it('rejects an empty key', () => {
    const result = validatePreference({ ...validPref, key: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('key');
  });

  it('rejects an empty value', () => {
    const result = validatePreference({ ...validPref, value: '   ' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('value');
  });
});

describe('validateSessionId', () => {
  it('rejects an empty string', () => {
    const result = validateSessionId('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a whitespace-only string', () => {
    const result = validateSessionId('   ');
    expect(result.valid).toBe(false);
  });

  it('accepts a valid session ID', () => {
    const result = validateSessionId('abc-123-def');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
