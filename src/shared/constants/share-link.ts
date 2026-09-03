/**
 * Links that hand *someone else* one conversation, and the wire shapes behind them.
 *
 * ## Why this is a second parameter and not a second use of `RESUME_PARAM`
 *
 * `resume-link.ts` carries a bare session id, and its safety argument is that the
 * id authorises nothing: every session route is scoped to the caller, so following
 * a stranger's `/?s=…` asks for a session that is not yours and gets a 404. That
 * property is exactly what makes it useless for sharing — the whole point of a
 * shareable link is that the reader is *not* the owner.
 *
 * So sharing gets its own parameter carrying its own credential: `/?share=<token>`,
 * where the token is signed by the server, names the session **and its owner**, and
 * expires. Two parameters rather than one overloaded one, because they have opposite
 * security properties and a reader of either file has to be told which one they are
 * holding. `share-token.ts` on the server is the only thing that mints or verifies
 * one; nothing here can.
 *
 * ## What a guest is allowed to see
 *
 * The transcript and the conversation's title. Not the dossier — not preferences,
 * people, tasks, outings or hand-typed corrections. A shared link is meant to show
 * someone *the conversation*, and the profile behind it is a file of intimate facts
 * about a specific person who is not in the room when it is pasted into a group
 * chat. `SharedConversation` below is the whole of the guest surface, and it is a
 * deliberately narrow type rather than a filtered `SessionDetail`: a field added to
 * the dossier must not become visible to guests by default.
 *
 * The transcript itself is *not* redacted. The person clicking Share is looking at
 * it when they click, so it is theirs to hand over — but the control must say so in
 * as many words, which is why the copy affordance carries a warning rather than
 * this module trying to guess which turns were sensitive.
 */

/** The query parameter carrying a signed share token. */
export const SHARE_PARAM = 'share';

/** How long a freshly minted share link stays good for. */
export const SHARE_TTL_DAYS = 7;

/**
 * An absolute link that opens one conversation read-only, for anyone.
 *
 * Same `origin` contract as `resumeLink`: a bare origin, trailing slash tolerated,
 * because `PUBLIC_ORIGIN` and the CDK `appUrls` both carry one.
 */
export function shareLink(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/?${SHARE_PARAM}=${encodeURIComponent(token)}`;
}

/** What `POST /api/session/:id/share` answers with. */
export interface ShareLinkResponse {
  /** The absolute link, already assembled — the client never sees the raw token. */
  url: string;
  /** ISO instant after which the link stops resolving. */
  expiresAt: string;
}

/** One turn of a shared transcript. */
export interface SharedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * What `GET /api/share/:token` answers with — the entire guest surface.
 *
 * No session id, and that is on purpose: handing a guest the real id would let them
 * try it against `/?s=` and the authenticated routes. It would 404 there, but there
 * is no reason to publish it at all.
 */
export interface SharedConversation {
  title: string;
  messages: SharedMessage[];
  /** So the guest view can say how long they have, rather than failing silently. */
  expiresAt: string;
}
