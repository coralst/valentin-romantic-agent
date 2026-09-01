import { describe, it, expect, afterEach } from 'vitest';
import {
  citySlugFor,
  knownCities,
  parseCityPage,
  resetDiscoveryCacheForTests,
} from '../discovery';

/**
 * Venue discovery, tested where it can be tested without a browser.
 *
 * `parseCityPage` and `citySlugFor` are pure, and they are also where the bugs
 * live: the first version of the parser tried to lift names out of the anchor
 * markup, matched nothing, and reported Ra'anana as having no restaurants — which
 * reads as "Ontopo does not cover it" rather than "the parser broke". So the
 * fixture below is real markup, copied from the rendered page, rather than a
 * hand-written ideal of it.
 */

afterEach(() => resetDiscoveryCacheForTests());

/**
 * A slice of the actual `ontopo.com/en/il/raanana` HTML.
 *
 * Kept verbatim, ugly attributes and all. A tidied-up fixture would have passed
 * against the broken parser too — the whole reason that bug survived was that the
 * shape I imagined was simpler than the shape Ontopo serves.
 */
const REAL_CITY_HTML = `
<span class="image-comp"><img alt="Highlight card cover" src="https://res.cloudinary.com/ontopo/image/upload/v1/2.jpg"></span>
<a class="block" href="/en/il/raanana/page/55913058" data-v-5d5a88b3=""><div class="post-header w-full flex justify-start no-wrap px-2 my-3 pointer" data-v-6318ecba="" data-v-5d5a88b3=""><div class="post-logo" data-v-6318ecba=""><span class="image-comp row" style="width:40px;height:40px;"><img rel="preload" loading="eager" draggable="false" class="rounded-lg" width="40px" height="40px" alt="Augustine Logo" src="https://res.cloudinary.com/ontopo/image/upload/v1/1.png"></span></div><div class="header-text">Augustine</div></div></a>
<a class="block" href="/en/il/raanana/page/56704909" data-v-5d5a88b3=""><div class="post-header"><div class="post-logo"><img alt="Kami Logo"></div></div></a>
<a class="block" href="/en/il/raanana/page/58310837" data-v-5d5a88b3=""><div class="post-header"><div class="post-logo"><img alt="Buckaroo Logo"></div></div></a>
<a href="/en/il/tel-aviv/page/33687997">a venue in another city</a>
<a href="/en/il/raanana/page/55913058">the same venue linked twice</a>
`;

describe('parseCityPage', () => {
  it('finds every venue slug in a real rendered city page', () => {
    const venues = parseCityPage(REAL_CITY_HTML, 'raanana');
    expect(venues.map((v) => v.slug).sort()).toEqual([
      '55913058',
      '56704909',
      '58310837',
    ]);
  });

  it('does not pick up venues from a different city on the same page', () => {
    // City pages cross-link, so a slug-only regex without the city segment would
    // quietly file a Tel Aviv restaurant under Ra'anana and then check the wrong
    // venue's availability.
    const venues = parseCityPage(REAL_CITY_HTML, 'raanana');
    expect(venues.map((v) => v.slug)).not.toContain('33687997');
  });

  it('returns one entry per venue however many times it is linked', () => {
    const venues = parseCityPage(REAL_CITY_HTML, 'raanana');
    expect(venues.filter((v) => v.slug === '55913058')).toHaveLength(1);
  });

  it('keeps the curated name and flag when a venue is also curated', () => {
    const venues = parseCityPage(
      '<a href="/en/il/tel-aviv/page/33687997">x</a>',
      'tel-aviv',
    );
    // Hotel Montefiore is in the curated list, which carries a neighbourhood and a
    // concierge's note. Discovery must not overwrite that with a page title.
    expect(venues[0].curated).toBe(true);
    expect(venues[0].name).toBe('Hotel Montefiore');
  });

  it('leaves an uncurated venue unnamed, for the caller to resolve', () => {
    const venues = parseCityPage(REAL_CITY_HTML, 'raanana');
    const buckaroo = venues.find((v) => v.slug === '58310837');
    // Names come from the venue page's own <title>, not from this markup — the
    // anchor here contains only an image alt, and depending on that is what broke.
    expect(buckaroo?.name).toBe('');
    expect(buckaroo?.curated).toBe(false);
  });

  it('reads a Hebrew-locale page as the same venues', () => {
    const venues = parseCityPage('<a href="/he/il/raanana/page/58310837">x</a>', 'raanana');
    expect(venues.map((v) => v.slug)).toEqual(['58310837']);
  });

  it('finds nothing in a page that carries no venue links', () => {
    expect(parseCityPage('<html><body>cookie banner</body></html>', 'raanana')).toEqual([]);
  });
});

describe('citySlugFor', () => {
  it('accepts the spellings a person actually types', () => {
    // The apostrophe is the interesting one: nobody types it consistently, and
    // this is the city the couple lives near.
    expect(citySlugFor("Ra'anana")).toBe('raanana');
    expect(citySlugFor('raanana')).toBe('raanana');
    expect(citySlugFor('Ranana')).toBe('raanana');
    expect(citySlugFor('רעננה')).toBe('raanana');
  });

  it('accepts Hebrew and transliterations for the bigger cities', () => {
    expect(citySlugFor('תל אביב')).toBe('tel-aviv');
    expect(citySlugFor('TLV')).toBe('tel-aviv');
    expect(citySlugFor('Tel Aviv-Yafo')).toBe('tel-aviv');
    expect(citySlugFor('Herzliya')).toBe('herzeliya');
  });

  it('finds a city named inside a longer phrase', () => {
    // "somewhere in Tel Aviv near the beach" should still resolve, since the model
    // passes through whatever the user said.
    expect(citySlugFor('somewhere in Tel Aviv near the beach')).toBe('tel-aviv');
  });

  it('returns null for a city Ontopo has no page for', () => {
    // Null rather than a guess: a wrong city silently checks the wrong
    // restaurants, which is worse than saying we do not cover it.
    expect(citySlugFor('Paris')).toBeNull();
    expect(citySlugFor('')).toBeNull();
    expect(citySlugFor('   ')).toBeNull();
  });
});

describe('knownCities', () => {
  it('lists the cities, so a tool description and a refusal can name them', () => {
    const cities = knownCities();
    expect(cities).toContain('tel aviv');
    expect(cities).toContain("ra'anana");
    expect(cities.length).toBeGreaterThan(15);
  });
});
