/**
 * The restaurants Valentin can offer, with their Ontopo page slugs.
 *
 * ## Why this file exists at all
 *
 * Ontopo has no reachable venue *search*. The site's own bundle names a
 * `search_token` → `search_request` pair, but `search_token` answers every payload
 * shape with an opaque `400 {"status":400,"message":"{}"}`, and the
 * `unified_search` / `venue_profile` endpoints the bundle also references return
 * 404 on the public host. Availability for a *known* slug works perfectly; finding
 * the slug does not.
 *
 * So discovery is a list, and the list is checked in. Every entry below was
 * harvested from `https://ontopo.com/sitemap.xml`, had its name, city and category
 * strings read off its own prerendered page, and was then confirmed to answer
 * `POST /api/availability_search`.
 *
 * Provenance matters here, so it is worth being exact about which fields are
 * which: `slug`, `name`, `city` and `cuisine` are Ontopo's own data, copied
 * verbatim — where `cuisine` is empty it is because Ontopo lists no categories for
 * that venue, not because nobody filled it in. `vibes` and `note` are editorial:
 * they are the curation, and they are what makes the list worth having.
 *
 * For a romantic concierge this is arguably the better design regardless: a
 * curated shortlist of places worth taking someone is closer to what a good
 * concierge actually keeps in their head than a full-text search over every
 * bookable room in the country. It is a real constraint honestly handled, not a
 * pretend feature.
 *
 * ## Maintaining it
 *
 * Slugs are stable identifiers on Ontopo's side but the venues are not eternal —
 * restaurants close. A slug that stops resolving surfaces as "I couldn't reach
 * Ontopo for that one" rather than a crash, so a stale entry degrades gracefully.
 * Re-validating the list is a five-minute job against the live endpoint; see
 * `__tests__/venues.test.ts` for the invariants that are cheap to keep true.
 */

import { distanceMetres, type GeoPoint } from '../../../shared/constants/geo';
import type { RestaurantStyle } from '../../../shared/constants/profile-fields';

/** A vibe tag the model can filter on. Deliberately few, and about *mood*. */
export type VenueVibe =
  | 'romantic'
  | 'view'
  | 'wine'
  | 'cocktails'
  | 'chef'
  | 'intimate'
  | 'lively'
  | 'seafood'
  | 'asian'
  | 'italian'
  | 'mediterranean'
  | 'kosher';

export interface CuratedVenue {
  /** Ontopo page slug — the `slug` field `availability_search` expects. */
  slug: string;
  /** Display name, city suffix stripped. */
  name: string;
  city: string;
  /** Neighbourhood, where it is the reason to go. */
  neighbourhood?: string;
  /** Ontopo's own category strings, verbatim, for the model to quote. */
  cuisine: string[];
  vibes: VenueVibe[];
  /** One line on why a concierge would send someone here. */
  note: string;
}

/**
 * Tel Aviv and Jaffa, which is where the demo lives.
 *
 * Ordered roughly from most to least "special occasion", because the model reads
 * this list in order and the first few are what it reaches for by default.
 */
export const CURATED_VENUES: readonly CuratedVenue[] = [
  {
    slug: '33687997',
    name: 'Hotel Montefiore',
    city: 'Tel Aviv',
    neighbourhood: 'Montefiore',
    cuisine: [],
    vibes: ['romantic', 'intimate', 'chef'],
    note: 'A small dining room in a restored Bauhaus hotel — the default answer for a serious anniversary.',
  },
  {
    slug: '15172114',
    name: 'NOEMA',
    city: 'Tel Aviv',
    neighbourhood: 'Jaffa Port',
    cuisine: ['Bar', 'Bistro'],
    vibes: ['romantic', 'view', 'cocktails'],
    note: 'Sea air and a bar worth sitting at; has an outside area that books separately.',
  },
  {
    slug: '34362976',
    name: 'Yaffo Tel Aviv',
    city: 'Tel Aviv',
    cuisine: ['Mediterranean', 'Chef Haim Cohen'],
    vibes: ['chef', 'mediterranean', 'romantic'],
    note: 'Haim Cohen’s room — grown-up, generous, and reliably good for a night that matters.',
  },
  {
    slug: '95877411',
    name: 'Milgo Milbar',
    city: 'Tel Aviv',
    cuisine: ['Chef'],
    vibes: ['chef', 'intimate', 'seafood'],
    note: 'Small, seafood-leaning, and quiet enough to actually talk.',
  },
  {
    slug: '61252146',
    name: 'Ramesses By The Box',
    city: 'Tel Aviv',
    cuisine: ['Restaurant', 'Wine bar', 'Tasting Menu'],
    vibes: ['wine', 'chef', 'intimate'],
    note: 'Tasting menu and a wine list — the choice when the meal itself is the gift.',
  },
  {
    slug: '93797570',
    name: 'Brasserie 18',
    city: 'Tel Aviv',
    cuisine: ['Restaurant'],
    vibes: ['romantic', 'wine'],
    note: 'Classic brasserie, open late, works for a spontaneous evening.',
  },
  {
    slug: '31503285',
    name: 'Ursa',
    city: 'Tel Aviv',
    cuisine: [],
    vibes: ['chef', 'seafood', 'intimate'],
    note: 'Tight menu, very good fish, low lighting.',
  },
  {
    slug: '51001068',
    name: 'Chacoli',
    city: 'Tel Aviv',
    cuisine: ['Spanish tapas', 'Chef Guy Gamzo', 'Chef Jordan Shay'],
    vibes: ['wine', 'lively', 'chef'],
    note: 'Spanish tapas with a bar and a dining area; good for a long, unhurried evening.',
  },
  {
    slug: '37748225',
    name: 'Concierge',
    city: 'Tel Aviv',
    cuisine: ['Wine Bar', 'Cocktails', 'Mixology'],
    vibes: ['cocktails', 'wine', 'intimate'],
    note: 'Drinks-first. The right suggestion for after dinner, or for a first date.',
  },
  {
    slug: '83133618',
    name: 'Matteo',
    city: 'Tel Aviv',
    cuisine: ['Italian', 'Meat', 'Fish', 'Seafood'],
    vibes: ['italian', 'romantic'],
    note: 'Italian, warm, dependable — an easy yes when nobody wants to be adventurous.',
  },
  {
    slug: '12618300',
    name: 'Hasalon',
    city: 'Tel Aviv',
    neighbourhood: 'Jaffa',
    cuisine: ['Mediterranean', 'Chef', 'Eyal Shani'],
    vibes: ['chef', 'lively', 'mediterranean'],
    note: 'Loud, theatrical Eyal Shani room. A celebration, not a quiet conversation.',
  },
  {
    slug: '83728647',
    name: 'North Abraxas',
    city: 'Tel Aviv',
    cuisine: ['Farm to table', 'Chef Eyal Shani'],
    vibes: ['chef', 'lively'],
    note: 'Standing-room energy and food off the fire; has a smoking terrace.',
  },
  {
    slug: '45578355',
    name: 'Onami',
    city: 'Tel Aviv',
    cuisine: ['Sushi Bar', 'Japanese Cuisine', 'Cocktails and wine'],
    vibes: ['asian', 'intimate', 'cocktails'],
    note: 'Sit at the sushi bar. Better for two than for a group.',
  },
  {
    slug: '46461893',
    name: 'Jasia',
    city: 'Tel Aviv',
    neighbourhood: 'Jaffa',
    cuisine: ['Asian', 'Sushi'],
    vibes: ['asian', 'romantic'],
    note: 'Jaffa, Asian, candlelit — photographs well, which matters to some people.',
  },
  {
    slug: '52073325',
    name: 'A la bar',
    city: 'Tel Aviv',
    cuisine: ['Wine Bar', 'Tapas', 'Bistro'],
    vibes: ['wine', 'intimate', 'cocktails'],
    note: 'Wine bar with real food; good when dinner should feel casual but not cheap.',
  },
  {
    slug: '70913310',
    name: 'Turkiz',
    city: 'Tel Aviv',
    cuisine: ['Bistro', 'Scenic View'],
    vibes: ['view', 'seafood', 'romantic'],
    note: 'The view is the reason. Ask for a table facing the water.',
  },
  {
    slug: '42305943',
    name: 'Stolero',
    city: 'Tel Aviv',
    cuisine: ['Middle Eastern', 'Sea View', 'Cocktails'],
    vibes: ['view', 'cocktails', 'mediterranean'],
    note: 'Sea view and cocktails; strongest at sunset, so it pairs with a late-Saturday plan.',
  },
  {
    slug: '96471644',
    name: 'Loulou 47',
    city: 'Tel Aviv',
    cuisine: ['Bar - restaurant'],
    vibes: ['lively', 'cocktails'],
    note: 'Bar-restaurant with a late crowd. Fine for drinks, not for a proposal.',
  },
  {
    slug: '91874183',
    name: 'Mezcal',
    city: 'Tel Aviv',
    cuisine: ['Mexican', 'Cocktails'],
    vibes: ['lively', 'cocktails'],
    note: 'Mexican and loud. Good energy, low ceremony.',
  },
  {
    slug: '40980635',
    name: 'Rendez-vous',
    city: 'Tel Aviv',
    cuisine: ['Italian', 'Kosher'],
    vibes: ['italian', 'kosher', 'romantic'],
    note: 'The kosher option that is genuinely a nice dinner rather than a compromise.',
  },
] as const;

/** Look a venue up by slug. */
export function venueBySlug(slug: string): CuratedVenue | undefined {
  return CURATED_VENUES.find((venue) => venue.slug === slug);
}

/**
 * Where each stored restaurant style lands in the closed {@link VenueVibe} set.
 *
 * `RESTAURANT_STYLE_OPTIONS` was written against this table rather than the other
 * way round, which is why every option maps onto vibes that actually occur in
 * `CURATED_VENUES`. A style listing vibes nothing is tagged with would silently
 * return an empty shortlist, so `__tests__/venues.test.ts` asserts every style
 * matches at least one venue.
 *
 * Ordering inside each list is meaningful: the first vibe is the one that defines
 * the style, and a venue carrying it scores higher than one that only carries a
 * secondary. That is what keeps "romantic and quiet" from ranking a loud room
 * ahead of a quiet one merely because both are `intimate`.
 */
export const STYLE_TO_VIBES: Readonly<Record<RestaurantStyle, readonly VenueVibe[]>> = {
  'Romantic & quiet': ['romantic', 'intimate'],
  'Lively & buzzy': ['lively', 'cocktails'],
  "Chef's tasting": ['chef', 'wine'],
  'Wine bar': ['wine', 'cocktails'],
  'Rooftop or view': ['view'],
  'Casual neighbourhood': ['mediterranean', 'italian', 'lively'],
};

/** Whether a string is one of the stored styles, so an unknown one is ignorable. */
export function isRestaurantStyle(value: string): value is RestaurantStyle {
  return Object.prototype.hasOwnProperty.call(STYLE_TO_VIBES, value);
}

/**
 * Approximate coordinates for the areas the bookable list covers.
 *
 * **Neighbourhood centroids, not venue addresses.** Deliberately: this exists to
 * answer "within 10 km of me", and the caller's own position is a city centroid
 * resolved from `home_city`, so a hundred metres of precision on the venue side
 * would be false accuracy in a comparison whose other operand is already kilometres
 * wide. Twenty invented street-level coordinates would also be twenty facts nobody
 * verified, in a file whose header is careful about which fields are Ontopo's data
 * and which are editorial — these are neither, so they are labelled as what they
 * are.
 *
 * The same trade `CITY_COORDS` in `wolt/client.ts` already makes. If sub-city
 * precision is ever needed it belongs in a `home_area` field on the user side, not
 * in stored coordinates.
 */
const AREA_COORDS: Readonly<Record<string, GeoPoint>> = {
  'tel aviv': { lat: 32.0853, lon: 34.7818 },
  jaffa: { lat: 32.0533, lon: 34.7509 },
  'jaffa port': { lat: 32.0503, lon: 34.7511 },
  montefiore: { lat: 32.0641, lon: 34.7745 },
};

/**
 * The coordinate to measure a venue from, or nothing when the area is unmapped.
 *
 * Returning `undefined` rather than a default matters: a venue whose area is not in
 * the table must be *excluded* from a radius filter, never silently placed at the
 * centre of Tel Aviv where it would pass every radius the user could ask for.
 */
export function venueCoords(venue: CuratedVenue): GeoPoint | undefined {
  const neighbourhood = venue.neighbourhood?.trim().toLowerCase();
  if (neighbourhood && AREA_COORDS[neighbourhood]) return AREA_COORDS[neighbourhood];
  return AREA_COORDS[venue.city.trim().toLowerCase()];
}

/**
 * Words that must never be the reason a venue matched.
 *
 * This list is not tidiness. `note` used to be part of the searchable text, and
 * because the notes are prose, the query "The French Laundry" scored a hit on
 * every venue whose note contained "the" — so asking about a restaurant in
 * California resolved to a random bar in Jaffa and Valentin went on to check its
 * availability. Notes are now excluded from matching entirely, and these words are
 * dropped on top of that, because "for", "and" and "with" appear in cuisine
 * strings too ("Cocktails and wine", "Farm to table").
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'near',
  'restaurant',
  'place',
  'somewhere',
  'want',
  'looking',
]);

/** The fields a query may legitimately match: facts, not editorial prose. */
function searchableText(venue: CuratedVenue): string {
  return [
    venue.name,
    venue.city,
    venue.neighbourhood ?? '',
    ...venue.cuisine,
    ...venue.vibes,
  ]
    .join(' ')
    .toLowerCase();
}

/** Split a query into the terms worth matching on. */
function queryTerms(query: string | undefined): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

/**
 * Find venues by loose text, the way the model will actually ask.
 *
 * Matches a name, a city, a neighbourhood, a cuisine string or a vibe, because the
 * model is as likely to pass "wine bar in jaffa" as it is to pass a clean vibe
 * tag. Scored rather than filtered so a query naming two things prefers a venue
 * matching both — and so a query matching nothing returns nothing rather than
 * everything, which would have Valentin confidently offer a Mexican bar to
 * someone who asked for a quiet anniversary dinner.
 *
 * Deliberately does *not* search `note`. See {@link STOPWORDS} for what that cost.
 */
export function findVenues(
  query: string | undefined,
  limit = 5,
  filters: VenueFilters = {},
): CuratedVenue[] {
  const terms = queryTerms(query);
  const styleVibes = filters.style ? STYLE_TO_VIBES[filters.style] : undefined;

  // The radius is a *filter*, applied before scoring, because a venue outside it is
  // not a worse answer — it is not an answer. Style is a *bonus*, because a room
  // tagged `chef` and `intimate` is a reasonable reply to "romantic and quiet" even
  // though it is not tagged `romantic`.
  const candidates = CURATED_VENUES.filter((venue) => withinRadius(venue, filters));

  if (terms.length === 0 && !styleVibes) return candidates.slice(0, limit);

  const scored = candidates
    .map((venue) => {
      const haystack = searchableText(venue);
      const textScore = terms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { venue, score: textScore + styleScore(venue, styleVibes) };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.venue);
}

/** Optional narrowing on top of the text query. Every field may be absent. */
export interface VenueFilters {
  /** A stored `restaurant_style`, resolved through {@link STYLE_TO_VIBES}. */
  style?: RestaurantStyle;
  /** Where the user is. Without it a radius is meaningless and is ignored. */
  origin?: GeoPoint;
  /** How far they are willing to go. Ignored unless `origin` is set too. */
  radiusMetres?: number;
}

/**
 * How well a venue answers a style.
 *
 * Weighted by position so the vibe that *defines* the style outranks a secondary —
 * 2 for the first, 1 for any other. Deliberately additive with the text score
 * rather than multiplicative: "wine bar in Jaffa" with style "Wine bar" should
 * prefer a Jaffa wine bar over a Tel Aviv one, which needs both signals to count.
 */
function styleScore(venue: CuratedVenue, styleVibes: readonly VenueVibe[] | undefined): number {
  if (!styleVibes) return 0;
  return styleVibes.reduce((total, vibe, index) => {
    if (!venue.vibes.includes(vibe)) return total;
    return total + (index === 0 ? 2 : 1);
  }, 0);
}

/**
 * Whether a venue is close enough, when the caller said where they are.
 *
 * A venue whose area is not in {@link AREA_COORDS} is dropped rather than kept, so
 * an unmapped neighbourhood shows up as a missing option — which someone will
 * notice and fix — instead of as a place that satisfies every radius ever asked
 * for. That is the failure mode worth choosing between the two.
 */
function withinRadius(venue: CuratedVenue, filters: VenueFilters): boolean {
  const { origin, radiusMetres } = filters;
  if (!origin || !radiusMetres || radiusMetres <= 0) return true;

  const coords = venueCoords(venue);
  if (!coords) return false;
  return distanceMetres(origin, coords) <= radiusMetres;
}

/**
 * Resolve something the model called a restaurant to a venue, or to nothing.
 *
 * Stricter than {@link findVenues} on purpose. This is the function that decides
 * whether Valentin is about to talk about a restaurant it can actually book, so a
 * loose match here becomes a confident answer about the wrong place. It will
 * accept a slug, a full name, or a name the query clearly contains ("Montefiore"
 * for "Hotel Montefiore") — and nothing else. A cuisine or a vibe is not a name.
 */
export function resolveVenueName(text: string): CuratedVenue | undefined {
  const lowered = text.trim().toLowerCase();
  if (lowered === '') return undefined;

  const bySlug = venueBySlug(text.trim());
  if (bySlug) return bySlug;

  const exact = CURATED_VENUES.find((venue) => venue.name.toLowerCase() === lowered);
  if (exact) return exact;

  // Substring either way round, so both "Montefiore" → "Hotel Montefiore" and
  // "dinner at NOEMA tonight" → "NOEMA" resolve. Longest name first, so "Loulou
  // Secret" is not shadowed by "Loulou 47" when both could match.
  const byName = [...CURATED_VENUES]
    .sort((a, b) => b.name.length - a.name.length)
    .find((venue) => {
      const name = venue.name.toLowerCase();
      return name.includes(lowered) || lowered.includes(name);
    });

  return byName;
}
