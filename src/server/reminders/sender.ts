import { logger } from '../logging';
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
     * Gmail belongs to the OAuth work happening separately. When it lands it is one
     * case here, wrapping `sendMessage({to, subject, body})` from
     * `integrations/google/client.ts` — which already does RFC 2047 on the subject,
     * so a Hebrew occasion needs nothing extra. It must also check
     * `integrationReadiness().gmail` and fall through to the log when false, or a
     * deployment with no refresh token silently stops reminding anyone.
     */
    case 'gmail':
      logger.warn('reminder.channel_not_built', { channel, using: 'log' });
      return loggingSender;
    case 'log':
    case undefined:
      return loggingSender;
    default:
      logger.warn('reminder.channel_unknown', { channel, using: 'log' });
      return loggingSender;
  }
}
