/**
 * The one query parameter this app reads, and the link that carries it.
 *
 * A reminder email is useless if it drops the reader on an empty chat: the whole
 * point of "here is what I found for the 4th" is that clicking it lands them in
 * *that* conversation, with the options already in the transcript. There is no
 * router in this SPA and deliberately so, so resuming is one query parameter
 * rather than a path — `/?s=<sessionId>`.
 *
 * It lives in `shared` because both halves must agree on the spelling: the server
 * writes it into email bodies and the client reads it out of `window.location`
 * before the auth gate can wipe the query string. A private constant on each side
 * is how the link ends up pointing at a parameter nobody reads.
 *
 * A session id in a link is **not** an authorisation token. Every session route is
 * scoped to the authenticated user, so following someone else's link asks the
 * server for a session that is not yours and gets a 404 — see `session-api.ts`.
 * That is why this can safely ride in plain text in an email.
 *
 * The corollary, and the reason `share-link.ts` exists next door: this link works
 * **only for the person who owns the conversation.** It is what a reminder mail
 * carries, because that mail goes to its owner. Do not reach for it to let somebody
 * *else* read a conversation — it will 404 for them, correctly. Handing a link to
 * another person needs a credential in the link, which is `SHARE_PARAM` and a signed
 * token, and which is deliberately a separate parameter so that nobody can turn this
 * one into a bearer token by accident.
 */

/** The query parameter naming the conversation to resume. */
export const RESUME_PARAM = 's';

/**
 * An absolute link that reopens one conversation.
 *
 * `origin` must be a bare origin; a trailing slash is tolerated because
 * `PUBLIC_ORIGIN` and the CDK `appUrls` both carry one and forgetting to strip it
 * would produce `https://host//?s=…`.
 */
export function resumeLink(origin: string, sessionId: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/?${RESUME_PARAM}=${encodeURIComponent(sessionId)}`;
}
