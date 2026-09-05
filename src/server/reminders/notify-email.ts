/**
 * Where outbound mail for the user goes.
 *
 * Sits next to `conversation-email.ts` because every caller is a mail path:
 * `set_reminder` stamps a row's target, `emailSession` posts a transcript,
 * `propose_email` addresses a card. All three used to answer "which address?" on
 * their own, and the shape check below existed twice, word for word, in two files
 * that could have drifted apart without a single test noticing.
 */

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
