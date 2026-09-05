import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncReminders, touchesReminders } from '../reminder-sync';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import {
  customReminderId,
  pendingReminders,
  reminderId,
  REMINDER_ZONE,
} from '../../../shared/interfaces/reminder';
import type { Reminder } from '../../../shared/interfaces/reminder';
import { logger } from '../../logging';
import { config } from '../../config';

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
  /** Kept because `markSent` — the dispatcher's claim — lives on the factory. */
  let factory: InMemoryStoreFactory;

  beforeEach(async () => {
    factory = new InMemoryStoreFactory();
    store = factory.forUser('user-under-test');
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
    // A week before the 12th, at half past eight in his morning.
    expect(wall(rows[0].dueAt)).toBe('2026-06-05T08:30');
    expect(rows[0].target).toBe('him@example.com');
    expect(rows[0].sentAt).toBeNull();
  });

  it("falls back to the deployment's owner when the profile has no address", async () => {
    await extracted('birthday', '1988-06-12');

    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const [row] = await store.getRemindersBySession(sessionId);
    expect(row.target).toBe(config.reminders.defaultEmail);
  });

  it('records a reminder with no target when there is nowhere at all to send it', async () => {
    // Worth recording without anywhere to send it — the dispatcher skips it with
    // `reminder.no_target` rather than the date going unnoticed. Only reachable now
    // with the default unset, which is the anonymous-deployment case.
    const original = config.reminders.defaultEmail;
    config.reminders.defaultEmail = '';
    try {
      await extracted('birthday', '1988-06-12');

      await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

      const [row] = await store.getRemindersBySession(sessionId);
      expect(row.target).toBeNull();
    } finally {
      config.reminders.defaultEmail = original;
    }
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
    expect(wall(rows[0].dueAt)).toBe('2026-06-11T08:30');
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

  /*
   * The beat the demo turns on: he tells Valentin about an anniversary that is
   * already closer than his lead time. There is no crossing to wait for, so the row
   * is due at once and the sweeper mails it on its next pass — rather than the date
   * landing on the profile and nothing ever arriving.
   */
  it('arms a date learned inside the lead window for immediate sending', async () => {
    const now = new Date('2026-03-01T08:00:00Z');
    await extracted('anniversary', '2023-03-05');
    await extracted('reminder_lead_time', '1 week before');
    await extracted('notify_email', 'him@example.com');

    await syncReminders(store, sessionId, now);

    const rows = pendingReminders(await store.getRemindersBySession(sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].occursOn).toBe('2026-03-05');
    expect(rows[0].dueAt).toBe(now.toISOString());
    expect(rows[0].target).toBe('him@example.com');
  });

  /*
   * The duplicate the clamp above would otherwise cause. Before it, a re-planned row
   * whose send moment had passed simply vanished; now it is due immediately, so
   * overwriting an already-sent row means the identical mail goes out again seconds
   * later. `dispatcher.ts` treats a duplicate as the worse failure of the two.
   */
  it('does not re-arm an already-sent reminder when the profile is edited again', async () => {
    const now = new Date('2026-03-01T08:00:00Z');
    await extracted('anniversary', '2023-03-05');
    await extracted('reminder_lead_time', '1 week before');
    await syncReminders(store, sessionId, now);

    const [armed] = await store.getRemindersBySession(sessionId);
    const claimed = await factory.markSent(armed, new Date(now.getTime() + 60_000));
    expect(claimed).toBe(true);

    // Any later edit to a reminder-bearing field re-runs the sync over the same date.
    await extracted('notify_email', 'him@example.com');
    await syncReminders(store, sessionId, new Date(now.getTime() + 120_000));

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sentAt).not.toBeNull();
    expect(pendingReminders(rows)).toHaveLength(0);
  });

  /*
   * Muting has to reach a reminder that is *already* armed, which is the whole
   * difficulty: "actually don't email me about her birthday" is almost always said
   * after the birthday has been recorded. It works by omission — the planner emits no
   * birthday row, and `reapSuperseded` deletes the pending one it no longer contains —
   * so there is no second delete path to keep in step with the first.
   */
  it('cancels an armed reminder when he mutes that date', async () => {
    const now = new Date('2026-03-01T08:00:00Z');
    await extracted('birthday', '1988-06-12');
    await extracted('anniversary', '2015-03-04');
    await syncReminders(store, sessionId, now);
    expect(await store.getRemindersBySession(sessionId)).toHaveLength(2);

    await extracted('reminders_muted', 'birthday');
    await syncReminders(store, sessionId, now);

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows.map((row) => row.kind)).toEqual(['anniversary']);
  });

  it('arms it again when he takes the mute back off', async () => {
    const now = new Date('2026-03-01T08:00:00Z');
    await extracted('birthday', '1988-06-12');
    await extracted('reminders_muted', 'birthday');
    await syncReminders(store, sessionId, now);
    expect(await store.getRemindersBySession(sessionId)).toHaveLength(0);

    await extracted('reminders_muted', '');
    await syncReminders(store, sessionId, now);

    const rows = pendingReminders(await store.getRemindersBySession(sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(reminderId('birthday', '2026-06-12'));
  });

  it('leaves a hand-set reminder alone when a whole category is muted', async () => {
    // `custom` is not a planner kind, so it is not mutable and not reapable. A
    // reminder he set by hand is cancelled by asking, not by silencing a category.
    const now = new Date('2026-03-01T08:00:00Z');
    await store.saveReminder(sessionId, {
      id: customReminderId('2026-06-12', 'Order the cake'),
      sessionId,
      userId: 'user-under-test',
      kind: 'custom',
      occursOn: '2026-06-12',
      dueAt: '2026-06-12T05:30:00.000Z',
      leadDays: 0,
      title: 'Order the cake',
      occasion: 'Order the cake',
      channel: 'log',
      target: 'him@example.com',
      sentAt: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-03-01T08:00:00.000Z',
    });

    await extracted('birthday', '1988-06-12');
    await extracted('reminders_muted', 'birthday');
    await syncReminders(store, sessionId, now);

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows.map((row) => row.kind)).toEqual(['custom']);
  });

  /*
   * The data-loss regression, and it was one turn of conversation away: reaping ran
   * over every unsent row, and a `custom` reminder is pending and never in
   * `plannedIds` — so extracting a birthday, or editing `notify_email` in the panel,
   * silently deleted every reminder the user had set by hand.
   */
  it('leaves a reminder the user set by hand alone', async () => {
    const his: Reminder = {
      id: customReminderId('2026-03-20', 'Call the florist'),
      sessionId,
      userId: 'user-under-test',
      kind: 'custom',
      occursOn: '2026-03-20',
      dueAt: '2026-03-20T07:00:00.000Z',
      leadDays: 0,
      title: 'Call the florist',
      occasion: 'Call the florist',
      channel: 'log',
      target: 'him@example.com',
      sentAt: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-03-01T08:00:00.000Z',
    };
    await store.saveReminder(sessionId, his);

    await extracted('birthday', '1988-06-12');
    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const rows = await store.getRemindersBySession(sessionId);
    expect(rows.map((row) => row.id)).toContain(his.id);
    expect(pendingReminders(rows)).toHaveLength(2);
  });

  /*
   * The other half of the "saved without an address" design: `set_reminder` writes
   * the row with `target: null` when it has nowhere to send, and this is what makes
   * that reminder deliverable once he gives the address rather than dead.
   */
  it('points a hand-set reminder at the address once notify_email lands', async () => {
    await store.saveReminder(sessionId, {
      id: customReminderId('2026-04-02', 'Collect the ring'),
      sessionId,
      userId: 'user-under-test',
      kind: 'custom',
      occursOn: '2026-04-02',
      dueAt: '2026-04-02T06:00:00.000Z',
      leadDays: 0,
      title: 'Collect the ring',
      occasion: 'Collect the ring',
      channel: 'log',
      target: null,
      sentAt: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-03-01T08:00:00.000Z',
    });

    await extracted('notify_email', 'him@example.com');
    await syncReminders(store, sessionId, new Date('2026-03-01T08:00:00Z'));

    const [row] = await store.getRemindersBySession(sessionId);
    expect(row.target).toBe('him@example.com');
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
    // Muting that did not re-plan would leave the armed row in the due-index and the
    // mail would arrive anyway — the one failure this field cannot have.
    expect(touchesReminders(['reminders_muted'])).toBe(true);
  });

  it('is false for fields no reminder depends on, and for nothing at all', () => {
    expect(touchesReminders(['favorite_cuisine', 'shoulder_width'])).toBe(false);
    expect(touchesReminders([null, undefined])).toBe(false);
    expect(touchesReminders([])).toBe(false);
  });
});
