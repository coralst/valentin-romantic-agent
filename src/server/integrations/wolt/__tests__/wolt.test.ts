import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  coordsFor,
  describeWoltVenue,
  filterByProductLine,
  matchVenues,
  parseWoltPage,
  resetWoltCacheForTests,
  venuesNear,
  woltCities,
} from '../client';
import { proposeGiftTool, findGiftDeliveryTool } from '../tools';
import { runTool } from '../../tool-registry';

/**
 * Wolt, with `fetch` stubbed.
 *
 * The fixture below is trimmed from a real `GET /v1/pages/front` response, keeping
 * the field names and nesting verbatim. That matters more here than usual: this is
 * an undocumented consumer API, so the only thing protecting us from a rename is a
 * fixture that reflects what Wolt actually sends. An idealised one would keep
 * passing after the real shape moved.
 */

const CTX = { sessionId: 'wolt-test' };

/** Real field names, real nesting, three venues across three product lines. */
const PAGE = {
  sections: [
    {
      name: 'restaurants-delivering-venues',
      items: [
        {
          venue: {
            id: '6731d09b0b8448452a6f8d6e',
            slug: 'japanika-raanana',
            name: "Japanika Kosher | Ra'anana",
            product_line: 'restaurant',
            online: true,
            delivers: true,
            estimate: 25,
            estimate_range: '20-30',
            rating: { score: 9.1 },
            price_range: 2,
            address: 'אלכסנדר זרחין 1ב׳, רעננה',
            tags: ['asian', 'japanese', 'noodles'],
          },
        },
        {
          venue: {
            slug: 'pirchey-hakerem',
            name: 'Pirchei Hakerem',
            product_line: 'florist',
            online: true,
            delivers: true,
            estimate: 50,
            estimate_range: '45-55',
            rating: { score: 6.6 },
            address: 'Tel Aviv',
            tags: ['flowers'],
          },
        },
      ],
    },
    {
      name: 'isr_retail_gm',
      items: [
        {
          venue: {
            slug: 'winston-wines',
            name: 'Winston Wines',
            product_line: 'alcohol',
            online: false,
            delivers: true,
            estimate: 25,
            estimate_range: '20-30',
            address: 'Tel Aviv',
            tags: ['wine'],
          },
        },
        // The same venue again, as Wolt really does repeat across sections.
        {
          venue: {
            slug: 'pirchey-hakerem',
            name: 'Pirchei Hakerem',
            product_line: 'florist',
            online: true,
            delivers: true,
            estimate: 50,
            tags: ['flowers'],
          },
        },
      ],
    },
    // A section with no items at all, which the live response also contains.
    { name: 'category-list', items: [{ title: 'Kosher' }] },
  ],
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  resetWoltCacheForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => PAGE } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWoltCacheForTests();
});

describe('parseWoltPage', () => {
  it('flattens every section into venues', () => {
    const venues = parseWoltPage(PAGE);
    expect(venues.map((v) => v.slug).sort()).toEqual([
      'japanika-raanana',
      'pirchey-hakerem',
      'winston-wines',
    ]);
  });

  it('returns one entry per venue however many sections list it', () => {
    // Wolt repeats a venue across "top rated", "newest" and so on. A duplicate
    // would show the same florist twice on one card.
    expect(parseWoltPage(PAGE).filter((v) => v.slug === 'pirchey-hakerem')).toHaveLength(1);
  });

  it('reads the nested rating score, not the object', () => {
    const florist = parseWoltPage(PAGE).find((v) => v.slug === 'pirchey-hakerem');
    expect(florist?.rating).toBe(6.6);
  });

  it('builds the public page URL a human finishes an order on', () => {
    const florist = parseWoltPage(PAGE).find((v) => v.slug === 'pirchey-hakerem');
    expect(florist?.url).toBe('https://wolt.com/en/isr/pirchey-hakerem');
  });

  it('treats a missing `online` as closed rather than open', () => {
    // Offering a closed florist is worse than offering none, so unknown must not
    // read as available.
    const venues = parseWoltPage({
      sections: [{ items: [{ venue: { slug: 's', name: 'n', product_line: 'florist' } }] }],
    });
    expect(venues[0].online).toBe(false);
  });

  it('survives a response with no sections at all', () => {
    expect(parseWoltPage({})).toEqual([]);
    expect(parseWoltPage(null)).toEqual([]);
    expect(parseWoltPage({ sections: 'nope' })).toEqual([]);
  });
});

describe('filterByProductLine', () => {
  it('selects on product_line, which is Wolt\'s own taxonomy', () => {
    // Not on tags: those are free text and inconsistent ("grocery" and "groceries"
    // both occur), while product_line is what the site itself filters on.
    const florists = filterByProductLine(parseWoltPage(PAGE), ['florist']);
    expect(florists.map((v) => v.name)).toEqual(['Pirchei Hakerem']);
  });

  it('keeps closed venues but sorts them last', () => {
    // "The only wine shop nearby is shut until nine" is a useful answer; an empty
    // list is not.
    const venues = filterByProductLine(parseWoltPage(PAGE), ['florist', 'alcohol']);
    expect(venues.map((v) => v.online)).toEqual([true, false]);
  });
});

describe('matchVenues', () => {
  it('matches on name, tags and address', () => {
    const venues = parseWoltPage(PAGE);
    expect(matchVenues(venues, 'wine').map((v) => v.slug)).toEqual(['winston-wines']);
    expect(matchVenues(venues, 'japanese').map((v) => v.slug)).toEqual(['japanika-raanana']);
  });

  it('keeps everything for an empty or too-short query', () => {
    const venues = parseWoltPage(PAGE);
    expect(matchVenues(venues, '')).toHaveLength(3);
    // A two-letter fragment would match half the city, so it is ignored.
    expect(matchVenues(venues, 'a')).toHaveLength(3);
  });
});

describe('coordsFor', () => {
  it('accepts the spellings a person types, including Hebrew', () => {
    expect(coordsFor("Ra'anana")).toEqual({ lat: 32.1848, lon: 34.8713 });
    expect(coordsFor('raanana')).toBeTruthy();
    expect(coordsFor('רעננה')).toBeTruthy();
    expect(coordsFor('TLV')).toBeTruthy();
  });

  it('returns null for a city Wolt coverage is not known for', () => {
    // Null rather than a nearby guess: delivering "to Paris" from Tel Aviv is not
    // a near miss, it is a wrong answer.
    expect(coordsFor('Paris')).toBeNull();
    expect(coordsFor('')).toBeNull();
  });

  it('lists its cities, so a refusal can name them', () => {
    expect(woltCities()).toContain("ra'anana");
  });
});

describe('venuesNear', () => {
  it('asks both pages, because only `front` carries florists', () => {
    // `/v1/pages/restaurants` is the exhaustive food list; the non-restaurant
    // product lines only appear on `front`. `/stores` and `/shops` both 404.
    return venuesNear(32.0853, 34.7818).then(() => {
      expect(calls.some((u) => u.includes('/pages/restaurants'))).toBe(true);
      expect(calls.some((u) => u.includes('/pages/front'))).toBe(true);
    });
  });

  it('caches, so a second question costs no requests', async () => {
    await venuesNear(32.0853, 34.7818);
    const after = calls.length;
    await venuesNear(32.0853, 34.7818);
    expect(calls.length).toBe(after);
  });

  it('reports a transport failure as null rather than as an empty city', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    // Null means "could not ask", which the tool says out loud. An empty array
    // would become "there are no florists", which is a different and false claim.
    expect(await venuesNear(31.7683, 35.2137)).toBeNull();
  });
});

describe('find_gift_delivery', () => {
  it('finds real florists and says how long delivery takes', async () => {
    const result = await runTool(findGiftDeliveryTool, { city: 'Tel Aviv', kind: 'flowers' }, CTX);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Pirchei Hakerem');
    expect(result.summary).toContain('45-55 min');
  });

  it('refuses a city it has no delivery area for, and names the ones it has', async () => {
    const result = await runTool(findGiftDeliveryTool, { city: 'Paris' }, CTX);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/ra'anana/i);
  });

  it('says plainly when nothing of that kind delivers there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sections: [] }) })),
    );
    const result = await runTool(findGiftDeliveryTool, { city: 'Tel Aviv', kind: 'flowers' }, CTX);
    // A true answer, so `ok` — and the instruction not to invent a shop is the
    // point of the sentence.
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/do not invent a shop/i);
  });

  it('never raises a proposal, because looking is not offering', async () => {
    const result = await runTool(findGiftDeliveryTool, { city: 'Tel Aviv', kind: 'gift' }, CTX);
    expect(result.proposal).toBeUndefined();
  });
});

describe('propose_gift', () => {
  it('produces a card carrying the shop\'s own Wolt link, and orders nothing', async () => {
    const result = await runTool(
      proposeGiftTool,
      {
        city: 'Tel Aviv',
        shop: 'Pirchei Hakerem',
        kind: 'flowers',
        occasion: 'your anniversary',
        note: 'a dozen white roses',
      },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal?.url).toBe('https://wolt.com/en/isr/pirchey-hakerem');
    expect(result.proposal?.title).toContain('your anniversary');
    // The card has to say who takes the money. Valentin never touches a card
    // number, and the sentence the user reads is what makes that legible.
    expect(result.proposal?.summary).toMatch(/pay Wolt/i);
    expect(result.proposal?.summary).toMatch(/nothing is ordered/i);
    // And the model is told not to overclaim.
    expect(result.summary).toMatch(/do not say it is ordered/i);
  });

  it('refuses a shop that is not actually deliverable there', async () => {
    const result = await runTool(
      proposeGiftTool,
      { city: 'Tel Aviv', shop: 'Some Florist That Does Not Exist' },
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(result.proposal).toBeUndefined();
  });

  it('confirming hands over the link and still orders nothing', async () => {
    const proposed = await runTool(
      proposeGiftTool,
      { city: 'Tel Aviv', shop: 'Pirchei Hakerem', kind: 'flowers' },
      CTX,
    );
    const before = calls.length;

    const confirmed = await proposeGiftTool.confirm!(proposed.proposal!, CTX);

    expect(confirmed.ok).toBe(true);
    expect((confirmed.data as { url: string }).url).toBe(
      'https://wolt.com/en/isr/pirchey-hakerem',
    );
    // The load-bearing assertion: confirming makes no request to anyone. Wolt's
    // basket is behind a login and a card, so the last step belongs to the human
    // by construction — which is why this capability is safe to have at all.
    expect(calls.length).toBe(before);
    expect(confirmed.summary).toMatch(/you have not ordered anything/i);
  });
});

describe('describeWoltVenue', () => {
  it('says "closed right now" rather than quoting a delivery time', () => {
    const closed = parseWoltPage(PAGE).find((v) => v.slug === 'winston-wines')!;
    expect(describeWoltVenue(closed)).toContain('closed right now');
    expect(describeWoltVenue(closed)).not.toContain('20-30 min');
  });
});
