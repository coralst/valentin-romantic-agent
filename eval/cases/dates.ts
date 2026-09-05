/**
 * "It thinks the wrong date."
 *
 * Every case here pins a *relative* expression to the absolute day the tool was
 * actually given. The instant is injected via `buildSystemPrompt(..., now)`, so the
 * cases that matter — the ones just after Israeli midnight, where the container's
 * UTC day and the Israeli day disagree — can be run at any real hour.
 *
 * Instants stay within ±36h of real time: Ontopo and Amadeus reject past dates and
 * the tools read the real clock internally, so a frozen 2027 would fail for reasons
 * that have nothing to do with the agent. Year-scale arithmetic is L1's job.
 */
import { all, everyDateIs, everyDateIsIso, noDateBefore, shiftDays } from '../harness/args';
import { hebrewDateFor, israelLocalDate } from '../harness/oracles';
import type { EvalCase } from '../harness/assertions';

const FACTS = [
  { key: 'partner_name', value: 'Maya' },
  { key: 'favorite_cuisine', value: 'Italian' },
  { key: 'anniversary', value: '2019-06-14' },
] as const;

/** Israeli 00:30 on the day after the real one — the UTC/Israel split window. */
function justAfterIsraeliMidnight(real: Date): Date {
  const tomorrow = shiftDays(israelLocalDate(real), 1);
  // 00:30 Israel is 21:30 or 22:30 UTC the previous day, so the container's
  // `getDate()` and the Israeli calendar day differ — exactly the condition under
  // which `hebrewDateOf` reads the wrong day.
  return new Date(`${tomorrow}T00:30:00+03:00`);
}

/** Israeli 23:45, where "tomorrow morning" is 15 minutes away. */
function lateEvening(real: Date): Date {
  return new Date(`${israelLocalDate(real)}T23:45:00+03:00`);
}

export const dateCases: readonly EvalCase[] = [
  {
    id: 'DATE-01',
    group: 'dates',
    severity: 'high',
    why: 'A bare "tomorrow" must reach the tool as the Israeli tomorrow, not the UTC one.',
    turns: ['Book us somewhere Italian tomorrow evening, around 8.'],
    facts: FACTS,
    at: justAfterIsraeliMidnight,
    expect: {
      calledTool: ['find_restaurants', 'check_availability', 'propose_reservation'],
      args: (calls, ctx) =>
        all(
          everyDateIsIso,
          (c) => everyDateIs(c, shiftDays(ctx.nowLocalDate, 1)),
        )(calls),
      maxMs: 90_000,
    },
  },
  {
    id: 'DATE-02',
    group: 'dates',
    severity: 'high',
    why: 'At 23:45 Israel, "tomorrow morning" is the next calendar day — not two days out, and not today.',
    turns: ['Remind me tomorrow morning to pick up flowers for Maya.'],
    facts: FACTS,
    at: lateEvening,
    expect: {
      calledTool: ['set_reminder'],
      args: (calls, ctx) => everyDateIs(calls, shiftDays(ctx.nowLocalDate, 1)),
      maxMs: 60_000,
    },
  },
  {
    id: 'DATE-03',
    group: 'dates',
    severity: 'high',
    why: 'Confirmed bug #1: hebrewDateOf reads process-local components, so on a UTC host the Hebrew date beside a correct Israeli civil date is a day off between roughly 00:00 and 03:00 Israel.',
    turns: ['What is the Hebrew date today?'],
    facts: FACTS,
    at: justAfterIsraeliMidnight,
    expect: {
      maxMs: 60_000,
      oracle: async (outcome, ctx) => {
        const truth = await hebrewDateFor(ctx.nowLocalDate);
        // The agent may render the month as Elul or Elul 5786; the day number is
        // the part that goes wrong, so that is what is asserted.
        const claimed = /(\d{1,2})\s+([A-Z][a-z']+)/.exec(outcome.reply);
        if (!claimed) return `the reply named no Hebrew date at all: ${outcome.reply.slice(0, 200)}`;

        const claimedDay = Number(claimed[1]);
        if (claimedDay === truth.day) return true;
        return `agent said "${claimed[0]}" for the Israeli day ${ctx.nowLocalDate}; hebcal says ${truth.text}`;
      },
    },
  },
  {
    id: 'DATE-04',
    group: 'dates',
    severity: 'medium',
    why: '"Next Friday" asked on a Friday is the ambiguous case; either reading is defensible but a past date never is, and the reply must say which day it picked.',
    turns: ['Can you find us a table next Friday?'],
    facts: FACTS,
    expect: {
      // Checking Shabbat before offering a Friday table is correct, so no specific
      // tool is required — only that whatever it consulted got a sane forward date.
      args: (calls, ctx) =>
        all(everyDateIsIso, (c) => noDateBefore(c, ctx.nowLocalDate))(calls),
      // Naming the day is what lets the user catch a wrong guess.
      replyMatches: [/\b(\d{1,2}(?:st|nd|rd|th)?|Friday)\b/i],
      maxMs: 90_000,
    },
  },
  {
    id: 'DATE-05',
    group: 'dates',
    severity: 'high',
    why: '"In two weeks" is plain arithmetic: exactly +14 days from the Israeli today.',
    turns: ['Set a reminder in two weeks to plan something for Maya.'],
    facts: FACTS,
    expect: {
      calledTool: ['set_reminder'],
      args: (calls, ctx) => everyDateIs(calls, shiftDays(ctx.nowLocalDate, 14)),
      maxMs: 60_000,
    },
  },
  {
    id: 'DATE-06',
    group: 'dates',
    severity: 'high',
    why: 'A bare day-of-month must resolve forward. Resolving "the 4th" to a date already past is the failure that silently books nothing.',
    turns: ['Book something nice for the 4th.'],
    facts: FACTS,
    expect: {
      args: (calls, ctx) =>
        all(everyDateIsIso, (c) => noDateBefore(c, ctx.nowLocalDate))(calls),
      maxMs: 90_000,
    },
  },
  {
    id: 'DATE-07',
    group: 'dates',
    severity: 'medium',
    why: 'A day-first written date ("14/2") must not be read month-first. Booking 2 Feb for a Valentine\'s dinner is the classic locale bug.',
    turns: ['We want dinner on 14/2 — can you look?'],
    facts: FACTS,
    expect: {
      args: (calls) => {
        const problems = everyDateIsIso(calls);
        if (problems !== true) return problems;
        const dates = calls
          .flatMap((call) => Object.entries(call.args))
          .filter(([, value]) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
          .map(([, value]) => value as string);
        if (dates.length === 0) return 'no date argument was passed to any tool';
        const wrong = dates.filter((date) => !date.endsWith('-02-14'));
        return wrong.length === 0 ? true : `read 14/2 as ${wrong.join(', ')}`;
      },
      maxMs: 90_000,
    },
  },
  {
    id: 'DATE-08',
    group: 'dates',
    severity: 'medium',
    why: 'A relative offset from a known anniversary must become remind_days_before, not a hand-computed date that ignores the recurrence.',
    turns: ['Remind me a week before our anniversary every year.'],
    facts: FACTS,
    expect: {
      calledTool: ['set_reminder'],
      args: (calls) => {
        const reminder = calls.find((call) => call.name === 'set_reminder');
        if (!reminder) return 'set_reminder was not called';
        const before = reminder.args.remind_days_before;
        if (before === 7) return true;
        return `remind_days_before was ${JSON.stringify(before)}, not 7; args: ${JSON.stringify(
          reminder.args,
        )}`;
      },
      maxMs: 60_000,
    },
  },
  {
    id: 'DATE-09',
    group: 'dates',
    severity: 'medium',
    why: 'A Hebrew-calendar date must go through get_hebrew_occasions rather than being guessed as a Gregorian day.',
    turns: ['When is 12 Iyyar this year? I want to mark it.'],
    facts: FACTS,
    expect: {
      calledTool: ['get_hebrew_occasions', 'find_occasions', 'check_shabbat'],
      maxMs: 60_000,
    },
  },
  {
    id: 'DATE-10',
    group: 'dates',
    severity: 'low',
    why: 'The prompt claims a mail time. Whatever it claims must be the time the dispatcher actually sends (confirmed bug #2 makes this 08:30 vs 9am).',
    turns: ['Remind me about Maya\'s birthday next month — what time will I hear from you?'],
    facts: FACTS,
    expect: {
      // 08:30 is the truth in REMINDER_SEND_TIME_LOCAL; TOOL_GUIDANCE says 9am, so
      // the model is expected to repeat the wrong figure here.
      replyRejects: [/\b9\s*(?:am|:00)\b/i],
      maxMs: 60_000,
    },
  },
];
