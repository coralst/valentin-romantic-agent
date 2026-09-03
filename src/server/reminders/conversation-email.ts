import { resumeLink } from '../../shared/constants/resume-link';
import type { Sender } from '../../shared/interfaces/message';
import type { ReminderEmail } from './email-body';

/**
 * "Mail this conversation to me", built by code rather than by the model.
 *
 * ## Why this is not model-authored
 *
 * The same argument `email-body.ts` makes, and it applies here with one turn less
 * safety net. Every other outbound message in this build is written by the model and
 * approved by a human who can read it (`propose_email`); this one is triggered by a
 * button and posted with nobody reviewing the result. Handing the transcript to the
 * model and asking for "a nice summary" is exactly how a mail ends up asserting that
 * a table was held or a florist was paid, because a summariser's job is to sound
 * conclusive. So the intro is a fixed sentence, and everything else in the body is a
 * verbatim quote of turns that are already in storage. Nothing in here can claim
 * anything happened.
 *
 * ## Plain text, and the same shape as a reminder
 *
 * `google/client.ts`'s `buildRawMessage()` is hardcoded to
 * `text/plain; charset="UTF-8"`, so there is no HTML path to use. The return type is
 * `ReminderEmail` rather than a new interface of its own because that is literally
 * what `ReminderSender.send` accepts: a subject and a plain-text body. A parallel
 * type with identical fields would need a converter at every send site and would
 * drift the first time one of them gained a field.
 *
 * ## One call to action, last
 *
 * The only link in the mail is `resumeLink` — back into the conversation, for the
 * owner, who is the only person this is ever sent to. Not a share link: sharing has
 * its own token and its own warning, and a mail that quietly contained a
 * seven-day bearer credential would hand one out without anybody choosing to.
 */

/** One quoted turn. Only what is rendered — no ids, no source message. */
export interface ConversationEmailTurn {
  sender: Sender;
  content: string;
}

export interface ConversationEmailInput {
  /** The conversation's name, as the sidebar shows it. */
  title: string;
  /** Her name, when known. Omitted rather than guessed. */
  partnerName?: string | null;
  /**
   * The whole transcript, oldest first.
   *
   * Passed whole rather than pre-trimmed by the caller so this function can both
   * choose the cap and *say* how much it left out — a caller that sliced first would
   * make the omission notice impossible to write truthfully.
   */
  turns: readonly ConversationEmailTurn[];
  /** Where the app lives. `PUBLIC_ORIGIN` in a container. */
  origin: string;
  /** The conversation to reopen. */
  sessionId: string;
}

/**
 * Six, and like the reminder's three it is a judgement rather than a limit.
 *
 * Six turns is about the last three exchanges — enough that the mail reads as a
 * conversation and not as a fragment, and few enough that it fits on a phone screen
 * without a scroll. A whole transcript pasted into a mail is an archive, and nobody
 * reads an archive from a lock screen.
 */
const MAX_TURNS = 6;

/** How long a single quoted turn may run before it is elided. */
const MAX_TURN_CHARS = 600;

/**
 * Who said it.
 *
 * "You" and "Valentin", not "User" and "Assistant": the reader is one of the two
 * speakers, and this is a mail rather than a log. Her name never appears as a
 * speaker label — she is not in the conversation, she is what it is about.
 */
function speakerOf(turn: ConversationEmailTurn): string {
  return turn.sender === 'user' ? 'You' : 'Valentin';
}

/** Quote one turn, indented, with an over-long turn elided. */
function renderTurn(turn: ConversationEmailTurn): string {
  const trimmed = turn.content.trim();
  const body =
    trimmed.length > MAX_TURN_CHARS ? `${trimmed.slice(0, MAX_TURN_CHARS).trimEnd()}…` : trimmed;

  // Indented continuation lines, so a multi-paragraph answer still reads as one
  // speaker's block in a plain-text client with no quoting of its own.
  const indented = body.split('\n').join('\n    ');
  return `  ${speakerOf(turn)}:\n    ${indented}`;
}

/**
 * The subject line.
 *
 * Names the conversation, because the reader may have several and the mail is
 * useless if it says only "Your conversation". Prefixed rather than bare so it is
 * recognisable as coming from the app in a threaded inbox.
 */
function buildSubject(input: ConversationEmailInput): string {
  const title = input.title.trim();
  // An untitled conversation gets the plain form rather than
  // "Your conversation: Your conversation", which is what a naive fallback string
  // inside the template would produce.
  return title ? `Your conversation: ${title}` : 'Your conversation with Valentin';
}

/** Build the mail. Pure: no clock, no network, no model. */
export function buildConversationEmail(input: ConversationEmailInput): ReminderEmail {
  const kept = input.turns.slice(-MAX_TURNS);
  const omitted = input.turns.length - kept.length;

  const parts: string[] = ['Hi,', ''];

  parts.push(
    input.partnerName
      ? `Here is where we got to on ${input.partnerName} — "${input.title.trim() || 'your conversation'}".`
      : `Here is where we got to on "${input.title.trim() || 'your conversation'}".`,
  );
  parts.push('');

  if (kept.length === 0) {
    /*
     * Sent anyway, with nothing quoted.
     *
     * Suppressing the mail because the conversation is empty would leave the button
     * looking broken; saying so plainly costs nothing and the link still works.
     */
    parts.push('There is nothing in this conversation yet — the link below opens it.');
  } else {
    if (omitted > 0) {
      // Stated before the quotes, not after: a reader who stops at the first turn
      // must already know they are looking at the tail and not the whole thing.
      parts.push(
        omitted === 1
          ? 'The last few turns — one earlier turn is not included:'
          : `The last few turns — ${omitted} earlier turns are not included:`,
      );
    } else {
      parts.push('The conversation so far:');
    }
    parts.push('');
    parts.push(kept.map(renderTurn).join('\n\n'));
  }

  parts.push('');
  // Deliberately says nothing about bookings. Nothing in this mail is an action that
  // was taken, and the only thing offered is picking the conversation back up.
  parts.push('Pick it up where you left off:');
  parts.push(resumeLink(input.origin, input.sessionId));
  parts.push('');
  parts.push('— Valentin');

  return { subject: buildSubject(input), body: parts.join('\n') };
}
