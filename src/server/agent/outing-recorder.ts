import { randomUUID } from 'node:crypto';
import type { Outing } from '../../shared/interfaces/outing';
import type { BookingRecord } from '../integrations/tool-registry';
import type { StorageInterface } from '../persistence/storage-interface';
import { logger } from '../logging';

/**
 * Turn a confirmed booking into a row on her file.
 *
 * A free function rather than a private method on `AgentOrchestrator`, for two
 * reasons. It is called from the middle of `confirmAction`, where a private
 * method would be indistinguishable from the booking itself and would make the
 * "this must never fail the turn" rule below invisible. And engine B
 * (`AgentCoreOrchestrator`) is one call away from needing it: it implements
 * `confirmAction` too, and the day it grows a tool registry this is the whole
 * integration, not a method to lift out of another class.
 *
 * ## Why this swallows its own failures
 *
 * By the time we get here the table is booked. Ontopo has the reservation and
 * the user has the confirmation. If DynamoDB is slow or throttled at that exact
 * moment, the correct outcome is a missing history row and a log line — not
 * "I couldn't complete that" in the reply, which would be a lie about the one
 * thing the user most needs to be true. So every failure path returns null and
 * logs `agent.outing_not_recorded`.
 *
 * ## Why a `booking` is required
 *
 * The plan for this had the recorder fall back to building a row out of the
 * proposal's title alone, so that every confirmed action produced history. It
 * does not, deliberately: this history answers "where have I already taken her",
 * it is read back both to avoid a place she disliked and to surface one she
 * loved, and the survey attached to each row asks how the *place* was. A gift
 * delivery or an email send is a confirmed action with no place in it, and a row
 * asking her to rate the florist would be noise in the dossier and in the
 * prompt. A tool that names a venue sets `booking`; nothing else records
 * anything. See the comment in `wolt/tools.ts`'s confirm.
 */
export async function recordOuting(
  storage: StorageInterface,
  sessionId: string,
  booking: BookingRecord | undefined,
): Promise<Outing | null> {
  if (!booking) return null;

  const outing: Outing = {
    id: randomUUID(),
    venueSlug: booking.venueSlug ?? null,
    venueName: booking.venueName,
    city: booking.city ?? null,
    occursOn: booking.occursOn ?? null,
    confirmedAt: new Date().toISOString(),
    // Unrated is the whole point of the row existing today: `unratedOutings`
    // finds it once the date has passed and that is what raises the survey.
    rating: null,
    verdict: null,
    note: null,
    ratedAt: null,
  };

  try {
    return await storage.saveOuting(sessionId, outing);
  } catch (cause) {
    logger.warn('agent.outing_not_recorded', {
      sessionId,
      venue: booking.venueName,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}
