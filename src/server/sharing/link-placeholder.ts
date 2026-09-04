/**
 * Keeping a signed share URL out of the model's hands.
 *
 * ## The failure this exists to remove
 *
 * `create_conversation_link` used to answer with the finished URL, and the model
 * was told to reproduce it "exactly as written". It cannot reliably do that. The
 * token is ~250 characters of base64url — an HMAC over the session and its owner
 * — and copying it into a reply, or into `propose_email`'s body, is a
 * character-perfect transcription task with no redundancy to recover from. One
 * wrong character fails the signature, `verifyShareToken` returns `null`, and the
 * guest is told "This link has expired or is not valid".
 *
 * That was observed in the live app on 2026-09-04: the tool minted a valid token
 * at 17:37:23 and the same process rejected the opened link thirty seconds later.
 * Same container, same secret — so what was opened was not what was minted.
 *
 * ## The fix
 *
 * The model is given a **placeholder** instead: `{{conversation_link}}`, which is
 * short, memorable, and survives being retyped. The server substitutes the real
 * URL on the way out — in tool inputs before a tool runs, and in the assistant's
 * prose before it reaches the client. So the token exists only on paths that
 * cannot corrupt it, and the model's job shrinks from "reproduce 250 random
 * characters" to "write one word".
 *
 * ## Why substitution mints rather than remembers
 *
 * Each expansion mints a fresh token. Caching one per turn would be tidier but
 * buys nothing: minting is an HMAC, the tokens are stateless, and a link written
 * into an email a minute after the tool ran deserves the full TTL rather than the
 * remainder of an earlier one. Two links in one reply differing in their `exp` by
 * a second is invisible and harmless — both resolve to the same conversation.
 *
 * Minting is **lazy**: text with no placeholder in it never calls `mint`, so a
 * turn that does not mention sharing neither signs anything nor logs about it.
 */

/**
 * What the model is told to write. Doubled braces because they cannot occur by
 * accident in the prose Valentin writes, and because the shape already reads as
 * "something gets filled in here" to a model.
 */
export const CONVERSATION_LINK_PLACEHOLDER = '{{conversation_link}}';

/**
 * Deliberately forgiving, because a near-miss must not reach the user as literal
 * braces. Square brackets, a hyphen, a space, inner padding and any casing all
 * resolve — every one of these is a plausible thing for a model to write when it
 * has been shown the canonical form once.
 */
const PLACEHOLDER_PATTERN = /(?:\{\{|\[\[)\s*conversation[-_ ]?link\s*(?:\}\}|\]\])/gi;

/** Whether this text asks for a share URL to be substituted into it. */
export function hasConversationLinkPlaceholder(text: string): boolean {
  // `test` on a `g` regex advances `lastIndex`, which would make the second call
  // on the same string answer differently. Reset rather than drop the flag,
  // because `replace` below needs `g` to catch every occurrence.
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return PLACEHOLDER_PATTERN.test(text);
}

/**
 * Replace every placeholder in one string with a freshly minted URL.
 *
 * `mint` is a callback rather than a URL so that nothing is signed for text that
 * turns out not to mention a link.
 */
export function expandConversationLinkText(text: string, mint: () => string): string {
  if (!hasConversationLinkPlaceholder(text)) return text;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return text.replace(PLACEHOLDER_PATTERN, () => mint());
}

/**
 * Expand placeholders anywhere inside a tool's input.
 *
 * Deep rather than a pass over known fields: the link belongs in
 * `propose_email.body` today, but a calendar event's description or a reminder's
 * text are the same kind of place, and a tool added later should not have to
 * remember to opt in. Keys are left alone — a placeholder in a key would be a
 * confused model, not a link.
 *
 * Returns the input unchanged, by reference, when there is nothing to expand, so
 * the common case allocates nothing and a tool that compares identity is
 * unaffected.
 */
export function expandConversationLinks<T>(value: T, mint: () => string): T {
  if (typeof value === 'string') {
    return expandConversationLinkText(value, mint) as unknown as T;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const expanded = expandConversationLinks(item, mint);
      if (expanded !== item) changed = true;
      return expanded;
    });
    return (changed ? next : value) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const expanded = expandConversationLinks(item, mint);
      if (expanded !== item) changed = true;
      next[key] = expanded;
    }
    return (changed ? next : value) as unknown as T;
  }

  return value;
}
