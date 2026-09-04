import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface } from '../persistence/storage-interface';
import type { KnownFact } from './prompts';
import { outingHistory } from '../../shared/interfaces/outing';
import type { Outing } from '../../shared/interfaces/outing';

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

/**
 * The same account-wide profile, in full, for the surfaces that display it.
 *
 * `readKnownFacts` narrows to key/value/fieldId because that is all a prompt
 * needs. Her brief and the dossier need the whole row — category, confidence,
 * history — so this returns `PreferenceWithHistory` rather than `KnownFact`.
 *
 * It exists because fixing the prompt alone left the screen contradicting it.
 * `getSessionDetail` read `getPreferencesBySession(sessionId)`, so opening a new
 * conversation inside a fully-profiled account showed Name, Birthday, Anniversary
 * and every other field as an empty placeholder — while Valentin, reading the
 * union, answered the very next message using her cuisine and her colours. Two
 * scopes for one partner, and the panel was the one telling the user he knew
 * nothing.
 *
 * Deliberately built on the same `recentSessionIds` as `readKnownFacts`: the
 * point of this module is that the prompt and the display cannot disagree about
 * which conversations count, and duplicating the ordering here is exactly how
 * they would drift.
 */
export async function readAccountPreferences(
  storage: StorageInterface,
  sessionId: string,
): Promise<PreferenceWithHistory[]> {
  const merged = new Map<string, PreferenceWithHistory>();

  for (const id of await recentSessionIds(storage, sessionId)) {
    for (const pref of await preferencesIn(storage, id)) {
      // Same collision rule as the prompt's: the active session is merged last,
      // so a value corrected in this conversation wins over an older copy.
      merged.set(pref.fieldId ?? pref.key, pref);
    }
  }

  return [...merged.values()];
}

/**
 * Every place he has taken her, account-wide, newest first.
 *
 * Built on the same `recentSessionIds` as the two functions above, for the same
 * reason: an outing recorded in last month's conversation is still a place they
 * have been, and a history scoped to the active session would let Valentin offer
 * the restaurant she disliked the moment someone starts a new chat.
 *
 * Unlike the preference readers there is no merge key — a second dinner at the
 * same restaurant is a second row, deliberately (see `outingSk`), and both
 * belong in the history. Sorted here rather than in the store because DynamoDB
 * returns them in sort-key order, which is uuid order, which is nothing.
 */
export async function readVisitedPlaces(
  storage: StorageInterface,
  sessionId: string,
): Promise<Outing[]> {
  const all: Outing[] = [];

  for (const id of await recentSessionIds(storage, sessionId)) {
    all.push(...(await outingsIn(storage, id)));
  }

  return outingHistory(all);
}

/** Best-effort read of one session's outings */
async function outingsIn(storage: StorageInterface, sessionId: string): Promise<Outing[]> {
  try {
    return await storage.getOutingsBySession(sessionId);
  } catch (err) {
    // Same trade as `factsIn`: losing the history costs him one line of the
    // prompt, where propagating would cost the user their turn.
    console.warn(
      '[partner-profile] could not read the outing history for the prompt:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Best-effort read of one session's full preference rows */
async function preferencesIn(
  storage: StorageInterface,
  sessionId: string,
): Promise<PreferenceWithHistory[]> {
  try {
    return await storage.getPreferencesBySession(sessionId);
  } catch (err) {
    // Same trade as `factsIn`: a partial profile on screen beats an error page.
    console.warn(
      '[partner-profile] could not read the profile for the brief:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
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
