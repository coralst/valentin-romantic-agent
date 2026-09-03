/**
 * Places the demo couple have already been, and what she thought of them.
 *
 * Three rows, and each one is a different state the card has to be able to draw:
 * a place she loved, a place she did not, and one they went to last week that
 * nobody has answered for yet. Without the third, the survey demos as an idea
 * rather than as a control — and without the first two, the history is a list of
 * names with no bearing on anything, which is exactly the complaint the outing
 * record exists to answer.
 *
 * The rated pair also makes the prompt block visible: the 5/5 is a place Valentin
 * may offer again by name, and the 2/5 is one he must keep quiet about. A demo
 * where every row is unrated could not show either rule working.
 *
 * Offsets in days rather than fixed dates, for the reason `demo-tasks.ts` gives at
 * more length: a hard-coded date reads as ancient history for most of the year,
 * and here it would also decide whether the unrated row is even *askable* — the
 * survey only appears on an evening that has happened.
 *
 * The slugs are real rows in `integrations/ontopo/venues.ts` — Ontopo's own
 * numeric ids, not readable names. That is deliberate:
 * `find_restaurants` can return these venues, so the "you have been here before"
 * behaviour can be demonstrated against the same names the booking flow produces
 * rather than against fixtures that exist nowhere else.
 */

import type { Outing } from '../../shared/interfaces/outing';

/** A seeded outing, before its dates are resolved against the seed time. */
export interface DemoOuting extends Omit<Outing, 'occursOn' | 'confirmedAt' | 'ratedAt'> {
  /** Days from the seed moment. Always negative: an outing has happened. */
  occurredDaysAgo: number;
}

export const DEMO_OUTINGS: readonly DemoOuting[] = [
  {
    id: 'demo-outing-brasserie-18',
    venueSlug: '93797570',
    venueName: 'Brasserie 18',
    city: 'Tel Aviv',
    occurredDaysAgo: 6,
    // Unrated, and recent enough that the question is still fair. This is the
    // row the survey renders on.
    rating: null,
    verdict: null,
    note: null,
  },
  {
    id: 'demo-outing-yaffo',
    venueSlug: '34362976',
    venueName: 'Yaffo Tel Aviv',
    city: 'Tel Aviv',
    occurredDaysAgo: 41,
    rating: 5,
    verdict: 'again',
    note: 'The corner table, and go early',
  },
  {
    id: 'demo-outing-noema',
    venueSlug: '15172114',
    venueName: 'NOEMA',
    city: 'Tel Aviv',
    occurredDaysAgo: 96,
    // The one he should not offer again. 2/5 rather than 1/5 because "it was
    // fine and she does not want to go back" is the ordinary case, and the
    // sentence is what carries it.
    rating: 2,
    verdict: 'once was enough',
    note: 'Far too loud for her',
  },
];

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stamp the fixture's offsets into real dates.
 *
 * `now` is threaded in from the seeder's single clock reading, like
 * `resolveDemoTasks` — see its comment for why six `Date.now()` calls would be a
 * bug rather than a style choice.
 *
 * `confirmedAt` is backdated to two days before the evening, and that matters
 * more here than it does for a task: `outingHistory` and `unratedOutings` both
 * sort on it, so stamping all three rows with the seed moment would leave the
 * card's order down to whichever write landed first.
 */
export function resolveDemoOutings(outings: readonly DemoOuting[], now: number): Outing[] {
  return outings.map(({ occurredDaysAgo, ...outing }) => {
    const occurredAt = now - occurredDaysAgo * DAY_MS;
    return {
      ...outing,
      occursOn: new Date(occurredAt).toISOString().slice(0, 10),
      confirmedAt: new Date(occurredAt - 2 * DAY_MS).toISOString(),
      // Rated the morning after, for the two that have a verdict on them.
      ratedAt:
        outing.rating === null || outing.rating === undefined
          ? null
          : new Date(occurredAt + DAY_MS).toISOString(),
    };
  });
}
