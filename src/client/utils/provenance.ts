import type { ChatMessage } from '../../shared/interfaces/message';
import type { Preference } from '../../shared/interfaces/preference';

/**
 * Where a discovered value came from, stated as a fact rather than as reasoning.
 *
 * ---
 * WHY THIS EXISTS INSTEAD OF THE MOCKUP'S `.why` LINE
 *
 * `full-profile.html:328` writes "I inferred this because she surfs and dances
 * salsa — but I'm not certain she'd want an active date." There is no field
 * anywhere in the codebase that holds that sentence, and nothing in the
 * extraction pipeline produces one: `Preference` carries `confidence` and
 * `sourceMessageId`, and that is all. Rendering the mockup's line would mean
 * inventing reasoning the system never did, and attributing it to Valentin.
 *
 * So the card says the true thing instead: *when* he picked it up. That needs no
 * schema change, and it is the part of the mockup's intent that actually builds
 * trust — the same `.src` provenance the saved-ideas card uses at `:141`.
 *
 * ---
 * THE `sourceMessageId` MISMATCH
 *
 * `sourceMessageId` holds the *server's* id for the user's turn, while the
 * transcript renders the optimistic copy `ChatPanel` created with a locally
 * generated uuid (see the note at `MessageHistory.tsx:45`). The two never match,
 * so a transcript lookup keyed on it misses every time.
 *
 * Rather than show a wrong date, this degrades in three steps:
 *
 *   1. Look the message up anyway. It is the most precise answer available and
 *      it starts working for free the day the ids are reconciled server-side.
 *   2. Fall back to `Preference.createdAt` — the moment the extraction was
 *      recorded, which is within a second or two of the turn that produced it.
 *      Different provenance, but *true*, which is the whole point.
 *   3. Return null when neither is usable, and the caller omits the line.
 *
 * Seeded demo rows are caught explicitly: they point at a synthetic id and were
 * never said by anyone, so claiming a conversation happened would be a lie.
 */

/**
 * The synthetic id `demo-profile.ts` stamps on seeded preferences.
 *
 * Exported because `noted-index.ts` has to skip the same rows for the same
 * reason, and two copies of a sentinel is one copy too many.
 */
export const DEMO_SEED_SOURCE_MESSAGE_ID = 'demo-seed';

/** "11 Aug" — the mockup's compact provenance date (`full-profile.html:297`). */
const PROVENANCE_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});

export type ProvenanceKind =
  /** Matched to the actual message in the transcript. */
  | 'message'
  /** Derived from when the extraction was recorded. */
  | 'extraction'
  /** Seeded demo data, with no originating conversation. */
  | 'seed';

export interface Provenance {
  kind: ProvenanceKind;
  /** The line to render, already in Valentin's voice. */
  line: string;
}

/** Parse an ISO timestamp, returning null rather than an Invalid Date. */
function parseIso(iso: string | undefined): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The provenance line for one discovered preference, or null when nothing true
 * can be said about where it came from.
 *
 * `messages` is the client transcript. Passing it in keeps this a pure function,
 * and keeps the mismatch above testable without mounting the chat.
 */
export function describeProvenance(
  preference: Pick<Preference, 'sourceMessageId' | 'createdAt'>,
  messages: readonly ChatMessage[] = [],
): Provenance | null {
  if (preference.sourceMessageId === DEMO_SEED_SOURCE_MESSAGE_ID) {
    return { kind: 'seed', line: 'From the demo profile, not from anything you told me.' };
  }

  const sourceMessage = preference.sourceMessageId
    ? messages.find((message) => message.id === preference.sourceMessageId)
    : undefined;

  const fromMessage = parseIso(sourceMessage?.timestamp);
  if (fromMessage) {
    return {
      kind: 'message',
      line: `I picked this up from what you told me on ${PROVENANCE_DATE.format(fromMessage)}.`,
    };
  }

  const fromExtraction = parseIso(preference.createdAt);
  if (fromExtraction) {
    // Deliberately vaguer wording than the branch above, because this date is
    // the extraction's, not the message's. "Noted" is true of both.
    return {
      kind: 'extraction',
      line: `I noted this on ${PROVENANCE_DATE.format(fromExtraction)} from something you said.`,
    };
  }

  return null;
}
