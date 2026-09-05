/**
 * Where outbound mail for the user goes.
 *
 * Sits next to `conversation-email.ts` because every caller is a mail path:
 * `set_reminder` stamps a row's target, `emailSession` posts a transcript,
 * `propose_email` addresses a card. All three used to answer "which address?" on
 * their own, and the shape check below existed twice, word for word, in two files
 * that could have drifted apart without a single test noticing.
 */

import { config } from '../config';

/**
 * The profile field holding where outbound mail for this user goes.
 *
 * Here rather than beside each reader, because there are now three of them and the
 * string is the join between them: a fourth copy that said `notify-email` or
 * `notifyEmail` would read the profile, find nothing, and silently fall back to the
 * owner — a bug with no error in it.
 */
export const NOTIFY_EMAIL_FIELD = 'notify_email';

/**
 * Roughly an address, which is all this can honestly check.
 *
 * Not a validator — there is no useful client-side test for deliverability, and
 * RFC 5322 in a regex is a famous waste of a day. This exists only to separate
 * "we have not been told where to write" from "that cannot be an address",
 * because both are the same fixable state and both should get the same answer.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * The address to write to: the profile's if it has one, otherwise the owner's.
 *
 * Takes the already-resolved profile value rather than the profile, so the
 * manual-over-inferred precedence stays in `profileFieldValue` — one rule, one
 * place — and so this file needs nothing from `reminder-sync.ts` that would make
 * the two import each other.
 *
 * ## Why the profile still wins
 *
 * Because it is the more specific answer, and because someone who typed an
 * address into the panel did it to be written to there. The default is what makes
 * the feature work at all when nobody has typed anything: a single-owner
 * deployment always knows whose mail this is, and the old behaviour — save the
 * reminder, then ask the owner for an address he has already given — read as
 * forgetfulness.
 *
 * ## Why the shape is checked on both
 *
 * The profile value is extracted from chat, so it can be "her email" or a half
 * address; before this it went into `Reminder.target` unchecked and the send
 * failed days later, out of sight. And `config.reminders.defaultEmail` comes from
 * an environment variable, so a typo there would silently address every reminder
 * in the deployment to nonsense. An unusable value on either side is treated as no
 * value, which lands back on the behaviour that existed before this function.
 */
export function resolveNotifyEmail(
  onProfile: string | null | undefined,
  fallback: string = config.reminders.defaultEmail,
): string | null {
  const stated = onProfile?.trim();
  if (stated && looksLikeEmail(stated)) return stated;

  const owner = fallback.trim();
  return looksLikeEmail(owner) ? owner : null;
}
