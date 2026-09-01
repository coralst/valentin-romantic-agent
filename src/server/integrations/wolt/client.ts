/**
 * Transport for Wolt — delivery in Israel, and the only provider here that covers
 * flowers, gifts and wine.
 *
 * ## What is verified and what is not
 *
 * Like Ontopo, Wolt publishes no API for this. Unlike Ontopo, its consumer endpoint
 * is unauthenticated and answers a plain `GET`, which makes it the cheapest real
 * integration in the layer — no key, no OAuth, no browser.
 *
 * **Observed, and reproduced from a plain `fetch`:**
 * - `GET /v1/pages/restaurants?lat=&lon=` returns `sections[].items[].venue` for
 *   everything delivering to that coordinate. 345 venues for Ra'anana.
 * - `GET /v1/pages/front?lat=&lon=` returns the same venue shape across a wider set
 *   of sections, and is where the non-restaurant `product_line`s appear.
 * - `venue.product_line` is the taxonomy that matters: `restaurant`, `grocery`,
 *   `florist`, `alcohol`, `general_merchandise`, `toys_games_and_kids`,
 *   `health_and_beauty`, `pharmacy`, `electronics`, `home_and_diy`, `pet_supply`.
 *   `florist` is what makes the Flower delivery capability real rather than a
 *   drawing.
 * - `venue.online` is whether it is taking orders *now*; `delivers` is whether it
 *   delivers at all. Both matter — a closed florist is not an answer.
 * - Prices are `ILS`, and `estimate` is minutes.
 *
 * **Guessed, and therefore fenced:** `/v1/pages/stores` and `/v1/pages/shops` both
 * 404, so `front` is the only route to non-restaurant venues that is known to work.
 * If Wolt renames these the client returns nothing and the tools say so.
 *
 * ## What this deliberately does not do
 *
 * **It never places an order.** Wolt checkout needs a logged-in account and a
 * stored card, and Valentin must never handle payment details. So the write path is
 * a handoff: a proposal carries a link to the venue's own Wolt page, and the human
 * completes it there, paying Wolt directly. That is the same shape as Ontopo's
 * checkout — the most honest available, since it means an unattended agent
 * physically cannot spend anyone's money.
 */

const API_BASE = 'https://restaurant-api.wolt.com/v1/pages';

/** A believable browser UA. The API answers a bare `fetch`, but not reliably. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const TIMEOUT_MS = 10_000;

/** How long a coordinate's venue list is considered current. */
const CACHE_TTL_MS = 30 * 60_000;

/**
 * Wolt's own venue categories, as returned in `product_line`.
 *
 * Kept as a union so a capability maps to a set of them rather than to a guessed
 * tag string. Tags are free text and inconsistent — "grocery" and "groceries" both
 * appear — while `product_line` is Wolt's own taxonomy and is what the site filters
 * on.
 */
export type WoltProductLine =
  | 'restaurant'
  | 'grocery'
  | 'florist'
  | 'alcohol'
  | 'general_merchandise'
  | 'toys_games_and_kids'
  | 'health_and_beauty'
  | 'pharmacy'
  | 'electronics'
  | 'home_and_diy'
  | 'pet_supply';

export interface WoltVenue {
  id: string;
  slug: string;
  /** As Wolt shows it, e.g. "Japanika Kosher | Ra'anana". */
  name: string;
  productLine: WoltProductLine | string;
  /** Taking orders right now. A closed shop is not an answer to "send flowers". */
  online: boolean;
  delivers: boolean;
  /** Minutes, e.g. 25. */
  estimateMinutes: number | null;
  /** Wolt's own range string, e.g. "20-30". Nicer to quote than a single number. */
  estimateRange: string | null;
  rating: number | null;
  /** 1–4, Wolt's own scale. Not a currency amount. */
  priceRange: number | null;
  address: string;
  tags: string[];
  /** The public page a human finishes an order on. */
  url: string;
}

/** Israeli city centres, so a caller can name a city instead of a coordinate. */
const CITY_COORDS: Record<string, { lat: number; lon: number; aliases: string[] }> = {
  'tel aviv': { lat: 32.0853, lon: 34.7818, aliases: ['telaviv', 'tlv', 'תל אביב'] },
  "ra'anana": { lat: 32.1848, lon: 34.8713, aliases: ['raanana', 'ranana', 'רעננה'] },
  jerusalem: { lat: 31.7683, lon: 35.2137, aliases: ['ירושלים'] },
  haifa: { lat: 32.794, lon: 34.9896, aliases: ['חיפה'] },
  herzliya: { lat: 32.1624, lon: 34.8447, aliases: ['herzeliya', 'הרצליה'] },
  'kfar saba': { lat: 32.174, lon: 34.9070, aliases: ['kfar sava', 'כפר סבא'] },
  netanya: { lat: 32.3215, lon: 34.8532, aliases: ['natanya', 'נתניה'] },
  'ramat gan': { lat: 32.0684, lon: 34.8248, aliases: ['ramatgan', 'רמת גן'] },
  'petah tikva': { lat: 32.0871, lon: 34.8878, aliases: ['petach tikva', 'פתח תקווה'] },
  'rishon lezion': { lat: 31.9730, lon: 34.7925, aliases: ['rishon letzion', 'ראשון לציון'] },
  beersheba: { lat: 31.2518, lon: 34.7913, aliases: ['beer sheva', 'באר שבע'] },
  eilat: { lat: 29.5577, lon: 34.9519, aliases: ['אילת'] },
};

/** A coordinate for a city a person named, or null. */
export function coordsFor(city: string): { lat: number; lon: number } | null {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return null;
  const direct = CITY_COORDS[wanted];
  if (direct) return { lat: direct.lat, lon: direct.lon };
  for (const entry of Object.values(CITY_COORDS)) {
    if (entry.aliases.some((a) => a === wanted)) return { lat: entry.lat, lon: entry.lon };
  }
  for (const [name, entry] of Object.entries(CITY_COORDS)) {
    if (wanted.includes(name) || entry.aliases.some((a) => wanted.includes(a))) {
      return { lat: entry.lat, lon: entry.lon };
    }
  }
  return null;
}

export function woltCities(): string[] {
  return Object.keys(CITY_COORDS);
}

interface CacheEntry {
  venues: WoltVenue[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function resetWoltCacheForTests(): void {
  cache.clear();
}

function readVenue(raw: Record<string, unknown>): WoltVenue | null {
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!slug || !name) return null;

  const estimate = typeof raw.estimate === 'number' ? raw.estimate : null;
  return {
    id: typeof raw.id === 'string' ? raw.id : slug,
    slug,
    name,
    productLine: typeof raw.product_line === 'string' ? raw.product_line : 'restaurant',
    // Absent means unknown, and unknown must not read as open: offering a closed
    // florist is worse than offering none.
    online: raw.online === true,
    delivers: raw.delivers !== false,
    estimateMinutes: estimate,
    estimateRange: typeof raw.estimate_range === 'string' ? raw.estimate_range : null,
    rating:
      typeof raw.rating === 'object' && raw.rating !== null
        ? typeof (raw.rating as { score?: unknown }).score === 'number'
          ? (raw.rating as { score: number }).score
          : null
        : typeof raw.rating === 'number'
          ? raw.rating
          : null,
    priceRange: typeof raw.price_range === 'number' ? raw.price_range : null,
    address: typeof raw.address === 'string' ? raw.address : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    url: `https://wolt.com/en/isr/${encodeURIComponent(slug)}`,
  };
}

/** Flatten one page response into venues, whatever sections it happens to have. */
export function parseWoltPage(body: unknown): WoltVenue[] {
  const sections = (body as { sections?: unknown })?.sections;
  if (!Array.isArray(sections)) return [];

  const byslug = new Map<string, WoltVenue>();
  for (const section of sections as Array<{ items?: unknown }>) {
    if (!Array.isArray(section?.items)) continue;
    for (const item of section.items as Array<{ venue?: unknown }>) {
      const raw = item?.venue;
      if (!raw || typeof raw !== 'object') continue;
      const venue = readVenue(raw as Record<string, unknown>);
      // The same venue appears in several sections ("top rated", "newest"); one
      // entry each is what a caller wants.
      if (venue && !byslug.has(venue.slug)) byslug.set(venue.slug, venue);
    }
  }
  return [...byslug.values()];
}

async function getPage(page: string, lat: number, lon: number): Promise<unknown | null> {
  try {
    const response = await fetch(`${API_BASE}/${page}?lat=${lat}&lon=${lon}`, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Any transport fault is "we could not ask", which the caller reports as such
    // rather than as "nothing is available".
    return null;
  }
}

/**
 * Everything delivering to a coordinate.
 *
 * Both pages are fetched and merged, because they answer different questions:
 * `restaurants` is the exhaustive food list, and `front` is the only known route to
 * florists, off-licences and general retail. Merging is safe — `parseWoltPage`
 * deduplicates by slug — and it means one cache entry serves every capability.
 */
export async function venuesNear(
  lat: number,
  lon: number,
): Promise<WoltVenue[] | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.venues;

  const [restaurants, front] = await Promise.all([
    getPage('restaurants', lat, lon),
    getPage('front', lat, lon),
  ]);
  if (!restaurants && !front) return hit?.venues ?? null;

  const merged = new Map<string, WoltVenue>();
  for (const venue of [...parseWoltPage(restaurants), ...parseWoltPage(front)]) {
    if (!merged.has(venue.slug)) merged.set(venue.slug, venue);
  }

  const venues = [...merged.values()];
  cache.set(key, { venues, fetchedAt: Date.now() });
  return venues;
}

/**
 * Venues of given kinds near a coordinate, open ones first.
 *
 * Closed venues are kept rather than filtered out, because "the only florist
 * nearby is shut until nine tomorrow" is a useful answer and an empty list is not.
 * They sort last so the model reaches for an open one by default.
 */
export function filterByProductLine(
  venues: readonly WoltVenue[],
  lines: readonly string[],
): WoltVenue[] {
  const wanted = new Set(lines);
  return venues
    .filter((v) => wanted.has(v.productLine) && v.delivers)
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      // Then by rating, then by speed — for a gift being sent today, both matter.
      const rating = (b.rating ?? 0) - (a.rating ?? 0);
      if (rating !== 0) return rating;
      return (a.estimateMinutes ?? 999) - (b.estimateMinutes ?? 999);
    });
}

/** Match a free-text query against name and tags. Empty query keeps everything. */
export function matchVenues(venues: readonly WoltVenue[], query?: string): WoltVenue[] {
  const wanted = query?.trim().toLowerCase();
  if (!wanted) return [...venues];
  const terms = wanted.split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return [...venues];
  return venues.filter((v) => {
    const blob = `${v.name} ${v.tags.join(' ')} ${v.address}`.toLowerCase();
    return terms.some((term) => blob.includes(term));
  });
}

/** One line per venue, for the model to quote. */
export function describeWoltVenue(venue: WoltVenue): string {
  const when = venue.online
    ? `${venue.estimateRange ?? venue.estimateMinutes ?? '?'} min`
    : 'closed right now';
  const stars = venue.rating ? `, ${venue.rating.toFixed(1)}★` : '';
  return `${venue.name} (${when}${stars})`;
}
