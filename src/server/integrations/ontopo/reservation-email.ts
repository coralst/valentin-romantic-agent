import type { ToolContext } from '../tool-registry';
import { integrationReadiness } from '../index';
import { sendMessage } from '../google/client';
import { notifyAddressForTool } from '../notify-address';
import { CHECKOUT_TTL_MS } from './client';
import { logger } from '../../logging';

/**
 * The mail that goes out after a reservation, and the rules behind it.
 *
 * ## Why this exists
 *
 * `propose_reservation.confirm` ends in one of three states and says which one in
 * the chat reply — booked, or a live checkout the reader still has to finish. A
 * chat reply is the wrong place for that to be the only record: the details scroll
 * away, and the checkout URL — the one link that can still be acted on — scrolls
 * away with them. So every confirmed reservation now also leaves a copy in the
 * user's inbox, which is where people keep the things they need on the night.
 *
 * ## Why no sentence here is model-authored
 *
 * The same rule the reminder mail follows, for a weaker but real version of the
 * same reason. Nobody reviews this before it goes: it is composed and sent inside
 * `confirm`, after the only human turn in the flow has already happened. So the
 * body is assembled by code from the proposal payload and Ontopo's own outcome,
 * and every fact in it traces to a field. See `docs/REMINDER-MAIL-TEMPLATE.md` for
 * the longer form of this argument.
 *
 * ## The one thing this must never do
 *
 * Claim a booking that did not happen. `booked` comes from Ontopo displaying its
 * own confirmation text and nothing weaker (see `checkout-form.ts`), and the two
 * bodies below are different documents rather than one document with a hedge in
 * it — a reader skimming the first line of the wrong one must not come away
 * thinking a table is held.
 */

/** How long Ontopo holds a minted checkout, in whole minutes, for the body. */
const CHECKOUT_TTL_MINUTES = Math.round(CHECKOUT_TTL_MS / 60_000);

export interface ReservationMailInput {
  venueName: string;
  /**
   * Neighbourhood or city, as our own curated row says it. Omitted rather than
   * guessed — and never Ontopo's `area`, which is a seating area ("Bar", "Indoor")
   * and would read as a place name here.
   */
  place?: string | null;
  /** "Saturday 5 September". Empty when the payload carried no readable date. */
  readableDate?: string | null;
  /** The slot time as a person reads it — "20:30". */
  time: string;
  partySize: number;
  /** Ontopo's own label for the seating area — "Inside", "Bar". */
  area?: string | null;
  /** What the evening is, in his words, when the proposal carried one. */
  occasion?: string | null;
  /** True only when Ontopo displayed its own booking confirmation. */
  booked: boolean;
  /** The name the table ended up under, when the form was completed for him. */
  guestName?: string | null;
  /** Ontopo's page for this specific reservation. The verification link. */
  checkoutUrl: string;
  /** The restaurant's durable public page on Ontopo, when its city resolves. */
  venuePageUrl?: string | null;
}

export interface ReservationMail {
  subject: string;
  body: string;
}

/** "Saturday 5 September at 20:30", degrading to just the time. */
function whenLine(input: ReservationMailInput): string {
  const date = input.readableDate?.trim();
  return date ? `${date} at ${input.time}` : input.time;
}

/**
 * The facts, one per line, indented so they read as a block rather than as prose.
 *
 * Every line is conditional on the field being present. A reservation whose
 * payload lost its area should show four true lines, not five with a blank.
 */
function detailLines(input: ReservationMailInput): string[] {
  const place = input.place?.trim();
  const area = input.area?.trim();
  const occasion = input.occasion?.trim();
  const guestName = input.guestName?.trim();

  const lines = [
    `  ${input.venueName}${place ? `, ${place}` : ''}`,
    `  ${whenLine(input)}`,
    `  Table for ${input.partySize}${area ? ` — ${area}` : ''}`,
  ];

  if (occasion) lines.push(`  For ${occasion}`);
  // Only on the booked path: on a handoff the reader types their own name into
  // Ontopo's form, so naming the configured guest would be telling them the
  // reservation is under someone it is not yet under at all.
  if (guestName && input.booked) lines.push(`  Under the name ${guestName}`);

  return lines;
}

/** Build the confirmation. Pure: no clock, no network, no model. */
export function buildReservationEmail(input: ReservationMailInput): ReservationMail {
  const when = whenLine(input);
  const parts: string[] = ['Hi,', ''];

  if (input.booked) {
    parts.push('Your table is booked.', '');
    parts.push(...detailLines(input), '');
    parts.push('Verify it on Ontopo:', `  ${input.checkoutUrl}`, '');
    parts.push(
      `That is the page Ontopo showed its confirmation on, and it stops working about ` +
        `${CHECKOUT_TTL_MINUTES} minutes after the booking was made. Ontopo also sends its ` +
        `own confirmation by email and SMS, and the cancellation link is in that message — ` +
        `it is the copy worth keeping.`,
      '',
    );
  } else {
    parts.push('Your table is not booked yet.', '');
    parts.push(...detailLines(input), '');
    parts.push('Finish the reservation on Ontopo:', `  ${input.checkoutUrl}`, '');
    parts.push(
      `Nothing is held until you complete that form. The page stays open for about ` +
        `${CHECKOUT_TTL_MINUTES} minutes from when you confirmed — if it has expired by the ` +
        `time you read this, ask me and I will look the table up again.`,
      '',
    );
  }

  const page = input.venuePageUrl?.trim();
  if (page) parts.push('The restaurant on Ontopo:', `  ${page}`, '');

  parts.push('— Valentin');

  return {
    subject: `${input.booked ? 'Booked' : 'Not booked yet'} — ${input.venueName}, ${when}`,
    body: parts.join('\n'),
  };
}

/** Where the confirmation ended up. `none` means there was no address to use. */
export type ReservationMailChannel = 'gmail' | 'log' | 'none';

export interface ReservationMailOutcome {
  /** True only when Gmail accepted the message and returned an id. */
  sent: boolean;
  channel: ReservationMailChannel;
}

/**
 * Mail the confirmation, and never let doing so cost the reservation.
 *
 * ## Why this cannot throw
 *
 * By the time it is called the table is either booked or a live checkout is
 * minted, and both are facts about the outside world that a mail failure does not
 * undo. Throwing would turn a delivered reservation into an apology. So every
 * failure — no address, a revoked token, a Gmail quota — comes back as
 * `sent: false` and a log line, and the caller's reply simply does not mention an
 * inbox.
 *
 * ## Why the channel is readiness-driven, not `REMINDER_CHANNEL`
 *
 * The reminder sweep defaults to the log channel on purpose: it fires unattended,
 * days ahead, so a misconfigured channel there should cost a log line rather than
 * mail somebody unexpectedly. This mail is the opposite — it is the direct
 * consequence of a button the user pressed a second ago, and a deployment with
 * Gmail connected that answered a confirmed booking with silence would read as the
 * feature being broken. So it sends whenever Gmail is actually ready and writes the
 * body to the log when it is not, which keeps the whole path observable on a
 * deployment with no refresh token.
 *
 * Readiness is read live rather than at module load: credentials can arrive at
 * runtime through `POST /api/integrations/:id/connect`.
 */
export async function sendReservationSummary(
  input: ReservationMailInput,
  ctx: ToolContext,
): Promise<ReservationMailOutcome> {
  const email = buildReservationEmail(input);

  try {
    const to = await notifyAddressForTool(ctx);
    if (!to) {
      logger.warn('ontopo.confirmation_mail_no_address', { venue: input.venueName });
      return { sent: false, channel: 'none' };
    }

    if (!integrationReadiness().gmail) {
      // The body is logged in full, for the same reason `loggingSender` logs a
      // reminder in full: it carries a venue, a date and a link, none of which is
      // a credential, and a confirmation nobody can read is one nobody can debug.
      logger.info('ontopo.confirmation_mail', {
        channel: 'log',
        to,
        subject: email.subject,
        body: email.body,
      });
      return { sent: false, channel: 'log' };
    }

    const sent = await sendMessage({ to, subject: email.subject, body: email.body });
    if (!sent) {
      logger.warn('ontopo.confirmation_mail_failed', {
        to,
        venue: input.venueName,
        cause: 'Gmail accepted no message id',
      });
      return { sent: false, channel: 'gmail' };
    }

    logger.info('ontopo.confirmation_mail', {
      channel: 'gmail',
      to,
      subject: email.subject,
      messageId: sent.id,
      booked: input.booked,
    });
    return { sent: true, channel: 'gmail' };
  } catch (err) {
    logger.warn('ontopo.confirmation_mail_failed', {
      venue: input.venueName,
      cause: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return { sent: false, channel: 'gmail' };
  }
}
