import { config } from '../../config';

/**
 * Transport for Amadeus Self-Service — hotels, and the nearest thing this build
 * has to "things to do".
 *
 * ## Status of this file
 *
 * Unlike `ontopo/client.ts`, none of this was reverse-engineered: Amadeus
 * publishes real documentation and this follows it. What that also means is that
 * nothing here has been exercised against a live account — this repo has no
 * Amadeus credentials, so the request shapes are documented-correct rather than
 * observed-correct, and the tests stub `fetch`. The first real call may well
 * find a field spelled differently. Treat a shape mismatch as expected
 * maintenance, not as a bug in the design.
 *
 * ## Two properties of the sandbox worth knowing before demoing
 *
 * 1. **`test.api.amadeus.com` has partial data.** Its hotel and activity
 *    coverage is a subset of production and Israel is thinly covered; a search
 *    for Tel Aviv can legitimately return nothing. That is why every tool here
 *    distinguishes "Amadeus answered with nothing" from "Amadeus did not
 *    answer" — the first is a fact about the sandbox, the second is a fault, and
 *    conflating them makes Valentin lie about the world.
 * 2. **The host is deliberately pinned to test.** `config.integrations.amadeusHost`
 *    defaults to the sandbox and only an explicit environment variable moves it,
 *    because the booking endpoints spend real money. Nothing in this file should
 *    ever hardcode the production host.
 *
 * ## Auth
 *
 * OAuth2 client credentials: `POST /v1/security/oauth2/token` with a form body
 * returns a bearer token and an `expires_in` (1799s in practice). Cached in this
 * module, refreshed early by {@link TOKEN_SKEW_MS} so a token cannot expire
 * mid-request. The cache is process-local and that is fine — a cold start
 * costing one extra round trip is cheaper than any shared cache.
 */

/** Amadeus tokens last ~30 minutes; refresh a minute early rather than racing. */
const TOKEN_SKEW_MS = 60 * 1000;

/** Long enough for a multi-hotel offer search, short enough not to hang a turn. */
const TIMEOUT_MS = 10_000;

/**
 * How long a proposed hotel offer is treated as good for.
 *
 * Amadeus does not publish an offer TTL, and offers do go stale — which is
 * exactly why {@link fetchOffer} re-prices at confirm time rather than trusting
 * the id. Ten minutes is a conservative window for the card, not a guarantee
 * from the provider.
 */
export const OFFER_TTL_MS = 10 * 60 * 1000;

export interface AmadeusCity {
  /** IATA city code, e.g. `TLV`. */
  code: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface HotelOffer {
  /** Amadeus offer id — the handle needed to re-price or book. */
  offerId: string;
  hotelId: string;
  hotelName: string;
  checkInDate: string;
  checkOutDate: string;
  /** Room description, trimmed; Amadeus sometimes returns a paragraph. */
  room: string;
  /** Total for the whole stay, as Amadeus states it. */
  total: string;
  currency: string;
  /** True when the offer states it can be cancelled without charge. */
  refundable: boolean;
}

export interface Activity {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  /** Amadeus' own booking page for the activity, when it supplies one. */
  bookingLink?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Drop the cached token. Exists for tests; nothing in production needs it. */
export function resetTokenCache(): void {
  tokenCache = null;
}

function baseUrl(): string {
  return `https://${config.integrations.amadeusHost}`;
}

/**
 * A bearer token, from cache when one is still good.
 *
 * Returns `null` rather than throwing when credentials are absent or the token
 * endpoint refuses, because the caller's job is to tell the user Amadeus is
 * unavailable — not to crash the turn.
 */
export async function accessToken(): Promise<string | null> {
  const { amadeusClientId, amadeusClientSecret } = config.integrations;
  if (!amadeusClientId || !amadeusClientSecret) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const response = await fetch(`${baseUrl()}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: amadeusClientId,
      client_secret: amadeusClientSecret,
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string') return null;

  const ttlSeconds = typeof body.expires_in === 'number' ? body.expires_in : 1799;
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000 - TOKEN_SKEW_MS,
  };
  return tokenCache.token;
}

/**
 * GET an Amadeus endpoint and hand back its `data`.
 *
 * Returns `null` for every failure mode — no credentials, a non-2xx, a body that
 * is not the documented shape. Amadeus reports errors as
 * `{errors:[{status,code,title,detail}]}`; that detail is genuinely useful when
 * debugging but it can name a property or a rate, so it is not propagated into
 * anything the model sees.
 */
async function get(path: string, params: Record<string, string>): Promise<unknown[] | null> {
  const token = await accessToken();
  if (!token) return null;

  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { data?: unknown };
  if (Array.isArray(body.data)) return body.data;
  // Single-resource endpoints return an object; normalise so callers have one shape.
  return body.data && typeof body.data === 'object' ? [body.data] : null;
}

/** A few Israeli cities, so the common case costs no round trip. */
const KNOWN_CITIES: readonly AmadeusCity[] = [
  { code: 'TLV', name: 'Tel Aviv', latitude: 32.0853, longitude: 34.7818 },
  { code: 'JRS', name: 'Jerusalem', latitude: 31.7683, longitude: 35.2137 },
  { code: 'HFA', name: 'Haifa', latitude: 32.794, longitude: 34.9896 },
  { code: 'ETH', name: 'Eilat', latitude: 29.5577, longitude: 34.9519 },
];

/**
 * Resolve a city name to a code and a coordinate.
 *
 * Tries the local table first. That is not a cache — it is the acknowledgement
 * that "Tel Aviv" is the answer to most of this app's questions and asking
 * Amadeus to confirm it every time is a round trip spent on nothing. Anything
 * else falls through to the reference-data endpoint.
 */
export async function resolveCity(keyword: string): Promise<AmadeusCity | null> {
  const lowered = keyword.trim().toLowerCase();
  if (lowered === '') return null;

  const known = KNOWN_CITIES.find(
    (city) => city.name.toLowerCase() === lowered || city.code.toLowerCase() === lowered,
  );
  if (known) return known;

  const data = await get('/v1/reference-data/locations/cities', {
    keyword: keyword.trim(),
    max: '1',
  });
  const first = data?.[0] as
    | { iataCode?: unknown; name?: unknown; geoCode?: { latitude?: unknown; longitude?: unknown } }
    | undefined;
  if (!first || typeof first.iataCode !== 'string') return null;

  const latitude = first.geoCode?.latitude;
  const longitude = first.geoCode?.longitude;
  return {
    code: first.iataCode,
    name: typeof first.name === 'string' ? first.name : keyword.trim(),
    latitude: typeof latitude === 'number' ? latitude : 0,
    longitude: typeof longitude === 'number' ? longitude : 0,
  };
}

/** Trim Amadeus' room prose to something that fits on a card. */
function shorten(text: unknown, limit = 160): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * True when the offer's own policy says it can be cancelled without charge.
 *
 * Read conservatively: an offer is refundable only if Amadeus says so
 * explicitly. An absent or unrecognised policy reads as non-refundable, because
 * the cost of the two mistakes is not symmetric — telling someone their
 * anniversary hotel is free to cancel when it is not is the worse one.
 */
function readRefundable(policies: unknown): boolean {
  if (!policies || typeof policies !== 'object') return false;
  const cancellations = (policies as { cancellations?: unknown }).cancellations;
  if (!Array.isArray(cancellations) || cancellations.length === 0) return false;

  return cancellations.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as { amount?: unknown; type?: unknown; numberOfNights?: unknown };
    if (typeof record.type === 'string' && record.type.toUpperCase() === 'FULL_STAY') return false;
    if (record.numberOfNights) return false;
    return record.amount === '0' || record.amount === 0 || record.amount === undefined;
  });
}

/** Flatten one `hotel-offers` entry into however many offers it carries. */
function readOffers(entry: unknown): HotelOffer[] {
  if (!entry || typeof entry !== 'object') return [];
  const record = entry as { hotel?: unknown; offers?: unknown };
  const hotel = (record.hotel ?? {}) as { hotelId?: unknown; name?: unknown };
  if (!Array.isArray(record.offers)) return [];

  const hotelId = typeof hotel.hotelId === 'string' ? hotel.hotelId : '';
  const hotelName = typeof hotel.name === 'string' ? hotel.name : 'Unnamed hotel';

  const offers: HotelOffer[] = [];
  for (const raw of record.offers as Array<Record<string, unknown>>) {
    if (typeof raw?.id !== 'string') continue;
    const price = (raw.price ?? {}) as { total?: unknown; currency?: unknown };
    const room = (raw.room ?? {}) as { description?: { text?: unknown }; type?: unknown };

    offers.push({
      offerId: raw.id,
      hotelId,
      hotelName,
      checkInDate: typeof raw.checkInDate === 'string' ? raw.checkInDate : '',
      checkOutDate: typeof raw.checkOutDate === 'string' ? raw.checkOutDate : '',
      room: shorten(room.description?.text) || shorten(room.type) || 'Room',
      total: typeof price.total === 'string' ? price.total : String(price.total ?? ''),
      currency: typeof price.currency === 'string' ? price.currency : '',
      refundable: readRefundable(raw.policies),
    });
  }
  return offers;
}

export interface HotelSearchQuery {
  city: string;
  /** `YYYY-MM-DD`. */
  checkInDate: string;
  /** `YYYY-MM-DD`. */
  checkOutDate: string;
  adults: number;
  /** How many offers to bring back. */
  limit?: number;
}

/**
 * Hotels with real, priced offers for a stay.
 *
 * Two calls, and both are necessary: `/v1/reference-data/locations/hotels/by-geocode`
 * finds hotel ids near a point, and `/v3/shopping/hotel-offers` prices them.
 * Amadeus has no one-shot "hotels in city with prices" endpoint at the
 * Self-Service tier, and the ids from the first call are not stable enough to
 * cache — a hotel that has left the inventory answers the second call with an
 * error for the whole batch, which is why the id list is capped rather than
 * passed wholesale.
 *
 * Returns `null` when Amadeus could not be reached at all, and an empty array
 * when it answered and had nothing.
 */
export async function searchHotels(query: HotelSearchQuery): Promise<HotelOffer[] | null> {
  const city = await resolveCity(query.city);
  if (!city) return null;

  const hotels = await get('/v1/reference-data/locations/hotels/by-geocode', {
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    radius: '10',
    radiusUnit: 'KM',
    hotelSource: 'ALL',
  });
  if (!hotels) return null;

  const hotelIds = hotels
    .map((hotel) => (hotel as { hotelId?: unknown }).hotelId)
    .filter((id): id is string => typeof id === 'string')
    // Amadeus rejects an over-long id list, and offer pricing is the slow call.
    // Twenty is plenty to find a handful of good rooms.
    .slice(0, 20);
  if (hotelIds.length === 0) return [];

  const offers = await get('/v3/shopping/hotel-offers', {
    hotelIds: hotelIds.join(','),
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    adults: String(query.adults),
    roomQuantity: '1',
    bestRateOnly: 'true',
  });
  if (!offers) return null;

  const flattened = offers.flatMap(readOffers);
  // Cheapest first. Amadeus' own ordering follows its inventory, which is not
  // what someone comparing two nights away actually wants to see.
  flattened.sort((a, b) => Number(a.total || Infinity) - Number(b.total || Infinity));
  return flattened.slice(0, query.limit ?? 5);
}

/**
 * Re-price a single offer.
 *
 * This is the call a booking flow makes immediately before booking, and it is
 * the one thing that can tell us whether an offer the user is looking at still
 * exists at the price on the card. Returns `null` when the offer is gone.
 */
export async function fetchOffer(offerId: string): Promise<HotelOffer | null> {
  const data = await get(`/v3/shopping/hotel-offers/${encodeURIComponent(offerId)}`, {});
  const offers = data?.flatMap(readOffers) ?? [];
  return offers.find((offer) => offer.offerId === offerId) ?? offers[0] ?? null;
}

/**
 * Tours and activities near a point.
 *
 * This is the closest Version A gets to event discovery, and it is worth being
 * clear that it is not close: it is a commercial tours inventory, so it knows
 * about boat trips and food tours and knows nothing about the gallery opening on
 * Thursday. Finding *that* needs a browser, which is Version B's job. Shipping
 * this anyway because a curated tour is a real romantic suggestion — just not
 * the same capability.
 */
export async function searchActivities(
  city: string,
  limit = 5,
): Promise<Activity[] | null> {
  const resolved = await resolveCity(city);
  if (!resolved) return null;

  const data = await get('/v1/shopping/activities', {
    latitude: String(resolved.latitude),
    longitude: String(resolved.longitude),
    radius: '15',
  });
  if (!data) return null;

  const activities: Activity[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    if (typeof raw?.name !== 'string') continue;
    const price = (raw.price ?? {}) as { amount?: unknown; currencyCode?: unknown };
    activities.push({
      id: typeof raw.id === 'string' ? raw.id : raw.name,
      name: raw.name,
      description: shorten(raw.shortDescription ?? raw.description, 200),
      price: typeof price.amount === 'string' ? price.amount : String(price.amount ?? ''),
      currency: typeof price.currencyCode === 'string' ? price.currencyCode : '',
      bookingLink: typeof raw.bookingLink === 'string' ? raw.bookingLink : undefined,
    });
  }
  return activities.slice(0, limit);
}
