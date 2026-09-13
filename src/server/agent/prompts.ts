import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import {
  PROFILE_FIELD_GUIDANCE,
  PROFILE_FIELD_IDS,
} from '../../shared/constants/profile-fields';
import type { Outing } from '../../shared/interfaces/outing';
// Interpolated into TOOL_GUIDANCE rather than written out: the prose used to say
// "9am" while the dispatcher sent at 08:30, and the agent promised users a time
// the mail never arrived at. Reading the constant makes that drift impossible.
import { REMINDER_SEND_TIME_LOCAL, REMINDER_ZONE } from '../../shared/interfaces/reminder';
import { hebrewDateOf, inZone } from '../integrations/hebcal/client';
// Interpolated for the same reason as the reminder time above. The guidance used
// to tell the model to hand back "the URL it returns, exactly as written", which
// stopped being true when `create_conversation_link` started answering with a
// placeholder — so the prompt was contradicting the tool at the moment the model
// had to decide whether to trust it.
import { CONVERSATION_LINK_PLACEHOLDER } from '../sharing/link-placeholder';

/**
 * Valentin's persona and the two goals he serves, in that order of permanence.
 *
 * WHY THERE ARE TWO GOALS
 *
 * This prompt used to state exactly one: "fill out a complete partner profile",
 * followed by a fixed interview order (name, then age, then gender). That is only
 * the *first* job, and it made him wrong for the rest of the relationship — asked
 * anything on a profile that was already complete, he still opened with "tell me
 * what your partner loves", because nothing in his instructions described what he
 * is for once he knows her.
 *
 * So the goals are named separately and the caller says which one is live. See
 * {@link buildSystemPrompt}, which is what the orchestrator actually sends.
 */
export const VALENTIN_SYSTEM_PROMPT = `You are Valentin, a warm and sophisticated romantic concierge. You help one person be a better partner to the person they love, by remembering everything that matters about her and using it at the moment it helps.

You have two jobs, and they run in this order.

GOAL 1 — GET TO KNOW HER. Early on, you know little or nothing. Learn who she is through ordinary conversation: her name, her birthday and the dates that matter, how she likes to be loved, what she eats, wears, listens to, dreams about. Never interrogate. Ask about one thing at a time and let the rest arrive on its own.

GOAL 2 — BE HER PARTNER'S ALLY. Once you know her, this is your standing job and it never ends: help him be thoughtful. Remember the dates and raise them before they arrive, not after. Suggest gifts, plans and gestures that fit *her* specifically, citing what you know. Notice what has not been asked about in a while. Answer practical questions with real recommendations, not with more questions. The measure of your work is whether she ends up happier.

Personality:
- Warm and empathetic — you genuinely care about this relationship
- Specific — you refer to her by name and to details you actually know, never in generalities
- Sophisticated — charming and elegant, never pretentious
- Encouraging — you credit him for knowing her well
- Discreet — everything shared with you is held carefully

Conversation guidelines:
- Match your response length to the moment — a quick or casual message gets a short, natural reply; a rich or open-ended one earns a fuller response
- Vary your rhythm — don't acknowledge-then-ask-a-follow-up on every single turn. Sometimes just react, sometimes just answer, sometimes ask
- Only ask a follow-up question when you genuinely need the detail
- Never re-ask something you already know. If you know her name, use it
- Never be judgmental about anything shared
- If he asks you a question, answer it directly. A recommendation beats a clarifying question
- If he seems frustrated, acknowledge it plainly and fix what he is pointing at
- You are not a general assistant, but you are also not a form. If a request is genuinely outside this relationship, say so briefly in your own voice and offer what you can do

Remember: you're helping someone become a more thoughtful, attentive partner. Every detail matters.`;

/**
 * How to behave when tools are on the table.
 *
 * Appended only when the registry has something in it, because most of what it
 * says is meaningless otherwise — and because a model told it can book tables in
 * a deployment with no Ontopo credentials will offer to book tables.
 *
 * The two rules that are not about competence:
 *
 * - **Never claim a write happened.** A tool that writes returns a proposal, and
 *   the user has to accept it. "I've booked you a table" when nothing is booked
 *   is the single worst thing this system can say, and it is the thing a
 *   confident model does by default. The one carve-out is `set_reminder`, which
 *   writes on the spot — stated explicitly and narrowly, because a blanket rule the
 *   model can see is contradicted by a tool it just used successfully is a rule it
 *   starts reasoning around.
 * - **Never state an hour you did not fetch.** Observed on the deployed engine A:
 *   asked for a table and "which hours are actually free", it called
 *   `find_restaurants`, never called `check_availability`, and answered with a
 *   clock time anyway. Every other rule here guards against claiming a *write*
 *   that did not happen; nothing guarded against claiming a *fact* that was never
 *   looked up, which is the same failure pointed the other way — and worse in one
 *   respect, because a fabricated 20:30 is a table he turns up for.
 * - **Offer a reminder once.** The offer is worth having and is also the most
 *   obvious thing to overdo: a model told to be helpful about reminders will append
 *   "shall I remind you?" to every turn, which is the kind of tic that makes an
 *   assistant feel automated. Hence "ask once, then let it go", next to the existing
 *   instruction to vary his rhythm.
 * - **A capability he has is never described as missing.** Told only "do not say
 *   you cannot make a link", the model found wordings the rule did not cover — "I
 *   don't have access to a link to this specific conversation", "that tool isn't
 *   available in this version" — with both tools sitting in the list it had been
 *   handed. So the rule now names the claim rather than the phrasing, and
 *   `capability-denial.ts` catches the turn where it is made anyway.
 * - **Shabbat is not a preference.** In Israel a Friday-evening dinner
 *   recommendation is not a slightly-off suggestion, it is a restaurant that is
 *   shut. Hebrew-date anniversaries drift against the Gregorian calendar by up to
 *   three weeks, so "their anniversary is the 14th" is a question for the
 *   calendar tools, not an arithmetic problem — but only once he has said it is a
 *   Hebrew date. Left to itself the model asked "civil or Hebrew?" of a plain
 *   "10 September", which spends the second turn of a first conversation
 *   interrogating a date nobody was unsure about. The default is stated
 *   explicitly for that reason: take the civil reading, do not ask.
 */
/**
 * Everything true of both engines' toolsets.
 *
 * Split out from {@link TOOL_GUIDANCE} because the two engines do not hold the same
 * tools: `create_conversation_link` is withheld from the AgentCore Gateway (see
 * `WITHHELD` in `infra/lib/agentcore-stack.ts`), so telling engine B's model to call
 * it would be the mirror of the bug this split fixes — a model confidently offering
 * something it cannot do. Assemble with {@link toolGuidanceFor}, never by hand.
 */
const TOOL_GUIDANCE_CORE = `
USING YOUR TOOLS

You can reach a few real services. Reach for them when the answer depends on
something you cannot know — what is actually available on Saturday, when Shabbat
ends this week, what her Hebrew anniversary date falls on this year. Do not call
a tool to decorate an answer you already have, and do not narrate the mechanics;
the user wants the restaurant, not the API call.

You are in Israel. Two things follow, always:
- Friday evening through Saturday nightfall is Shabbat. Most places are closed
  and a Friday-night dinner plan is not a suggestion, it is a mistake. מוצ"ש —
  Saturday after dark — is the good night out. Check rather than assume; the
  time changes every week.
- A date he gives you is the civil date. Take it as written and move on — never
  ask which calendar he meant, and never make him confirm one; asking is the
  wrong trade, because the civil reading is right nearly every time and the
  question stalls the conversation over something he did not raise.
- Only when *he* says a date is a Hebrew one does that change: those move against
  the Gregorian calendar by up to three weeks a year, so look them up rather than
  calculate them.

NOTHING YOU WRITE, SEND OR BOOK HAPPENS ON YOUR WORD ALONE. Anything that
reserves, orders, emails or messages comes back to you as a proposal, and the
user sees a card they must accept. So describe what you have lined up and ask
them to confirm it. Never say a table is booked, an email is sent or an event is
on the calendar until you are told the confirmation went through. If a tool
fails, say so plainly and offer something else — do not invent the result.

AN HOUR IS A FACT YOU HAVE TO FETCH. Never say a place has a table at a given
time, or that a time is free, unless a check_availability result in this
conversation said so. A shortlist tells you which rooms exist; it never tells you
when they are free. When you have the rooms but not the hours, name the rooms and
offer to check the hours — that is a good answer, and a plausible-sounding hour
is not, because he will turn up to it. The same holds for anything else only a
tool knows: a closing time, a price, when Shabbat comes in.

Setting a reminder is the one exception, because it is his own note to himself
and nobody else is affected by it: set_reminder writes it immediately and tells
you whether it worked. So you may say a reminder is set — but only after the tool
came back successful, and never before you have called it.

YOU CAN REMIND HIM OF THINGS. Call set_reminder with the thing in his own words
and an absolute date, and he gets an email that morning at ${REMINDER_SEND_TIME_LOCAL} Israel
time with a link back
to this conversation. Use it whenever he asks to be reminded, or says yes when
you offer.

Offer one when the conversation lands on something real and dated that nothing is
covering yet — a table he means to book, her sister's birthday, the appointment he
has to make on the 12th. Say when the mail would reach him, so he knows what he is
agreeing to: "want me to drop you a note on the Thursday morning?" Ask once. If he
says no, or says nothing about it, let it go and do not raise it again — a
concierge who asks twice is a nag, and this must never become a tic you attach to
every message. Her birthday, your anniversary and the occasion you are currently
planning are already handled from her profile; do not offer to remind him of those.

YOU CAN TELL HIM WHAT YOU ARE ALREADY REMINDING HIM ABOUT. Reminders outlive a
conversation, and some of them were set in an earlier one — so when he asks what is
set, whether something is covered, or before you offer a reminder that may already
exist, call list_reminders and read the answer. Do not recall it from what was said
in this chat; a reminder you merely offered is not one that is armed.

If he wants one stopped, call cancel_reminder with whatever he called it. Some
reminders come from her profile and are stopped by muting that kind rather than by
deleting them; the tool works that out and tells you which it did. Report what it
says happened rather than assuming it was a deletion.`;

/**
 * The one capability engine B does not have.
 *
 * Appended only when `create_conversation_link` is actually reachable — engine A
 * always, engine B not at all, because the tools Lambda holds no share-token secret.
 */
const CONVERSATION_LINK_GUIDANCE = `

YOU CAN HAND OUT A LINK TO THIS CONVERSATION. If the user asks for a link to the
chat, asks you to email or send them one, or wants to show it to somebody, call
create_conversation_link. It answers with the placeholder
${CONVERSATION_LINK_PLACEHOLDER} rather than with a URL: write that placeholder
wherever the link belongs — in your reply, or in the body of propose_email — and
the real signed link is filled in for you. Never write a URL of your own; they are
signed, and one you compose will not open.`;

/**
 * The don't-deny-your-own-capabilities rule, in two versions.
 *
 * The rule names the specific claims that are untrue, because naming only the
 * behaviour ("do not say you cannot") left the model wordings the rule did not cover.
 * That makes it capability-specific: on an engine with no link tool, "I don't have
 * access to a link to this conversation" is *true*, and listing it as a forbidden
 * claim would push the model into inventing a URL instead.
 */
const CAPABILITY_DENIAL_WITH_LINK = `

NEVER TELL HIM A CAPABILITY IS MISSING WHEN YOU HAVE A TOOL FOR IT. You can make
a link to this conversation and you can email him, so "I don't have access to a
link to this conversation", "I can't send email" and "that tool isn't available in
this version" are all untrue — and being told a thing is impossible when it is one
tool call away is worse than any error message. If you are unsure whether
something will work, call the tool and find out. A real limit is one a tool came
back and told you about, and then you say plainly what failed.`;

const CAPABILITY_DENIAL_NO_LINK = `

NEVER TELL HIM A CAPABILITY IS MISSING WHEN YOU HAVE A TOOL FOR IT. You can email
him, you can set him a reminder and you can list the ones already set, so "I can't
send email", "I don't have a reminder tool" and "that tool isn't available in this
version" are all untrue — and being told a thing is impossible when it is one tool
call away is worse than any error message. If you are unsure whether something will
work, call the tool and find out. A real limit is one a tool came back and told you
about, and then you say plainly what failed.`;

/** Which optional tools this deployment actually holds. */
export interface ToolAvailability {
  /** Whether there are any tools at all. False silences the whole block. */
  any: boolean;
  /** Whether `create_conversation_link` is reachable. False on the AgentCore Gateway. */
  conversationLink: boolean;
}

/** The guidance for a given toolset. */
export function toolGuidanceFor(availability: ToolAvailability): string {
  return availability.conversationLink
    ? `${TOOL_GUIDANCE_CORE}${CONVERSATION_LINK_GUIDANCE}${CAPABILITY_DENIAL_WITH_LINK}`
    : `${TOOL_GUIDANCE_CORE}${CAPABILITY_DENIAL_NO_LINK}`;
}

/**
 * The full guidance, for a deployment holding every tool — which is engine A.
 *
 * Kept as a constant because `prompts-consistency.test.ts` reads it directly to check
 * the prose against the code it describes: that the send time it promises matches
 * `REMINDER_SEND_TIME_LOCAL`, and that every tool name it mentions is one a tool
 * actually provides.
 */
export const TOOL_GUIDANCE = toolGuidanceFor({ any: true, conversationLink: true });

/**
 * What day it is, for a model that would otherwise guess.
 *
 * ## Why this is not optional
 *
 * Several things this product does take an *absolute* date the model authored.
 * `next_occasion` is stored as `YYYY-MM-DD@what it is`, `check_shabbat` takes a
 * datetime, and `set_reminder` takes a day. With no date in the prompt, "the 4th"
 * and "next Tuesday" could only be resolved against the model's training cutoff —
 * so it invented a year, and the failure was silent and confident: a Shabbat window
 * computed for the right weekday of the wrong year still reads like an answer, and
 * a reminder filed for 2024 is simply never sent.
 *
 * ## Why the zone is Israel and not the server's
 *
 * The container runs UTC. Between midnight and 03:00 Israel time, UTC is still
 * yesterday — so a user saying "tomorrow" at one in the morning would have been
 * booked for the day he was already in. {@link inZone} is the same helper candle
 * lighting uses, for the same reason.
 *
 * The Hebrew date is included because it is Valentin's idiom, not decoration: he is
 * expected to know that an anniversary falls in Iyyar without being asked to
 * compute it, and it costs one line.
 */
export function nowBlock(now: Date): string {
  const { localDate, localTime } = inZone(now, REMINDER_ZONE);
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: REMINDER_ZONE,
    weekday: 'long',
  }).format(now);

  /*
   * The next two weeks, spelled out.
   *
   * The computed-dates block below covers dates already ON the profile — but the
   * turn that *teaches* a date is answered before extraction has stored it, so
   * the very first "our anniversary is the 16th" gets a reply whose weekday the
   * model derived itself. On camera it derived it wrong twice: "Wednesday" for a
   * Thursday, then "Tuesday" for a Wednesday, on the first turn each time. A
   * fourteen-day lookup table costs a line and turns that derivation into a read.
   */
  // "16 September = Wednesday", not "Wed 09-16": the user says dates in words,
  // and the first rehearsal with the numeric form watched the model glance past
  // "Wed 09-16" and still write "Tuesday the 16th". The lookup has to be keyed
  // the way the question arrives.
  const fortnight = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(now.getTime() + (i + 1) * 86_400_000);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: REMINDER_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).formatToParts(day);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('day')} ${get('month')} = ${get('weekday')}`;
  }).join('; ');

  return `RIGHT NOW: it is ${weekday} ${localDate}, ${localTime} in Israel (${REMINDER_ZONE}). The Hebrew date is ${hebrewDateOf(now)}.
CALENDAR FOR THE NEXT TWO WEEKS: ${fortnight}.
Before you name the weekday of ANY date, find that date in the calendar line above and copy its weekday exactly — never work a weekday out yourself. For a date beyond those two weeks, give the date without naming its weekday.
Work out every relative date the user says — "tomorrow", "next Tuesday", "the 4th", "in two weeks" — against today's date, and pass tools the absolute YYYY-MM-DD you arrived at. Never guess a year. If a date he gives is ambiguous or already past, ask him rather than picking one.`;
}

/** A calendar date, no year semantics attached. Mirrors the planner's shape. */
interface DateParts {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;

/** The calendar date `now` falls on in the reminder zone — same recipe as the planner's. */
function localToday(now: Date): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The first `YYYY-MM-DD` in a value, or nothing — anchored to a 4-digit year like the planner. */
function findIsoDate(value: string): DateParts | null {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d] = match;
  const parts = { year: Number(y), month: Number(mo), day: Number(d) };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  return parts;
}

/** Weekday of a calendar date, independent of the server's zone. */
function weekdayOf(date: DateParts): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  );
}

/** Whole calendar days from `today` to `date`. Negative when past. */
function daysUntil(date: DateParts, today: DateParts): number {
  return Math.round(
    (Date.UTC(date.year, date.month - 1, date.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      DAY_MS,
  );
}

/** The next time a month/day recurs, at or after today. Year on the stored value is ignored. */
function rollForward(date: DateParts, today: DateParts): DateParts {
  for (let year = today.year; year <= today.year + 1; year += 1) {
    // 29 February observed on the 28th in a common year, matching the planner.
    const day =
      date.month === 2 && date.day === 29 && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)
        ? 28
        : date.day;
    const candidate = { year, month: date.month, day };
    if (
      Date.UTC(candidate.year, candidate.month - 1, candidate.day) >=
      Date.UTC(today.year, today.month - 1, today.day)
    ) {
      return candidate;
    }
  }
  return { year: today.year + 1, month: date.month, day: date.day };
}

function iso(date: DateParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** "in 5 days" / "TODAY" / "tomorrow" / "already passed", for the computed-dates block. */
function distanceWording(days: number): string {
  if (days === 0) return 'TODAY';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `already passed, ${-days} day${days === -1 ? '' : 's'} ago`;
  return `in ${days} days`;
}

/** The profile fields that carry a calendar date the model will otherwise re-derive. */
const RECURRING_DATE_FIELDS = ['birthday', 'anniversary'] as const;

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** `september` | `sept` | `sep` → 9, or 0 for anything else. */
function monthNumber(word: string): number {
  const lower = word.toLowerCase();
  return MONTH_NAMES.findIndex((name) => name.startsWith(lower.slice(0, 3))) + 1;
}

const MONTH_PATTERN = MONTH_NAMES.map((name) => `${name.slice(0, 3)}[a-z]*`).join('|');

/**
 * Every calendar date a message names, as the day it actually falls on.
 *
 * A date the user has only just typed is not on the profile yet — extraction
 * runs *after* the reply — so {@link computedDatesBlock} had nothing to say
 * about it, and the weekday of the single most important date in the
 * conversation was the one the model was left to derive. It derived it wrong
 * three times running: "16 September" answered as "Tuesday the 16th".
 *
 * Only the three forms a person actually types are read — `2026-09-16`,
 * `16 September`, `September 16th`. A year-less date is resolved to its next
 * occurrence, which is what "our anniversary is on 16 September" means. Anything
 * unrecognised yields nothing rather than a guess.
 */
export function datesInText(text: string, now: Date): DateParts[] {
  const today = localToday(now);
  const found: DateParts[] = [];
  const push = (date: DateParts) => {
    if (!found.some((seen) => iso(seen) === iso(date))) found.push(date);
  };

  const isoMatches = text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g);
  for (const [, y, mo, d] of isoMatches) {
    const date = { year: Number(y), month: Number(mo), day: Number(d) };
    if (date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31) push(date);
  }

  // "16 September", "16th of September", optionally with a year.
  const dayFirst = text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\b(?:\\s+(\\d{4}))?`, 'gi'),
  );
  // "September 16", "September 16th, 2026".
  const monthFirst = text.matchAll(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'gi'),
  );

  const prose: [day: string, month: string, year: string | undefined][] = [
    ...[...dayFirst].map((m) => [m[1], m[2], m[3]] as [string, string, string | undefined]),
    ...[...monthFirst].map((m) => [m[2], m[1], m[3]] as [string, string, string | undefined]),
  ];

  for (const [dayText, monthText, yearText] of prose) {
    const month = monthNumber(monthText);
    const day = Number(dayText);
    if (month < 1 || day < 1 || day > 31) continue;
    push(
      yearText
        ? { year: Number(yearText), month, day }
        : rollForward({ year: today.year, month, day }, today),
    );
  }

  return found;
}

/**
 * Every date on the profile, already worked out — weekday, next occurrence,
 * distance from today — so no calendar arithmetic is left to the model.
 *
 * This exists because the model got both halves of that arithmetic wrong on
 * camera: told "the anniversary is 2026-09-10" on a Saturday five days before
 * it, it said "this coming Wednesday" (a Thursday) and "in four days" (five).
 * Weekday-of-a-date is the one computation in this prompt that is trivial for
 * the server and unreliable for the model, so the server does it and tells the
 * model to trust the line over its own reckoning.
 *
 * Recurring dates (birthday, anniversary) are shown as their *next* occurrence,
 * exactly as the reminder planner rolls them — a birthday stored with a past or
 * birth year must never surface as "six months ago". `next_occasion` is one-off
 * and shown as stored, flagged plainly when it has already passed.
 */
export function computedDatesBlock(
  facts: readonly KnownFact[],
  now: Date,
  message = '',
): string {
  const today = localToday(now);
  const lines: string[] = [];

  for (const date of datesInText(message, now)) {
    lines.push(
      `- the date he just named in this message is ${weekdayOf(date)} ${iso(date)} — ${distanceWording(daysUntil(date, today))}`,
    );
  }

  for (const fact of facts) {
    const id = fact.fieldId ?? fact.key;
    const parsed = findIsoDate(fact.value);
    if (!parsed) continue;

    if ((RECURRING_DATE_FIELDS as readonly string[]).includes(id)) {
      const next = rollForward(parsed, today);
      const days = daysUntil(next, today);
      lines.push(
        `- ${id.replace(/_/g, ' ')}: next falls ${weekdayOf(next)} ${iso(next)} — ${distanceWording(days)}`,
      );
    } else if (id === 'next_occasion') {
      const days = daysUntil(parsed, today);
      lines.push(
        `- ${id.replace(/_/g, ' ')}: ${weekdayOf(parsed)} ${iso(parsed)} — ${distanceWording(days)}`,
      );
    }
  }

  if (lines.length === 0) return '';
  return `

DATES, ALREADY WORKED OUT (computed by the system — trust these over your own arithmetic, and never re-derive a weekday or a day count yourself):
${lines.join('\n')}`;
}

/** The smallest thing the prompt builder needs to know about a stored fact */
export interface KnownFact {
  key: string;
  value: string;
  fieldId?: string | null;
}

/** `favorite_cuisine` → `favorite cuisine`, so the block reads as prose */
function readableLabel(fact: KnownFact): string {
  return (fact.fieldId ?? fact.key).replace(/_/g, ' ');
}

/** The partner's name, when it is among the known facts */
export function partnerNameFrom(facts: readonly KnownFact[]): string | null {
  const named = facts.find(
    (fact) => fact.fieldId === 'partner_name' || fact.key === 'partner_name',
  );
  const value = named?.value.trim();
  return value ? value : null;
}

/**
 * The system prompt for one turn, with what he already knows folded in.
 *
 * The model was previously sent {@link VALENTIN_SYSTEM_PROMPT} and the recent
 * messages, and nothing else — so the profile the whole product is built around
 * was invisible to the one component that most needed it. A demo profile with 21
 * known fields still got treated as a stranger, because the transcript above a
 * seeded session is empty and the facts live in DynamoDB, not in the chat.
 *
 * Facts are rendered as plain `label: value` lines rather than JSON: it is fewer
 * tokens and the model quotes them back more naturally.
 *
 * ## Why GOAL 2 is gated on coverage, not on "any fact at all"
 *
 * This used to flip on `facts.length === 0` — one fact was enough. So the moment
 * turn one landed her name, turn two was built with "GOAL 2 is live... answer
 * practical questions with real recommendations", and a user still *introducing*
 * her got every further fact read as a planning brief: "quiet and romantic"
 * became a restaurant search, "she loves Nina Simone" got one line before being
 * dragged back to an unanswered shortlist. Nothing was forgotten — the model was
 * answering the wrong question, correctly. GOAL 2 now waits until the profile
 * has real coverage; until then a middle state keeps GOAL 1's posture while
 * still using what is known.
 *
 * The unknown-field list is included while GOAL 1 is live — it is what lets him
 * fill a gap when a conversation wanders past one. Once GOAL 2 is live it is
 * dropped: enumerating every missing field next to "stop collecting" pulled him
 * straight back into interrogation.
 *
 * `now` is a parameter with a default rather than a read of the clock inside,
 * matching `shabbatWindow(from, city)` and `planReminders(input, now)`: it is what
 * makes the date line assertable in a test without touching global time, and every
 * existing caller keeps today's behaviour by omitting it.
 */
export function buildSystemPrompt(
  facts: readonly KnownFact[],
  /**
   * What this deployment can actually do.
   *
   * A bare boolean still means "all of it, or none", which is engine A and every
   * existing caller. Engine B passes a {@link ToolAvailability} because its tools come
   * from the Gateway, which withholds `create_conversation_link`.
   */
  hasTools: boolean | ToolAvailability = false,
  visited: readonly Outing[] = [],
  now: Date = new Date(),
  message = '',
): string {
  const availability: ToolAvailability =
    typeof hasTools === 'boolean' ? { any: hasTools, conversationLink: hasTools } : hasTools;
  // Appended, not interleaved, so the persona and the profile read the same
  // whether or not this deployment has any credentials.
  const tools = availability.any ? `\n${toolGuidanceFor(availability)}` : '';
  const history = visitedBlock(visited);
  // Ahead of the state and the facts, because it is the frame they are read in: a
  // birthday "next month" means nothing until the model knows which month this is.
  const today = `\n\n${nowBlock(now)}`;
  // Dates he names in *this* message, resolved before the reply — the profile
  // cannot carry them yet, because extraction runs after the reply is written.
  const dates = computedDatesBlock(facts, now, message);

  if (facts.length === 0) {
    // No history block here even if there somehow is one: an account with no
    // facts at all and a booked restaurant is a state that only arises from a
    // half-finished seed, and the opening turn should introduce him rather than
    // recite a venue.
    return `${VALENTIN_SYSTEM_PROMPT}${today}${dates}

CURRENT STATE: You know nothing about her yet. GOAL 1 is live. Open by introducing yourself and asking one easy, warm question about her.${tools}`;
  }

  const name = partnerNameFrom(facts);
  const her = name ?? 'his partner';

  const known = facts
    .map((fact) => `- ${readableLabel(fact)}: ${fact.value}`)
    .join('\n');

  const knownFieldIds = new Set(
    facts.map((fact) => fact.fieldId).filter((id): id is string => Boolean(id)),
  );
  const missing = PROFILE_FIELD_IDS.filter((id) => !knownFieldIds.has(id));

  /*
   * Both ongoing states carry this. The single worst failure mode observed live
   * was a stated preference being answered with a shortlist: told "somewhere
   * quiet and romantic — she hates loud rooms", the model searched restaurants
   * nobody asked for, and the unanswered offer then dominated every later turn.
   */
  const noUnsolicited =
    'When he states a fact about her — "she loves...", "she hates...", "she does X on Tuesdays" — receive it and remember it; a stated preference is a fact to keep, not a brief to act on. Never answer a fact with a venue, a gift or an itinerary. Propose a plan only when he asks for one, or when a date you know about is close enough to need action.';

  if (!goalTwoLive(name, knownFieldIds)) {
    return `${VALENTIN_SYSTEM_PROMPT}${today}${dates}

CURRENT STATE: You are still getting to know ${her}. GOAL 1 is live — keep learning who she is through ordinary conversation, one thing at a time, and never re-ask what you already know below. ${noUnsolicited}

WHAT YOU KNOW ABOUT ${(name ?? 'HER').toUpperCase()}:
${known}

Still unknown: ${missing.join(', ')}. Do not interrogate him for these. Ask about one only when the conversation naturally arrives there.${history}${tools}`;
  }

  const gaps =
    missing.length > 0
      ? `\nIf a gap in her profile surfaces naturally you may ask about it — one at a time, never as a checklist.`
      : `\nYou know every field on her profile. Stop collecting and start using it.`;

  return `${VALENTIN_SYSTEM_PROMPT}${today}${dates}

CURRENT STATE: You already know ${her}. GOAL 2 is live — you are past the introductions, so do not open as though you were meeting him for the first time, and do not ask him to tell you about his partner. Use what you know below, by name and in specifics. ${noUnsolicited}

WHAT YOU KNOW ABOUT ${(name ?? 'HER').toUpperCase()}:
${known}
${gaps}${history}${tools}`;
}

/**
 * Whether the profile is filled in enough for GOAL 2's posture.
 *
 * Her name plus {@link GOAL_2_MIN_FIELDS} known registry fields. The number is a
 * judgement, not a law: it is roughly "the name, the dates, and a couple of
 * tastes" — the least he can know and still make a suggestion that is about
 * *her*. Below it, suggesting is guessing dressed up, and the model belongs in
 * GOAL 1's listening posture. He answers direct questions with recommendations
 * in either state (persona guideline), so gating this does not make him refuse
 * help — it only stops him volunteering plans at someone mid-introduction.
 */
const GOAL_2_MIN_FIELDS = 6;

function goalTwoLive(name: string | null, knownFieldIds: ReadonlySet<string>): boolean {
  return name !== null && knownFieldIds.size >= GOAL_2_MIN_FIELDS;
}

/**
 * The places they have already been, and what to do about each one.
 *
 * Rendered as prose lines with the verdict spelled out rather than as a rating
 * table, because the instruction attached to a row is the point: a 5/5 is a
 * place to offer again by name, a 2/5 is a place to keep quiet about, and an
 * unrated one is a place he was just at, which makes "somewhere new this time" a
 * reasonable thing for Valentin to say unprompted.
 *
 * Capped, and by the most recent, for the same reason the profile reader is
 * capped: this is sent on every single turn. Ten places is more history than any
 * suggestion needs and still small enough not to crowd out the facts above it.
 */
const MAX_PROMPT_OUTINGS = 10;

function visitedBlock(visited: readonly Outing[]): string {
  if (visited.length === 0) return '';

  const lines = visited.slice(0, MAX_PROMPT_OUTINGS).map((outing) => {
    const where = outing.city ? `${outing.venueName}, ${outing.city}` : outing.venueName;
    const when = outing.occursOn ? ` on ${outing.occursOn}` : '';
    if (outing.rating === null || outing.rating === undefined) {
      return `- ${where}${when} — not rated yet, so do not assume it went well`;
    }
    const verdict = outing.verdict ? `, "${outing.verdict}"` : '';
    return `- ${where}${when} — she rated it ${outing.rating}/5${verdict}`;
  });

  return `
WHERE YOU HAVE ALREADY TAKEN HER:
${lines.join('\n')}

Use this. Never present one of these as a new discovery — he was there. Do not
re-offer anything rated 3 or below unless he asks for it by name; say plainly
that it did not land last time if he does. A place rated 4 or 5 is worth
suggesting again by name, as a return rather than a find.`;
}

/**
 * The `field` enum guidance, rendered as one line per field id.
 *
 * An enum tells the model *which* ids are legal; it does not tell it *when* each
 * one applies. Without this, "her birthday is in June" and "she's turning 32"
 * were emitted as two unrelated preferences.
 */
const FIELD_GUIDANCE_LINES = PROFILE_FIELD_IDS.map(
  (id) => `- ${id}: ${PROFILE_FIELD_GUIDANCE[id]}`,
).join('\n');

/**
 * Tool schema for Bedrock tool-use preference extraction.
 *
 * `field` is an ENUM over the canonical profile field ids, not a free-form
 * string. That is the whole point of this schema's shape: the previous version
 * asked the model for a prose `key` and the client then tried to string-match it
 * against a lookup table. The model is not obliged to guess the table's wording,
 * so real runs emitted keys like `birthday_month`, `age_turning`,
 * `salsa_dancing` and `pronouns` — every one of which resolved to `null` and was
 * dropped without a trace.
 *
 * `key` survives alongside it, deliberately, and is still free-form: not every
 * useful fact has a registry field. An allergy is the load-bearing example —
 * `KeepInMind.tsx` substring-matches keys like `shellfish_allergy` to raise a
 * caution, and there is no allergy field in the registry. So `field` is optional: set
 * it when the fact belongs to a profile field, omit it when the fact is real but
 * off-registry.
 *
 * ## Three arrays, one tool
 *
 * `people` and `tasks` are here rather than in two tools of their own because
 * `extractWithTool` forces `toolChoice` to a single named tool: a second and third
 * tool would mean a second and third Bedrock call on every user turn, tripling the
 * latency and cost of extraction to read the same sentence three times. One
 * schema with three arrays gets the model to sort the turn once, which is also
 * how it avoids filing "her sister Nadia's birthday is in March" as both a person
 * and a `birthday` preference — the arrays are described in terms of each other.
 *
 * All three are optional. Most turns fill none of them, and an empty array is the
 * normal answer.
 */
export const EXTRACT_PREFERENCES_TOOL = {
  name: 'extract_preferences',
  description:
    'Extract what the conversation says about the user\'s partner, the people in her life, and what the user has to do. Only extract what is clearly stated or strongly implied.\n\n' +
    'PREFERENCES — facts about her. For each, set "field" to the profile field it belongs to, choosing from this list:\n' +
    FIELD_GUIDANCE_LINES +
    '\n\nIf the fact is real but does not belong to any field above (an allergy, a dislike, something to avoid), omit "field" and give it a descriptive "key" instead.\n\n' +
    'Emit ONE preference per distinct fact. Never split a single fact across two preferences — ' +
    '"she\'s turning 32 in June" is one birthday preference with the value "June (turning 32)", not an age preference plus a month preference.\n\n' +
    'PEOPLE — someone in HER life: her mother, her sister, her uncle, her cat. Not the user, and not her. ' +
    'A relative mentioned without a name is still a person: record the relationship and leave "name" out, because "her brother, whose name I never caught" is exactly the thing worth remembering. ' +
    'A birthday belonging to a relative goes on that person, never in a preference — the "birthday" field is HERS alone.\n\n' +
    'TASKS — something the USER has said he will do or should do: book a table, buy the glaze set, ask her about a date. ' +
    'Only when he commits or asks for a reminder, never for something he has already done, and never for advice you are merely offering in reply.',
  input_schema: {
    type: 'object',
    properties: {
      preferences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: [...PREFERENCE_CATEGORIES],
              description: 'The preference category',
            },
            field: {
              type: 'string',
              enum: [...PROFILE_FIELD_IDS],
              description:
                'The profile field this preference fills. Omit ONLY if the fact belongs to no field in the list above.',
            },
            key: {
              type: 'string',
              description:
                'Short snake_case label for the preference. When "field" is set, use the same value as "field". When it is not, describe the fact (e.g. "shellfish_allergy").',
            },
            value: {
              type: 'string',
              description: 'The preference value as described by the user',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                'How confident the extraction is (1.0 = explicitly stated, 0.5 = implied)',
            },
          },
          required: ['category', 'key', 'value', 'confidence'],
        },
      },
      people: {
        type: 'array',
        description:
          'People in her life mentioned in this message. Empty on most turns.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'What they are called. OMIT when the message names a relative without naming them.',
            },
            relationship: {
              type: 'string',
              description:
                'How they are related to her, in the user\'s own words: "her mother", "her older sister", "her uncle on her father\'s side".',
            },
            generation: {
              type: 'string',
              enum: ['grandparent', 'elder', 'peer', 'younger'],
              description:
                'Which rung of her family they sit on: grandparent, elder (her parents, aunts and uncles), peer (siblings, cousins, friends of her own age), younger (children, nieces, nephews, pets).',
            },
            birthday: {
              type: 'string',
              description:
                'Their birthday as YYYY-MM-DD when the year is known, otherwise omit it. Never guess a year.',
            },
            note: {
              type: 'string',
              description:
                'Anything worth remembering about them: "goes by Mimi", "do not mention the illness".',
            },
          },
          required: ['relationship', 'generation'],
        },
      },
      tasks: {
        type: 'array',
        description:
          'Things the user has to do, from this message. Empty on most turns.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description:
                'The line as he would read it back: "Book the Italian place for the 18th".',
            },
            due: {
              type: 'string',
              description:
                'YYYY-MM-DD when he named a date. Omit for "sometime" — never invent a deadline.',
            },
            note: {
              type: 'string',
              description: 'Why it matters, or what to say when he does it.',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['preferences'],
  },
} as const;
