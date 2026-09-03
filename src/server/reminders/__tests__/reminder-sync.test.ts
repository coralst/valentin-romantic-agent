import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncReminders, touchesReminders } from '../reminder-sync';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import { pendingReminders, reminderId, REMINDER_ZONE } from '../../../shared/interfaces/reminder';
import type { Reminder } from '../../../shared/interfaces/reminder';
import { logger } from '../../logging';

/**
 * The call site that turns a stored date into a row the sweeper can find.
 *
 * A real store throughout. Almost everything here is about what a *second* sync
 * does to what the first one wrote — the superseded occasion, the corrected lead
 * time, the reminder already sent — and a mocked `getRemindersBySession` returning
 * `[]` would pass all of it while production mailed twice.
 */

/** The wall clock in Israel for an instant, so assertions read as the user's day. */
function wall(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(', ', 'T');
}

describe('syncReminders', () => {
  let store: StorageInterface;
  let sessionId: string;

  beforeEach(async () => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    sessionId = await store.createSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Land one extracted profile value, the way the extractor would. */
  async function extracted(fieldId: string, value: string): Promise<void> {
    await store.savePreference({
      sessionId,
      category: 'important_dates',
      key: fieldId,
      fieldId,
      value,
      confidence: 0.9,
      sourceMessageId: 'msg-1',
    });
  }

  it('creates one pending row for a birthday, due at the lead time', async () => {
    await extracted('birthday', '1988-06-12');
    await extracted('reminder_lead_time', '1 week before');
    await extracted('notify_email', 'him@example.com');

    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const rows = pendingReminders(await store.getRemindersBySession(sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(reminderId('birthday', '2026-06-12'));
    // A week before the 12th, at nine in her morning.
    expect(wall(rows[0].dueAt)).toBe('2026-06-05T09:00');
    expect(rows[0].target).toBe('him@example.com');
    expect(rows[0].sentAt).toBeNull();
  });

  it('records a reminder with no target when no address is known', async () => {
    await extracted('birthday', '1988-06-12');

    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const [row] = await store.getRemindersBySession(sessionId);
    // Worth recording without anywhere to send it — the dispatcher skips it with
    // `reminder.no_target` rather than the date going unnoticed.
    expect(row.target).toBeNull();
  });

  it('overwrites in place when the lead time changes', async () => {
    await extracted('birthday', '1988-06-12');
    await extracted('reminder_lead_time', '1 week before');
    const now = new Date('2026-03-01T08:00:00Z');
    await syncReminders(store, sessionId, now);

    await extracted('reminder_lead_time', '1 day before');
    await syncReminders(store, sessionId, now);

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows).toHaveLength(1);
    expect(wall(rows[0].dueAt)).toBe('2026-06-11T09:00');
    expect(rows[0].leadDays).toBe(1);
  });

  it('leaves exactly one pending row when an occasion moves to a new date', async () => {
    await extracted('next_occasion', '2026-03-12@dinner at Ha Salon');
    await extracted('reminder_lead_time', '1 day before');
    const now = new Date('2026-03-01T08:00:00Z');
    await syncReminders(store, sessionId, now);
    expect(await store.getRemindersBySession(sessionId)).toHaveLength(1);

    await extracted('next_occasion', '2026-03-20@dinner at Ha Salon');
    await syncReminders(store, sessionId, now);

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].occursOn).toBe('2026-03-20');
  });

  it('never deletes a reminder that has already been sent', async () => {
    const sent: Reminder = {
      id: reminderId('occasion', '2026-03-12'),
      sessionId,
      userId: 'user-under-test',
      kind: 'occasion',
      occursOn: '2026-03-12',
      dueAt: '2026-03-11T07:00:00.000Z',
      leadDays: 1,
      occasion: 'dinner at Ha Salon',
      channel: 'log',
      target: 'him@example.com',
      sentAt: '2026-03-11T07:00:05.000Z',
      attempts: 0,
      lastError: null,
      createdAt: '2026-03-01T08:00:00.000Z',
    };
    await store.saveReminder(sessionId, sent);

    await extracted('next_occasion', '2026-03-20@dinner at Ha Salon');
    await extracted('reminder_lead_time', '1 day before');
    await syncReminders(store, sessionId, new Date('2026-03-13T08:00:00Z'));

    const rows = await store.getRemindersBySession(sessionId);
    // The sent row is history: reaping it would let the identical reminder be
    // planned and mailed a second time.
    expect(rows.map((row) => row.id).sort()).toEqual(
      [reminderId('occasion', '2026-03-12'), reminderId('occasion', '2026-03-20')].sort(),
    );
    expect(pendingReminders(rows)).toHaveLength(1);
  });

  it('plans on the hand-corrected birthday, not the inferred one', async () => {
    await extracted('birthday', '1988-06-12');
    await store.setManualValue(sessionId, 'birthday', '1988-07-04');

    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const [row] = await store.getRemindersBySession(sessionId);
    expect(row.occursOn).toBe('2026-07-04');
  });

  it('plans nothing from a profile with no dates on it', async () => {
    await extracted('reminder_lead_time', '1 week before');

    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    expect(await store.getRemindersBySession(sessionId)).toHaveLength(0);
  });

  it('logs and returns when the store fails, rather than throwing', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await extracted('birthday', '1988-06-12');
    // Prototype delegation rather than a hand-built mock: every other method is
    // the real store, so only the fault under test differs from the happy path.
    const faulty: StorageInterface = Object.assign(Object.create(store) as StorageInterface, {
      saveReminder: async (): Promise<never> => {
        throw new Error('ProvisionedThroughputExceededException');
      },
    });

    await expect(syncReminders(faulty, sessionId, new Date('2026-03-01T08:00:00Z'))).resolves
      .toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'reminder.sync_failed',
      expect.objectContaining({ sessionId }),
    );
    // The extraction that triggered this is untouched.
    expect(await store.getPreferencesBySession(sessionId)).toHaveLength(1);
  });
});

describe('touchesReminders', () => {
  it('is true for any field a reminder is derived from', () => {
    expect(touchesReminders(['favorite_cuisine', 'birthday'])).toBe(true);
    expect(touchesReminders(['notify_email'])).toBe(true);
  });

  it('is false for fields no reminder depends on, and for nothing at all', () => {
    expect(touchesReminders(['favorite_cuisine', 'shoulder_width'])).toBe(false);
    expect(touchesReminders([null, undefined])).toBe(false);
    expect(touchesReminders([])).toBe(false);
  });
});
