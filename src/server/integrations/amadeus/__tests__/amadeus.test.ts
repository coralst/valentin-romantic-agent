import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config';
import {
  accessToken,
  fetchOffer,
  resetTokenCache,
  resolveCity,
  searchActivities,
  searchHotels,
} from '../client';
import {
  amadeusTools,
  proposeHotelBookingTool,
  searchActivitiesTool,
  searchHotelsTool,
} from '../tools';

/**
 * Amadeus, with `fetch` stubbed throughout.
 *
 * There are no credentials in this repo, so these tests are the only thing
 * asserting the request shapes — which makes what they check deliberate rather
 * than incidental. In particular they pin the two things a live call would
 * otherwise be the first to notice: that the token is cached instead of minted
 * per request, and that the host is never anything but the configured sandbox.
 */

const TOKEN_URL = '/v1/security/oauth2/token';
const HOTELS_BY_GEOCODE = '/reference-data/locations/hotels/by-geocode';
const HOTEL_OFFERS = '/v3/shopping/hotel-offers';
const ACTIVITIES = '/v1/shopping/activities';
const CITIES = '/reference-data/locations/cities';

interface Call {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

let calls: Call[] = [];

/** Respond per-URL. A responder returning undefined becomes a 404. */
function stubFetch(responder: (url: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });

      const payload = responder(url);
      if (payload === undefined) {
        return { ok: false, status: 404, json: async () => ({ errors: [{ status: 404 }] }) };
      }
      return { ok: true, status: 200, json: async () => payload };
    }),
  );
}

const TOKEN_OK = { access_token: 'tok-abc', expires_in: 1799, token_type: 'Bearer' };

/** Two hotels; the second is cheaper, so ordering is observable. */
const HOTELS = {
  data: [
    { hotelId: 'HTLAAA', name: 'Hotel Alpha' },
    { hotelId: 'HTLBBB', name: 'Hotel Beta' },
  ],
};

const OFFERS = {
  data: [
    {
      type: 'hotel-offers',
      hotel: { hotelId: 'HTLAAA', name: 'Hotel Alpha' },
      offers: [
        {
          id: 'OFFER-ALPHA',
          checkInDate: '2026-09-05',
          checkOutDate: '2026-09-06',
          room: { description: { text: 'Deluxe king,   sea view\n\n' }, type: 'DLX' },
          price: { total: '980.00', currency: 'ILS' },
          policies: { cancellations: [{ amount: '0', deadline: '2026-09-03T12:00:00' }] },
        },
      ],
    },
    {
      type: 'hotel-offers',
      hotel: { hotelId: 'HTLBBB', name: 'Hotel Beta' },
      offers: [
        {
          id: 'OFFER-BETA',
          checkInDate: '2026-09-05',
          checkOutDate: '2026-09-06',
          room: { type: 'STANDARD' },
          price: { total: '640.00', currency: 'ILS' },
          policies: { cancellations: [{ type: 'FULL_STAY', amount: '640.00' }] },
        },
      ],
    },
  ],
};

/** The single-resource form of the same endpoint: `data` is an object. */
const SINGLE_OFFER = {
  data: {
    type: 'hotel-offers',
    hotel: { hotelId: 'HTLAAA', name: 'Hotel Alpha' },
    offers: [
      {
        id: 'OFFER-ALPHA',
        checkInDate: '2026-09-05',
        checkOutDate: '2026-09-06',
        room: { description: { text: 'Deluxe king, sea view' } },
        price: { total: '980.00', currency: 'ILS' },
        policies: { cancellations: [{ amount: '0' }] },
      },
    ],
  },
};

const ACTIVITY_DATA = {
  data: [
    {
      id: 'ACT-1',
      name: 'Sunset sail from Jaffa',
      shortDescription: 'Two hours on the water with a bottle of wine.',
      price: { amount: '320.00', currencyCode: 'ILS' },
      bookingLink: 'https://example.test/act-1',
    },
  ],
};

/** The default happy path: every endpoint answers. */
function stubEverything(): void {
  stubFetch((url) => {
    if (url.includes(TOKEN_URL)) return TOKEN_OK;
    if (url.includes(HOTELS_BY_GEOCODE)) return HOTELS;
    if (url.includes(`${HOTEL_OFFERS}/`)) return SINGLE_OFFER;
    if (url.includes(HOTEL_OFFERS)) return OFFERS;
    if (url.includes(ACTIVITIES)) return ACTIVITY_DATA;
    return undefined;
  });
}

const ctx = { sessionId: 'session-1', userId: 'user-1' };

beforeEach(() => {
  calls = [];
  resetTokenCache();
  config.integrations.amadeusClientId = 'client-id';
  config.integrations.amadeusClientSecret = 'client-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.integrations.amadeusClientId = undefined;
  config.integrations.amadeusClientSecret = undefined;
});

describe('accessToken', () => {
  it('posts client credentials as a form body', async () => {
    stubEverything();
    await expect(accessToken()).resolves.toBe('tok-abc');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0].body).toContain('grant_type=client_credentials');
    expect(calls[0].body).toContain('client_id=client-id');
  });

  it('reuses the cached token rather than minting one per request', async () => {
    stubEverything();
    await accessToken();
    await accessToken();
    await accessToken();

    expect(calls.filter((call) => call.url.includes(TOKEN_URL))).toHaveLength(1);
  });

  it('mints a new token once the cached one has expired', async () => {
    // `expires_in: 0` minus the refresh skew lands in the past, so the very next
    // call must go back to the token endpoint.
    stubFetch((url) =>
      url.includes(TOKEN_URL) ? { access_token: 'tok-short', expires_in: 0 } : undefined,
    );

    await accessToken();
    await accessToken();

    expect(calls.filter((call) => call.url.includes(TOKEN_URL))).toHaveLength(2);
  });

  it('returns null, and makes no request, with no credentials configured', async () => {
    config.integrations.amadeusClientId = undefined;
    stubEverything();

    await expect(accessToken()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null when the token endpoint refuses', async () => {
    stubFetch(() => undefined);
    await expect(accessToken()).resolves.toBeNull();
  });

  it('only ever talks to the configured sandbox host', async () => {
    stubEverything();
    await searchHotels({
      city: 'Tel Aviv',
      checkInDate: '2026-09-05',
      checkOutDate: '2026-09-06',
      adults: 2,
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.startsWith(`https://${config.integrations.amadeusHost}/`)).toBe(true);
    }
    expect(config.integrations.amadeusHost).toBe('test.api.amadeus.com');
  });
});

describe('resolveCity', () => {
  it('answers a known Israeli city without a round trip', async () => {
    stubEverything();
    const city = await resolveCity('tel aviv');

    expect(city).toEqual({
      code: 'TLV',
      name: 'Tel Aviv',
      latitude: 32.0853,
      longitude: 34.7818,
    });
    expect(calls.filter((call) => call.url.includes(CITIES))).toHaveLength(0);
  });

  it('accepts an IATA code directly', async () => {
    stubEverything();
    await expect(resolveCity('JRS')).resolves.toMatchObject({ name: 'Jerusalem' });
  });

  it('falls through to reference data for anywhere else', async () => {
    stubFetch((url) => {
      if (url.includes(TOKEN_URL)) return TOKEN_OK;
      if (url.includes(CITIES)) {
        return {
          data: [
            { iataCode: 'PAR', name: 'Paris', geoCode: { latitude: 48.85, longitude: 2.35 } },
          ],
        };
      }
      return undefined;
    });

    await expect(resolveCity('Paris')).resolves.toEqual({
      code: 'PAR',
      name: 'Paris',
      latitude: 48.85,
      longitude: 2.35,
    });
  });

  it('returns null for an empty keyword, and asks nothing', async () => {
    stubEverything();
    await expect(resolveCity('  ')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('searchHotels', () => {
  const query = {
    city: 'Tel Aviv',
    checkInDate: '2026-09-05',
    checkOutDate: '2026-09-06',
    adults: 2,
  };

  it('finds hotel ids first, then prices them', async () => {
    stubEverything();
    const offers = await searchHotels(query);

    const geocode = calls.find((call) => call.url.includes(HOTELS_BY_GEOCODE));
    const priced = calls.find((call) => call.url.includes(`${HOTEL_OFFERS}?`));
    expect(geocode?.url).toContain('latitude=32.0853');
    expect(priced?.url).toContain('hotelIds=HTLAAA%2CHTLBBB');
    expect(priced?.url).toContain('checkInDate=2026-09-05');
    expect(priced?.url).toContain('adults=2');
    expect(offers).toHaveLength(2);
  });

  it('sends the bearer token, not the raw credentials', async () => {
    stubEverything();
    await searchHotels(query);

    const priced = calls.find((call) => call.url.includes(`${HOTEL_OFFERS}?`));
    expect(priced?.headers.authorization).toBe('Bearer tok-abc');
    expect(priced?.url).not.toContain('client-secret');
  });

  it('orders offers cheapest first', async () => {
    stubEverything();
    const offers = await searchHotels(query);

    expect(offers?.map((offer) => offer.offerId)).toEqual(['OFFER-BETA', 'OFFER-ALPHA']);
  });

  it('flattens the room description and collapses its whitespace', async () => {
    stubEverything();
    const offers = await searchHotels(query);

    expect(offers?.find((o) => o.offerId === 'OFFER-ALPHA')?.room).toBe('Deluxe king, sea view');
  });

  it('reads a zero-charge cancellation as refundable and a full-stay one as not', async () => {
    stubEverything();
    const offers = await searchHotels(query);

    expect(offers?.find((o) => o.offerId === 'OFFER-ALPHA')?.refundable).toBe(true);
    expect(offers?.find((o) => o.offerId === 'OFFER-BETA')?.refundable).toBe(false);
  });

  it('returns null when Amadeus cannot be reached', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(searchHotels(query)).resolves.toBeNull();
  });

  it('returns an empty list — not null — when the city has no hotels listed', async () => {
    stubFetch((url) => {
      if (url.includes(TOKEN_URL)) return TOKEN_OK;
      if (url.includes(HOTELS_BY_GEOCODE)) return { data: [] };
      return undefined;
    });

    // Distinguishing these two is the whole point: nothing found is a fact about
    // the sandbox, unreachable is a fault, and the tools say different things.
    await expect(searchHotels(query)).resolves.toEqual([]);
  });
});

describe('fetchOffer', () => {
  it('reads the single-resource shape, where `data` is an object', async () => {
    stubEverything();
    await expect(fetchOffer('OFFER-ALPHA')).resolves.toMatchObject({
      offerId: 'OFFER-ALPHA',
      hotelName: 'Hotel Alpha',
      total: '980.00',
      refundable: true,
    });
  });

  it('url-encodes the offer id', async () => {
    stubEverything();
    await fetchOffer('OFFER/WITH SPACE');

    expect(calls.at(-1)?.url).toContain('OFFER%2FWITH%20SPACE');
  });

  it('returns null when the offer has gone', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(fetchOffer('OFFER-ALPHA')).resolves.toBeNull();
  });
});

describe('searchActivities', () => {
  it('searches around the resolved coordinate', async () => {
    stubEverything();
    const activities = await searchActivities('Tel Aviv');

    expect(calls.at(-1)?.url).toContain('latitude=32.0853');
    expect(activities).toEqual([
      {
        id: 'ACT-1',
        name: 'Sunset sail from Jaffa',
        description: 'Two hours on the water with a bottle of wine.',
        price: '320.00',
        currency: 'ILS',
        bookingLink: 'https://example.test/act-1',
      },
    ]);
  });

  it('returns null when Amadeus does not answer', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(searchActivities('Tel Aviv')).resolves.toBeNull();
  });
});

describe('search_hotels', () => {
  it('defaults to one night and two adults', async () => {
    stubEverything();
    const result = await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: '2026-09-05' }, ctx);

    expect(result.ok).toBe(true);
    const priced = calls.find((call) => call.url.includes(`${HOTEL_OFFERS}?`));
    expect(priced?.url).toContain('checkOutDate=2026-09-06');
    expect(priced?.url).toContain('adults=2');
  });

  it('ignores a check-out that is not after the check-in', async () => {
    stubEverything();
    await searchHotelsTool.execute(
      { city: 'Tel Aviv', check_in: '2026-09-05', check_out: '2026-09-04' },
      ctx,
    );

    const priced = calls.find((call) => call.url.includes(`${HOTEL_OFFERS}?`));
    expect(priced?.url).toContain('checkOutDate=2026-09-06');
  });

  it('does not shift the date across the Israeli midnight', async () => {
    stubEverything();
    await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: '2026-09-05' }, ctx);

    // A bare date parsed as UTC midnight would send the 4th. This is the bug the
    // noon anchor exists to prevent, and it books the wrong night.
    const priced = calls.find((call) => call.url.includes(`${HOTEL_OFFERS}?`));
    expect(priced?.url).toContain('checkInDate=2026-09-05');
  });

  it('rejects an unreadable date without calling Amadeus', async () => {
    stubEverything();
    const result = await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: 'someday' }, ctx);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('tells the model not to invent prices when Amadeus is unreachable', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: '2026-09-05' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('do not invent prices');
  });

  it('blames the sandbox, not the city, when nothing is listed', async () => {
    stubFetch((url) => {
      if (url.includes(TOKEN_URL)) return TOKEN_OK;
      if (url.includes(HOTELS_BY_GEOCODE)) return { data: [] };
      return undefined;
    });
    const result = await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: '2026-09-05' }, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('test inventory');
    // And it must steer the model off the wrong conclusion explicitly — an empty
    // result from the sandbox is not evidence that Tel Aviv has no rooms.
    expect(result.summary).toContain('rather than that the city is full');
  });

  it('returns the offer ids the proposal tool will need', async () => {
    stubEverything();
    const result = await searchHotelsTool.execute({ city: 'Tel Aviv', check_in: '2026-09-05' }, ctx);
    const data = result.data as { offers: Array<{ offerId: string }> };

    expect(data.offers.map((offer) => offer.offerId)).toContain('OFFER-BETA');
  });
});

describe('search_activities', () => {
  it('reports what it found', async () => {
    stubEverything();
    const result = await searchActivitiesTool.execute({ city: 'Tel Aviv' }, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Sunset sail from Jaffa');
  });

  it('says nothing was found rather than suggesting something unverified', async () => {
    stubFetch((url) => {
      if (url.includes(TOKEN_URL)) return TOKEN_OK;
      if (url.includes(ACTIVITIES)) return { data: [] };
      return undefined;
    });
    const result = await searchActivitiesTool.execute({ city: 'Tel Aviv' }, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('no activities');
  });
});

describe('propose_hotel_booking', () => {
  it('re-prices the offer and returns a proposal, booking nothing', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.execute(
      { offer_id: 'OFFER-ALPHA', occasion: 'your anniversary' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal).toBeDefined();
    expect(result.proposal?.service).toBe('amadeus');
    expect(result.proposal?.sessionId).toBe('session-1');
    expect(result.proposal?.title).toContain('Hotel Alpha');
    expect(result.proposal?.summary).toContain('your anniversary');
    // No booking endpoint may be touched before a human says yes — and, in this
    // integration, not after either. See the tools file header.
    expect(calls.some((call) => call.url.includes('booking'))).toBe(false);
  });

  it('carries the offer id server-side rather than on the card', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.execute({ offer_id: 'OFFER-ALPHA' }, ctx);

    expect(result.proposal?.payload).toMatchObject({ offerId: 'OFFER-ALPHA' });
    expect(result.proposal?.summary).not.toContain('OFFER-ALPHA');
  });

  it('sets an expiry in the future', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.execute({ offer_id: 'OFFER-ALPHA' }, ctx);

    expect(new Date(result.proposal!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses without an offer id, and asks nothing of Amadeus', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.execute({}, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('search_hotels');
    expect(calls).toHaveLength(0);
  });

  it('refuses a stale offer instead of showing a card for it', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await proposeHotelBookingTool.execute({ offer_id: 'OFFER-ALPHA' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.proposal).toBeUndefined();
  });
});

describe('propose_hotel_booking confirm', () => {
  const proposal = {
    id: 'p1',
    sessionId: 'session-1',
    service: 'amadeus' as const,
    title: 'Hotel Alpha',
    summary: '',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    payload: {
      offerId: 'OFFER-ALPHA',
      hotelName: 'Hotel Alpha',
      nights: '2026-09-05 to 2026-09-06',
      total: '980.00',
      currency: 'ILS',
    },
  };

  it('re-checks availability and says plainly that nothing was booked', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.confirm!(proposal, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('No payment was taken');
    expect(calls.some((call) => call.url.includes('booking'))).toBe(false);
  });

  it('surfaces a price change rather than quietly reporting a new number', async () => {
    stubFetch((url) => {
      if (url.includes(TOKEN_URL)) return TOKEN_OK;
      if (url.includes(HOTEL_OFFERS)) {
        return {
          data: {
            hotel: { hotelId: 'HTLAAA', name: 'Hotel Alpha' },
            offers: [
              {
                id: 'OFFER-ALPHA',
                checkInDate: '2026-09-05',
                checkOutDate: '2026-09-06',
                room: { type: 'DLX' },
                price: { total: '1180.00', currency: 'ILS' },
                policies: {},
              },
            ],
          },
        };
      }
      return undefined;
    });

    const result = await proposeHotelBookingTool.confirm!(proposal, ctx);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('the price changed from 980.00');
    expect((result.data as { priceChanged: boolean }).priceChanged).toBe(true);
  });

  it('reports nothing charged when the room has gone', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await proposeHotelBookingTool.confirm!(proposal, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('nothing was charged');
  });

  it('fails clearly when the payload lost its offer id', async () => {
    stubEverything();
    const result = await proposeHotelBookingTool.confirm!({ ...proposal, payload: {} }, ctx);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('registration', () => {
  it('exports the three tools, with exactly one that writes', () => {
    expect(amadeusTools.map((tool) => tool.name)).toEqual([
      'search_hotels',
      'search_activities',
      'propose_hotel_booking',
    ]);
    expect(amadeusTools.filter((tool) => tool.requiresConfirmation)).toHaveLength(1);
  });

  it('gives every confirmation-gated tool a confirm handler', () => {
    for (const tool of amadeusTools) {
      expect(typeof tool.confirm === 'function').toBe(tool.requiresConfirmation);
    }
  });

  it('attributes every tool to amadeus', () => {
    for (const tool of amadeusTools) expect(tool.service).toBe('amadeus');
  });
});
