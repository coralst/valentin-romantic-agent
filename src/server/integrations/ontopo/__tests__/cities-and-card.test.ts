import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Discovery is faked: it launches Chromium, which neither CI nor the production
 * image has. What these tests are about is how the tools behave *around* it — what
 * they answer when it returns venues, and what they answer when it returns null
 * because there is no browser, which is every deployed environment today.
 */
const { venuesInCity } = vi.hoisted(() => ({ venuesInCity: vi.fn() }));
vi.mock('../discovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discovery')>()),
  venuesInCity,
}));

vi.mock('../venue-web-fallback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../venue-web-fallback')>()),
  findVenueOwnPage: vi.fn().mockResolvedValue(null),
}));

import { parseCheckoutTerms } from '../client';
import { resolveAnyVenue } from '../discovery';
import {
  checkAvailabilityTool,
  findRestaurantsTool,
  proposeReservationTool,
  resetCardTermsForTests,
} from '../tools';
import {
  CURATED_VENUES,
  cityKey,
  curatedCities,
  curatedCityMatches,
  findVenues,
  resolveVenueName,
  sameVenueName,
  squashVenueName,
} from '../venues';

/**
 * The live failure these tests exist for, session `97725cc8…`, 2026-09-21:
 *
 *   user:     search in Kfar Saba
 *   Valentin: The bookable system I have access to only covers Tel Aviv and Jaffa —
 *             nothing in Kfar Saba is in there.
 *
 * Ontopo lists seven venues in Kfar Saba, one of which had been booked through this
 * integration a fortnight earlier. Then:
 *
 *   user:     find one without a need of credit card
 *   Valentin: nearly all the bookable restaurants in Tel Aviv now ask for a card
 *
 * — said with no data, because nothing here ever read the checkout page where the
 * card requirement lives. Four of the Kfar Saba venues take a table with no card.
 */

const CTX = { userId: 'user-1', sessionId: 's1' };

/** Trimmed from a real `s1.ontopo.com/en/checkout/…` for NOEMA, 2026-09-21. */
const CARD_REQUIRED_PAGE = `<script>window.__CHECKOUT__={"paymentTerms":{"header":{"title":"Credit card details"},"items":[{"label":"To complete your reservation, please fill in credit card details for deposit.","color":"text-red"}]},"creditcard":{"header":{"title":"Credit card details"},"sum":30,"currency":"NIS","form":[{"name":"cc-number","value":"number","required":true,"mask":"card"}],"showPayment":true},"upsale":null,"summary":{"header":{"title":"Review"}}}</script>`;

/** Trimmed from the same host for Ruben, Kfar Saba, the same day. */
const NO_CARD_PAGE = `<script>window.__CHECKOUT__={"details":{"header":{"title":"Contact Info"},"form":[{"name":"firstName","required":true}]},"upsale":null,"summary":{"header":{"title":"Review"}}}</script>`;

/** A venue that carries the block but has payment switched off. */
const CARD_FORM_UNUSED_PAGE = `{"creditcard":{"header":{"title":"Credit card details"},"sum":0,"currency":"NIS","form":[],"showPayment":false}}`;

const RUBEN = '36893103';

const RUBEN_AVAILABILITY = {
  areas: [
    {
      id: 'main',
      name: 'Restaurant',
      options: [
        { time: '1930', method: 'seat' },
        { time: '2000', method: 'seat' },
      ],
    },
  ],
  method: 'seat',
  availability_id: 'avail-ruben',
};

interface Recorded {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

let calls: Recorded[];

/**
 * A fetch that answers three kinds of request the tools now make: the availability
 * POST, the checkout-minting POST (same endpoint, carries `availability_id`), and
 * the GET of the checkout page on `s1.ontopo.com`.
 */
function stubOntopo(options: { checkoutPage: string | null; availability?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url: String(url), body });

      if (String(url).startsWith('https://s1.ontopo.com/')) {
        if (options.checkoutPage === null) {
          return { ok: false, status: 503, text: async () => '' } as unknown as Response;
        }
        return { ok: true, status: 200, text: async () => options.checkoutPage } as unknown as Response;
      }

      const payload =
        body && 'availability_id' in body
          ? { checkout_id: 'ck-1' }
          : (options.availability ?? RUBEN_AVAILABILITY);
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
  resetCardTermsForTests();
  venuesInCity.mockReset();
  venuesInCity.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the curated list covers Kfar Saba', () => {
  it('lists every Kfar Saba venue Ontopo had on 2026-09-21', () => {
    const kfarSaba = CURATED_VENUES.filter((venue) => venue.city === 'Kfar Saba');
    expect(kfarSaba.map((venue) => venue.name).sort()).toEqual(
      ['Beer Garden', 'Dr. Gonzo', 'Fresh the market', "Home'is", "L'maya", 'Ruben'].sort(),
    );
  });

  it('names its cities from the data, so a description cannot drift from the list', () => {
    expect(curatedCities()).toEqual(['Tel Aviv', 'Kfar Saba']);
    expect(findRestaurantsTool.description).toContain('Kfar Saba');
    expect(findRestaurantsTool.description).not.toMatch(/Tel Aviv and Jaffa only/);
  });

  it('keeps the default shortlist Tel Aviv', () => {
    // The Kfar Saba entries sit at the end on purpose: the model reads this list in
    // order, and "somewhere nice for dinner" with no city should still mean the city
    // the demo lives in.
    expect(findVenues(undefined, 5).every((venue) => venue.city === 'Tel Aviv')).toBe(true);
  });

  it('filters by city, tolerating the spellings people use', () => {
    for (const spelling of ['Kfar Saba', 'kfar sava', 'Kefar Sava', 'כפר סבא']) {
      const found = findVenues(undefined, 20, { city: spelling });
      expect(found.length, spelling).toBeGreaterThan(0);
      expect(found.every((venue) => venue.city === 'Kfar Saba'), spelling).toBe(true);
    }
  });

  it('treats Jaffa as Tel Aviv, which is how Ontopo files it', () => {
    expect(cityKey('Jaffa')).toBe(cityKey('Tel Aviv'));
    expect(findVenues(undefined, 20, { city: 'Jaffa' }).some((v) => v.name === 'NOEMA')).toBe(true);
  });

  it('knows which cities it holds and which it does not', () => {
    expect(curatedCityMatches('Kfar Saba')).toBe(true);
    expect(curatedCityMatches('Haifa')).toBe(false);
  });
});

describe('find_restaurants with a city', () => {
  it('returns the Kfar Saba venues without any network call', async () => {
    stubOntopo({ checkoutPage: NO_CARD_PAGE });

    const result = await findRestaurantsTool.execute({ city: 'Kfar Saba' }, CTX);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Ruben');
    expect(result.summary).toContain("Home'is");
    expect(calls).toHaveLength(0);
    expect(venuesInCity).not.toHaveBeenCalled();
  });

  it('falls through to live discovery for a city the list does not hold', async () => {
    venuesInCity.mockResolvedValue([
      { slug: '111', name: 'Buckaroo', city: "Ra'anana", curated: false },
    ]);

    const result = await findRestaurantsTool.execute({ city: "Ra'anana" }, CTX);

    expect(venuesInCity).toHaveBeenCalledWith("Ra'anana");
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Buckaroo');
    expect(result.summary).toContain('city="Ra\'anana"');
  });

  it('says honestly which cities it covers when there is no browser to discover with', async () => {
    // `venuesInCity` returns null in production: the image has no Chromium.
    const result = await findRestaurantsTool.execute({ city: 'Haifa' }, CTX);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Tel Aviv, Kfar Saba');
    expect(result.summary).toContain('Haifa is not somewhere Valentin can book right now');
    expect(result.summary).not.toMatch(/Tel Aviv and Jaffa only/);
  });

  it('does not discover for a covered city that merely matched nothing', async () => {
    // "haifa teppanyaki in Kfar Saba" is a query problem, not a coverage problem.
    const result = await findRestaurantsTool.execute(
      { city: 'Kfar Saba', query: 'teppanyaki omakase' },
      CTX,
    );

    expect(result.data).toEqual({ venues: [] });
    expect(venuesInCity).not.toHaveBeenCalled();
  });
});

describe('resolving a name the way a person types it', () => {
  it('squashes punctuation and Ontopo’s city suffix', () => {
    expect(squashVenueName("Home'is Kefar Sava")).toBe('homeis');
    expect(squashVenueName("L'maya Kefar Sava")).toBe('lmaya');
    expect(squashVenueName('Dr. Gonzo')).toBe('drgonzo');
  });

  it('does not strip a city that is part of the name', () => {
    expect(squashVenueName('Yaffo Tel Aviv')).toBe('yaffo');
    // …which is still what `resolveVenueName` needs, because the curated name
    // goes through the same function and lands on the same string.
    expect(resolveVenueName('Yaffo Tel Aviv')?.slug).toBe('34362976');
  });

  it('forgives one swapped pair of letters in a long name, and nothing looser', () => {
    // "Homies" is how "Home'is" is said; it squashes to a transposition, not to an
    // equal string, so an alias alone would not carry a live-discovered venue.
    expect(sameVenueName('homies', 'homeis')).toBe(true);
    expect(sameVenueName('homeis', 'homeis')).toBe(true);
    expect(sameVenueName('homees', 'homeis')).toBe(false); // substitution
    expect(sameVenueName('homes', 'homeis')).toBe(false); // deletion
    expect(sameVenueName('noema', 'noeam')).toBe(false); // too short to trust
  });

  it('resolves Homies to Home’is', () => {
    expect(resolveVenueName('Homies')?.name).toBe("Home'is");
    expect(resolveVenueName("Home'is")?.name).toBe("Home'is");
    expect(resolveVenueName("home'is kefar sava")?.name).toBe("Home'is");
    expect(resolveVenueName('a table at Homies please')?.name).toBe("Home'is");
  });

  it('still resolves every name the old matcher did', () => {
    expect(resolveVenueName('Montefiore')?.name).toBe('Hotel Montefiore');
    expect(resolveVenueName('dinner at NOEMA tonight')?.name).toBe('NOEMA');
    expect(resolveVenueName('Loulou 47')?.name).toBe('Loulou 47');
    expect(resolveVenueName('The French Laundry')).toBeUndefined();
  });

  it('reaches a curated venue through resolveAnyVenue without a city', async () => {
    // The curated path is checked before discovery, so no browser is involved.
    const venue = await resolveAnyVenue('Homies');
    expect(venue?.slug).toBe('86749104');
  });
});

describe('check_availability knows the city', () => {
  it('declares city in its schema so the model can send it at all', () => {
    // `execute` read `input.city` for weeks while the schema never offered it, so
    // the model could not pass what the code was waiting for.
    expect(checkAvailabilityTool.input_schema.properties).toHaveProperty('city');
    expect(proposeReservationTool.input_schema.properties).toHaveProperty('city');
  });

  it('checks a Kfar Saba venue by the name a regular would use', async () => {
    stubOntopo({ checkoutPage: NO_CARD_PAGE });

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24', time: '20:00' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(calls[0].body?.slug).toBe(RUBEN);
    expect(result.summary).toContain('Ruben on Thursday 24 September for 2');
  });
});

describe('the card requirement', () => {
  it('is read off the checkout page', () => {
    expect(parseCheckoutTerms(CARD_REQUIRED_PAGE)).toEqual({
      cardRequired: true,
      depositAmount: 30,
      currency: 'NIS',
    });
    expect(parseCheckoutTerms(NO_CARD_PAGE)).toEqual({ cardRequired: false });
    expect(parseCheckoutTerms(CARD_FORM_UNUSED_PAGE)).toEqual({ cardRequired: false });
  });

  it('is reported by check_availability when a card is needed', async () => {
    stubOntopo({ checkoutPage: CARD_REQUIRED_PAGE });

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );

    expect(result.summary).toMatch(/ask for a credit card to hold this table \(30 NIS deposit\)/);
    expect(result.summary).toMatch(/check a different restaurant/);
    expect(result.data).toMatchObject({ cardRequired: true, depositAmount: 30, currency: 'NIS' });
  });

  it('is reported by check_availability when no card is needed', async () => {
    stubOntopo({ checkoutPage: NO_CARD_PAGE });

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );

    expect(result.summary).toContain('No credit card is needed to hold this table.');
    expect(result.data).toMatchObject({ cardRequired: false });
  });

  it('mints a throwaway checkout to learn it, then reads s1.ontopo.com', async () => {
    stubOntopo({ checkoutPage: NO_CARD_PAGE });

    await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );

    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST', 'GET']);
    expect(calls[1].body).toMatchObject({ availability_id: 'avail-ruben' });
    expect(calls[2].url).toBe('https://s1.ontopo.com/en/checkout/ck-1');
  });

  it('says nothing about cards when the page could not be read', async () => {
    // Unknown must never be reported as "no card needed".
    stubOntopo({ checkoutPage: null });

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).not.toMatch(/credit card/i);
    expect(result.data).not.toHaveProperty('cardRequired');
  });

  it('is remembered per venue, so the next check does not mint again', async () => {
    stubOntopo({ checkoutPage: CARD_REQUIRED_PAGE });

    await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );
    calls = [];
    await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-25' },
      CTX,
    );

    expect(calls.map((call) => call.method)).toEqual(['POST']);
  });

  it('appears on the proposal card without propose_reservation minting anything', async () => {
    stubOntopo({ checkoutPage: CARD_REQUIRED_PAGE });

    await checkAvailabilityTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24' },
      CTX,
    );
    calls = [];

    const result = await proposeReservationTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24', time: '20:00' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal?.summary).toContain('Ontopo asks for a credit card to hold this table (30 NIS deposit).');
    expect(result.summary).toContain('30 NIS deposit');
    // One call — the availability re-check. The rule that no checkout exists while
    // the user is still deciding is untouched.
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => !(call.body && 'availability_id' in call.body))).toBe(true);
  });

  it('leaves the card silent on cards when nothing was learned', async () => {
    stubOntopo({ checkoutPage: NO_CARD_PAGE });

    const result = await proposeReservationTool.execute(
      { restaurant: 'Ruben', city: 'Kfar Saba', date: '2026-09-24', time: '20:00' },
      CTX,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal?.summary).not.toMatch(/credit card/i);
    expect(calls).toHaveLength(1);
  });
});
