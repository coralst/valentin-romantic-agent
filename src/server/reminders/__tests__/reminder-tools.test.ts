import { describe, it, expect, beforeEach } from 'vitest';
import { setReminderTool } from '../tools';
import { buildToolRegistry } from '../../integrations';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import { REMINDER_ZONE } from '../../../shared/interfaces/reminder';
import type { Reminder } from '../../../shared/interfaces/reminder';

/**
 * The gap this file covers: until now a reminder could only be created as a side
 * effect of profile extraction, so "remind me to call the florist on Thursday" had
 * nowhere to go, and Valentin's "I'll remind you" was a sentence with nothing behind
 * it.
 *
 * A real store rather than a mock, like `reminder-sync.test.ts`, and for the same
 * reason: most of what can go wrong here is about the *row* — its id, its due
 * instant, whether a second reminder on the same day overwrites the first — and a
 * mocked `saveReminder` asserts only that the tool called something.
 */

/** A date far enough out that the fixture does not expire with the calendar. */
function daysFromNow(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The wall clock in Israel for a stored `dueAt`, so assertions read as his day. */
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

describe('set_reminder', () => {
  let store: StorageInterface;
  let sessionId: string;

  beforeEach(async () => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    sessionId = await store.createSession();
  });

  function ctx() {
    return { sessionId, userId: 'user-under-test', storage: store };
  }

  async function rows(): Promise<Reminder[]> {
    return store.getRemindersBySession(sessionId);
  }

  async function notifyEmail(value: string): Promise<void> {
    await store.setManualValue(sessionId, 'notify_email', value);
  }

  it('is registered, so the model can actually reach it', () => {
    expect(buildToolRegistry().has('set_reminder')).toBe(true);
  });

  /*
   * Not a style preference. `toolFor` in `agent-orchestrator.ts` resolves a
   * confirmation by matching `service` and `requiresConfirmation`, not by name — so
   * a confirming tool on a fresh service would start receiving another tool's
   * confirms the moment a second one joined `reminders`.
   */
  it('needs no confirmation — the reminder is his own note to himself', () => {
    expect(setReminderTool.requiresConfirmation).toBe(false);
    expect(setReminderTool.confirm).toBeUndefined();
    expect(setReminderTool.service).toBe('reminders');
  });

  it('asks for exactly the four things it needs, title and date required', () => {
    const schema = setReminderTool.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      'at_time',
      'date',
      'remind_days_before',
      'title',
    ]);
    expect(schema.required.sort()).toEqual(['date', 'title']);
  });

  it('writes one pending row due at 08:30 Israel on the day itself', async () => {
    await notifyEmail('him@example.com');
    const date = daysFromNow(10);

    const result = await setReminderTool.execute(
      { title: 'Call the florist', date },
      ctx(),
    );

    expect(result.ok).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({
      kind: 'custom',
      occursOn: date,
      title: 'Call the florist',
      leadDays: 0,
      target: 'him@example.com',
      sentAt: null,
      attempts: 0,
    });
    // The default is the morning of the thing, not a week before it — the profile's
    // `reminder_lead_time` is about occasions and would be wrong here.
    expect(wall(row.dueAt)).toBe(`${date}T08:30`);
  });

  /*
   * The DST case, which is the whole reason the tool calls `dueInstant` instead of
   * subtracting `leadDays * 86_400_000`. Millisecond arithmetic across an Israeli
   * clock change mails at 08:00 for half the year.
   */
  it('honours a lead time by calendar day, not by elapsed milliseconds', async () => {
    const result = await setReminderTool.execute(
      { title: 'Book the Italian place', date: '2027-04-01', remind_days_before: 7 },
      ctx(),
    );

    expect(result.ok).toBe(true);
    const [row] = await rows();
    expect(row.leadDays).toBe(7);
    expect(wall(row.dueAt)).toBe('2027-03-25T08:30');
  });

  /*
   * The scheduling half of "mail me about this, and mail me *then*". Without it the
   * only send time in the product is 08:30, so "text me the evening before" could be
   * agreed to in prose and quietly filed for the morning.
   */
  it('sends at the time he named instead of the default', async () => {
    const date = daysFromNow(20);
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date, at_time: '19:45' },
      ctx(),
    );

    expect(result.ok).toBe(true);
    const [row] = await rows();
    expect(wall(row.dueAt)).toBe(`${date}T19:45`);
    // Quoted back off the instant, not off the default — a promise of 08:30 for a
    // mail arriving at a quarter to eight is the small lie this avoids.
    expect(result.summary).toMatch(/19:45 Israel/);
  });

  it('combines a named time with a lead time, on the earlier day', async () => {
    const result = await setReminderTool.execute(
      { title: 'Book the Italian place', date: '2027-04-01', remind_days_before: 7, at_time: '07:00' },
      ctx(),
    );

    expect(result.ok).toBe(true);
    const [row] = await rows();
    expect(wall(row.dueAt)).toBe('2027-03-25T07:00');
  });

  /*
   * Refused rather than defaulted. `dueInstant` falls back to 08:30 on anything it
   * cannot parse, which is right inside the planner — a malformed hour must not cost
   * a birthday its reminder — and wrong for a time he just said out loud, where the
   * failure is being told the wrong time or being told his own and getting another.
   */
  it('refuses a time it cannot read rather than silently using 08:30', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: daysFromNow(9), at_time: '8:30am' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/08:30/);
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a time that is not on a clock', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: daysFromNow(9), at_time: '25:00' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it('records the title as the occasion too, so every existing reader still works', async () => {
    await setReminderTool.execute({ title: 'Ring her sister', date: daysFromNow(5) }, ctx());
    const [row] = await rows();
    expect(row.occasion).toBe('Ring her sister');
  });

  /*
   * `reminderId(kind, occursOn)` is `${kind}-${occursOn}` and would collide, so the
   * second reminder on a day would silently replace the first — the user would be
   * told twice that it was set and reminded once.
   */
  it('keeps two different reminders on the same day apart', async () => {
    const date = daysFromNow(12);
    await setReminderTool.execute({ title: 'Call the florist', date }, ctx());
    await setReminderTool.execute({ title: 'Collect the ring', date }, ctx());

    const saved = await rows();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((r) => r.id)).size).toBe(2);
  });

  it('overwrites in place when he asks for the same thing twice', async () => {
    const date = daysFromNow(12);
    await setReminderTool.execute({ title: 'Call the florist', date }, ctx());
    await setReminderTool.execute({ title: '  call the FLORIST ', date }, ctx());

    // Same thing said differently is the same reminder — the id hashes a normalised
    // title, so repeating himself is harmless rather than duplicating the mail.
    expect(await rows()).toHaveLength(1);
  });

  it('refuses a date whose moment has already gone, out loud', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: '2020-02-14' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/already passed/i);
    // The planner drops a past reminder silently, which is right for a birthday and
    // wrong here: a refusal nobody hears leaves him believing it was set.
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a relative date rather than filing it as a literal', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: 'next Thursday' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/YYYY-MM-DD/);
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a day that is not on the calendar', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: '2027-02-31' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  /*
   * The hallucinated-year guard. A model that resolved "next Tuesday" against its
   * training cutoff produces a plausible string in the wrong century, and accepting
   * it means a confident "I'll remind you" about a date he never said.
   */
  it('refuses a date implausibly far out rather than filing it for ever', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: '2231-03-04' },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/two years/i);
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a reminder with nothing in it', async () => {
    const result = await setReminderTool.execute(
      { title: '   ', date: daysFromNow(4) },
      ctx(),
    );

    expect(result.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  /*
   * Saved anyway, and this is the deliberate half of the design: `adoptTarget` in
   * `reminder-sync.ts` points the row at the address the moment `notify_email`
   * lands, so a reminder set before Valentin knew where to write still goes out.
   */
  it('saves the row even with no address on file, and says so', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: daysFromNow(6) },
      ctx(),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/address/i);
    const [row] = await rows();
    expect(row.target).toBeNull();
  });

  it('prefers the address he typed over the one that was inferred', async () => {
    await store.savePreference({
      sessionId,
      category: 'important_dates',
      key: 'notify_email',
      fieldId: 'notify_email',
      value: 'guessed@example.com',
      confidence: 0.6,
      sourceMessageId: 'msg-1',
    });
    await notifyEmail('typed@example.com');

    await setReminderTool.execute({ title: 'Call the florist', date: daysFromNow(3) }, ctx());

    const [row] = await rows();
    expect(row.target).toBe('typed@example.com');
  });

  it('tells the model when and where the mail will land, so it can say so honestly', async () => {
    await notifyEmail('him@example.com');
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: '2027-04-01' },
      ctx(),
    );

    expect(result.summary).toContain('him@example.com');
    expect(result.summary).toContain('2027-04-01');
    expect(result.summary).toMatch(/08:30 Israel/);
  });

  /*
   * Refuses rather than throws. `runTool` would turn a throw into "set_reminder
   * could not be completed", which reads to the model as a transient fault worth
   * retrying — and every retry would fail the same way.
   */
  it('refuses politely when the deployment gave it no store', async () => {
    const result = await setReminderTool.execute(
      { title: 'Call the florist', date: daysFromNow(4) },
      { sessionId, userId: 'user-under-test' },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not available/i);
  });
});
