import { describe, it, expect, vi, afterEach } from 'vitest';
import { failingSender, gmailSender, loggingSender, resolveSender } from '../sender';
import { buildReminderEmail } from '../email-body';
import { integrationReadiness } from '../../integrations';
import { sendMessage } from '../../integrations/google/client';

// Both are the outside world: readiness reads process credentials, and `sendMessage`
// would post to Gmail. Mocked at the module boundary so the assertions below are
// about the sender's own decisions.
vi.mock('../../integrations', () => ({ integrationReadiness: vi.fn(() => ({ gmail: false })) }));
vi.mock('../../integrations/google/client', () => ({ sendMessage: vi.fn() }));

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

  /*
   * Without a refresh token every gmail send would throw, the rows would be retried
   * for ever and nobody would be reminded of anything — where the log channel at
   * least records that the reminder came due, with its body.
   */
  it('falls back to the log for gmail when there is no Google token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(integrationReadiness).mockReturnValue({ gmail: false } as never);
    expect(resolveSender('gmail').channel).toBe('log');
    expect(warn).toHaveBeenCalled();
  });

  it('sends on gmail once the account is connected', () => {
    vi.mocked(integrationReadiness).mockReturnValue({ gmail: true } as never);
    expect(resolveSender('gmail').channel).toBe('gmail');
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

describe('gmailSender', () => {
  it('sends the built subject and body to the address given', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(sendMessage).mockResolvedValue({ id: 'msg-1' });

    await gmailSender.send('him@example.test', email);

    expect(sendMessage).toHaveBeenCalledWith({
      to: 'him@example.test',
      subject: email.subject,
      body: email.body,
    });
  });

  /*
   * The one that matters. `sendMessage` returns `null` for every Gmail failure — a
   * revoked token, a quota, a rejected recipient — rather than throwing. The
   * dispatcher stamps `sentAt` *before* calling this, so a send that resolves without
   * sending leaves a row marked sent that nothing will ever retry: the reminder is
   * gone for good and the logs say it went out.
   */
  it('throws when Gmail returns no message id, instead of losing the reminder', async () => {
    vi.mocked(sendMessage).mockResolvedValue(null);

    await expect(gmailSender.send('him@example.test', email)).rejects.toThrow(
      /not sent/i,
    );
  });
});

describe('failingSender', () => {
  it('throws, because a failed send must not look like a successful one', async () => {
    await expect(failingSender().send('a@b.test', email)).rejects.toThrow(
      'channel unavailable',
    );
  });
});
