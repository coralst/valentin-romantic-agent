import type { AgentTool } from '../tool-registry';
import { SEARCH_RADIUS_OPTIONS, radiusMetres } from '../../../shared/constants/profile-fields';
import { describePlace, geocode, placesNearby, type GeoPoint } from './client';

/**
 * The one tool that can answer "within 10 km of me".
 *
 * One tool, and read-only. There is deliberately no `propose_*` counterpart here:
 * Places is a directory, and nothing in it is bookable through Valentin. Ontopo is
 * the only integration in this build that can hold a table, and conflating the two
 * would have the model offer to reserve a restaurant it has no way to reach.
 *
 * That boundary is enforced by keeping this a separate tool rather than merging
 * Places rows into `find_restaurants` with a `bookable: false` flag. A per-row flag
 * is something models drop far more readily than a tool boundary, and the failure
 * it produces — "I have booked you a table at a place I cannot book" — is the worst
 * outcome this layer has. The prose below says so three times over, because the
 * tool description survives in the system prompt long after any one result has
 * scrolled out of attention.
 */

/** Enough to choose between, few enough to say out loud. Matches Wolt's figure. */
const DEFAULT_LIMIT = 5;

/**
 * Where to search from.
 *
 * Explicit coordinates win when the browser has just handed them over; otherwise a
 * city name is geocoded. The tool cannot read storage — no tool can, `ToolContext`
 * carries only a session id — so the user's `home_city` reaches it the way every
 * other stored fact does: it is in the system prompt, and the model passes it as
 * `city`.
 */
async function resolveOrigin(input: Record<string, unknown>): Promise<GeoPoint | null> {
  const lat = input.lat;
  const lon = input.lon;
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };

  const city = typeof input.city === 'string' ? input.city.trim() : '';
  if (!city) return null;
  return geocode(city);
}

function readRadius(input: Record<string, unknown>): number {
  if (typeof input.radius_km === 'number' && input.radius_km > 0) {
    return Math.min(Math.round(input.radius_km * 1_000), 50_000);
  }
  // Falls through to the shared parser so an unset radius and a stored
  // `search_radius` string both land on the same default.
  return radiusMetres(typeof input.radius === 'string' ? input.radius : null);
}

export const findPlacesNearbyTool: AgentTool = {
  name: 'find_places_nearby',
  description:
    'Discover real restaurants within a radius of a coordinate or a city, using ' +
    'Google Places. Use this when the user asks what is near them or near a place, ' +
    'or when their own city and radius are known and no bookable venue fits. ' +
    'DISCOVERY ONLY: nothing returned here can be booked through Valentin. Never ' +
    'offer to reserve one of these — say the user would book it themselves, and use ' +
    'find_restaurants for anything you can actually hold a table at.',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description:
          'Where to search from, e.g. "Ra\'anana". Use the home city you already ' +
          'know unless the user names somewhere else. Omit if passing lat/lon.',
      },
      lat: {
        type: 'number',
        description: 'Latitude to search from. Only when a precise point is known.',
      },
      lon: { type: 'number', description: 'Longitude to search from.' },
      radius_km: {
        type: 'number',
        description:
          'How far out to look, in kilometres. Defaults to the radius the user ' +
          `has set, or 10. Their stored value is one of: ${SEARCH_RADIUS_OPTIONS.join(', ')}.`,
      },
      keyword: {
        type: 'string',
        description:
          'Optional refinement matched against place names — a cuisine or a style ' +
          'like "italian" or "wine". Omit to see what is simply nearby.',
      },
      limit: {
        type: 'number',
        description: `How many to return, up to ${DEFAULT_LIMIT}.`,
      },
    },
    required: [],
  },
  service: 'google-places',
  requiresConfirmation: false,
  async execute(input) {
    const origin = await resolveOrigin(input);
    if (!origin) {
      return {
        ok: false,
        summary:
          'I do not know where to search from. Ask which city they are in, or offer ' +
          'the "use my location" button — do not guess a city.',
      };
    }

    const radius = readRadius(input);
    const keyword = typeof input.keyword === 'string' ? input.keyword : undefined;
    const places = await placesNearby({
      lat: origin.lat,
      lon: origin.lon,
      radiusMetres: radius,
      keyword,
      limit: typeof input.limit === 'number' ? input.limit : DEFAULT_LIMIT,
    });

    // null and [] mean different things and must be reported differently: one is
    // "I could not ask", the other is "I asked and there is nothing there". Saying
    // the second when the first is true tells the user their neighbourhood is empty.
    if (places === null) {
      return {
        ok: false,
        summary:
          'Google Places did not answer. Say you could not check what is nearby right ' +
          'now and offer to try again — do not name a restaurant from memory.',
      };
    }

    const where = origin.city ?? (typeof input.city === 'string' ? input.city : 'there');
    const km = Math.round(radius / 100) / 10;

    if (places.length === 0) {
      return {
        ok: true,
        summary:
          `Nothing came back within ${km} km of ${where}` +
          (keyword ? ` matching "${keyword}"` : '') +
          '. Say so plainly and offer a wider radius or a different area.',
        data: { origin: where, radiusMetres: radius, places: [] },
      };
    }

    return {
      ok: true,
      summary:
        `${places.length} place(s) within ${km} km of ${where}: ` +
        `${places.map(describePlace).join(' | ')}. ` +
        'These are discovery only — Valentin cannot book any of them, so offer them as ' +
        'places the user would reserve themselves, and mention find_restaurants if they ' +
        'want somewhere you can actually hold a table.',
      data: {
        origin: where,
        radiusMetres: radius,
        places: places.map((place) => ({
          name: place.name,
          address: place.address,
          rating: place.rating,
          ratingCount: place.userRatingCount,
          priceLevel: place.priceLevel,
          openNow: place.openNow,
          // Google's own link, which is what attribution means on a text surface,
          // and the only action available on one of these rows.
          mapsUrl: place.mapsUrl,
        })),
      },
    };
  },
};

export const googlePlacesTools: readonly AgentTool[] = [findPlacesNearbyTool];
