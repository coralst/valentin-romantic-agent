/**
 * Transport for Google Maps Platform — the only thing here that can answer
 * "within 10 km of *me*".
 *
 * Everything else in this layer works from a name. Wolt takes a coordinate but
 * gets it from a twelve-entry table of Israeli city centres; Ontopo searches five
 * curated venues by free text. Neither can answer a radius, and a radius is what
 * the demo promises. This module is what makes the promise true: a browser
 * coordinate or a typed address becomes a city and a coordinate, and a coordinate
 * plus a radius becomes real places.
 *
 * ## Three calls, one key, one readiness bit
 *
 * Geocoding, reverse geocoding and Nearby Search all ride `GOOGLE_PLACES_API_KEY`,
 * which is why they share the single `google-places` integration id rather than
 * being split the way Gmail and Calendar are.
 *
 * ## Caching, and the line we do not cross
 *
 * Google's terms let us cache latitude and longitude values; they do not let us
 * build a local copy of Places content. So both caches here are **in-memory only
 * and are never written to DynamoDB**:
 *
 * - Geocode results live 24 hours. A city centre does not move, and a cap well
 *   inside the 30-day content limit means nobody has to reason about it.
 * - Nearby results live 30 minutes, the same figure `wolt/client.ts` uses for the
 *   same reason: whether a place is open goes stale fast.
 *
 * The rules that a later "let's persist this to save money" commit would break,
 * stated so it has to break them on purpose: no Places content is persisted
 * anywhere; results are never re-ranked and presented as our own database; a place
 * is shown with the name and address Google returned plus its own maps link, which
 * is what attribution means on a text surface; and `limit` is capped so this cannot
 * be used to enumerate an area.
 *
 * ## What this deliberately does not do
 *
 * **Nothing here is bookable.** Places is discovery. Ontopo is the only thing in
 * this build that can hold a table, and `find_places_nearby` says so in its own
 * description — see `tools.ts`.
 */

import { config } from '../../config';
import { logger } from '../../logging';

const GEOCODE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json';
const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

const TIMEOUT_MS = 8_000;

/** A city centre does not move. Long enough to matter, short enough to be safe. */
const GEOCODE_TTL_MS = 24 * 60 * 60_000;

/** Whether a place is open now goes stale fast. Wolt's figure, same reasoning. */
const NEARBY_TTL_MS = 30 * 60_000;

/**
 * The most places one call will return.
 *
 * Matches Wolt's `DEFAULT_LIMIT`, and it is a compliance boundary as much as a
 * usability one: a tool that returned two hundred rows would be bulk enumeration
 * of Places content, which the terms forbid. Five is also all a person can hear
 * in a sentence.
 */
const MAX_LIMIT = 5;

/**
 * The fields we ask Nearby Search for.
 *
 * This mask is not an optimisation — it is what keeps the call on the cheap SKU.
 * Requesting fields outside the Essentials/Pro tiers silently moves every request
 * to a more expensive one, which is the classic way this integration ends up
 * costing ten times what it should. Add a field here only after checking which
 * tier it belongs to.
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours.openNow',
].join(',');

export interface GeoPoint {
  lat: number;
  lon: number;
  /** The locality Google put this coordinate in, when it named one. */
  city?: string;
}

export interface NearbyPlace {
  placeId: string;
  name: string;
  address: string;
  rating: number | null;
  userRatingCount: number | null;
  /** Google's own 1–4 scale, not a currency amount. */
  priceLevel: number | null;
  lat: number;
  lon: number;
  /** The link a human opens. Attribution, and the only useful action we have. */
  mapsUrl: string;
  openNow: boolean | null;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const geocodeCache = new Map<string, CacheEntry<GeoPoint | null>>();
const nearbyCache = new Map<string, CacheEntry<NearbyPlace[]>>();

export function resetPlacesCacheForTests(): void {
  geocodeCache.clear();
  nearbyCache.clear();
}

/**
 * The key, once resolved. Set either from the env var or from Secrets Manager.
 *
 * Held in a module variable rather than re-read per call so that
 * `placesConfigured()` can stay synchronous — `integrationReadiness()` is called
 * from a sync boot path and from `GET /api/integrations`, and making it async
 * would ripple through both.
 */
let resolvedKey: string | null = config.integrations.googlePlacesApiKey ?? null;

/** Whether this process can call Google at all. */
export function placesConfigured(): boolean {
  return Boolean(resolvedKey);
}

function apiKey(): string | null {
  return resolvedKey;
}

/**
 * Fetch the key from Secrets Manager, once, at boot.
 *
 * Returns whether Places became available, so the caller can rebuild the tool
 * registry — the `probeBrowserReadiness` shape in `index.ts`, and for the same
 * reason: this is a slow, optional, fire-and-forget capability check that must not
 * hold up the health check the load balancer is waiting for. Until it lands,
 * readiness reports Places as unconfigured, which is the safe direction to be
 * briefly wrong in.
 *
 * Every failure path is a warn-and-return-false. A Maps key that cannot be read is
 * "no place search", never a boot failure — which is the entire reason the ARN
 * arrives in a plain env var instead of as an `ecs.Secret`, whose absence would
 * fail task startup and take the app down with it.
 */
export async function primePlacesKey(): Promise<boolean> {
  if (resolvedKey) return true;

  const arn = config.integrations.googlePlacesSecretArn;
  if (!arn) return false;

  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({ region: config.awsRegion });
    const response = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = response.SecretString;
    if (!raw) {
      logger.warn('integration.google-places.secret_empty');
      return false;
    }

    // Tolerates both shapes on purpose: a bare key pasted into the console, and
    // the `{"apiKey": "..."}` JSON the CDK writes. Neither is echoed anywhere —
    // this value goes in and never comes out.
    let key = raw.trim();
    if (key.startsWith('{')) {
      const parsed = JSON.parse(key) as Record<string, unknown>;
      const candidate = parsed.apiKey ?? parsed.GOOGLE_PLACES_API_KEY ?? parsed.key;
      key = typeof candidate === 'string' ? candidate.trim() : '';
    }
    if (!key) {
      logger.warn('integration.google-places.secret_missing_key');
      return false;
    }

    resolvedKey = key;
    logger.info('integration.google-places.key_loaded');
    return true;
  } catch (error) {
    logger.warn('integration.google-places.secret_unreadable', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

function normaliseAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Three decimal places, ~110 m.
 *
 * Coarse enough that two requests from the same room share a cache entry, fine
 * enough that neighbouring towns do not.
 */
function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function fresh<T>(entry: CacheEntry<T> | undefined, ttl: number): boolean {
  return entry !== undefined && Date.now() - entry.fetchedAt < ttl;
}

/**
 * Seed the geocode cache with a coordinate we were handed rather than looked up.
 *
 * The browser's own position is better than anything geocoding would return for
 * the same city, and it costs nothing. `POST /api/session/:id/location` calls this
 * so the next tool call resolves the user's city without a network round trip —
 * which is the whole reason the route can throw the raw coordinate away instead of
 * persisting it.
 */
export function rememberCityCoords(city: string, point: GeoPoint): void {
  const key = normaliseAddress(city);
  if (!key) return;
  geocodeCache.set(key, { value: { ...point, city }, fetchedAt: Date.now() });
}

async function getJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('integration.google-places.http', { status: response.status });
      return null;
    }
    return await response.json();
  } catch {
    // Any transport fault is "we could not ask", which the caller reports as such
    // rather than as "there is nothing near you".
    return null;
  }
}

/**
 * Pull the locality out of a Geocoding result's address components.
 *
 * `locality` is the ordinary case. Israeli results sometimes carry the town only
 * as `administrative_area_level_2`, so that is the fallback rather than the
 * formatted address, which would give back a street.
 */
function readCity(result: Record<string, unknown>): string | null {
  const components = result.address_components;
  if (!Array.isArray(components)) return null;

  const typed = components as Array<{ long_name?: unknown; types?: unknown }>;
  const pick = (wanted: string): string | null => {
    for (const component of typed) {
      const types = Array.isArray(component.types) ? component.types : [];
      if (types.includes(wanted) && typeof component.long_name === 'string') {
        return component.long_name;
      }
    }
    return null;
  };

  return pick('locality') ?? pick('postal_town') ?? pick('administrative_area_level_2');
}

function readPoint(result: Record<string, unknown>): GeoPoint | null {
  const geometry = result.geometry as { location?: { lat?: unknown; lng?: unknown } } | undefined;
  const lat = geometry?.location?.lat;
  const lon = geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const city = readCity(result);
  return city ? { lat, lon, city } : { lat, lon };
}

function firstResult(body: unknown): Record<string, unknown> | null {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

/** A coordinate and a city for something a person typed, or null. */
export async function geocode(address: string): Promise<GeoPoint | null> {
  const key = normaliseAddress(address);
  if (!key) return null;

  const hit = geocodeCache.get(key);
  if (fresh(hit, GEOCODE_TTL_MS)) return hit!.value;

  const token = apiKey();
  if (!token) return null;

  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(address.trim())}&key=${token}`;
  const body = await getJson(url);
  // A transport fault must not poison the cache with a null: the next caller
  // should get another chance rather than 24 hours of "no such place".
  if (body === null) return hit?.value ?? null;

  const result = firstResult(body);
  const point = result ? readPoint(result) : null;
  geocodeCache.set(key, { value: point, fetchedAt: Date.now() });
  return point;
}

/** The city a coordinate falls in, or null. */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const key = `rev:${coordKey(lat, lon)}`;
  const hit = geocodeCache.get(key);
  if (fresh(hit, GEOCODE_TTL_MS)) return hit!.value?.city ?? null;

  const token = apiKey();
  if (!token) return null;

  const url = `${GEOCODE_BASE}?latlng=${lat},${lon}&result_type=locality&key=${token}`;
  const body = await getJson(url);
  if (body === null) return hit?.value?.city ?? null;

  const result = firstResult(body);
  const city = result ? readCity(result) : null;
  geocodeCache.set(key, { value: city ? { lat, lon, city } : null, fetchedAt: Date.now() });
  return city;
}

function readPlace(raw: Record<string, unknown>): NearbyPlace | null {
  const placeId = typeof raw.id === 'string' ? raw.id : null;
  const display = raw.displayName as { text?: unknown } | undefined;
  const name = typeof display?.text === 'string' ? display.text : null;
  if (!placeId || !name) return null;

  const location = raw.location as { latitude?: unknown; longitude?: unknown } | undefined;
  const lat = typeof location?.latitude === 'number' ? location.latitude : null;
  const lon = typeof location?.longitude === 'number' ? location.longitude : null;
  if (lat === null || lon === null) return null;

  const hours = raw.currentOpeningHours as { openNow?: unknown } | undefined;

  return {
    placeId,
    name,
    address: typeof raw.formattedAddress === 'string' ? raw.formattedAddress : '',
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    userRatingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : null,
    priceLevel: readPriceLevel(raw.priceLevel),
    lat,
    lon,
    mapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
    openNow: typeof hours?.openNow === 'boolean' ? hours.openNow : null,
  };
}

/**
 * Places (New) returns price as an enum string, not a number.
 *
 * Mapped back to Google's familiar 1–4 so callers and the older Wolt shape agree,
 * and so a summary can print "₪₪" without knowing which API it came from.
 */
function readPriceLevel(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  switch (value) {
    case 'PRICE_LEVEL_INEXPENSIVE':
      return 1;
    case 'PRICE_LEVEL_MODERATE':
      return 2;
    case 'PRICE_LEVEL_EXPENSIVE':
      return 3;
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return 4;
    default:
      return null;
  }
}

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusMetres: number;
  /** A cuisine or a style, passed to Google as an included type or keyword. */
  keyword?: string;
  limit?: number;
}

/**
 * Restaurants near a coordinate, best-rated first.
 *
 * Returns `null` for "we could not ask" and `[]` for "we asked and there is
 * nothing", which the tool reports differently — the distinction Wolt's client
 * makes for the same reason.
 */
export async function placesNearby(query: NearbyQuery): Promise<NearbyPlace[] | null> {
  const limit = Math.min(Math.max(Math.round(query.limit ?? MAX_LIMIT), 1), MAX_LIMIT);
  const radius = Math.min(Math.max(Math.round(query.radiusMetres), 100), 50_000);
  const keyword = query.keyword?.trim().toLowerCase() ?? '';
  const key = `${coordKey(query.lat, query.lon)}|${radius}|${keyword}|${limit}`;

  const hit = nearbyCache.get(key);
  if (fresh(hit, NEARBY_TTL_MS)) return hit!.value;

  const token = apiKey();
  if (!token) return null;

  const body = await getJson(NEARBY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': token,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: limit,
      rankPreference: 'POPULARITY',
      locationRestriction: {
        circle: {
          center: { latitude: query.lat, longitude: query.lon },
          radius,
        },
      },
    }),
  });
  if (body === null) return hit?.value ?? null;

  const raw = (body as { places?: unknown }).places;
  const places = Array.isArray(raw)
    ? raw
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
        .map(readPlace)
        .filter((p): p is NearbyPlace => p !== null)
    : [];

  // Nearby Search has no free-text field, so a style or cuisine is applied here
  // against the names we already paid for. Cheaper than a second Text Search
  // call, and it cannot invent a match.
  const matched = keyword
    ? places.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(keyword))
    : places;
  const chosen = matched.length > 0 ? matched : places;

  nearbyCache.set(key, { value: chosen, fetchedAt: Date.now() });
  return chosen;
}

/** Metres between two coordinates. Used to sort the bookable set by distance. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One line per place, for the model to quote. */
export function describePlace(place: NearbyPlace): string {
  const stars = place.rating
    ? `, ${place.rating.toFixed(1)}★${place.userRatingCount ? ` (${place.userRatingCount})` : ''}`
    : '';
  const price = place.priceLevel ? `, ${'₪'.repeat(place.priceLevel)}` : '';
  const open = place.openNow === false ? ', closed right now' : '';
  return `${place.name} — ${place.address}${stars}${price}${open}`;
}
