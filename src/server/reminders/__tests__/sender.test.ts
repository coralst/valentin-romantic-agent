import { describe, it, expect, vi, afterEach } from 'vitest';
import { failingSender, loggingSender, resolveSender } from '../sender';
import { buildReminderEmail } from '../email-body';

const email = buildReminderEmail({
  occasion: 'her birthday',
  occasionDate: new Date(2026, 5, 12),
  daysUntil: 7,
  partnerName: 'Samantha',
  suggestions: [],
  origin: 'https://example.test',
  sessionId: 'sess-1',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveSender', () => {
  it('defaults to the log so the reminder path works with Gmail dark', () => {
    expect(resolveSender(undefined).channel).toBe('log');
    expect(resolveSender('log').channel).toBe('log');
  });

  it('falls back to the log for gmail rather than pretending it can send', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSender('gmail').channel).toBe('log');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to the log for a channel nobody built, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSender('carrier-pigeon').channel).toBe('log');
    expect(warn).toHaveBeenCalled();
  });
});

describe('loggingSender', () => {
  it('logs the subject and the body so a reminder can be verified', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await loggingSender.send('someone@example.test', email);

    const line = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('reminder.sent');
    expect(line).toContain('someone@example.test');
    expect(line).toContain('Samantha');
  });

  it('resolves rather than throwing, so the dispatcher marks it sent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(loggingSender.send('a@b.test', email)).resolves.toBeUndefined();
  });
});

describe('failingSender', () => {
  it('throws, because a failed send must not look like a successful one', async () => {
    await expect(failingSender().send('a@b.test', email)).rejects.toThrow(
      'channel unavailable',
    );
  });
});
