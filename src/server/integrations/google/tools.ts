import { randomUUID } from 'node:crypto';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';
import {
  GOOGLE_PROPOSAL_TTL_MS,
  insertEvent,
  listEvents,
  sendMessage,
  type CalendarEvent,
} from './client';

/**
 * Calendar and Gmail — the two tools that touch someone's own account.
 *
 * Both are gated behind a human yes, and for different reasons. A calendar entry
 * is reversible but it is *someone's diary*, and an agent writing to it
 * unprompted is the behaviour that makes people turn integrations off. An email
 * is not reversible at all: a reservation link can be ignored, a calendar entry
 * deleted, a sent message is sent. So `propose_email` shows the user the exact
 * text and the exact recipient before anything leaves the account, and the body
 * it sends is the body they read — carried on the proposal rather than
 * regenerated at confirm time, so the model cannot change its mind between the
 * card and the send.
 *
 * `find_occasions` is read-only and is the reason the other two are worth having:
 * it is how Valentin knows the anniversary is in three weeks without being told.
 */

/** Milliseconds in a day, for window arithmetic that reads clearly. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead `find_occasions` looks when not told. */
const DEFAULT_HORIZON_DAYS = 120;

/**
 * Words that mark an event as an occasion rather than a meeting.
 *
 * Hebrew included because that is the language half of these entries will be in,
 * and a birthday written "יום הולדת" is exactly the entry this tool exists to
 * find. Matching is a lowercased substring test; Hebrew has no case, so the same
 * comparison works for both.
 */
const OCCASION_WORDS = [
  'birthday',
  'anniversary',
  'valentine',
  'engagement',
  'wedding',
  'יום הולדת',
  'יום נישואין',
  'נישואין',
  'הולדת',
  'חתונה',
] as const;

function isOccasion(event: CalendarEvent): boolean {
  const title = event.summary.toLowerCase();
  return OCCASION_WORDS.some((word) => title.includes(word));
}

/** Local civil date as `YYYY-MM-DD` — never via `toISOString`, which shifts. */
function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: unknown): { iso: string; readable: string } | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(bare ? `${text}T12:00:00` : text);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    iso: localDate(parsed),
    readable: parsed.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  };
}

/** `HH:MM` from a few spellings, or null. */
function parseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Add minutes to a `YYYY-MM-DDTHH:MM:00` local string, staying local.
 *
 * Deliberately no offset anywhere in this path: Google accepts a bare local
 * `dateTime` when `timeZone` is supplied, which sidesteps having to know whether
 * Israel is on +02:00 or +03:00 on the date in question. Computing that by hand
 * is how a dinner ends up in the calendar an hour out.
 */
function addMinutes(localIso: string, minutes: number): string {
  const parsed = new Date(localIso);
  parsed.setMinutes(parsed.getMinutes() + minutes);
  const hh = String(parsed.getHours()).padStart(2, '0');
  const mm = String(parsed.getMinutes()).padStart(2, '0');
  return `${localDate(parsed)}T${hh}:${mm}:00`;
}

function describeEvent(event: CalendarEvent): string {
  const when = event.allDay
    ? event.start
    : new Date(event.start).toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
  const where = event.location ? ` (${event.location})` : '';
  // The calendar name is worth its tokens: the user asks "did you check Yonatan &
  // Coral?" by name, and the model can only answer that if it was told.
  const source = event.calendar ? ` [${event.calendar}]` : '';
  return `${event.summary} — ${when}${where}${source}`;
}

/**
 * What is already in the diary that matters.
 *
 * Two modes in one tool, which is a compromise worth naming: with no `query` it
 * filters the window down to entries whose titles look like occasions, and with
 * one it hands the text to Google's own search. The alternative was two tools,
 * and two tools that both mean "look at the calendar" is exactly the prompt bloat
 * this build is meant to demonstrate the cost of.
 */
export const findOccasionsTool: AgentTool = {
  name: 'find_occasions',
  description:
    "Look in the user's Google Calendar for dates that matter — birthdays, " +
    'anniversaries, trips already booked. Use this before suggesting a date, so ' +
    'you know what is already happening and when the occasion actually is. ' +
    'Read-only. Pass a query to search for something specific, or omit it to see ' +
    'upcoming occasions.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Free text to search titles and locations, e.g. "anniversary". Omit to ' +
          'list upcoming occasions.',
      },
      days_ahead: {
        type: 'number',
        description: `How far ahead to look. Defaults to ${DEFAULT_HORIZON_DAYS}.`,
      },
    },
    required: [],
  },
  service: 'google-calendar',
  requiresConfirmation: false,
  async execute(input) {
    const days =
      typeof input.days_ahead === 'number' && input.days_ahead > 0
        ? Math.min(Math.round(input.days_ahead), 400)
        : DEFAULT_HORIZON_DAYS;
    const query = typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined;

    const now = Date.now();
    const events = await listEvents({
      timeMin: new Date(now).toISOString(),
      timeMax: new Date(now + days * DAY_MS).toISOString(),
      q: query,
      limit: 25,
    });

    if (events === null) {
      return {
        ok: false,
        summary:
          `I could not reach the calendar. Tell the user plainly and ask them when the ` +
          `occasion is instead of guessing a date.`,
      };
    }

    if (events.length === 0) {
      return {
        ok: true,
        summary: query
          ? `Nothing in the calendar matches "${query}" in the next ${days} days. Ask the user for the date.`
          : `The calendar has nothing at all in the next ${days} days. Say so plainly.`,
        data: { events: [] },
      };
    }

    // With an explicit query, trust Google's search. Without one, occasions lead
    // — they are what this tool is for — but the rest still goes back.
    //
    // It used to be `events.filter(isOccasion)`, and that was a bug with teeth: a
    // keyword list of ten words decided what the model was allowed to know the
    // calendar contained, so a diary holding a flight, six hotel bookings, two
    // restaurant reservations and two court dates was reported as *empty*. The
    // model then said so, in prose, with total confidence. A read tool that
    // silently drops seventeen of seventeen rows does not narrow a result, it
    // fabricates one — and "your calendar is empty" is a lie the user cannot
    // catch without opening Google themselves.
    //
    // So the filter is now a *sort key*, never a gate.
    const occasions = query ? [] : events.filter(isOccasion);
    const rest = query ? events : events.filter((event) => !isOccasion(event));
    const ordered = [...occasions, ...rest];

    const headline = query
      ? `${ordered.length} matching "${query}" in the next ${days} days`
      : occasions.length > 0
        ? `${occasions.length} occasion(s) and ${rest.length} other entr(ies) in the next ${days} days` +
          ` — occasions first`
        : `No birthdays or anniversaries in the next ${days} days, but ${rest.length} other ` +
          `entr(ies) are in the diary — use them to judge when the user is busy or travelling`;

    return {
      ok: true,
      summary: `${headline}: ${ordered.map(describeEvent).join(' | ')}`,
      data: {
        events: ordered.map((event) => ({
          summary: event.summary,
          start: event.start,
          allDay: event.allDay,
          location: event.location,
          calendar: event.calendar,
          isOccasion: isOccasion(event),
        })),
      },
    };
  },
};

/**
 * Offer to put something in the diary.
 *
 * With a time it is a timed entry in Israel time; without one it is all-day,
 * which is the right shape for "our anniversary" and the wrong shape for dinner.
 * The distinction is carried explicitly rather than inferred later, because
 * Google's schema is `date` xor `dateTime` and sending both is an error.
 */
export const proposeCalendarEventTool: AgentTool = {
  name: 'propose_calendar_event',
  description:
    "Offer to add something to the user's Google Calendar — a dinner " +
    'reservation, a reminder to buy flowers, the occasion itself. This does NOT ' +
    'write anything: it shows a card, and the entry is created only after they ' +
    'confirm. Omit the time for an all-day entry like an anniversary.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the entry says, e.g. "Dinner at NOEMA".' },
      date: { type: 'string', description: 'The date as YYYY-MM-DD, e.g. "2026-09-05".' },
      time: {
        type: 'string',
        description: 'Start time as "20:00", in Israel time. Omit for an all-day entry.',
      },
      duration_minutes: {
        type: 'number',
        description: 'How long it runs. Defaults to 120 for a timed entry.',
      },
      location: { type: 'string', description: 'Where, if it has a place.' },
      notes: { type: 'string', description: 'Anything else to put in the entry body.' },
    },
    required: ['title', 'date'],
  },
  service: 'google-calendar',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title === '') {
      return { ok: false, summary: 'No title was given for the calendar entry. Ask what to call it.' };
    }

    const date = parseDate(input.date);
    if (!date) {
      return {
        ok: false,
        summary: `I could not read "${String(input.date)}" as a date. Ask which day they mean.`,
      };
    }

    const time = parseTime(input.time);
    const allDay = time === null;
    const duration =
      typeof input.duration_minutes === 'number' && input.duration_minutes > 0
        ? Math.min(Math.round(input.duration_minutes), 24 * 60)
        : 120;

    const start = allDay ? date.iso : `${date.iso}T${time}:00`;
    // An all-day event's `end` is exclusive in Google's model, so a one-day entry
    // ends the following day. Getting this wrong produces a two-day anniversary.
    const end = allDay ? localDate(new Date(new Date(`${date.iso}T12:00:00`).getTime() + DAY_MS)) : addMinutes(start, duration);

    const location = typeof input.location === 'string' && input.location.trim() ? input.location.trim() : undefined;
    const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : undefined;

    const when = allDay ? date.readable : `${date.readable} at ${time}`;
    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'google-calendar',
      title: `${title} — ${when}`,
      summary:
        `${allDay ? 'All day' : `${duration} minutes`} on ${date.readable}` +
        `${location ? `, at ${location}` : ''}. ` +
        `Confirming adds this to your Google Calendar. Nothing is written until you do.`,
      expiresAt: new Date(Date.now() + GOOGLE_PROPOSAL_TTL_MS).toISOString(),
      payload: { title, start, end, allDay, location, notes, readable: when },
    };

    return {
      ok: true,
      summary:
        `I've offered to add "${title}" for ${when}. Tell them what the entry will say and ` +
        `that it needs their confirmation. Do not say it is in the calendar.`,
      proposal,
      data: { title, when, allDay },
    };
  },

  async confirm(proposal): Promise<ToolResult> {
    const payload = proposal.payload ?? {};
    const title = typeof payload.title === 'string' ? payload.title : null;
    const start = typeof payload.start === 'string' ? payload.start : null;
    const end = typeof payload.end === 'string' ? payload.end : null;
    const readable = typeof payload.readable === 'string' ? payload.readable : '';

    if (!title || !start || !end) {
      return {
        ok: false,
        summary: 'That calendar entry is missing its details. Apologise and offer to set it up again.',
      };
    }

    const created = await insertEvent({
      summary: title,
      start,
      end,
      allDay: payload.allDay === true,
      location: typeof payload.location === 'string' ? payload.location : undefined,
      description: typeof payload.notes === 'string' ? payload.notes : undefined,
    });
    if (!created) {
      return {
        ok: false,
        summary:
          `Google would not accept the calendar entry, so nothing was added. Tell them ` +
          `plainly and offer to try again.`,
      };
    }

    return {
      ok: true,
      summary: `"${title}" is in the calendar for ${readable}. Confirm it briefly and move on.`,
      data: { eventId: created.id, url: created.htmlLink, title },
    };
  },
};

/** A very loose sanity check — enough to catch a mangled address, not a validator. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Trim a body down for the card while keeping it recognisable. */
function preview(body: string, limit = 400): string {
  const flat = body.trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * Offer to send an email, showing exactly what would be sent.
 *
 * The card carries the recipient and the body, because "confirm this email"
 * without the text is not consent to anything. The full body rides on the
 * proposal payload and `confirm` sends *that* — not a regenerated version — so
 * what the user approved is what leaves the account.
 *
 * The account is the one hardcoded in the environment, so this always sends from
 * the demo address rather than from the user. That is stated in the proposal
 * summary rather than left for someone to discover in their sent folder.
 */
export const proposeEmailTool: AgentTool = {
  name: 'propose_email',
  description:
    'Offer to send an email — a note to a restaurant, a message to a partner, a ' +
    'gift order enquiry. This does NOT send anything: it shows the user the exact ' +
    'recipient and text, and it is sent only after they confirm. Write the body ' +
    'in full; the user reads it before it goes. Never claim an email has been sent.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address.' },
      subject: { type: 'string', description: 'Subject line. Hebrew is fine.' },
      body: {
        type: 'string',
        description: 'The full text of the email, exactly as it should be sent. Plain text.',
      },
      why: {
        type: 'string',
        description: 'One line on why you are offering to send this. Shown on the card.',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  service: 'gmail',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const to = typeof input.to === 'string' ? input.to.trim() : '';
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';

    if (!looksLikeEmail(to)) {
      return {
        ok: false,
        summary:
          `"${to}" is not an email address I can send to. Ask the user for the address ` +
          `rather than guessing one.`,
      };
    }
    if (subject === '' || body === '') {
      return {
        ok: false,
        summary: 'An email needs both a subject and a body. Write both before offering to send it.',
      };
    }

    const why = typeof input.why === 'string' && input.why.trim() ? `${input.why.trim()} ` : '';
    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'gmail',
      title: `Email to ${to}: ${subject}`,
      summary:
        `${why}This is exactly what will be sent, from Valentin's own Gmail account:\n\n` +
        `${preview(body)}\n\nNothing is sent until you confirm.`,
      expiresAt: new Date(Date.now() + GOOGLE_PROPOSAL_TTL_MS).toISOString(),
      // The full body, not the preview. Confirm sends this and only this.
      payload: { to, subject, body },
    };

    return {
      ok: true,
      summary:
        `I've shown them the email to ${to}. Say what it says in a sentence and that it ` +
        `is waiting for their confirmation. Do not say it has been sent.`,
      proposal,
      data: { to, subject },
    };
  },

  async confirm(proposal): Promise<ToolResult> {
    const payload = proposal.payload ?? {};
    const to = typeof payload.to === 'string' ? payload.to : null;
    const subject = typeof payload.subject === 'string' ? payload.subject : null;
    const body = typeof payload.body === 'string' ? payload.body : null;

    if (!to || !subject || !body) {
      return {
        ok: false,
        summary:
          `That email is missing its text or its recipient, so nothing was sent. Offer to ` +
          `write it again.`,
      };
    }

    const sent = await sendMessage({ to, subject, body });
    if (!sent) {
      return {
        ok: false,
        summary:
          `Gmail would not send that message, so it was not sent. Tell them plainly — do ` +
          `not say it went out.`,
      };
    }

    return {
      ok: true,
      summary: `The email to ${to} has been sent. Say so once, briefly.`,
      data: { messageId: sent.id, to },
    };
  },
};

export const googleCalendarTools: AgentTool[] = [findOccasionsTool, proposeCalendarEventTool];
export const gmailTools: AgentTool[] = [proposeEmailTool];
