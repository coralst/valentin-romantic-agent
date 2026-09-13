import { describe, it, expect, beforeEach } from 'vitest';
import { cancelReminderTool, listRemindersTool, setReminderTool } from '../tools';
import { buildToolRegistry } from '../../integrations';
import { syncReminders } from '../reminder-sync';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import { REMINDER_ZONE, type Reminder } from '../../../shared/interfaces/reminder';

/**
 * The gap this file covers: a reminder was write-only. `set_reminder` returned one
 * sentence into one turn and nothing could read the rows back — so asked two messages
 * later what it was reminding him about, the model answered from the transcript, and a
 * reminder set in an earlier conversation did not exist as far as it was concerned.
 *
 * A real store rather than a mock, for the reason `reminder-tools.test.ts` gives: what
 * can go wrong here is about the rows — which one a phrase matches, whether cancelling
 * a derived one actually sticks — and a mocked store asserts only that a call happened.
 */

/** A date far enough out that the fixture does not expire with the calendar. */
function daysFromNow(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

describe('list_reminders and cancel_reminder', () => {
  let store: StorageInterface;
  let sessionId: string;

  beforeEach(async () => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    sessionId = await store.createSession();
    await store.setManualValue(sessionId, 'notify_email', 'him@example.com');
  });

  function ctx() {
    return { sessionId, userId: 'user-under-test', storage: store };
  }

  async function rows(): Promise<Reminder[]> {
    return store.getRemindersBySession(sessionId);
  }

  /** One hand-set reminder, through the real tool, so the row is the real shape. */
  async function setByHand(title: string, days = 10): Promise<void> {
    const result = await setReminderTool.execute(
      { title, date: daysFromNow(days) },
      ctx(),
    );
    expect(result.ok).toBe(true);
  }

  /** A birthday on her profile, armed the way a chat turn arms it. */
  async function birthdayOnProfile(days = 20): Promise<void> {
    await store.setManualValue(sessionId, 'birthday', daysFromNow(days));
    await syncReminders(store, sessionId);
    expect((await rows()).some((row) => row.kind === 'birthday')).toBe(true);
  }

  it('registers both, so the model can actually reach them', () => {
    const registry = buildToolRegistry();
    expect(registry.has('list_reminders')).toBe(true);
    expect(registry.has('cancel_reminder')).toBe(true);
  });

  /*
   * Structural, not stylistic. `toolFor` in `agent-orchestrator.ts` resolves a
   * `confirm_*` call by scanning for the first tool with the matching `service` *and*
   * `requiresConfirmation` — by service, not by name. A gated tool on `reminders`
   * would start receiving another reminders tool's confirmations.
   */
  it('leaves both ungated, so confirm resolution by service stays unambiguous', () => {
    for (const tool of [listRemindersTool, cancelReminderTool]) {
      expect(tool.requiresConfirmation).toBe(false);
      expect(tool.confirm).toBeUndefined();
      expect(tool.service).toBe('reminders');
    }
  });

  describe('list_reminders', () => {
    it('says plainly that nothing is set rather than inventing one', async () => {
      const result = await listRemindersTool.execute({}, ctx());

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ reminders: [] });
      expect(result.summary).toContain('Nothing is set');
    });

    it('names a hand-set reminder by its own words, not the possessive', async () => {
      await setByHand('call the florist');

      const result = await listRemindersTool.execute({}, ctx());

      expect(result.summary).toContain('call the florist');
      // The bug the `toReminder` fix was about: with `title` lost, the only thing
      // left to print is `occasion`, which readers inflect into "her ...".
      expect(result.summary).not.toContain('Her call the florist');
    });

    it('distinguishes a profile-derived reminder from a hand-set one', async () => {
      await birthdayOnProfile();
      await setByHand('call the florist');

      const result = await listRemindersTool.execute({}, ctx());

      expect(result.summary).toContain('from her profile');
      expect(result.summary).toContain('set by hand');
    });

    it('orders them soonest first, so the next thing is the first thing said', async () => {
      await setByHand('the later one', 30);
      await setByHand('the sooner one', 5);

      const result = await listRemindersTool.execute({}, ctx());
      const listed = (result.data as { reminders: { what: string }[] }).reminders;

      expect(listed.map((entry) => entry.what)).toEqual(['the sooner one', 'the later one']);
    });

    /*
     * A sent reminder is not armed. It stays in the table as the idempotency record —
     * `syncReminders` reads `sentAt` to avoid re-arming it — so a list that showed it
     * would tell the user he is about to be mailed about something he already was.
     */
    it('omits a reminder that has already gone out', async () => {
      await setByHand('call the florist');
      const [armed] = await rows();
      await store.saveReminder(sessionId, { ...armed, sentAt: new Date().toISOString() });

      const result = await listRemindersTool.execute({}, ctx());

      expect((result.data as { reminders: unknown[] }).reminders).toHaveLength(0);
    });

    it('refuses in prose when the deployment has no store', async () => {
      const result = await listRemindersTool.execute(
        {},
        { sessionId, userId: 'user-under-test' },
      );

      expect(result.ok).toBe(false);
      expect(result.summary).toContain('not available on this deployment');
    });
  });

  describe('cancel_reminder', () => {
    it('drops a hand-set reminder named loosely', async () => {
      await setByHand('call the florist');

      const result = await cancelReminderTool.execute({ reminder: 'florist' }, ctx());

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ action: 'deleted' });
      expect(await rows()).toHaveLength(0);
    });

    it('accepts the id list_reminders handed out', async () => {
      await setByHand('call the florist');
      const listed = (
        (await listRemindersTool.execute({}, ctx())).data as { reminders: { id: string }[] }
      ).reminders;

      const result = await cancelReminderTool.execute({ reminder: listed[0].id }, ctx());

      expect(result.ok).toBe(true);
      expect(await rows()).toHaveLength(0);
    });

    /*
     * The whole reason this tool is not a delete.
     *
     * A birthday row is re-derived from the profile by `syncReminders` on every edit to
     * a reminder field, so deleting it would succeed, visibly, and then come back the
     * next time anything touched the profile. Muting is the write that lasts — and the
     * assertion that matters is the second sync, which is what used to undo it.
     */
    it('mutes a profile reminder instead of deleting it, and it stays gone', async () => {
      await birthdayOnProfile();

      const result = await cancelReminderTool.execute({ reminder: 'birthday' }, ctx());

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ action: 'muted', kind: 'birthday' });
      expect((await rows()).some((row) => row.kind === 'birthday')).toBe(false);
      expect(await store.getManualValues(sessionId)).toMatchObject({
        reminders_muted: 'birthday',
      });

      // The re-plan that used to bring it back.
      await syncReminders(store, sessionId);
      expect((await rows()).some((row) => row.kind === 'birthday')).toBe(false);
    });

    it('muting one kind does not un-mute another he already silenced', async () => {
      await store.setManualValue(sessionId, 'reminders_muted', 'anniversary');
      await birthdayOnProfile();

      await cancelReminderTool.execute({ reminder: 'birthday' }, ctx());

      const muted = (await store.getManualValues(sessionId)).reminders_muted;
      expect(muted).toContain('anniversary');
      expect(muted).toContain('birthday');
    });

    /*
     * Ambiguity is a refusal. Cancelling the wrong row is silent in both directions:
     * he hears one thing is off and gets mailed about it anyway, or stops hearing
     * about the one he still wanted.
     */
    it('cancels nothing when the phrase matches two reminders', async () => {
      await setByHand('dinner at Ontopo', 8);
      await setByHand('dinner with her parents', 12);

      const result = await cancelReminderTool.execute({ reminder: 'dinner' }, ctx());

      expect(result.ok).toBe(false);
      expect(result.summary).toContain('more than one');
      expect(await rows()).toHaveLength(2);
    });

    it('cancels nothing when the phrase matches none, and says what is armed', async () => {
      await setByHand('call the florist');

      const result = await cancelReminderTool.execute({ reminder: 'the dentist' }, ctx());

      expect(result.ok).toBe(false);
      expect(result.summary).toContain('call the florist');
      expect(await rows()).toHaveLength(1);
    });

    it('does not touch a reminder that has already been sent', async () => {
      await setByHand('call the florist');
      const [armed] = await rows();
      await store.saveReminder(sessionId, { ...armed, sentAt: new Date().toISOString() });

      const result = await cancelReminderTool.execute({ reminder: 'florist' }, ctx());

      // Nothing pending matches, so there is nothing to cancel — and the sent row
      // survives, because it is what stops the reminder being armed again.
      expect(result.ok).toBe(false);
      expect(await rows()).toHaveLength(1);
    });

    it('refuses an empty subject rather than guessing which one he meant', async () => {
      await setByHand('call the florist');

      const result = await cancelReminderTool.execute({ reminder: '  ' }, ctx());

      expect(result.ok).toBe(false);
      expect(await rows()).toHaveLength(1);
    });

    it('refuses in prose when the deployment has no store', async () => {
      const result = await cancelReminderTool.execute(
        { reminder: 'florist' },
        { sessionId, userId: 'user-under-test' },
      );

      expect(result.ok).toBe(false);
      expect(result.summary).toContain('not available on this deployment');
    });
  });
});
