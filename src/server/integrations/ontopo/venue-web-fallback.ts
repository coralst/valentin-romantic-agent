import { readPage, webSearch } from '../websearch/client';
import { logger } from '../../logging';

/**
 * What to do when Ontopo is not the answer.
 *
 * Ontopo covers a few hundred Israeli restaurants and answers for fewer than that
 * on any given evening. Two states end the conversation on a dead end: Ontopo does
 * not respond at all, and Ontopo responds with an empty grid. Neither means the
 * restaurant has no table — it means *this booking platform* has nothing to say
 * about it. Most of these kitchens keep a phone line and a booking form on their
 * own site, and before this Valentin could not reach either.
 *
 * So: find the restaurant's own page on the open web and hand over the link and the
 * phone number. This never claims a table is free — it cannot know that, and the
 * whole point of `check_availability` is not guessing. It shifts the answer from
 * "I could not check" to "I could not check, here is where you can".
 *
 * ## Why it cannot throw
 *
 * It runs inside `check_availability`, on a path that is already a partial failure.
 * A throw here would turn a usable "try another night" into `runTool`'s generic
 * "check_availability could not be completed", which reads to the model as a
 * transient fault worth retrying — and every retry would fail the same way. Every
 * exit returns `null`, and the caller degrades to exactly the message it sent before.
 */

/** The venue's own page, once we are reasonably sure it is theirs. */
export interface VenueWebLead {
  /** The page we found and, where possible, read. */
  url: string;
  /** For prose: "their own site, hasalon.co.il". */
  host: string;
  /** A phone number lifted off the page, when it had one. */
  phone: string | null;
}

/**
 * Hosts that are never the restaurant's own site.
 *
 * `ontopo` heads the list because it is the thing that just failed — offering it
 * back would be a loop. The rest are aggregators, review sites and social profiles:
 * all of them *mention* the restaurant, none of them is the restaurant, and a link
 * to a TripAdvisor page in answer to "can we eat there Thursday" is noise.
 */
const NOT_THEIR_SITE = [
  'ontopo',
  'tripadvisor',
  'facebook',
  'instagram',
  'twitter',
  'x.com',
  'tiktok',
  'youtube',
  'yelp',
  'zomato',
  'wolt',
  'tabit',
  'rest.co.il',
  'mishlam',
  '10bis',
  'google.',
  'bing.',
  'duckduckgo',
  'wikipedia',
  'timeout.co',
  'booking.com',
  'opentable',
  'reddit',
  'linkedin',
];

/**
 * Israeli phone numbers, which is the only shape worth matching here — every venue
 * Ontopo lists is in Israel.
 *
 * The leading `0` or `+972` is what keeps this from matching prices, dates and
 * years, and the digit boundaries stop it from biting a chunk out of a longer run
 * (an order id, a coordinate). It matches landlines (`03-6021133`), mobiles
 * (`052-1234567`) and the service prefixes (`073-…`, `077-…`).
 */
const IL_PHONE = /(?<!\d)(?:\+972[-\s.]?|0)(?:5\d|7\d|[23489])[-\s.]?\d{3}[-\s.]?\d{4}(?!\d)/;

/** Everything the lookup is allowed to spend, across search and page read. */
const BUDGET_MS = 9_000;

/** Words in a venue name that say nothing about which host is theirs. */
const NOISE_WORDS = new Set([
  'the',
  'ha',
  'restaurant',
  'bar',
  'cafe',
  'café',
  'kitchen',
  'bistro',
  'and',
  'by',
  'de',
  'la',
  'le',
]);

/** Lowercase, letters and digits only — for comparing a name against a hostname. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The parts of a venue name worth looking for in a hostname. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !NOISE_WORDS.has(token));
}

function isAggregator(host: string): boolean {
  const lower = host.toLowerCase();
  return NOT_THEIR_SITE.some((bad) => lower.includes(bad));
}

/**
 * How much this result looks like the restaurant's own site rather than a page
 * about it.
 *
 * Returns 0 for "not convinced", and the caller then finds nothing rather than
 * offering a link it cannot stand behind — a wrong number for a restaurant is worse
 * than no number, because the user rings it.
 *
 * The hostname carries most of the signal: a restaurant's own domain almost always
 * contains its name, and nothing else on a results page does. `squash` is what makes
 * that work across transliteration — "Ha Salon" is `hasalon.co.il`, and matching
 * token by token would miss it.
 *
 * ## Why nothing else can score on its own
 *
 * Everything below the name check is a tie-breaker, gated behind the name having
 * matched at all. That gate is not tidiness: searching "Ha Salon Tel Aviv restaurant"
 * really does return `ha.com` — Heritage Auctions — and an ungated homepage bonus was
 * enough to put a coin dealer's phone number in front of someone booking dinner.
 */
function ownSiteScore(
  result: { title: string; url: string },
  venueName: string,
): number {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(result.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 0;
    host = parsed.hostname.replace(/^www\./, '');
    path = parsed.pathname;
  } catch {
    return 0;
  }
  if (isAggregator(host)) return 0;

  const hostSquashed = squash(host);
  const whole = squash(venueName);

  // The strongest evidence available: the whole name inside the hostname.
  let score = 0;
  if (whole.length >= 4 && hostSquashed.includes(whole)) score = 4;
  else if (nameTokens(venueName).some((token) => hostSquashed.includes(token))) score = 2;

  // No name, no lead — and therefore no tie-breakers either.
  if (score === 0) return 0;

  // A homepage over a deep link, because a booking form and a phone number live at
  // the root far more often than three directories down.
  if (path === '/' || path === '') score += 1;

  // Weak on its own — a review headline names the restaurant too — so it only ever
  // separates two hosts that already matched.
  if (squash(result.title).includes(whole)) score += 1;

  return score;
}

/**
 * Something beyond the name that ties this site to this restaurant.
 *
 * A name in a hostname is suggestive and not sufficient, because names are not
 * unique across countries: "Buckaroo" in Ra'anana matches `buckaroond.com`, a
 * western-wear shop in the United States, on the name alone. Every venue Ontopo
 * lists is in Israel, so one of two things has to hold — an Israeli domain, or the
 * city named somewhere on the page we were given.
 *
 * The direction of the error is deliberate. Refusing a real `.com` whose pages never
 * mention their own city costs the user a link he did not have before; accepting a
 * stranger's site costs him a phone call to a shop in Texas.
 */
function corroborates(
  host: string,
  city: string | undefined,
  text: readonly (string | null | undefined)[],
): boolean {
  if (host.toLowerCase().endsWith('.il')) return true;
  const where = city ? squash(city) : '';
  if (where.length < 3) return false;
  return text.some((chunk) => chunk && squash(chunk).includes(where));
}

/** Reject the deadline instead of waiting on a browser that may never settle. */
function withBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The venue's own page and phone number, or null if we cannot be confident.
 *
 * Two hops at most. The search is what finds the domain — no curated entry carries
 * a website, and inventing one from the name would produce a plausible URL that
 * belongs to somebody else. Reading the page is what finds the phone number, which
 * is the more useful half: a link asks the user to go hunting, a number is something
 * Valentin can say out loud.
 */
export async function findVenueOwnPage(venue: {
  readonly name: string;
  readonly city?: string;
}): Promise<VenueWebLead | null> {
  const name = venue.name?.trim();
  if (!name) return null;

  const where = venue.city?.trim();
  const query = `${name}${where ? ` ${where}` : ''} restaurant official site reservations phone`;

  const found = await withBudget(webSearch(query, { maxResults: 6 }), BUDGET_MS);
  if (!found?.results?.length) return null;

  let best: { url: string; host: string; title: string; snippet: string } | null = null;
  let bestScore = 0;
  for (const result of found.results) {
    const score = ownSiteScore(result, name);
    if (score > bestScore) {
      bestScore = score;
      // Re-parsed rather than carried out of the scorer, so the host in the prose is
      // the host that was scored and not a string assembled twice.
      best = {
        url: result.url,
        host: new URL(result.url).hostname.replace(/^www\./, ''),
        title: result.title,
        snippet: result.snippet,
      };
    }
  }
  if (!best) return null;

  // A page read is a nicety for the phone number, and the last chance to corroborate:
  // a site that never names its own city in a title still usually does on the page.
  const page = await withBudget(readPage(best.url), BUDGET_MS);

  if (!corroborates(best.host, where, [best.title, best.snippet, page?.text])) {
    logger.info('ontopo.web_fallback_unplaced', { venue: name, host: best.host, city: where });
    return null;
  }

  const phone = page?.text ? (IL_PHONE.exec(page.text)?.[0]?.trim() ?? null) : null;

  logger.info('ontopo.web_fallback', {
    venue: name,
    host: best.host,
    foundPhone: phone !== null,
    readPage: page !== null,
  });

  return { url: best.url, host: best.host, phone };
}

/**
 * The clause Valentin says when Ontopo had nothing.
 *
 * Deliberately instructional rather than a finished sentence: it is appended to a
 * tool summary, which the model reads as direction, and a pre-written line would be
 * quoted verbatim in the middle of a conversation that had its own tone. The one
 * hard rule is stated outright, because this is exactly the point where a helpful
 * model starts to improvise a table.
 */
export function describeVenueWebLead(lead: VenueWebLead, venueName: string): string {
  const reach = lead.phone
    ? `their own site is ${lead.host} (${lead.url}) and their number is ${lead.phone}`
    : `their own site is ${lead.host} (${lead.url})`;

  return (
    ` Ontopo is not the only way in: ${reach}. Offer to send him there — say plainly ` +
    `that you could not see ${venueName}'s book yourself, so this is a place to ask, ` +
    `not a table you have held.`
  );
}
