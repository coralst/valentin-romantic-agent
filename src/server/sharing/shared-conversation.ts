import type { ChatMessage } from '../../shared/interfaces/message';
import type { SessionData } from '../../shared/interfaces/session';
import type {
  SharedConversation,
  SharedMessage,
} from '../../shared/constants/share-link';

/**
 * The whole of what a guest is allowed to see, assembled in one pure function.
 *
 * ## Why a builder and not a filter
 *
 * The tempting shape is to take the `getSessionDetail` body and delete the keys a
 * guest must not have. That is the version that leaks: the next field added to the
 * dossier — a new preference bucket, a note, a photo reference — arrives in the
 * guest payload by default and nothing fails. Here the guest surface is *built up*
 * from named fields, so a new dossier field is invisible to guests until somebody
 * deliberately writes a line in this file adding it.
 *
 * `SharedConversation` in `shared/constants/share-link.ts` is therefore the
 * allowlist, in the literal sense: title, transcript, expiry. **No session id** (a
 * guest has no use for one and could otherwise try it against `/?s=`), no
 * preferences, no people, no tasks, no outings, no manual corrections. The dossier
 * is a file of intimate facts about someone who is not in the room when the link is
 * pasted into a group chat.
 *
 * ## `agent` becomes `assistant`
 *
 * Storage calls the two senders `user` and `agent` (`ChatMessage.sender`); the guest
 * type calls them `user` and `assistant`. The rename happens here rather than in the
 * shared type because the guest view is read by a renderer that has never heard of
 * this server's storage vocabulary, and mapping at the boundary is what keeps an
 * internal name from becoming a public one.
 *
 * Pure: no clock, no network, no model. The expiry is passed in because it belongs
 * to the token, not to the conversation.
 */

/** Turns beyond this are dropped from the head of a shared transcript. */
const MAX_SHARED_MESSAGES = 200;

/**
 * A conversation's public name.
 *
 * Same precedence the sidebar uses — the user's own title first, then the
 * denormalised partner name — but with a neutral fallback instead of an empty
 * string, because this string is the page's heading for a stranger.
 */
function sharedTitle(session: SessionData): string {
  const title = session.title?.trim();
  if (title) return title;
  const partner = session.partnerName?.trim();
  if (partner) return `Planning something for ${partner}`;
  return 'A conversation with Valentin';
}

function toSharedMessage(message: ChatMessage): SharedMessage {
  return {
    role: message.sender === 'user' ? 'user' : 'assistant',
    content: message.content,
    timestamp: message.timestamp,
  };
}

/**
 * Build the guest payload for one conversation.
 *
 * The tail is kept rather than the head when a transcript is very long: the end of a
 * conversation is what the person clicking Share was looking at.
 */
export function buildSharedConversation(
  session: SessionData,
  messages: readonly ChatMessage[],
  expiresAt: string,
): SharedConversation {
  return {
    title: sharedTitle(session),
    messages: messages.slice(-MAX_SHARED_MESSAGES).map(toSharedMessage),
    expiresAt,
  };
}
