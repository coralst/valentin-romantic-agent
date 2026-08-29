import type { StorageInterface } from '../persistence/storage-interface';
import type { KnownFact } from './prompts';

/**
 * How many other conversations to gather the partner's profile from.
 *
 * `listSessions` returns newest first, so this takes the recent ones. One query
 * each, on every turn — see {@link readKnownFacts}.
 */
const MAX_PROFILE_SESSIONS = 6;

/**
 * What Valentin knows about her, for the prompt.
 *
 * Extracted from `AgentOrchestrator` so both engines read the profile the same
 * way. That is not tidiness: the whole point of running two engines is that a
 * difference between their answers is attributable to the engine, and "engine B
 * looked at fewer facts" would silently invalidate every comparison. One
 * function means the two cannot drift apart.
 *
 * ACCOUNT-WIDE, NOT PER-CONVERSATION. Preferences are stored under a session,
 * but the partner they describe belongs to the account: opening a second
 * conversation does not give someone a second partner. Reading only
 * `sessionId` meant a brand-new chat inside a fully-profiled account was
 * treated as a first meeting — the exact thing that made him ask a user who
 * had twenty-one known fields to tell him about his partner.
 *
 * The active session is merged last so it wins on conflicts: it holds the most
 * recent turn, and a fact just corrected there must not be overwritten by the
 * older copy of it sitting in another conversation.
 *
 * Bounded to the most recent handful of conversations. This runs on every turn
 * and each session is its own query, so it is capped rather than left to grow
 * with the account's history; the latest conversations are where a current
 * profile actually lives.
 *
 * Best-effort throughout: a store that fails here must cost a personalised
 * reply, not the reply itself. Falling back to less knowledge degrades him to
 * the getting-to-know-you register, which is wrong but harmless; propagating
 * would put an apology on screen instead of an answer.
 */
export async function readKnownFacts(
  storage: StorageInterface,
  sessionId: string,
): Promise<KnownFact[]> {
  const merged = new Map<string, KnownFact>();

  for (const id of await recentSessionIds(storage, sessionId)) {
    for (const fact of await factsIn(storage, id)) {
      merged.set(fact.fieldId ?? fact.key, fact);
    }
  }

  return [...merged.values()];
}

/** The sessions worth reading, oldest first, with the active one last */
async function recentSessionIds(
  storage: StorageInterface,
  activeId: string,
): Promise<string[]> {
  let others: string[] = [];
  try {
    others = (await storage.listSessions())
      .map((session) => session.id)
      .filter((id) => id !== activeId)
      .slice(0, MAX_PROFILE_SESSIONS)
      .reverse();
  } catch (err) {
    console.warn(
      '[partner-profile] could not list sessions for the prompt:',
      err instanceof Error ? err.message : err,
    );
  }
  return [...others, activeId];
}

async function factsIn(
  storage: StorageInterface,
  sessionId: string,
): Promise<KnownFact[]> {
  try {
    return await storage.getPreferencesBySession(sessionId);
  } catch (err) {
    console.warn(
      '[partner-profile] could not read the profile for the prompt:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
