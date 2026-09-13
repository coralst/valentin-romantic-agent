/**
 * Letting Valentin set a reminder because he was asked to.
 *
 * ## Why this exists
 *
 * Every other part of the reminder path was already built — the planner, the
 * due-index, the sweeper, the mail with a link back to the conversation. What was
 * missing was any way to create a row on purpose. A reminder existed only as a
 * *side effect* of profile extraction: writing `birthday`, `anniversary`,
 * `next_occasion` or `reminder_lead_time` trips `touchesReminders` and re-plans
 * (see `reminder-sync.ts`). Three things followed from that, all bad.
 *
 * - Asked "remind me to call the florist on Thursday", Valentin could only file it
 *   as a task nothing schedules, or as `next_occasion`, which is a single field —
 *   so the dinner on the 4th and her parents visiting on the 19th could not both
 *   be held.
 * - He could not honestly say a reminder existed. `syncReminders` swallows its own
 *   failures by design, so "I'll remind you" was a sentence with nothing behind it.
 * - Nothing could be reminded about that is not a field on her profile, which is
 *   most of what a person actually wants reminding about.
 *
 * ## Why it writes immediately instead of proposing
 *
 * `requiresConfirmation` marks tools that spend money or send something to another
 * person, where the agent's own word is not sufficient authority. A reminder is
 * none of that: it is private, it is addressed to the person who asked for it, and
 * it is undone by asking. A card between "remind me" and a reminder is friction
 * with nothing on the other side of it.
 *
 * Writing immediately is also what makes the promise honest. The tool result tells
 * the model whether the row is really there, so "I'll mail you on the 27th" is a
 * report rather than an intention — which is exactly what the side-effect path
 * could not offer.
 *
 * It also avoids a live hazard: `toolFor` in `agent-orchestrator.ts` resolves which
 * tool should handle a confirmation by scanning for the first tool with the same
 * `service` and `requiresConfirmation`, *not* by name. A confirming tool on a new
 * service is fine today and misroutes the moment a second one joins it.
 *
 * ## What it deliberately does not do
 *
 * It cannot aim at another conversation — `sessionId` comes from
 * {@link ToolContext} and is not an input — and the model does not get to say where
 * the mail goes. The address is `notify_email` on the profile, or failing that the
 * deployment's own owner (`resolveNotifyEmail`). Neither can be an argument: the
 * extraction guidance forbids *inferring* an address for exactly the reason it
 * cannot be a tool input either, which is that a guessed one reaches a stranger.
 */

import {
  REMINDER_SEND_TIME_LOCAL,
  REMINDER_ZONE,
  customReminderId,
  isPlannerKind,
  pendingReminders,
  type Reminder,
} from '../../shared/interfaces/reminder';
import { mutedReminderKinds } from '../../shared/constants/profile-fields';
import type { AgentTool, ToolContext, ToolResult } from '../integrations/tool-registry';
import { config } from '../config';
import { dueInstant } from './planner';
import { plannedChannel, profileFieldValue, syncReminders } from './reminder-sync';
import { NOTIFY_EMAIL_FIELD, resolveNotifyEmail } from './notify-email';

/** `YYYY-MM-DD`, and nothing else. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A 24-hour wall time, `HH:MM`. Kept strict so "8:30am" is refused, not misread. */
const SEND_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The longest reminder we will accept, in days out.
 *
 * Not a storage limit — a hallucination guard. A model that has mis-resolved "next
 * Tuesday" against the wrong year produces a date three centuries away, and the
 * failure mode of accepting it is a row that sits in the table for ever and a
 * confident "I'll remind you" about a date the user never said. Two years is longer
 * than any real reminder in this product and short enough to catch a wrong century.
 */
const MAX_HORIZON_DAYS = 730;

const DAY_MS = 86_400_000;

export const setReminderTool: AgentTool = {
  name: 'set_reminder',
  description:
    'Set a reminder for the user about something on a specific date. He gets an ' +
    'email at 08:30 Israel time with a link back to this conversation, or at a ' +
    'time he names. Use this whenever he asks to be reminded of something, to be ' +
    'mailed about it, or accepts your offer to remind him.\n\n' +
    'The date must be absolute (YYYY-MM-DD). Work out "next Tuesday", "the 4th" ' +
    'or "in two weeks" against the current date given at the top of your ' +
    "instructions — never guess a year, and if you cannot tell which date he means, ask.\n\n" +
    'By default the mail goes out on the morning of the date itself. Set ' +
    'remind_days_before when he wants warning ahead of it ("a week before the ' +
    'anniversary" is remind_days_before: 7).\n\n' +
    'Her birthday, your anniversary and the next occasion being planned are ' +
    'already reminded about automatically from her profile — do not duplicate ' +
    'those here. This is for everything else: an errand, a booking to make, a ' +
    'dinner, someone else\'s birthday.\n\n' +
    // The live bug this paragraph exists for: asked to be reminded a week before
    // the anniversary every year, the agent said the reminder system "can only set
    // one reminder at a time for a specific date, not a recurring annual one" and
    // then offered to file exactly the duplicate the paragraph above forbids. Both
    // halves were false. Saying what is true is a one-liner; leaving it unsaid
    // makes the model guess, and it guesses badly.
    'If he asks for something recurring or annual: the anniversary and her birthday ' +
    'already recur every year on their own, so say that plainly rather than claiming ' +
    'you cannot do recurring reminders — you are not being asked to. How much warning ' +
    'those built-in ones give is a preference on her profile, not something this tool ' +
    'sets; if he wants it changed, say so plainly instead of filing a one-off copy.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'What to remind him of, in his own words, as he would want to read it ' +
          'back: "Call the florist", "Book the Italian place for the 18th". Do ' +
          'not make it possessive or add her name.',
      },
      date: {
        type: 'string',
        description:
          'The day the thing happens, as YYYY-MM-DD. An absolute date, resolved ' +
          'against the current date in your instructions.',
      },
      remind_days_before: {
        type: 'integer',
        minimum: 0,
        maximum: 365,
        description:
          'How many days of warning he wants. Omit for the morning of the date ' +
          'itself, which is the default. 7 for "a week before".',
      },
      at_time: {
        type: 'string',
        description:
          'The time of day to send it, as 24-hour HH:MM in Israel time, when he ' +
          'names one — "mail me at seven that morning" is "07:00". Omit for the ' +
          'default of 08:30. This is the time the *mail* goes out, not the time ' +
          'of the thing itself.',
      },
    },
    required: ['title', 'date'],
  },
  service: 'reminders',
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const storage = ctx.storage;
    if (!storage) {
      // Structural rather than user-facing: a deployment wired without a store on
      // the tool path. Refuse in prose the model can pass on rather than throwing,
      // which would surface as "set_reminder could not be completed" and invite it
      // to try again.
      return {
        ok: false,
        summary:
          'Reminders are not available on this deployment, so nothing was saved. ' +
          'Tell the user plainly instead of promising to remind him.',
      };
    }

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) {
      return {
        ok: false,
        summary: 'That reminder has no subject, so nothing was saved. Ask him what to remind him of.',
      };
    }

    const date = typeof input.date === 'string' ? input.date.trim() : '';
    if (!ISO_DATE.test(date)) {
      return {
        ok: false,
        summary:
          'That is not a date I can use, so nothing was saved. A reminder needs an ' +
          'absolute day as YYYY-MM-DD — ask him which date he means rather than guessing.',
      };
    }

    if (!isRealDate(date)) {
      return {
        ok: false,
        summary:
          `${date} is not a real date — check the day against the calendar. Nothing was ` +
          'saved; ask him which day he means.',
      };
    }

    const leadDays = normaliseLead(input.remind_days_before);
    if (leadDays === null) {
      return {
        ok: false,
        summary:
          'That amount of warning does not make sense, so nothing was saved. Ask how ' +
          'much notice he wants before the date.',
      };
    }

    /*
     * A named time is validated here and refused, rather than silently defaulted.
     *
     * `dueInstant` falls back to the default on anything it cannot parse, which is
     * the right call inside the planner — a malformed hour must not cost a birthday
     * its reminder. It is the wrong call for a time the user just said out loud: he
     * would be told "08:30" after asking for something else, or worse, told the time
     * he asked for while the row carries another. So the tool checks the format
     * first and hands the refusal back to him.
     */
    const atTimeInput = typeof input.at_time === 'string' ? input.at_time.trim() : '';
    if (atTimeInput && !SEND_TIME.test(atTimeInput)) {
      return {
        ok: false,
        summary:
          `"${atTimeInput}" is not a time I can send at, so nothing was saved. Ask him ` +
          'for it as a 24-hour clock time, or offer the usual 08:30.',
      };
    }

    const dueAt = dueInstant(date, leadDays, atTimeInput || undefined);
    if (!dueAt) {
      // Belt and braces: `isRealDate` has already caught everything known to reach
      // here, so this is the unparseable case nobody has thought of rather than a
      // path with a diagnosis to offer.
      return {
        ok: false,
        summary:
          `I could not work out when to send a reminder for ${date}, so nothing was ` +
          'saved. Ask him for the date again.',
      };
    }

    const now = new Date();
    if (dueAt.getTime() <= now.getTime()) {
      // The planner returns null here and says nothing, which is right for a date
      // derived from a profile field — a birthday whose reminder moment has passed
      // is simply not planned. A reminder the user just asked for is different: the
      // refusal has to reach him, or he is left believing it was set.
      return {
        ok: false,
        summary:
          `The moment to send that has already passed (it would have gone out ${describeInstant(dueAt)}), ` +
          'so nothing was saved. Say so and offer a date, or less warning, that is still ahead.',
      };
    }

    if (dueAt.getTime() - now.getTime() > MAX_HORIZON_DAYS * DAY_MS) {
      return {
        ok: false,
        summary:
          `${date} is more than two years away, which is almost certainly not the ` +
          'date he meant — nothing was saved. Check the year with him.',
      };
    }

    const [preferences, manual] = await Promise.all([
      storage.getPreferencesBySession(ctx.sessionId),
      storage.getManualValues(ctx.sessionId),
    ]);
    const target = resolveNotifyEmail(
      profileFieldValue(NOTIFY_EMAIL_FIELD, manual, preferences),
    );

    const reminder: Reminder = {
      id: customReminderId(date, title),
      // Both stores overwrite these from their own scope, and `reminder-sync.ts`
      // passes empty strings for the same reason: there is no honest value here and
      // inventing one is only a lie the store then corrects.
      sessionId: '',
      userId: '',
      kind: 'custom',
      occursOn: date,
      dueAt: dueAt.toISOString(),
      leadDays,
      title,
      // `occasion` is required and is what every existing reader falls back to. The
      // title serves as both; `email-body.ts` prefers `title` and so never inflects it.
      occasion: title,
      channel: plannedChannel(config.reminders.channel),
      target,
      sentAt: null,
      attempts: 0,
      lastError: null,
      createdAt: now.toISOString(),
    };

    await storage.saveReminder(ctx.sessionId, reminder);

    const when = describeInstant(dueAt);
    if (!target) {
      // Saved anyway, deliberately. The row is the record that this was asked for,
      // and `adoptTarget` in `reminder-sync.ts` points it at the address the moment
      // `notify_email` lands — so the reminder survives being set before Valentin
      // knew where to write.
      return {
        ok: true,
        summary:
          `The reminder is saved: "${title}" on ${date}, to go out ${when}. But there is no ` +
          'email address on file for him, so it cannot actually be sent yet. Tell him it is ' +
          'noted, and ask what address he wants reminders at — once he gives it, this one ' +
          'will go out on its own.',
        data: { id: reminder.id, dueAt: reminder.dueAt, occursOn: date, target: null },
      };
    }

    return {
      ok: true,
      summary:
        `Saved. The reminder "${title}" for ${date} will be emailed to ${target} ${when}, with a ` +
        'link back to this conversation. Confirm it to him in your own words, saying when it ' +
        'will reach him — it is really set, so you can say so plainly.',
      data: { id: reminder.id, dueAt: reminder.dueAt, occursOn: date, target },
    };
  },
};

/**
 * Whether a well-formed `YYYY-MM-DD` names a day that exists.
 *
 * The shape check is not enough and `parseInZone` will not catch this: it builds the
 * instant through `Date.UTC`, which *rolls over* rather than rejecting, so
 * `2027-02-31` becomes the 3rd of March. Left alone, a model that mis-counted the
 * days in a month would have the reminder quietly filed three days late, and both the
 * tool result and Valentin's confirmation would name the date he asked for.
 *
 * Checked by round-tripping the components rather than by a table of month lengths,
 * which gets February right in every year for free.
 */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day
  );
}

/**
 * The lead time, or `null` for something that is not a number of days.
 *
 * Absent means zero — the morning of the date. That is the right default for what
 * this tool mostly gets asked for ("remind me Thursday"), where the profile's
 * `reminder_lead_time` would be wrong twice over: it defaults to a whole week when
 * unset, and it is a preference about *occasions*, not about errands.
 */
function normaliseLead(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  const days = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days)) return null;
  if (days < 0 || days > 365) return null;
  return days;
}

/**
 * The send moment as the user's own calendar reads it.
 *
 * In {@link REMINDER_ZONE} rather than UTC, because the summary is quoted back into
 * the conversation and "05:30Z" is not a time anybody recognises as half past eight
 * in the morning.
 *
 * The time is read off the instant rather than off {@link REMINDER_SEND_TIME_LOCAL},
 * because a caller may now have named their own — "mail me at seven" — and quoting
 * the default back at them would promise the wrong thing.
 */
function describeInstant(at: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `on ${day} at ${time} Israel time`;
}

/**
 * Everything armed and not yet sent, in his own terms.
 *
 * ## Why this is a tool and not left to the prompt
 *
 * Before it existed the only record that a reminder had been set was the sentence
 * `set_reminder` returned into a single turn. Asked two messages later what it was
 * going to remind him about, the model had nothing to read and answered from the
 * transcript — so a reminder set in an earlier conversation did not exist as far as it
 * was concerned, and one it had merely *offered* could be described as armed. Both
 * directions are wrong and neither is visible.
 *
 * Reads through {@link pendingReminders}, the same filter the profile page applies, so
 * what Valentin says is armed and what the page draws cannot disagree.
 */
export const listRemindersTool: AgentTool = {
  name: 'list_reminders',
  description:
    'List the reminders currently set for the user — what each one is about, the ' +
    'date it concerns, and when the email goes out. Call this whenever he asks what ' +
    'you are reminding him about, whether something is already set, or before you ' +
    'offer to remind him of something that may already be covered. Read the answer ' +
    'rather than recalling it from the conversation: reminders persist across ' +
    'conversations and some of these were set long before this one.',
  input_schema: { type: 'object', properties: {} },
  service: 'reminders',
  requiresConfirmation: false,

  async execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const storage = ctx.storage;
    if (!storage) {
      return {
        ok: false,
        summary:
          'Reminders are not available on this deployment, so there is nothing to list. ' +
          'Tell the user plainly rather than saying none are set.',
      };
    }

    const pending = pendingReminders(await storage.getRemindersBySession(ctx.sessionId));

    if (pending.length === 0) {
      return {
        ok: true,
        summary:
          'Nothing is set at the moment. Say so plainly — and note that her birthday, ' +
          'your anniversary and the occasion being planned only arm themselves once ' +
          'those dates are on her profile, so if he expected one, the date may be missing.',
        data: { reminders: [] },
      };
    }

    const lines = pending.map((reminder) => {
      // `title` for a hand-set one, `occasion` for a planner row — the same
      // preference `email-body` applies, so the two describe a row identically.
      const what = reminder.title?.trim() || reminder.occasion;
      const how = isPlannerKind(reminder.kind)
        ? `from her profile (${reminder.kind})`
        : 'set by hand';
      return `- "${what}" — about ${reminder.occursOn}, mailing ${describeInstant(
        new Date(reminder.dueAt),
      )}, ${how}`;
    });

    return {
      ok: true,
      summary:
        `${pending.length} reminder${pending.length === 1 ? '' : 's'} armed:\n${lines.join('\n')}\n\n` +
        'Tell him about these in your own words. A profile one is cancelled by muting ' +
        'that kind, a hand-set one by dropping it — cancel_reminder handles either.',
      data: {
        reminders: pending.map((reminder) => ({
          id: reminder.id,
          kind: reminder.kind,
          what: reminder.title?.trim() || reminder.occasion,
          occursOn: reminder.occursOn,
          dueAt: reminder.dueAt,
        })),
      },
    };
  },
};

/**
 * Stop one reminder, by whichever of the two mechanisms actually holds.
 *
 * ## Why this cannot just be a delete
 *
 * A `custom` row is the user's own note and deleting it is the whole story. A planner
 * row is *derived*: `syncReminders` rebuilds birthday, anniversary and occasion rows
 * from her profile on every edit to a reminder field, so a deleted one reappears the
 * next time anything touches the profile. Deleting it would work, visibly, and then
 * silently undo itself — the worst available outcome, because the user watched it
 * succeed. Muting the kind is the write that lasts, and `reapSuperseded` then removes
 * the row on the same sync.
 *
 * So this branches on `isPlannerKind` and performs whichever write is durable. It is
 * the one place that knows the difference; the model is not asked to.
 *
 * ## Why it is not gated behind a confirmation
 *
 * Same argument as `set_reminder`, and one structural constraint on top: `toolFor` in
 * `agent-orchestrator.ts` resolves a `confirm_*` call by scanning for the first tool
 * with the matching `service` *and* `requiresConfirmation` — by service, not by name.
 * A second gated reminders tool would therefore be reachable by the wrong
 * confirmation. Both tools here stay ungated, which keeps that resolution unambiguous.
 */
export const cancelReminderTool: AgentTool = {
  name: 'cancel_reminder',
  description:
    'Stop a reminder the user no longer wants. Say which one in his own words — ' +
    '"the florist", "her birthday" — or pass the id from list_reminders. Call ' +
    'list_reminders first if you are not sure what is set.\n\n' +
    'This handles both kinds: a reminder he set by hand is dropped, and one that ' +
    'comes from her profile (her birthday, your anniversary, the occasion being ' +
    'planned) is muted so it does not come back. You do not need to know which is ' +
    'which. Report what actually happened rather than assuming it was a deletion.',
  input_schema: {
    type: 'object',
    properties: {
      reminder: {
        type: 'string',
        description:
          'Which reminder to stop: the id from list_reminders, or enough of what it ' +
          'is about to identify it — "florist", "birthday".',
      },
    },
    required: ['reminder'],
  },
  service: 'reminders',
  requiresConfirmation: false,

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const storage = ctx.storage;
    if (!storage) {
      return {
        ok: false,
        summary:
          'Reminders are not available on this deployment, so nothing was cancelled. ' +
          'Tell the user plainly rather than confirming a cancellation.',
      };
    }

    const wanted = typeof input.reminder === 'string' ? input.reminder.trim() : '';
    if (!wanted) {
      return {
        ok: false,
        summary:
          'Nothing was cancelled — I was not told which reminder. Ask him which one he means.',
      };
    }

    const pending = pendingReminders(await storage.getRemindersBySession(ctx.sessionId));
    const matches = matchReminders(pending, wanted);

    if (matches.length === 0) {
      return {
        ok: false,
        summary:
          `Nothing matching "${wanted}" is set, so nothing was cancelled. ` +
          (pending.length === 0
            ? 'In fact nothing is set at all — say so rather than confirming a cancellation.'
            : `What is armed: ${pending
                .map((reminder) => `"${reminder.title?.trim() || reminder.occasion}"`)
                .join(', ')}. Ask him which he meant.`),
      };
    }

    /*
     * Ambiguity is a refusal, not a guess.
     *
     * "the dinner" can match two rows, and cancelling the wrong one is silent: the
     * user hears that it is off and then gets mailed about it anyway, or does not get
     * mailed about the thing he still wanted.
     */
    if (matches.length > 1) {
      return {
        ok: false,
        summary:
          `"${wanted}" matches more than one reminder, so nothing was cancelled: ` +
          `${matches
            .map((reminder) => `"${reminder.title?.trim() || reminder.occasion}" (${reminder.occursOn})`)
            .join(', ')}. Ask him which one he means.`,
      };
    }

    const [reminder] = matches;
    const what = reminder.title?.trim() || reminder.occasion;

    if (isPlannerKind(reminder.kind)) {
      // Muted by kind, and the existing value is preserved: muting the birthday must
      // not un-mute an anniversary he silenced last week.
      const manual = await storage.getManualValues(ctx.sessionId);
      const preferences = await storage.getPreferencesBySession(ctx.sessionId);
      const already = mutedReminderKinds(
        profileFieldValue(MUTED_FIELD, manual, preferences),
      );
      const muted = [...new Set([...already, reminder.kind])];

      await storage.setManualValue(ctx.sessionId, MUTED_FIELD, muted.join(', '));
      // The mute is only half the write: `syncReminders` is what reaps the row that
      // is already armed. Without it the reminder stays in the due-index and mails
      // anyway, which is exactly the failure this tool exists to prevent.
      await syncReminders(storage, ctx.sessionId);

      return {
        ok: true,
        summary:
          `Done — ${reminder.kind} reminders are muted now, so the one about ${what} on ` +
          `${reminder.occursOn} will not go out and no new one will be armed. He can have ` +
          'them back by asking. Confirm it in your own words.',
        data: { id: reminder.id, kind: reminder.kind, action: 'muted', muted },
      };
    }

    await storage.deleteReminder(ctx.sessionId, reminder.id);
    return {
      ok: true,
      summary:
        `Done — the reminder "${what}" for ${reminder.occursOn} is cancelled and will not ` +
        'be sent. Confirm it in your own words.',
      data: { id: reminder.id, kind: reminder.kind, action: 'deleted' },
    };
  },
};

/** The profile field holding the muted kinds, as `mutedReminderKinds` parses it. */
const MUTED_FIELD = 'reminders_muted';

/**
 * The pending rows a user's phrase refers to.
 *
 * An exact id first, so an id taken from `list_reminders` can never be re-interpreted
 * as free text — a hash like `1f2e3d4c` would otherwise be matched as a substring of
 * nothing and quietly become a no-match.
 *
 * Then a case-insensitive substring both ways round, against the title and the
 * occasion: "birthday" should find "her birthday", and "her birthday is coming"
 * should find it too. Deliberately not fuzzy — the caller resolves ambiguity by
 * asking, which is cheaper than being wrong about which reminder to drop.
 */
function matchReminders(pending: readonly Reminder[], wanted: string): Reminder[] {
  const exact = pending.filter((reminder) => reminder.id === wanted);
  if (exact.length > 0) return exact;

  const needle = wanted.toLowerCase();
  return pending.filter((reminder) => {
    const haystacks = [reminder.title ?? '', reminder.occasion, reminder.kind].map((text) =>
      text.toLowerCase(),
    );
    return haystacks.some((text) => text.includes(needle) || needle.includes(text));
  });
}

/** Registered as one array, the shape `buildToolRegistry` expects of every service. */
export const reminderTools: AgentTool[] = [
  setReminderTool,
  listRemindersTool,
  cancelReminderTool,
];
