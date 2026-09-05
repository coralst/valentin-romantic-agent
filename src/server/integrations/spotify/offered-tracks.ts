/**
 * The track ids `find_music` actually offered, per session.
 *
 * ## Why this exists
 *
 * `propose_playlist` requires the model to copy 22-character opaque base-62 ids out
 * of `find_music`'s prose and back into an argument. That is the one thing a
 * language model is structurally bad at, and it fails the way you would expect: a
 * live bug hunt caught `1zNXF2svmdlNxfS5XeNUgr` coming back as
 * `1zNXF2svmdlNxfS6XeNUgr` — one character — on three runs out of four, always the
 * same flip. Spotify then 404s that id, the tool drops it, and a seventeen-track
 * playlist quietly becomes sixteen. The user is told about none of it.
 *
 * Telling the model to try harder does not fix a transcription channel; removing
 * the need to transcribe does. The set of ids the model is *allowed* to use is
 * knowable — it is exactly what `find_music` returned in this session — so a
 * near-miss can be corrected against it before anything reaches the wire.
 *
 * ## Why correction is safe here
 *
 * A correction only happens when the candidate is within one character of exactly
 * **one** offered id. Two plausible matches means we cannot know which song was
 * meant, so the id is left alone to fail honestly rather than guessed at. That
 * keeps the invariant the card depends on: every track on it is one the model was
 * shown, and nothing is silently substituted for something else.
 */

/** Ids offered per session, newest last, oldest sessions evicted first. */
const offered = new Map<string, string[]>();

/** How many sessions to remember. Bounded so a long-lived process cannot grow. */
const MAX_SESSIONS = 200;

/** How many ids to keep per session — several searches' worth, not unbounded. */
const MAX_IDS_PER_SESSION = 200;

/** Record the ids a search offered, so a later playlist can be checked against them. */
export function rememberOffered(sessionId: string, ids: readonly string[]): void {
  if (!sessionId || ids.length === 0) return;

  // Re-inserting moves the session to the end, which is what makes the eviction
  // below least-recently-used rather than arbitrary.
  const existing = offered.get(sessionId) ?? [];
  offered.delete(sessionId);
  offered.set(sessionId, [...new Set([...existing, ...ids])].slice(-MAX_IDS_PER_SESSION));

  while (offered.size > MAX_SESSIONS) {
    const oldest = offered.keys().next();
    if (oldest.done) break;
    offered.delete(oldest.value);
  }
}

/** Every id this session has been shown. Empty when it has not searched yet. */
export function offeredIn(sessionId: string): readonly string[] {
  return offered.get(sessionId) ?? [];
}

/**
 * Whether two ids differ by exactly one character — substitution, insertion or
 * deletion. Not a general edit distance: bailing out at the first divergence is
 * enough for a distance of one and keeps this cheap enough to run per id.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let short = 0;
  let long = 0;
  let edits = 0;

  while (short < shorter.length && long < longer.length) {
    if (shorter[short] === longer[long]) {
      short += 1;
      long += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    // Same length means the divergence must be a substitution; different lengths
    // means the longer string has a character the shorter one does not.
    if (shorter.length === longer.length) short += 1;
    long += 1;
  }
  // A trailing character left over in the longer string is the final edit.
  return edits + (longer.length - long) <= 1;
}

export interface Correction {
  readonly from: string;
  readonly to: string;
}

export interface CorrectedIds {
  readonly ids: readonly string[];
  readonly corrections: readonly Correction[];
  /** Ids that are neither offered nor near an offered one — invented outright. */
  readonly unknown: readonly string[];
}

/**
 * Map the ids the model passed onto the ids it was actually shown.
 *
 * An exact match passes through. A one-character miss against exactly one offered
 * id is corrected and reported. Anything else is passed through untouched and
 * listed as unknown — it may still resolve on Spotify (the model may be quoting an
 * id from an earlier session, or the session may have no record at all), so this
 * does not filter, it only repairs what it can prove.
 */
export function correctOfferedIds(sessionId: string, ids: readonly string[]): CorrectedIds {
  const known = offeredIn(sessionId);
  if (known.length === 0) return { ids, corrections: [], unknown: [] };

  const knownSet = new Set(known);
  const corrections: Correction[] = [];
  const unknown: string[] = [];

  const mapped = ids.map((id) => {
    if (knownSet.has(id)) return id;

    const near = known.filter((candidate) => withinOneEdit(id, candidate));
    if (near.length === 1) {
      corrections.push({ from: id, to: near[0] });
      return near[0];
    }
    // Zero matches means invented; two or more means we cannot tell which song was
    // meant, and guessing would put a track on the card that was never discussed.
    unknown.push(id);
    return id;
  });

  return { ids: mapped, corrections, unknown };
}

/** Test seam: forget everything. Never called in production. */
export function resetOfferedTracks(): void {
  offered.clear();
}
