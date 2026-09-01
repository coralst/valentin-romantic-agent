import { venueBySlug, type CuratedVenue } from './venues';

/**
 * Transport for Ontopo, Israel's restaurant reservation platform.
 *
 * ## What is verified and what is not
 *
 * Ontopo publishes no API and no documentation. Everything here was established by
 * driving the real site in a browser and reading the requests it made, then
 * replaying them until the minimum working payload was known. Recording that
 * distinction is the point of this comment, because the next person to touch this
 * file needs to know which lines are observed fact and which are guesses.
 *
 * **Observed, and reproduced from a plain `fetch`:**
 * - `POST /api/availability_search` with `{slug, locale, criteria, data}` returns
 *   `areas[].options[]`, where `method: 'seat'` means bookable and
 *   `method: 'disabled'` means the slot is shown but cannot be taken, plus an
 *   `availability_id` naming that particular search.
 * - Repeating the same call with an `area` in `criteria` **and** that
 *   `availability_id` returns `{checkout_id}` and nothing else. That is the second
 *   stage, and it is the same endpoint — not a separate one.
 * - The checkout URL is `https://ontopo.com/{locale}/checkout/{checkout_id}`,
 *   which is how the site's own bundle builds it.
 * - **No authentication is involved.** The site does call
 *   `POST /api/loginAnonymously` for a 900-second JWT, but availability and
 *   checkout both succeed with no `authorization` header at all. We therefore do
 *   not mint a token: an unused credential is a liability, and a token cache we
 *   never read would be code pretending to do something.
 * - `data` is required but **may be empty**. The browser fills it with an analytics
 *   block (device id, referrer, an origin string). We send `{}`. Sending invented
 *   analytics would be both a lie and a fingerprint.
 * - `locale` is required, and a `User-Agent` header is required — omit either and
 *   the endpoint answers `400`.
 *
 * **Not available, despite appearing in the site's bundle:** venue search.
 * `search_token` rejects every payload shape with an opaque
 * `400 {"status":400,"message":"{}"}`, and `unified_search` and `venue_profile`
 * both 404 on the public host. Discovery therefore comes from the checked-in list
 * in `./venues.ts`, which is a real constraint, honestly handled.
 *
 * ## Two things to know before extending this
 *
 * 1. **It is a GraphQL server behind a REST facade.** A malformed `criteria`
 *    returns a 400 whose `message` is a stringified GraphQL error naming the
 *    offending field and the input type. That is the fastest way to learn the
 *    schema, and it is why `date`/`time`/`size` are the shapes they are.
 * 2. **`https://ontopo.com/robots.txt` contains `Disallow: /api/`.** That is a
 *    directive to crawlers, not a contract, and Valentin is acting for one person
 *    at conversational rates rather than crawling — but it is a clear signal about
 *    intended use and it belongs on the record. Anything beyond a demo should ask
 *    Ontopo for access rather than rely on this file.
 *
 * Nothing here throws for an expected failure. A venue that has gone away, a night
 * with no tables, a 500 from Ontopo — all return `null` or an empty slot list, so
 * `runTool` reports it and Valentin offers another night instead of losing the turn.
 */

const API_BASE = 'https://ontopo.com/api';

/**
 * Ontopo `400`s a request with no `User-Agent`, so one is required rather than
 * polite. It names the app honestly instead of impersonating Chrome — if Ontopo
 * ever wants to identify or rate-limit this traffic, they should be able to.
 */
const USER_AGENT = 'Valentin/1.0 (romantic concierge demo; +https://github.com/coralst)';

/** Ontopo is slow when a venue's calendar is cold; it is never slow for long. */
const TIMEOUT_MS = 8000;

/** How long a minted checkout link is treated as good for. */
export const CHECKOUT_TTL_MS = 15 * 60 * 1000;

/** A single time on a single venue's grid. */
export interface OntopoSlot {
  /** `HHMM`, as Ontopo returns it. */
  time: string;
  /**
   * Ontopo's area identifier — frequently Hebrew (`מסעדה`), sometimes an English
   * label (`Inside`, `Bar`). Opaque: pass it back exactly as received.
   */
  area: string;
  /** The area's display name, when Ontopo gives one. */
  areaLabel: string;
  /** `method === 'seat'`. A shown-but-unbookable slot is `false`. */
  bookable: boolean;
}

/**
 * The least a caller has to know about a venue to book it.
 *
 * `fetchAvailability` used to take a slug and look it up in the curated list,
 * returning null when it was not there. That made the list a hard ceiling on the
 * whole integration: Ontopo would happily quote tables at Buckaroo in Ra'anana, and
 * Valentin refused before sending a request, because five Tel Aviv restaurants were
 * all it could name. The slug is what Ontopo needs; the name is what a person needs
 * read back to them. Anything richer — vibes, a concierge's note — is a property of
 * the *curated* entries and belongs to callers that have one.
 */
export interface BookableVenue {
  slug: string;
  name: string;
  city?: string;
}

export interface Availability {
  venue: BookableVenue;
  /** Names this search to Ontopo; required to mint a checkout from it. */
  availabilityId: string | null;
  slots: OntopoSlot[];
}

export interface AvailabilityQuery {
  /** `YYYYMMDD`. */
  date: string;
  /** `HHMM`. */
  time: string;
  /** Party size. */
  size: number;
  locale?: string;
}

export interface Checkout {
  checkoutId: string;
  url: string;
}

/** `YYYYMMDD`, in the local civil day — never via `toISOString`, which shifts. */
export function toOntopoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** `HHMM` from `HH:MM`, `H:MM`, or an already-compact `HHMM`. */
export function toOntopoTime(time: string): string | null {
  const match = time.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
}

/** Turn `HHMM` back into something a person reads. */
export function formatSlotTime(time: string): string {
  return time.length === 4 ? `${time.slice(0, 2)}:${time.slice(2)}` : time;
}

/** The checkout URL, built the way Ontopo's own bundle builds it. */
export function checkoutUrl(checkoutId: string, locale = 'en'): string {
  return `https://ontopo.com/${locale}/checkout/${checkoutId}`;
}

interface OntopoArea {
  id?: unknown;
  name?: unknown;
  options?: unknown;
}

/** POST JSON and parse it, with a timeout. Returns null on any transport fault. */
async function post(
  path: string,
  body: unknown,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // A 400 here means the payload shape drifted, which is the failure this whole
  // integration is designed to expect. Surface it as null and let the caller say
  // so; the alternative is a stack trace where a sentence belonged.
  if (!response.ok) return null;

  const parsed: unknown = await response.json();
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Flatten Ontopo's areas-of-options into one list. */
function readSlots(areas: unknown): OntopoSlot[] {
  if (!Array.isArray(areas)) return [];

  const slots: OntopoSlot[] = [];
  for (const raw of areas as OntopoArea[]) {
    const area = typeof raw?.id === 'string' ? raw.id : '';
    const areaLabel = typeof raw?.name === 'string' ? raw.name : area;
    if (!Array.isArray(raw?.options)) continue;

    for (const option of raw.options as Array<Record<string, unknown>>) {
      if (typeof option?.time !== 'string') continue;
      slots.push({
        time: option.time,
        area,
        areaLabel,
        bookable: option.method === 'seat',
      });
    }
  }

  // Ontopo returns areas in its own preference order and times within them; a flat
  // list sorted by time is what a person wants read back to them.
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * What is free at a venue around a time.
 *
 * Note that `time` is a *centre*, not a filter: Ontopo returns a window either
 * side of it. Asking for 20:00 and being offered 19:30 and 20:30 is the endpoint
 * working correctly, and the tool layer relies on that to suggest alternatives.
 *
 * Returns `null` when the venue is unknown to us or Ontopo could not be reached;
 * returns an empty `slots` list when the venue simply has nothing that night. The
 * two are different answers and the caller says different things about them.
 */
export async function fetchAvailability(
  venue: BookableVenue,
  query: AvailabilityQuery,
): Promise<Availability | null> {
  const { slug } = venue;
  const locale = query.locale ?? 'en';
  const body = await post('/availability_search', {
    slug,
    locale,
    criteria: {
      date: query.date,
      time: query.time,
      size: String(query.size),
    },
    // Required, but may be empty — see the header comment. We do not invent
    // analytics.
    data: {},
  });
  if (!body) return null;

  return {
    venue,
    availabilityId:
      typeof body.availability_id === 'string' ? body.availability_id : null,
    slots: readSlots(body.areas),
  };
}

/**
 * Turn a chosen slot into a checkout link.
 *
 * This is the second call to the *same* endpoint, distinguished only by carrying
 * an `area` and the `availability_id` from the first. It reserves nothing: Ontopo
 * holds the table only once the human completes the form the link opens, which is
 * exactly the boundary the propose/confirm design wants. Valentin can hand over a
 * live link and still be honest that nothing is booked yet.
 *
 * `criteria.areas` (plural) does not exist — the GraphQL layer rejects it by name.
 * It is `area`, singular. Keeping this noted because the plural is the natural
 * guess and costs a round trip to disprove.
 */
export async function createCheckout(
  slug: string,
  query: AvailabilityQuery & { area: string; availabilityId: string },
): Promise<Checkout | null> {
  const locale = query.locale ?? 'en';
  const body = await post('/availability_search', {
    slug,
    locale,
    criteria: {
      date: query.date,
      time: query.time,
      size: String(query.size),
      area: query.area,
    },
    availability_id: query.availabilityId,
    data: {},
  });

  const checkoutId = body?.checkout_id;
  if (typeof checkoutId !== 'string' || checkoutId === '') return null;

  return { checkoutId, url: checkoutUrl(checkoutId, locale) };
}
