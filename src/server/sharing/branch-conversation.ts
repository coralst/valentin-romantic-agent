import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../../shared/interfaces/message';
import type { SessionData } from '../../shared/interfaces/session';
import type { StorageInterface } from '../persistence/storage-interface';

/**
 * Opening a share link puts the visitor **in the app**, in a conversation of their
 * own that starts where the shared one was handed over.
 *
 * ## Why a copy and not the original
 *
 * The obvious implementation is to let a guest talk directly into the owner's
 * session. That is the one thing this must never do. Two people would be writing
 * turns into one transcript with no idea the other was there, the guest's questions
 * would be extracted into the *owner's* dossier, and a link forwarded twice would
 * put strangers in the same room. Possession of a URL buys a copy of a
 * conversation, not write access to somebody's account.
 *
 * So the branch is a genuine fork: a fresh session in the *visitor's* own scoped
 * store, seeded with the transcript up to the shared point. From there it is an
 * ordinary conversation — the composer works, Valentin answers, and nothing the
 * visitor says can reach the original. The owner's session is opened read-only and
 * never written to.
 *
 * ## Where the cut falls
 *
 * At the token's mint time, not at the end of the transcript. A link sent on
 * Tuesday should open Tuesday's conversation however far the owner has taken it
 * since — that is what "branched from that chat" means, and it is why
 * `share-token.ts` carries an `iat`. When the owner has moved on, the fork and the
 * original diverge at exactly the point the link was handed over.
 *
 * ## What is deliberately *not* copied
 *
 * The dossier. Not preferences, people, tasks, outings or manual corrections — the
 * same allowlist `shared-conversation.ts` defends, for the same reason: those are
 * intimate facts about someone who is not in the room when a link gets forwarded.
 * The consequence is honest and worth stating — Valentin enters the branch knowing
 * only what the transcript says, so the profile panel starts empty and refills from
 * the conversation as it continues.
 */

/** Turns beyond this are dropped from the head, matching the shared transcript cap. */
const MAX_BRANCHED_MESSAGES = 200;

export interface BranchedConversation {
  /** The new session, in the visitor's own store. */
  sessionId: string;
  /** Its heading, derived from the original. */
  title: string;
  /** How many turns were carried over. */
  copied: number;
  /**
   * True when the original had moved on past the shared point.
   *
   * Surfaced so the UI can say so plainly. A visitor who is told "this continues
   * from where the link was made, and the conversation has since moved on"
   * understands why the last thing they remember reading is not there; one who is
   * told nothing assumes the app lost it.
   */
  advanced: boolean;
}

/**
 * Order a transcript the way it was said, tolerating an unparseable timestamp.
 *
 * Storage returns messages in key order, which is insertion order, and that is
 * normally the same thing. Sorting is defensive rather than corrective: the cut
 * below is by time, so a transcript that is out of order would otherwise lose a
 * turn from the middle rather than from the end.
 */
function inSpokenOrder(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => at(a) - at(b));
}

/** A message's instant, with an unreadable one treated as very old. */
function at(message: ChatMessage): number {
  const parsed = Date.parse(message.timestamp);
  // Not `NaN`-propagating: a message with a broken timestamp is kept and sorted to
  // the front, because dropping a turn silently is worse than misplacing one.
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The turns that existed when the link was minted.
 *
 * Inclusive of the boundary, and generous by a second: `iat` is truncated to whole
 * seconds while message timestamps carry milliseconds, so an exact comparison drops
 * the very turn the sharer was looking at when they clicked.
 */
export function messagesAsSharedAt(
  messages: readonly ChatMessage[],
  sharedAtSeconds: number,
): ChatMessage[] {
  const cutoff = (sharedAtSeconds + 1) * 1000;
  return inSpokenOrder(messages).filter((message) => at(message) <= cutoff);
}

/**
 * A branch's heading.
 *
 * Named after the original so a visitor can tell what they are in, and marked as a
 * continuation so it is not mistaken for the owner's own conversation in a sidebar
 * that may later hold several.
 */
export function branchTitle(session: SessionData): string {
  const title = session.title?.trim();
  if (title) return `${title} (continued)`;
  const partner = session.partnerName?.trim();
  if (partner) return `Planning something for ${partner} (continued)`;
  return 'A conversation with Valentin (continued)';
}

/**
 * Fork one conversation into a fresh session in `target`.
 *
 * `source` is read and never written. `target` is the visitor's own store, which
 * the caller has already scoped — this function is given two stores rather than a
 * factory precisely so it cannot pick the wrong one.
 */
export async function branchSharedConversation(options: {
  source: StorageInterface;
  target: StorageInterface;
  session: SessionData;
  sourceSessionId: string;
  /** Epoch seconds, from `sharedAtSeconds(payload)`. */
  sharedAt: number;
}): Promise<BranchedConversation> {
  const { source, target, session, sourceSessionId, sharedAt } = options;

  const all = await source.getMessagesBySession(sourceSessionId);
  const asShared = messagesAsSharedAt(all, sharedAt);
  // The tail, for the same reason the shared view keeps the tail: the end of a
  // conversation is what the person clicking Share was looking at.
  const carried = asShared.slice(-MAX_BRANCHED_MESSAGES);

  const sessionId = await target.createSession();
  const title = branchTitle(session);
  await target.updateSessionMeta(sessionId, { title });

  /*
   * Sequentially, not `Promise.all`.
   *
   * The transcript's order is the only thing that makes it a conversation, and
   * these rows are keyed by insertion. Firing two hundred concurrent writes at
   * DynamoDB would also hand the visitor a throttling error in place of their
   * first page.
   */
  for (const message of carried) {
    await target.saveMessage({
      id: randomUUID(),
      sessionId,
      sender: message.sender,
      content: message.content,
      // The original instant, not now. These turns were said when they were said,
      // and stamping them with the fork time would make a week-old conversation
      // look like it happened in one second this afternoon.
      timestamp: message.timestamp,
    });
  }

  return {
    sessionId,
    title,
    copied: carried.length,
    advanced: asShared.length < all.length,
  };
}
