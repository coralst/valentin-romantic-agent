import { describe, it, expect } from 'vitest';
import type { Reminder } from '../../../shared/interfaces/reminder';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import { dispatchDue } from '../dispatcher';
import { failingSender, type ReminderSender } from '../sender';
import type { ReminderEmail } from '../email-body';

const ORIGIN = 'https://valentin.example.com';
const NOW = new Date('2026-06-05T06:00:00.000Z');

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'birthday-2026-06-12',
    sessionId: 'session-1',
    userId: 'user-1',
    kind: 'birthday',
    occursOn: '2026-06-12',
    dueAt: '2026-06-05T06:00:00.000Z',
    leadDays: 7,
    occasion: 'birthday',
    channel: 'log',
    target: 'him@example.com',
    sentAt: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
  };
}

/** A sender that keeps what it was handed, so the body can be asserted. */
function recordingSender(): ReminderSender & { sent: { to: string; email: ReminderEmail }[] } {
  return {
    channel: 'recording',
    sent: [],
    async send(to, email) {
      this.sent.push({ to, email });
    },
  };
}

/** A factory seeded with reminders, used as both the store and the due-index. */
async function seeded(...reminders: Reminder[]): Promise<InMemoryStoreFactory> {
  const factory = new InMemoryStoreFactory();
  for (const row of reminders) {
    await factory.forUser(row.userId).saveReminder(row.sessionId, row);
  }
  return factory;
}

describe('dispatchDue', () => {
  it('sends one due reminder and counts it', async () => {
    const factory = await seeded(reminder());
    const sender = recordingSender();

    const summary = await dispatchDue(factory, sender, NOW, { origin: ORIGIN });

    expect(summary).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('him@example.com');
  });

  it('builds a body that names the date, the gap and the resume link', async () => {
    const factory = await seeded(reminder());
    const sender = recordingSender();

    await dispatchDue(factory, sender, NOW, { origin: ORIGIN });
    const { subject, body } = sender.sent[0].email;

    expect(subject).toBe('Her birthday is a week away');
    expect(body).toContain('Friday 12 June');
    expect(body).toContain(`${ORIGIN}/?s=session-1`);
    // No search ran, so the mail says so rather than implying an empty result set.
    expect(body).toContain('I have not found anything worth suggesting yet');
    // And it must never claim anything was held.
    expect(body).not.toMatch(/reserved for you|booked/i);
  });

  it('leaves a reminder that is not due yet alone', async () => {
    const factory = await seeded(reminder({ dueAt: '2026-06-05T06:00:01.000Z' }));
    const sender = recordingSender();

    const summary = await dispatchDue(factory, sender, NOW, { origin: ORIGIN });

    expect(summary).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
  });

  it('claims the row, so a second sweep finds nothing to send', async () => {
    const factory = await seeded(reminder());
    const sender = recordingSender();

    await dispatchDue(factory, sender, NOW, { origin: ORIGIN });
    const second = await dispatchDue(factory, sender, NOW, { origin: ORIGIN });

    // The claim drops the row out of the index rather than filtering it out for ever.
    expect(second.considered).toBe(0);
    expect(sender.sent).toHaveLength(1);

    const stored = await factory.forUser('user-1').getRemindersBySession('session-1');
    expect(stored[0].sentAt).toBe(NOW.toISOString());
  });

  it('double dispatch over one index sends once and skips once', async () => {
    /*
     * Two containers sweeping the same second. Both `dueBefore` calls see the row —
     * the second `markSent` is the only thing standing between the user and two
     * identical mails about the same birthday.
     */
    const factory = await seeded(reminder());
    const sender = recordingSender();

    const [a, b] = await Promise.all([
      dispatchDue(factory, sender, NOW, { origin: ORIGIN }),
      dispatchDue(factory, sender, NOW, { origin: ORIGIN }),
    ]);

    expect(a.considered).toBe(1);
    expect(b.considered).toBe(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('counts a failing channel as failed, not as sent', async () => {
    const factory = await seeded(reminder());

    const summary = await dispatchDue(factory, failingSender('smtp down'), NOW, {
      origin: ORIGIN,
    });

    expect(summary).toEqual({ considered: 1, sent: 0, skipped: 0, failed: 1 });
  });

  it('does not retry a failed send on the next sweep', async () => {
    // The documented cost of claiming before sending: a dropped reminder, never a
    // duplicated one. Asserted so the trade cannot change silently.
    const factory = await seeded(reminder());
    await dispatchDue(factory, failingSender(), NOW, { origin: ORIGIN });

    const second = await dispatchDue(factory, recordingSender(), NOW, { origin: ORIGIN });

    expect(second).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
  });

  it('skips a reminder with no target without sending or claiming it', async () => {
    const factory = await seeded(reminder({ target: null }));
    const sender = recordingSender();

    const summary = await dispatchDue(factory, sender, NOW, { origin: ORIGIN });

    expect(summary).toEqual({ considered: 1, sent: 0, skipped: 1, failed: 0 });
    expect(sender.sent).toHaveLength(0);
    // Still pending: a row nobody can be mailed about is a visible "I know about
    // this date", and stamping it sent would hide it.
    const stored = await factory.forUser('user-1').getRemindersBySession('session-1');
    expect(stored[0].sentAt).toBeNull();
  });

  it('sweeps across users, and stays inside the limit', async () => {
    const factory = await seeded(
      reminder({ id: 'birthday-2026-06-12', userId: 'user-1', sessionId: 'session-1' }),
      reminder({
        id: 'anniversary-2026-06-13',
        kind: 'anniversary',
        occursOn: '2026-06-13',
        dueAt: '2026-06-05T05:00:00.000Z',
        userId: 'user-2',
        sessionId: 'session-2',
        target: 'her@example.com',
      }),
    );
    const sender = recordingSender();

    const first = await dispatchDue(factory, sender, NOW, { origin: ORIGIN, limit: 1 });

    // Soonest first, so the other user's earlier reminder is the one in this slice.
    expect(first).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sender.sent[0].to).toBe('her@example.com');

    const second = await dispatchDue(factory, sender, NOW, { origin: ORIGIN, limit: 1 });
    expect(second.sent).toBe(1);
    expect(sender.sent[1].to).toBe('him@example.com');
  });

  it('counts the gap from the sweep, not from the lead time it was planned with', async () => {
    // A sweep delayed by a day must not still say "a week away".
    const factory = await seeded(reminder());
    const sender = recordingSender();

    await dispatchDue(factory, sender, new Date('2026-06-06T06:00:00.000Z'), { origin: ORIGIN });

    expect(sender.sent[0].email.subject).toBe('Her birthday is 6 days away');
  });
});
