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
