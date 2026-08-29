import { logger } from '../../logging';
import { fetchRendered } from '../browser/session';
import { CURATED_VENUES, type CuratedVenue } from './venues';

/**
 * Finding venues Ontopo can book, anywhere in Israel.
 *
 * ### Why this exists
 *
 * The curated list in `venues.ts` is five Tel Aviv and Jaffa restaurants, and until
 * now it *was* the world: `resolveVenue` refuses a name that is not in it, so
 * `check_availability` returned "not one of the restaurants Valentin can book"
 * before any request was made. Asked for Buckaroo in Ra'anana — a real venue that
 * Ontopo books, with tables free on six of the next seven nights — Valentin
 * declined. The availability API was working perfectly the whole time. The list was
 * the ceiling.
 *
 * ### Why it needs a browser
 *
 * Ontopo used to expose a search API. It does not now: `/api/search_page`,
 * `/api/venue_search`, `/api/search`, `/api/suggest` and `/api/autocomplete` all
 * answer 404. What still works is the city page — `ontopo.com/en/il/raanana` — which
 * lists every bookable venue in that city as links of the form
 * `/en/il/<city>/page/<slug>`, and `<slug>` is exactly what `availability_search`
 * wants. But the list is rendered client-side, so `curl` returns a shell and only a
 * real browser produces the links.
 *
 * That makes this the most fragile thing in the integration layer, and the design
 * follows from it: nothing here is on the path of an ordinary booking. The curated
 * list is still consulted first and still works with no browser at all, so a change
 * to Ontopo's markup costs Valentin the *long tail* of venues rather than the
 * ability to book dinner. The failure is a narrowing, not an outage.
 *
 * Only public pages are read, exactly as a visitor sees them: no login, no
 * paywall, and nothing behind a consent gate.
 */

/** How long a city's venue list is considered current. */
const CACHE_TTL_MS = 6 * 60 * 60_000;

/** Venues to look the name up for. Tel Aviv has well over a hundred. */
const MAX_NAMED_PER_CITY = 60;

/** Name lookups in flight at once — polite, and fast enough at this cap. */
const NAME_CONCURRENCY = 8;

/**
 * Ontopo's own city slugs, from the links on its Israel page.
 *
 * Hardcoded rather than discovered because these are stable, few, and the
 * alternative is a second scrape to learn them — a page load to find out that
 * Ra'anana is spelled `raanana`. Aliases carry what a person actually types,
 * including the Hebrew, since the couple this is built for lives here.
 */
const CITY_SLUGS: Record<string, readonly string[]> = {
  'tel-aviv': ['tel aviv', 'telaviv', 'tlv', 'tel aviv-yafo', 'תל אביב'],
  jerusalem: ['jerusalem', 'yerushalayim', 'ירושלים'],
  raanana: ["ra'anana", 'raanana', 'ranana', 'רעננה'],
  herzeliya: ['herzliya', 'herzeliya', 'hertzliya', 'הרצליה'],
  kfar_saba: ['kfar saba', 'kfar sava', 'כפר סבא'],
  hod_hasharon: ['hod hasharon', 'הוד השרון'],
  natanya: ['netanya', 'natanya', 'נתניה'],
  haifa: ['haifa', 'חיפה'],
  ramatgan: ['ramat gan', 'ramatgan', 'רמת גן'],
  ramat_hasharon: ['ramat hasharon', 'רמת השרון'],
  petah_tikva: ['petah tikva', 'petach tikva', 'פתח תקווה'],
  rishon_lezion: ['rishon lezion', 'rishon letzion', 'ראשון לציון'],
  rehovot: ['rehovot', 'רחובות'],
  modiin: ['modiin', "modi'in", 'מודיעין'],
  eilat: ['eilat', 'אילת'],
  caesarya: ['caesarea', 'caesarya', 'קיסריה'],
  kiryat_ono: ['kiryat ono', 'קריית אונו'],
  ness_ziona: ['ness ziona', 'nes ziona', 'נס ציונה'],
  holon: ['holon', 'חולון'],
  ashdod: ['ashdod', 'אשדוד'],
  ashkelon: ['ashkelon', 'אשקלון'],
  'beer-sheva': ['beer sheva', 'beersheba', 'באר שבע'],
};

/** A venue Ontopo will book, learned from a city page rather than curated. */
export interface DiscoveredVenue {
  slug: string;
  name: string;
  city: string;
  /** True when this also appears in the curated list, which carries richer detail. */
  curated: boolean;
}

interface CacheEntry {
  venues: DiscoveredVenue[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Ontopo's slug for a city a person named, or null if it is not one we know. */
export function citySlugFor(city: string): string | null {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return null;
  if (CITY_SLUGS[wanted]) return wanted;
  for (const [slug, aliases] of Object.entries(CITY_SLUGS)) {
    if (aliases.some((alias) => alias === wanted)) return slug;
  }
  // Last resort, so "Tel Aviv beach" still finds Tel Aviv rather than nothing.
  for (const [slug, aliases] of Object.entries(CITY_SLUGS)) {
    if (aliases.some((alias) => wanted.includes(alias))) return slug;
  }
  return null;
}

/** Every city this can look in, for a tool description and an error message. */
export function knownCities(): string[] {
  return Object.values(CITY_SLUGS).map((aliases) => aliases[0]);
}

/**
 * Pull the venue slugs out of a rendered city page.
 *
 * **Only the slugs.** The first version of this also tried to lift the venue's name
 * out of the surrounding anchor, and that was the wrong instinct: an Ontopo venue
 * link wraps an entire card — nested divs, a logo, a cover image — so the name is
 * buried in a kilobyte of markup whose shape is Ontopo's private business. It
 * matched nothing and reported an empty city, which is a worse failure than not
 * trying, because it looks like "no restaurants here".
 *
 * What is left is the durable part. `/<locale>/il/<city>/page/<digits>` is a
 * *contract*: it is the URL a visitor bookmarks and `<digits>` is exactly the slug
 * `availability_search` consumes. Names come from {@link nameFromVenuePage}, which
 * reads a server-rendered `<title>` — also stable, and it needs no browser.
 *
 * The locale segment is matched loosely so a Hebrew-locale page (`/he/il/...`)
 * yields the same slugs; they are the same venues either way.
 */
export function parseCityPage(html: string, citySlug: string): DiscoveredVenue[] {
  const pattern = new RegExp(`/[a-z]{2}/il/${citySlug}/page/(\\d+)`, 'g');
  const slugs = new Set<string>();
  for (const match of html.matchAll(pattern)) slugs.add(match[1]);

  const city = prettyCity(citySlug);
  return [...slugs].map((slug) => ({
    slug,
    // Filled in by the caller. A curated venue already has a better one than a
    // page title, including its neighbourhood, so prefer that.
    name: CURATED_VENUES.find((v) => v.slug === slug)?.name ?? '',
    city,
    curated: CURATED_VENUES.some((v) => v.slug === slug),
  }));
}

function prettyCity(citySlug: string): string {
  const alias = CITY_SLUGS[citySlug]?.[0] ?? citySlug.replace(/[-_]/g, ' ');
  return alias.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Ask a venue page for its own name, when the city page did not carry one.
 *
 * The `<title>` is server-rendered — `curl` is enough, no browser needed — and
 * reads "Book now <Name> <City> | ontopo". Worth the extra request only for venues
 * whose name is otherwise blank, which is why the caller batches it.
 */
async function nameFromVenuePage(slug: string, citySlug: string): Promise<string | null> {
  try {
    const response = await fetch(`https://ontopo.com/en/il/${citySlug}/page/${slug}`, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const title = /<title>([^<]*)<\/title>/i.exec(await response.text())?.[1];
    if (!title) return null;
    return (
      title
        .replace(/\s*\|\s*ontopo\s*$/i, '')
        .replace(/^\s*book\s+now\s+/i, '')
        .trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Every venue Ontopo books in a city.
 *
 * Cached for six hours. A restaurant joining or leaving Ontopo is a weekly event,
 * not a per-request one, and the alternative is a three-second browser launch on
 * every question about dinner.
 */
export async function venuesInCity(city: string): Promise<DiscoveredVenue[] | null> {
  const citySlug = citySlugFor(city);
  if (!citySlug) return null;

  const hit = cache.get(citySlug);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.venues;

  const startedAt = Date.now();
  let html: string;
  try {
    // The list is client-rendered, so it needs a beat after DOMContentLoaded.
    html = await fetchRendered(`https://ontopo.com/en/il/${citySlug}`, { waitMs: 3000 });
  } catch (err) {
    logger.warn('ontopo.discovery-failed', {
      city: citySlug,
      cause: err instanceof Error ? err.message : String(err),
    });
    // Stale beats nothing: an hours-old list of the same restaurants is a better
    // answer than refusing, and availability is checked live regardless.
    return hit?.venues ?? null;
  }

  const venues = parseCityPage(html, citySlug);

  /*
   * Name every venue the city page did not already name, in small batches.
   *
   * Each name is one cheap `fetch` of a server-rendered title. Tel Aviv carries
   * well over a hundred venues, so this is capped and run eight at a time — the cap
   * keeps a first question about dinner from turning into a hundred requests, and
   * the concurrency limit keeps us from arriving as a burst. Cached for six hours
   * afterwards, so the cost is paid roughly twice a day per city.
   */
  const nameless = venues.filter((v) => !v.name).slice(0, MAX_NAMED_PER_CITY);
  for (let i = 0; i < nameless.length; i += NAME_CONCURRENCY) {
    const batch = nameless.slice(i, i + NAME_CONCURRENCY);
    await Promise.all(
      batch.map(async (venue) => {
        const name = await nameFromVenuePage(venue.slug, citySlug);
        if (name) venue.name = name;
      }),
    );
  }

  // A venue we could not name is one the model cannot offer, so it is dropped
  // rather than shown as a bare number.
  const named = venues.filter((v) => v.name);
  logger.info('ontopo.discovered', {
    city: citySlug,
    venues: named.length,
    durationMs: Date.now() - startedAt,
  });

  cache.set(citySlug, { venues: named, fetchedAt: Date.now() });
  return named;
}

/**
 * Resolve a restaurant name to something bookable, curated list first.
 *
 * Order matters and is the whole safety property. The curated list is checked
 * first because it is instant, needs no browser, and carries the notes and vibes
 * the model uses to explain *why* a place suits an anniversary. Discovery is the
 * fallback that stops "we do not book there" from being a lie.
 */
export async function resolveAnyVenue(
  name: string,
  city?: string,
): Promise<DiscoveredVenue | CuratedVenue | null> {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;

  const curated = CURATED_VENUES.find(
    (v) => v.name.toLowerCase() === wanted || v.name.toLowerCase().includes(wanted),
  );
  if (curated) return curated;

  // Without a city there is no page to read: Ontopo has no all-Israel listing.
  if (!city) return null;
  const venues = await venuesInCity(city);
  if (!venues) return null;

  return (
    venues.find((v) => v.name.toLowerCase() === wanted) ??
    venues.find((v) => v.name.toLowerCase().includes(wanted)) ??
    // Loosest match last: a venue whose name is contained in what was asked for,
    // so "the Buckaroo place" still lands. Guarded on length so a two-letter
    // fragment cannot match half a city.
    (wanted.length >= 4
      ? venues.find((v) => v.name.length >= 4 && wanted.includes(v.name.toLowerCase()))
      : undefined) ??
    null
  );
}

/** Drop the cache, so a test does not inherit another test's city. */
export function resetDiscoveryCacheForTests(): void {
  cache.clear();
}
