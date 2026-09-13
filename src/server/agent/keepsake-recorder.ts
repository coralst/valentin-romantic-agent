import type { Keepsake } from '../integrations/tool-registry';
import type { StorageInterface } from '../persistence/storage-interface';
import { logger } from '../logging';

/**
 * Write down something that was made for her, so a later message can hand it over.
 *
 * The sibling of `outing-recorder.ts`, and it exists for the same structural reason.
 * A confirm is the only moment at which the artefact is known to be real — Spotify has
 * saved the playlist and returned a URL — and the message that gives it to him fires
 * days later from a timer, in a process with no conversation in it. If the URL is not
 * persisted here it is gone, and the reminder can only allude to a surprise it cannot
 * link.
 *
 * ## Why a preference row and not a table of its own
 *
 * The profile is already the durable, per-session, user-scoped store that the reminder
 * path reads on its way to composing a mail (`reminderContextFor` fetches
 * `getPreferencesBySession` regardless). A new table would need a new read there, a new
 * method on `StorageInterface` and a new DynamoDB access pattern, to hold one row that
 * is genuinely a fact about her: there is a playlist, made for her, at this address.
 *
 * `music` is the honest category — the alternative was widening `PreferenceCategory`,
 * which is also the extraction vocabulary the model is shown, and a category the model
 * can emit but should never invent is worse than a well-named key. The key is
 * namespaced `valentin_` so it cannot collide with anything the extractor writes.
 *
 * ## Why this swallows its own failures
 *
 * Identical to `recordOuting`: by the time we are here the playlist exists and the
 * user has been told so. A throttled write must cost the mail its closing paragraph,
 * never the confirm its reply.
 */

/** Where a made playlist is filed. Read by `reminderContextFor`. */
export const KEEPSAKE_CATEGORY = 'music' as const;
export const PLAYLIST_KEY = 'valentin_playlist';

/**
 * `title@url`.
 *
 * One field, because `Preference.value` is one string and the two halves are never
 * wanted apart — the mail needs a name to write and a link to point at. `@` is the
 * separator the rest of the profile already uses for compound values (`weekly_rhythm`
 * is `Day@what@weight`, `next_occasion` is `date@description`), so this is the
 * codebase's existing convention rather than a second one.
 *
 * The split takes the **last** separator, not the first: a Spotify URL contains no `@`,
 * so everything before the final one is the title — which is what makes a title that
 * contains one ("me@home mixtape") survive the round trip. Splitting on the first
 * instead silently produced a title of "me" and a URL that failed validation, so the
 * whole surprise vanished from the mail over a punctuation mark in a playlist name.
 */
export function encodeKeepsake(keepsake: Keepsake): string {
  return `${keepsake.title}@${keepsake.url}`;
}

/** The inverse. `null` for anything that is not a usable title-and-link pair. */
export function decodeKeepsake(value: string | null | undefined): { title: string; url: string } | null {
  if (!value) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;

  const title = value.slice(0, at).trim();
  const url = value.slice(at + 1).trim();
  // A link is the whole point, and only http(s) is openable from a mail client. A
  // stored row that fails this is skipped rather than rendered, which is the same
  // stance the mail takes everywhere else: say nothing before saying something wrong.
  if (!title || !/^https?:\/\//i.test(url)) return null;
  return { title, url };
}

export async function recordKeepsake(
  storage: StorageInterface,
  sessionId: string,
  sourceMessageId: string,
  keepsake: Keepsake | undefined,
): Promise<void> {
  if (!keepsake) return;

  const value = encodeKeepsake(keepsake);

  try {
    const existing = await storage.findPreference(sessionId, KEEPSAKE_CATEGORY, PLAYLIST_KEY);

    /*
     * Upsert rather than save, and skip an unchanged value — the same rule
     * `mirrorPreferences` follows. `savePreference` over an existing row loses the
     * revision history the profile UI reads, and re-saving an identical value grows a
     * fake trail of revisions. Making a second playlist is a real revision and does
     * appear as one.
     */
    if (!existing) {
      await storage.savePreference({
        sessionId,
        category: KEEPSAKE_CATEGORY,
        key: PLAYLIST_KEY,
        value,
        confidence: 1,
        sourceMessageId,
      });
      return;
    }

    if (existing.value === value) return;

    await storage.updatePreference(
      { sessionId, category: KEEPSAKE_CATEGORY, key: PLAYLIST_KEY },
      { value, confidence: 1, sourceMessageId },
    );
  } catch (cause) {
    logger.warn('agent.keepsake_not_recorded', {
      sessionId,
      kind: keepsake.kind,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
