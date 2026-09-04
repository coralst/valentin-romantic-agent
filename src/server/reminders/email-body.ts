import { resumeLink } from '../../shared/constants/resume-link';

/**
 * The body of an important-date reminder, built by code rather than by the model.
 *
 * ## Why this is not model-authored
 *
 * Every other outbound message in this build is written by the model:
 * `propose_email` hands it a `body` argument and the human approves what they can
 * see (`google/tools.ts`). That is safe precisely *because* someone is in the
 * conversation reading it.
 *
 * A reminder is the one message that goes out with nobody there. It fires days
 * ahead of an occasion, from a timer, and there is no turn in which a person could
 * catch an invented restaurant or a table that was never held. So the body is
 * assembled here from stored rows, by a pure function with no network and no
 * model, and every claim in it is traceable to something the user told Valentin or
 * something an integration actually returned.
 *
 * ## Plain text, on purpose
 *
 * `google/client.ts`'s `buildRawMessage()` hardcodes
 * `Content-Type: text/plain; charset="UTF-8"`, so there is no HTML path today and
 * this must read well as text. That is not only a constraint: a plain-text
 * reminder renders identically in every client, cannot leak a tracking pixel, and
 * survives being forwarded. An HTML alternative part would be a separate change
 * and the demo does not need it.
 *
 * ## What must never appear
 *
 * Nothing has been booked when this sends. The body may say a table *is available*
 * and may offer to hold one; it must never say one was reserved, and it must never
 * quote a price as though it were charged. `email-body.test.ts` asserts this
 * directly, because it is the one error here that would be a lie to a real person
 * about a real restaurant.
 */

/** How Valentin can act on a suggestion, which is the distinction that matters. */
export type SuggestionReach =
  /** Ontopo. Valentin can hold this table himself, on confirmation. */
  | 'bookable'
  /** Google Places. Discovery only — the reader books it themselves. */
  | 'discovery';

export interface ReminderSuggestion {
  name: string;
  /** As the source returned it. Never rewritten — it is the source's fact. */
  area: string;
  reach: SuggestionReach;
  rating?: number | null;
  ratingCount?: number | null;
  /** Google's 1-4 scale, rendered as shekel signs. Not an amount. */
  priceLevel?: number | null;
  /** Times a table is actually free, for a bookable row. Empty when unknown. */
  availableTimes?: readonly string[];
  /** Where the reader goes to book it themselves, for a discovery row. */
  url?: string | null;
  /**
   * What the user said about this place last time, if they have been.
   *
   * The payoff of the survey: a reminder that remembers is the difference between
   * a suggestion and a recommendation. Rendered only when present.
   */
  previousRating?: number | null;
}

export interface ReminderEmailInput {
  /** What the occasion is, in the user's own words — "her birthday". */
  occasion: string;
  /** The occasion itself, already in the user's timezone. */
  occasionDate: Date;
  /** Days of notice, so the body can say "a week away" without recomputing it. */
  daysUntil: number;
  /** Her name, when known. Omitted rather than guessed. */
  partnerName?: string | null;
  /**
   * The user's own words for a reminder he set himself, used verbatim.
   *
   * The two fields are two different grammars, which is why this is not just another
   * `occasion`. `occasion` names something *of hers* — "birthday", "anniversary" —
   * and is rendered possessively: "Maya's birthday is a week away". A title comes
   * from `set_reminder` and is already a whole phrase in his voice, so the same
   * treatment produces "Her call the florist is a week away".
   *
   * Present ⇒ used as written, with no name and no inflection. Absent ⇒ the
   * possessive path below, unchanged.
   */
  title?: string | null;
  /**
   * The criteria the suggestions were chosen against, restated in the mail.
   *
   * Included so the message is auditable: if a suggestion looks wrong, the reason
   * it was chosen is on the same page, and the reader can see which of their stored
   * answers did the work.
   */
  criteria?: readonly string[];
  suggestions: readonly ReminderSuggestion[];
  /** Where the app lives. `PUBLIC_ORIGIN` in a container. */
  origin: string;
  /** The conversation to reopen. The whole reason the link is worth clicking. */
  sessionId: string;
}

export interface ReminderEmail {
  subject: string;
  body: string;
}

/**
 * Three, and the cap is a judgement rather than a limit.
 *
 * One suggestion is a decision made on the reader's behalf; ten is a list they
 * have to triage. Three is what a person actually reads standing at a bus stop,
 * and it leaves room to say why each one is there.
 */
const MAX_SUGGESTIONS = 3;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "Thursday 12 June".
 *
 * Hand-rolled rather than `toLocaleDateString`, because the container's ICU data
 * and locale are not something this file should depend on for a string that ends
 * up in someone's inbox. A reminder that reads "6/12/2026" to an Israeli user has
 * already half failed.
 */
function formatDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "a week away", "tomorrow" — how a person would say it, not "in 7 days". */
function describeGap(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === 7) return 'a week away';
  if (days === 14) return 'two weeks away';
  if (days >= 28 && days <= 31) return 'a month away';
  return `${days} days away`;
}

function formatRating(suggestion: ReminderSuggestion): string {
  if (typeof suggestion.rating !== 'number') return '';
  const count =
    typeof suggestion.ratingCount === 'number' && suggestion.ratingCount > 0
      ? ` (${suggestion.ratingCount.toLocaleString('en-GB')})`
      : '';
  return `${suggestion.rating.toFixed(1)}★${count}`;
}

function formatPrice(suggestion: ReminderSuggestion): string {
  const level = suggestion.priceLevel;
  if (typeof level !== 'number' || level < 1) return '';
  return '₪'.repeat(Math.min(Math.round(level), 4));
}

/**
 * The line under a suggestion that says what Valentin can and cannot do about it.
 *
 * Per row, not once at the bottom, because the row is where the reader is
 * deciding. A single disclaimer at the end of the mail is read after the choice
 * has already been made, if it is read at all.
 */
function reachLine(suggestion: ReminderSuggestion): string {
  if (suggestion.reach === 'bookable') {
    const times = suggestion.availableTimes ?? [];
    if (times.length === 0) {
      return 'Bookable through me — reply and I will check the times.';
    }
    if (times.length === 1) return `Bookable through me. ${times[0]} is free.`;
    return `Bookable through me. Free at ${times.join(' and ')}.`;
  }

  const where = suggestion.url ? `\n     ${suggestion.url}` : '';
  return `I cannot book this one — you would reserve it yourself:${where}`;
}

function renderSuggestion(suggestion: ReminderSuggestion, index: number): string {
  const facts = [formatRating(suggestion), formatPrice(suggestion)].filter(Boolean).join(', ');
  const heading = `  ${index + 1}. ${suggestion.name}, ${suggestion.area}${facts ? ` — ${facts}` : ''}`;
  const lines = [heading, `     ${reachLine(suggestion)}`];

  if (typeof suggestion.previousRating === 'number') {
    lines.push(
      `     You have been here before and rated it ${suggestion.previousRating}/5.`,
    );
  }

  return lines.join('\n');
}

/**
 * The subject line.
 *
 * Carries the *when* and the count, because that is what decides whether this gets
 * opened from a lock screen. "A reminder from Valentin" says nothing; "Her
 * birthday is a week away — three ideas" says both what is happening and that
 * there is something to act on.
 */
/**
 * The thing this reminder is about, as a phrase that can take "is a week away".
 *
 * One function for the subject and the body, because they were computing it twice
 * with two slightly different expressions — and the second one is the only reason a
 * user-authored title would have read correctly in the body and wrongly in the
 * subject, or the reverse.
 */
function headline(input: ReminderEmailInput): string {
  // His own phrasing wins outright: no name, no possessive, no stripping. He wrote
  // "Call the florist" and that is what he should read on his lock screen.
  const title = input.title?.trim();
  if (title) return title;

  const who = input.partnerName ? `${input.partnerName}'s` : 'Her';
  const occasion = input.occasion.trim() || 'the date you are planning';
  return occasion.toLowerCase().startsWith(who.toLowerCase())
    ? occasion
    : `${who} ${occasion.replace(/^her\s+/i, '')}`;
}

function buildSubject(input: ReminderEmailInput): string {
  const subject = headline(input);

  const count = Math.min(input.suggestions.length, MAX_SUGGESTIONS);
  const ideas = count === 0 ? '' : count === 1 ? ' — one idea' : ` — ${numberWord(count)} ideas`;
  return `${capitalise(subject)} is ${describeGap(input.daysUntil)}${ideas}`;
}

function numberWord(count: number): string {
  return ['zero', 'one', 'two', 'three'][count] ?? String(count);
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Build the reminder. Pure: no clock, no network, no model. */
export function buildReminderEmail(input: ReminderEmailInput): ReminderEmail {
  const suggestions = input.suggestions.slice(0, MAX_SUGGESTIONS);
  const subjectOf = headline(input);

  const parts: string[] = ['Hi,', ''];

  parts.push(
    `${capitalise(subjectOf)} is on ${formatDate(input.occasionDate)}, ` +
      `${describeGap(input.daysUntil)}.`,
  );
  parts.push('');

  const hisOwnReminder = Boolean(input.title?.trim());

  if (hisOwnReminder && suggestions.length === 0) {
    /*
     * A reminder he wrote himself is not a suggestion problem.
     *
     * The paragraph below apologises for having found no restaurants, which is the
     * right thing to say about a birthday and nonsense about "Call the florist" — he
     * did not ask for ideas, he asked to be reminded. So the mail says the thing and
     * stops. The link still follows, because reopening the conversation is the one
     * useful action either kind of reminder can offer.
     */
    parts.push("That's all — you asked me to remind you.");
  } else if (suggestions.length === 0) {
    /*
     * Sent anyway, with nothing to offer.
     *
     * The date is the fact worth knowing, and suppressing the whole reminder
     * because a search came back empty would turn a bad search into a missed
     * birthday. Saying "I have not found anything yet" is honest and still useful.
     */
    parts.push(
      'I have not found anything worth suggesting yet. Open the conversation and ' +
        'tell me what you have in mind and I will look properly.',
    );
  } else {
    const criteria = (input.criteria ?? []).filter((c) => c.trim().length > 0);
    parts.push(
      criteria.length > 0
        ? `Here is what fits what you have told me — ${criteria.join(', ')}:`
        : 'Here is what I found:',
    );
    parts.push('');
    parts.push(suggestions.map(renderSuggestion).join('\n\n'));
    parts.push('');
    parts.push('Nothing is reserved — say the word and I will hold one of the first two.');
  }

  parts.push('');
  // "Pick one" only makes sense when something was offered.
  parts.push(
    hisOwnReminder && suggestions.length === 0
      ? 'Pick up where we left off:'
      : 'Pick one, or tell me what you would rather:',
  );
  parts.push(resumeLink(input.origin, input.sessionId));
  parts.push('');
  parts.push('— Valentin');

  return { subject: buildSubject(input), body: parts.join('\n') };
}
