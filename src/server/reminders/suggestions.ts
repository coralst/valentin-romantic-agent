import type { Outing } from '../../shared/interfaces/outing';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { Reminder } from '../../shared/interfaces/reminder';
import { venuePageUrl } from '../integrations/ontopo/discovery';
import { isRestaurantStyle, findVenues } from '../integrations/ontopo/venues';
import type { CuratedVenue } from '../integrations/ontopo/venues';
import type { StorageInterface } from '../persistence/storage-interface';
import { logger } from '../logging';
import type {
  ReminderActivity,
  ReminderReservation,
  ReminderSuggestion,
  ReminderSurprise,
} from './email-body';
import { profileFieldValue } from './reminder-sync';
import {
  decodeKeepsake,
  KEEPSAKE_CATEGORY,
  PLAYLIST_KEY,
} from '../agent/keepsake-recorder';

/**
 * What a reminder should be *about*, composed from the profile before it is sent.
 *
 * ## Why this is a separate module and not part of the dispatcher
 *
 * `dispatcher.ts` had `suggestions: []` with a comment explaining what wiring it in
 * would take, and the reason it stayed empty is the claim-then-send window: the row
 * is stamped `sentAt` *before* the mail is composed, so anything slow or failing
 * between the two turns a reminder into a lost reminder. That argues for composing
 * the content first, outside the claim, and handing it in — which is what this is.
 *
 * ## Why it makes no network call
 *
 * Suggestions come from {@link findVenues}, which searches the curated Ontopo list
 * in `integrations/ontopo/venues.ts` — real venues with real booking slugs, matched
 * in process. The alternatives both cost more than they are worth here:
 *
 * - **Ontopo availability** (`fetchAvailability`) would let the mail name the times a
 *   table is genuinely free. It is also an outbound HTTP call per venue, on a sweep
 *   that runs every minute, and `reachLine` in `email-body.ts` already has an honest
 *   wording for not knowing: "Bookable through me — reply and I will check the
 *   times." So the mail offers the room and finds the hour when he answers.
 * - **Google Places discovery** would widen the list beyond the curated set, but it
 *   needs a geocoded origin (`geocode` is itself a Places call) and returns places
 *   Valentin cannot book. A reminder full of things it cannot act on is a worse mail.
 *
 * The consequence, stated plainly: `search_radius` is *not* applied, because filtering
 * by radius needs coordinates for `home_city` and those come from `geocode`. The
 * criteria line therefore never claims a distance it did not check. `home_city` is
 * used as a search *term* instead, which is honest and does most of the same work.
 *
 * ## Why nothing here is model-authored
 *
 * Same reason as `email-body.ts`: this mail goes out with nobody in the conversation
 * to catch an invented restaurant. Every string this produces is either a stored
 * profile value or a field of a curated venue.
 */

/**
 * One template cannot serve all three activities: a list of restaurants under "Call
 * the florist" is noise, and the same list under "keep it at home this year" argues
 * with what he just said. So the activity picks the block, and adding a fourth — a
 * concert, a weekend away — is a case in {@link activityFor} plus a paragraph in
 * `email-body.ts`, not a rewrite. `restaurant` is the default because it is the only
 * one the product can *act* on: Ontopo is the one integration that books.
 */
export type { ReminderActivity } from './email-body';

export interface ReminderContext {
  activity: ReminderActivity;
  /** Why these, restated in the mail so a wrong suggestion is auditable. */
  criteria: readonly string[];
  suggestions: readonly ReminderSuggestion[];
  /** Grounded prompts for an activity with nothing bookable. */
  ideas: readonly string[];
  /** What else is on her week that evening, when the profile says. */
  timingNote?: string | null;
  /**
   * Her name, so the subject reads "Maya's birthday" instead of "Her birthday".
   *
   * It rides along here because this is already the one place that reads the profile
   * on the send path — the alternative was a second read in the dispatcher, which is
   * the boundary `DispatchOptions.context` exists to avoid.
   */
  partnerName?: string | null;
  /**
   * The venue he already settled on for this evening, which turns the mail from a
   * prompt into a confirmation. Null unless a confirmed outing matches the date.
   */
  reservation?: ReminderReservation | null;
  /** A playlist made for her, to hand over at the end of the mail. */
  surprise?: ReminderSurprise | null;
}

/** Nothing to add: the mail still sends, and still says the date. */
export const EMPTY_CONTEXT: ReminderContext = {
  activity: 'restaurant',
  criteria: [],
  suggestions: [],
  ideas: [],
  timingNote: null,
  reservation: null,
  surprise: null,
};

/**
 * How many curated venues to consider. Three reach the mail — `MAX_SUGGESTIONS` in
 * `email-body.ts` caps it — and a couple of spares survive the previously-rated pass
 * below reordering them.
 */
const CANDIDATES = 5;

/**
 * Words that mean he does not want to be sent out.
 *
 * Read off `next_occasion`'s description or a `set_reminder` title, which are both
 * his own words. Kept short and literal on purpose: a longer list starts guessing at
 * intent, and guessing wrong here means a mail that argues with him. Anything not
 * matched falls through to `restaurant`, which is the recoverable direction — a
 * restaurant he did not want is an idea he can ignore, where silence about an evening
 * in is a reminder that did nothing.
 */
const AT_HOME_WORDS = [
  'at home',
  'at our place',
  'stay in',
  'staying in',
  'night in',
  'evening in',
  'cook',
  'cooking',
  'takeaway',
  'movie night',
  'film night',
];

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Prefixes rather than exact names, because `weekly_rhythm` is written by the
 * extractor from his own sentence and arrives as `Tue`, `Tues` or `Tuesday`.
 */
const WEEKDAY_PREFIXES: readonly (readonly [string, number])[] = [
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6],
];

/** Which evening the occasion falls on, `0` for Sunday, from a `YYYY-MM-DD`. */
function weekdayOf(occursOn: string): number | null {
  const [year, month, day] = occursOn.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The line about what else she has on that evening.
 *
 * `weekly_rhythm` is stored as `Day@what it is@weight`, and only the day and the
 * label are wanted here. Parsed locally rather than through
 * `client/utils/list-field-parsing.ts`'s richer `parseWeeklyRhythm`: the server must
 * not import from `src/client/`, and what this needs is two of that function's three
 * fields — the weight only exists to size a bar in a chart.
 *
 * This is the one paragraph in the mail that could not be written by looking at a
 * calendar, which is the whole reason it earns its place: "the 12th is a Tuesday, and
 * Tuesday is her pottery night" is the difference between a date and a plan.
 */
function timingNoteFor(occursOn: string, weeklyRhythm: string | null): string | null {
  const weekday = weekdayOf(occursOn);
  if (weekday === null || !weeklyRhythm) return null;

  for (const item of weeklyRhythm.split(',')) {
    const [dayPart, label] = item.split('@').map((part) => part.trim());
    const day = (dayPart ?? '').toLowerCase();
    const named = WEEKDAY_PREFIXES.find(([prefix]) => day.startsWith(prefix))?.[1];
    if (named !== weekday) continue;
    if (!label) continue;
    return `That is a ${WEEKDAY_NAMES[weekday]}, and you have told me ${label} — worth planning around.`;
  }
  return null;
}

/** Which template this reminder wants. */
export function activityFor(reminder: Pick<Reminder, 'kind' | 'title' | 'occasion'>): ReminderActivity {
  // A title exists only on a row `set_reminder` wrote, which is his own sentence
  // about his own errand. He did not ask for ideas.
  if (reminder.title?.trim()) return 'errand';

  const said = reminder.occasion.toLowerCase();
  if (AT_HOME_WORDS.some((word) => said.includes(word))) return 'at_home';
  return 'restaurant';
}

/** The best rating this session has recorded for a venue, or nothing. */
function ratingFor(venue: CuratedVenue, outings: readonly Outing[]): number | null {
  const match = outings.find((outing) => {
    if (typeof outing.rating !== 'number') return false;
    if (outing.venueSlug) return outing.venueSlug === venue.slug;
    // Falling back to the name is deliberate: an outing confirmed by hand has no
    // slug, and "you rated this 5/5" is the single most valuable line in the mail.
    return outing.venueName.trim().toLowerCase() === venue.name.trim().toLowerCase();
  });
  return typeof match?.rating === 'number' ? match.rating : null;
}

function toSuggestion(venue: CuratedVenue, outings: readonly Outing[]): ReminderSuggestion {
  const previousRating = ratingFor(venue, outings);
  const url = venuePageUrl(venue);
  return {
    name: venue.name,
    ...(url === null ? {} : { url }),
    // The source's own words for where it is — never rewritten, and never inferred
    // from coordinates the mail did not look up.
    area: venue.neighbourhood ? `${venue.neighbourhood}, ${venue.city}` : venue.city,
    reach: 'bookable',
    // Left unset rather than guessed: no availability call was made, and
    // `reachLine` has an honest wording for not knowing.
    availableTimes: [],
    ...(previousRating === null ? {} : { previousRating }),
  };
}

export interface ComposeInput {
  reminder: Pick<Reminder, 'kind' | 'title' | 'occasion' | 'occursOn'>;
  partnerName: string | null;
  favoriteCuisine: string | null;
  restaurantStyle: string | null;
  homeCity: string | null;
  musicGenre: string | null;
  weeklyRhythm: string | null;
  outings: readonly Outing[];
  /**
   * A playlist made for her, decoded from her profile. Absent on every caller that
   * predates it, which gets the mail exactly as it was.
   */
  surprise?: ReminderSurprise | null;
}

/**
 * The venue he already chose for this evening, from his own confirmed outings.
 *
 * Matched on the date and nothing else, which is what makes it trustworthy: an outing
 * row exists only because somebody clicked Confirm on a card naming a real venue, and
 * the date on it came from the same card. There is no scoring and no nearest-match — a
 * reservation for a different evening is not this evening's reservation.
 *
 * The most recently confirmed wins when there are several, because changing your mind
 * about where to take her is normal and the last decision is the live one.
 */
function reservationFor(
  occursOn: string,
  outings: readonly Outing[],
): ReminderReservation | null {
  const sameEvening = outings
    .filter((outing) => outing.occursOn === occursOn && Boolean(outing.confirmedAt))
    .sort((a, b) => (a.confirmedAt < b.confirmedAt ? 1 : -1));

  const chosen = sameEvening[0];
  if (!chosen?.venueName) return null;
  return { venueName: chosen.venueName, city: chosen.city };
}

/**
 * The mail's content for one reminder. Pure: no clock, no network, no model.
 *
 * Split from {@link reminderContextFor} so every branch here is a test rather than a
 * fixture in a store — which matters because the interesting cases are all "what does
 * he get when half the profile is empty", and half-empty is the normal state.
 */
export function composeReminderContext(input: ComposeInput): ReminderContext {
  const activity = activityFor(input.reminder);
  const timingNote = timingNoteFor(input.reminder.occursOn, input.weeklyRhythm);

  const partnerName = input.partnerName;
  const surprise = input.surprise ?? null;

  if (activity === 'errand') {
    // No surprise and no reservation on an errand. He asked to be reminded to call the
    // florist; a playlist at the bottom of that is a non-sequitur, and any table he has
    // booked belongs to whatever occasion he booked it for, not to this.
    return { ...EMPTY_CONTEXT, activity, timingNote, partnerName };
  }

  if (activity === 'at_home') {
    /*
     * Nothing bookable, so nothing is suggested — and the ideas below are only ever
     * a restatement of something he told Valentin. A generated "light some candles"
     * would be the model's voice in the one message no human is reading first.
     */
    const ideas: string[] = [];
    if (input.favoriteCuisine) {
      ideas.push(`She loves ${input.favoriteCuisine} — cook it or order it in.`);
    }
    if (input.musicGenre) {
      ideas.push(`Put ${input.musicGenre} on. I can build the playlist if Spotify is connected.`);
    }
    return {
      activity,
      criteria: [],
      suggestions: [],
      ideas,
      timingNote,
      partnerName,
      reservation: null,
      surprise,
    };
  }

  /*
   * A decision already made short-circuits the search.
   *
   * Not merely an optimisation — running `findVenues` anyway and then discarding it
   * would leave the criteria line ("here is what fits what you have told me") computed
   * for a list nobody sees, which is how a later edit accidentally prints suggestions
   * under a confirmation.
   */
  const reservation = reservationFor(input.reminder.occursOn, input.outings);
  if (reservation) {
    return {
      activity,
      criteria: [],
      suggestions: [],
      ideas: [],
      timingNote,
      partnerName,
      reservation,
      surprise,
    };
  }

  const named = input.restaurantStyle?.trim();
  /*
   * Only a style `findVenues` can actually filter on reaches the criteria line. An
   * unrecognised one — "somewhere nice", which is a perfectly human answer — is
   * ignored by the search, and listing it anyway would tell the reader a constraint
   * was applied that never was.
   */
  const style = named && isRestaurantStyle(named) ? named : null;
  const filters = style ? { style } : {};
  const query = [input.favoriteCuisine, input.homeCity].filter(Boolean).join(' ') || undefined;
  /*
   * `findVenues` drops everything that scores zero, so a cuisine nobody on the list
   * serves — or a city outside Tel Aviv — returns nothing. Falling back to the
   * unqueried list matters because the list is ordered most-special-occasion first:
   * three good anniversary restaurants he has to judge for himself beat a reminder
   * with no suggestions in it at all.
   *
   * The criteria go with the match and not with the fallback, which is the honest
   * half of this: `email-body.ts` renders them as "here is what fits what you have
   * told me — she loves sushi", and printing that over a list that matched no sushi
   * is the one thing this mail must not do. With no criteria it says "here is what I
   * found", which is exactly true.
   */
  const matched = findVenues(query, CANDIDATES, filters);
  const searchMatched = matched.length > 0;
  const venues = searchMatched ? matched : findVenues(undefined, CANDIDATES, filters);

  const suggestions = venues.map((venue) => toSuggestion(venue, input.outings));
  // A place she liked goes first. The survey's whole payoff is that the next
  // suggestion is better than the last, and it is only visible if it leads.
  suggestions.sort((a, b) => (b.previousRating ?? 0) - (a.previousRating ?? 0));

  const criteria = searchMatched
    ? [
        input.favoriteCuisine ? `she loves ${input.favoriteCuisine}` : '',
        style ? style.toLowerCase() : '',
        // "near" and not "within N km": no radius was applied, and the city was a
        // search term. Saying more than that would claim a distance nobody measured.
        input.homeCity ? `near ${input.homeCity}` : '',
      ].filter(Boolean)
    : [];

  return {
    activity,
    criteria,
    suggestions,
    ideas: [],
    timingNote,
    partnerName,
    reservation: null,
    surprise,
  };
}

/**
 * The same thing, read out of the session's stored profile.
 *
 * Returns {@link EMPTY_CONTEXT} rather than throwing when anything goes wrong: the
 * caller is one step from a send, and a failed profile read must cost the mail its
 * suggestions and not cost the user his reminder. That is the same trade
 * `syncReminders` makes, and it is logged the same way.
 */
export async function reminderContextFor(
  storage: StorageInterface,
  reminder: Reminder,
): Promise<ReminderContext> {
  try {
    const [preferences, manual, outings] = await Promise.all([
      storage.getPreferencesBySession(reminder.sessionId),
      storage.getManualValues(reminder.sessionId),
      storage.getOutingsBySession(reminder.sessionId),
    ]);
    const value = (fieldId: string): string | null =>
      profileFieldValue(fieldId, manual, preferences as readonly PreferenceWithHistory[]);

    return composeReminderContext({
      reminder,
      partnerName: value('partner_name'),
      favoriteCuisine: value('favorite_cuisine'),
      restaurantStyle: value('restaurant_style'),
      homeCity: value('home_city'),
      musicGenre: value('music_genre'),
      weeklyRhythm: value('weekly_rhythm'),
      outings,
      /*
       * Read off the row `recordKeepsake` wrote, not through `profileFieldValue` — this
       * is not a profile *field*, it has no id in `PROFILE_FIELD_IDS` and no place in
       * the field grid. `decodeKeepsake` returns null for anything that is not a title
       * and an http(s) link, so a malformed row costs the surprise and nothing else.
       */
      surprise: decodeKeepsake(
        preferences.find(
          (pref) => pref.category === KEEPSAKE_CATEGORY && pref.key === PLAYLIST_KEY,
        )?.value,
      ),
    });
  } catch (cause) {
    logger.warn('reminder.context_failed', {
      reminderId: reminder.id,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return { ...EMPTY_CONTEXT, activity: activityFor(reminder) };
  }
}
