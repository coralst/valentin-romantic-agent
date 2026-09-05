import { describe, it, expect } from 'vitest';
import { looksLikeEmail, resolveNotifyEmail } from '../notify-email';
import { config } from '../../config';

/**
 * Which address outbound mail is aimed at.
 *
 * The fallback is passed explicitly in most of these rather than read from
 * `config`, so the rules are asserted against a value this file controls and one
 * `REMINDER_DEFAULT_EMAIL` in someone's shell cannot turn a passing test red.
 */
describe('resolveNotifyEmail', () => {
  const OWNER = 'owner@example.com';

  it('uses the address on the profile when there is one', () => {
    expect(resolveNotifyEmail('typed@example.com', OWNER)).toBe('typed@example.com');
  });

  it("falls back to the deployment's owner when the profile is empty", () => {
    expect(resolveNotifyEmail(null, OWNER)).toBe(OWNER);
    expect(resolveNotifyEmail(undefined, OWNER)).toBe(OWNER);
    expect(resolveNotifyEmail('   ', OWNER)).toBe(OWNER);
  });

  it('falls back when the profile holds something that cannot be an address', () => {
    // Extracted from chat, so this is a real shape: before, it went into
    // `Reminder.target` unchecked and the send failed days later, out of sight.
    expect(resolveNotifyEmail('her email', OWNER)).toBe(OWNER);
    expect(resolveNotifyEmail('koral at gmail', OWNER)).toBe(OWNER);
    expect(resolveNotifyEmail('koral@', OWNER)).toBe(OWNER);
  });

  it('trims, because an extracted address often arrives padded', () => {
    expect(resolveNotifyEmail('  typed@example.com \n', OWNER)).toBe('typed@example.com');
  });

  it('answers null when there is no usable address anywhere', () => {
    // The behaviour that existed before the default, and still the honest answer
    // for a deployment that has no owner to name.
    expect(resolveNotifyEmail(null, '')).toBeNull();
    expect(resolveNotifyEmail('her email', '   ')).toBeNull();
  });

  it('ignores a default that is not an address rather than mailing nonsense', () => {
    // `REMINDER_DEFAULT_EMAIL` is an environment variable, so a typo here would
    // otherwise address every reminder in the deployment to something undeliverable.
    expect(resolveNotifyEmail(null, 'koralsteinberg')).toBeNull();
    expect(resolveNotifyEmail('typed@example.com', 'nonsense')).toBe('typed@example.com');
  });

  it("defaults to the configured owner when no fallback is passed", () => {
    expect(resolveNotifyEmail(null)).toBe(config.reminders.defaultEmail);
  });
});

describe('looksLikeEmail', () => {
  it('accepts an ordinary address', () => {
    expect(looksLikeEmail('koralsteinberg@gmail.com')).toBe(true);
  });

  it('rejects the shapes an extractor actually produces', () => {
    expect(looksLikeEmail('koral at gmail dot com')).toBe(false);
    expect(looksLikeEmail('koral@gmail')).toBe(false);
    expect(looksLikeEmail('two addresses@a.com b@c.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });
});
