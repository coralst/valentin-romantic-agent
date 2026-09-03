/**
 * Somewhere he actually took her, and what she thought of it.
 *
 * ## Why this exists at all
 *
 * Without it the third step of the demo has no substrate. "Survey the places and
 * keep a history of the good and the bad ones" needs a row per place; today
 * `confirmAction` returns "your table is booked at 20:00" and forgets, so the
 * agent can recommend the same restaurant it booked last month with no idea it has
 * been there.
 *
 * ## Why the rating lives on this row and not on its own
 *
 * `keys.ts` splits entities when they are written *concurrently and
 * independently* — extraction filing a person while the user ticks a task. That
 * argument does not apply here. An outing is written once when the booking is
 * confirmed and once when the user rates it, days apart, from one code path
 * each. So a whole-row idempotent put is safe, and history becomes one query with
 * nothing to join.
 *
 * ## Why it is not a `Task`
 *
 * A `Task` is something he has to do, and its `done` flag means "handled". An
 * outing is something that already happened; it has venue identity, a date it
 * occurred on, and a verdict. Overloading `done` to mean "rated" would give one
 * field two meanings, which is how the row stops being trustworthy.
 */
export interface Outing {
  /** Stable across the rating edit, and the sort key component. */
  id: string;

  /**
   * The bookable venue's slug, when it came from a provider we can book.
   *
   * Null for anything confirmed without one — a hand-typed plan, or a
   * discovery-only place. Nullable rather than absent because "we know this is
   * Claro" and "we never knew which venue" are different facts, and the second
   * is the one that means "do not try to match this against the curated list".
   */
  venueSlug?: string | null;
  /** What to show on the row. Always present: a nameless outing is unreadable. */
  venueName: string;
  /** For the history line in a reminder: "Ha'achim, Tel Aviv". */
  city?: string | null;
  /** ISO date it happened on, `YYYY-MM-DD`. */
  occursOn?: string | null;

  /** When the booking was confirmed, ISO instant. Not when it happened. */
  confirmedAt: string;

  /**
   * Her verdict, 1-5, once someone has asked.
   *
   * Null until rated, and that null is load-bearing: it is what the survey looks
   * for. Zero would be a rating, and a missing field would be indistinguishable
   * from an older row written before ratings existed.
   */
  rating?: number | null;
  /**
   * What to do about it next time — the part a recommendation can act on.
   *
   * A number alone does not say whether 3/5 means "fine, but not again". This
   * does, in the words someone would actually use.
   */
  verdict?: OutingVerdict | null;
  /** Anything worth remembering: "ask for the corner table". */
  note?: string | null;
  /** When it was rated. Null while unrated, and the pair must move together. */
  ratedAt?: string | null;
}

/** The closed set of answers the survey accepts. */
export const OUTING_VERDICTS = ['again', 'once was enough', 'never again'] as const;

export type OutingVerdict = (typeof OUTING_VERDICTS)[number];

/** Whether a string is one of the verdicts, for validating an untrusted body. */
export function isOutingVerdict(value: unknown): value is OutingVerdict {
  return typeof value === 'string' && (OUTING_VERDICTS as readonly string[]).includes(value);
}

/**
 * Outings still waiting on a verdict, oldest first.
 *
 * Oldest first because that is the one the memory is fading on, so it is the one
 * worth asking about before the answer is a shrug.
 */
export function unratedOutings(outings: readonly Outing[]): Outing[] {
  return outings
    .filter((outing) => outing.rating === null || outing.rating === undefined)
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
}

/** Everywhere he has been, most recent first — the order history is read in. */
export function outingHistory(outings: readonly Outing[]): Outing[] {
  return [...outings].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

/**
 * Places not to offer again unasked.
 *
 * 3 and below, or an explicit "never again" whatever the number: someone can rate
 * a place 4/5 on the food and still not want to go back, and the sentence they
 * chose outranks the number they picked.
 */
export function placesToAvoid(outings: readonly Outing[]): Outing[] {
  return outings.filter(
    (outing) =>
      outing.verdict === 'never again' ||
      (typeof outing.rating === 'number' && outing.rating <= 3),
  );
}
