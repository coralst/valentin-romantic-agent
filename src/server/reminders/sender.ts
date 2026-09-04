import { logger } from '../logging';
import { integrationReadiness } from '../integrations';
import { sendMessage } from '../integrations/google/client';
import type { ReminderEmail } from './email-body';

/**
 * How a reminder leaves the building — one interface, so the dispatcher does not
 * know or care which channel it is.
 *
 * This is the seam the Gmail work lands in, and it is deliberately the entire
 * integration surface: `buildReminderEmail` produces a subject and a plain-text
 * body, a sender takes them, and nothing in the dispatcher changes when a real
 * channel appears. A `GmailSender` is one `case` in `resolveSender` below.
 *
 * It matters that the default is not Gmail. Gmail is dark on this deployment —
 * `integrationReadiness()` reports it false without a refresh token, and
 * credentials supplied through the panel do not survive task replacement, because
 * the container has `readonlyRootFilesystem: true`. If the dispatcher only worked
 * with Gmail configured then the entire reminder path would be untestable and
 * undemonstrable until that landed, and "it will work once the integration is
 * ready" is exactly the claim this codebase keeps refusing to make about itself.
 * With `loggingSender` the timing, the due-index query, the idempotent write and
 * the body are all real and observable today; only the last hop is a log line.
 */
export interface ReminderSender {
  /** A name for the logs and for `GET /api/integrations`-style reporting. */
  readonly channel: string;
  /**
   * Deliver one reminder.
   *
   * Resolves on success and **throws on failure**. The dispatcher counts the
   * attempt and leaves the row unsent so the next sweep retries it — which is why
   * this must not swallow its own errors and report success.
   */
  send(to: string, email: ReminderEmail): Promise<void>;
}

/**
 * The default: writes the reminder to the log instead of sending it.
 *
 * Not a stub to be replaced — a real, useful channel. It proves the reminder fired
 * at the right minute with the right body, which is the part of step 2 that is
 * actually hard, and it does it without a credential.
 *
 * The body is logged in full and that is a deliberate call: it contains the
 * partner's name, an occasion and a resume link. All three are already in this
 * process's logs by other routes, none is a credential, and a reminder you cannot
 * read is a reminder you cannot debug. The one thing never logged anywhere in this
 * codebase is a credential value, and there is none here.
 */
export const loggingSender: ReminderSender = {
  channel: 'log',
  async send(to, email) {
    logger.info('reminder.sent', {
      channel: 'log',
      to,
      subject: email.subject,
      body: email.body,
    });
  },
};

/**
 * A sender that always fails, for proving the retry path.
 *
 * Exported rather than defined in the test file because the dispatcher's
 * behaviour on a failed send — count the attempt, leave the row unsent, do not
 * mark it — is the property most likely to regress and least likely to be noticed.
 */
export function failingSender(message = 'channel unavailable'): ReminderSender {
  return {
    channel: 'failing',
    async send() {
      throw new Error(message);
    },
  };
}

/** Which channel this deployment sends on. */
export type ReminderChannel = 'log' | 'gmail';

/**
 * The real thing: the reminder arrives as mail from the user's own account.
 *
 * ## Why `null` has to become a throw
 *
 * `sendMessage` returns `SentMessage | null` — `null` for any response it could not
 * read an id out of, which is every Gmail failure: a revoked token, a quota, a
 * rejected recipient. It does not throw, because its other caller is a `confirm`
 * handler that turns a falsy result into "I couldn't send that".
 *
 * Here that would be silent data loss, and permanent. The dispatcher *claims* a
 * reminder before sending — `markSent` is a conditional write, deliberately, so a
 * crash mid-send cannot mail the same reminder twice — so a send that resolves
 * without sending leaves a row stamped `sentAt` that nothing will ever retry. The
 * reminder is gone and the logs say it went. Converting `null` into a throw puts it
 * back on the failure path, where the attempt is counted and the row stays unsent.
 *
 * No retry or backoff of its own: the sweeper runs every 60 seconds and re-queries
 * the due index, so a transient failure is retried by the next sweep. A second retry
 * loop in here would fight that one.
 */
export const gmailSender: ReminderSender = {
  channel: 'gmail',
  async send(to, email) {
    const sent = await sendMessage({ to, subject: email.subject, body: email.body });
    if (!sent) {
      // Deliberately not logged as an error here — the dispatcher logs the failed
      // attempt with the reminder's id and kind, which is the record worth having.
      throw new Error('Gmail accepted no message id — the reminder was not sent');
    }
    logger.info('reminder.sent', {
      channel: 'gmail',
      to,
      subject: email.subject,
      messageId: sent.id,
    });
  },
};

/**
 * Pick the sender for a channel.
 *
 * Unknown or unconfigured channels fall back to the log rather than throwing, for
 * the same reason an unconfigured integration is absent from the tool list rather
 * than present and failing: a misconfigured channel should cost the delivery, not
 * the boot.
 */
export function resolveSender(channel: string | undefined): ReminderSender {
  switch (channel) {
    /*
     * Readiness is checked here rather than inside the sender, so the fallback is
     * chosen once per sweep instead of failing once per reminder. Without a refresh
     * token every send would throw, the rows would be retried for ever, and nobody
     * would be reminded of anything — where the log channel at least records that
     * the reminder came due, with its body, which is what a demo needs.
     *
     * Read live rather than at module load: credentials can arrive at runtime
     * through `POST /api/integrations/:id/connect`, and the scheduler outlives that.
     */
    case 'gmail': {
      if (integrationReadiness().gmail) return gmailSender;
      logger.warn('reminder.channel_unconfigured', { channel, using: 'log' });
      return loggingSender;
    }
    case 'log':
    case undefined:
      return loggingSender;
    default:
      logger.warn('reminder.channel_unknown', { channel, using: 'log' });
      return loggingSender;
  }
}
