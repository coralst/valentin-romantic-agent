import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkoutUrl,
  createCheckout,
  fetchAvailability,
  formatSlotTime,
  toOntopoDate,
  toOntopoTime,
} from '../client';
import {
  checkAvailabilityTool,
  findRestaurantsTool,
  ontopoTools,
  proposeReservationTool,
} from '../tools';
import {
  CURATED_VENUES,
  STYLE_TO_VIBES,
  findVenues,
  resolveVenueName,
  venueBySlug,
  venueCoords,
} from '../venues';
import { RESTAURANT_STYLE_OPTIONS } from '../../../../shared/constants/profile-fields';

/**
 * Ontopo, tested against the shapes the real endpoint actually returned.
 *
 * The fixtures below are trimmed copies of live responses captured while the API
 * was being reverse-engineered, not invented JSON. That matters more here than in
 * most tests: this integration's entire risk is that the payload shape changes,
 * and a fixture someone made up would give false confidence about a shape that was
 * never real. `NOEMA_AVAILABILITY` in particular preserves two details worth
 * keeping — a Hebrew area id, and `disabled` slots mixed in with bookable ones.
 */

const SLUG = '15172114'; // NOEMA, from the curated list.

/**
 * The venue argument `fetchAvailability` now takes.
 *
 * It used to take a bare slug and look the rest up in the curated list, which made
 * that list a hard ceiling: Ontopo would quote tables at a venue and Valentin
 * refused before sending a request. Passing the venue in is what lets a *discovered*
 * one be booked; these tests still use a curated slug so the fixtures are unchanged.
 */
const VENUE = { slug: SLUG, name: 'NOEMA', city: 'Tel Aviv' };

const NOEMA_AVAILABILITY = {
  page: { title: "There's a few seats available for you" },
  areas: [
    {
      id: 'מסעדה',
      name: 'Inside',
      options: [
        { time: '1930', method: 'disabled', score: 4 },
        { time: '2000', method: 'seat', text: 'Book now', score: 1 },
        { time: '2030', method: 'seat', text: 'Book now', score: 2 },
      ],
    },
    {
      id: 'outside',
      name: 'Outside',
      options: [{ time: '2000', method: 'seat', text: 'Book now', score: 3 }],
    },
  ],
  recommended: [{ id: 'מסעדה', time: '2000', method: 'seat' }],
  method: 'seat',
  venue: { slug: '48744296', campaign: null },
  availability_id: '6a9174b28a3792002c557e1e',
};

const NO_TABLES = {
  page: { title: "There's a few seats available for you" },
  areas: [],
  recommended: [],
  availability_id: 'aaa111',
};

/** Capture what was actually POSTed so the payload shape can be asserted. */
let calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }>;

function stubFetch(responder: (call: { body: Record<string, unknown> }) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({
        url: String(url),
        body,
        headers: init.headers as Record<string, string>,
      });
      const result = responder({ body });
      // `text` matters as much as `json`: the client reads the body of a refusal to
      // log the status and a snippet, and a stub without it turned a 400 into a
      // TypeError — the mock disagreeing with `Response`, not the code being wrong.
      if (result === null) {
        return {
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => '{"status":400,"message":"{}"}',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => result,
        text: async () => JSON.stringify(result),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('date and time formatting', () => {
  it('formats a date as YYYYMMDD in the local civil day', () => {
    // Late evening local time is the case `toISOString` gets wrong: it would roll
    // this forward to the 6th in any timezone east of UTC.
    expect(toOntopoDate(new Date(2026, 8, 5, 23, 30))).toBe('20260905');
  });

  it('pads single-digit months and days', () => {
    expect(toOntopoDate(new Date(2026, 0, 3, 12))).toBe('20260103');
  });

  it('compacts a time to HHMM', () => {
    expect(toOntopoTime('20:00')).toBe('2000');
    expect(toOntopoTime('9:30')).toBe('0930');
    expect(toOntopoTime('2045')).toBe('2045');
  });

  it('rejects a time it cannot compact rather than sending something wrong', () => {
    expect(toOntopoTime('half eight')).toBeNull();
    expect(toOntopoTime('25:00')).toBeNull();
    expect(toOntopoTime('20:75')).toBeNull();
  });

  it('renders HHMM back into something a person reads', () => {
    expect(formatSlotTime('2030')).toBe('20:30');
  });

  it('builds the checkout URL the way the site does', () => {
    expect(checkoutUrl('QbnyJrlN2')).toBe('https://ontopo.com/en/checkout/QbnyJrlN2');
    expect(checkoutUrl('QbnyJrlN2', 'he')).toBe('https://ontopo.com/he/checkout/QbnyJrlN2');
  });
});

describe('the curated venue list', () => {
  it('has no duplicate slugs', () => {
    const slugs = CURATED_VENUES.map((venue) => venue.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every venue a numeric slug, a name and a note', () => {
    for (const venue of CURATED_VENUES) {
      expect(venue.slug).toMatch(/^\d+$/);
      expect(venue.name.length).toBeGreaterThan(1);
      expect(venue.note.length).toBeGreaterThan(10);
      expect(venue.vibes.length).toBeGreaterThan(0);
    }
  });

  it('looks a venue up by slug', () => {
    expect(venueBySlug(SLUG)?.name).toBe('NOEMA');
    expect(venueBySlug('does-not-exist')).toBeUndefined();
  });

  it('matches on vibe, cuisine and neighbourhood', () => {
    expect(findVenues('wine').length).toBeGreaterThan(0);
    expect(findVenues('italian').map((v) => v.name)).toContain('Matteo');
    expect(findVenues('jaffa').length).toBeGreaterThan(0);
  });

  it('prefers a venue matching more of the query', () => {
    // "kosher italian" should put the one venue that is both first, rather than
    // returning every Italian and every kosher place in arbitrary order.
    expect(findVenues('kosher italian', 3)[0].name).toBe('Rendez-vous');
  });

  it('returns nothing for a query that matches nothing', () => {
    // Not "everything" — offering a Mexican bar to someone who asked for sushi in
    // Haifa is worse than admitting there is no match.
    expect(findVenues('haifa teppanyaki')).toEqual([]);
  });

  it('returns the default shortlist when asked for nothing', () => {
    expect(findVenues(undefined, 3)).toHaveLength(3);
  });

  it('maps every stored style onto vibes something is actually tagged with', () => {
    // A style whose vibes nothing carries would return an empty shortlist and look
    // like "we have nothing for you" rather than like a broken table.
    for (const style of RESTAURANT_STYLE_OPTIONS) {
      expect(STYLE_TO_VIBES[style].length).toBeGreaterThan(0);
      expect(findVenues(undefined, 5, { style })).not.toHaveLength(0);
    }
  });

  it('ranks the vibe that defines a style above a secondary one', () => {
    const [first] = findVenues(undefined, 5, { style: 'Romantic & quiet' });
    expect(first.vibes).toContain('romantic');
  });

  it('lets a style and a text query both count', () => {
    // "wine bar in jaffa" with style "Wine bar" has to prefer the Jaffa wine bar,
    // which needs the two signals to add rather than one to override the other.
    const [first] = findVenues('jaffa', 5, { style: 'Wine bar' });
    expect(first.city.toLowerCase() === 'tel aviv' || first.city === 'Jaffa').toBe(true);
    expect(first.vibes.some((v) => v === 'wine' || v === 'cocktails')).toBe(true);
  });

  it('drops venues outside the radius', () => {
    // Ra'anana is ~20 km from Tel Aviv, so 5 km reaches nothing and 30 km reaches
    // the list. This is the assertion that makes "within 10 km of me" meaningful.
    const raanana = { lat: 32.1848, lon: 34.8713 };
    expect(findVenues(undefined, 20, { origin: raanana, radiusMetres: 5_000 })).toEqual([]);
    expect(
      findVenues(undefined, 20, { origin: raanana, radiusMetres: 30_000 }).length,
    ).toBeGreaterThan(0);
  });

  it('ignores a radius with nowhere to measure from', () => {
    // Half a filter is worse than none: silently returning nothing would read as
    // "there are no restaurants" rather than "I do not know where you are".
    expect(findVenues(undefined, 3, { radiusMetres: 1_000 })).toHaveLength(3);
  });

  it('excludes a venue whose area has no coordinate rather than assuming one', () => {
    // Every current entry is mapped; this guards the next one added in an area that
    // is not, which must go missing from a radius search instead of passing all of
    // them.
    for (const venue of CURATED_VENUES) {
      expect(venueCoords(venue)).toBeDefined();
    }
    expect(
      venueCoords({ ...CURATED_VENUES[0], city: 'Eilat', neighbourhood: undefined }),
    ).toBeUndefined();
  });

  it('does not let a stopword be the reason something matched', () => {
    // Regression: notes are prose, so when they were searchable the word "the" in
    // "The French Laundry" scored a hit on every venue whose note contained it.
    // A restaurant on another continent then resolved to a bar in Jaffa.
    // "the" carries no information, so a query of nothing but stopwords is
    // treated as no query at all and gets the shortlist — which is the right
    // answer to "somewhere for the two of us". What must not happen is a
    // *scored* match, where one venue wins on a word that means nothing.
    expect(findVenues('the', 3)).toEqual(CURATED_VENUES.slice(0, 3));
    // "the restaurant with the view" still finds the places tagged `view`, and
    // finds them because of that word rather than because of "the".
    expect(findVenues('the restaurant with the view', 3).length).toBeGreaterThan(0);
    for (const venue of findVenues('the restaurant with the view', 3)) {
      expect(venue.vibes).toContain('view');
    }
  });
});

describe('resolveVenueName', () => {
  it('resolves a slug, an exact name and a contained name', () => {
    expect(resolveVenueName(SLUG)?.name).toBe('NOEMA');
    expect(resolveVenueName('hotel montefiore')?.name).toBe('Hotel Montefiore');
    expect(resolveVenueName('Montefiore')?.name).toBe('Hotel Montefiore');
    expect(resolveVenueName('dinner at NOEMA tonight')?.name).toBe('NOEMA');
  });

  it('resolves nothing for a restaurant that is not in the list', () => {
    // The important half. A vibe or a cuisine is not a name, so these must not
    // resolve to "something close enough".
    expect(resolveVenueName('The French Laundry')).toBeUndefined();
    expect(resolveVenueName('somewhere romantic')).toBeUndefined();
    expect(resolveVenueName('italian')).toBeUndefined();
    expect(resolveVenueName('')).toBeUndefined();
  });
});

describe('fetchAvailability', () => {
  it('sends the verified payload shape and no authorization header', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    await fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ontopo.com/api/availability_search');
    expect(calls[0].body).toEqual({
      slug: SLUG,
      locale: 'en',
      // `size` is a string on the wire; a number is rejected.
      criteria: { date: '20260905', time: '2000', size: '2' },
      // Required, but deliberately empty — we do not invent analytics.
      data: {},
    });
    // Availability needs no credential, so sending one would be inventing a
    // dependency the endpoint does not have.
    expect(calls[0].headers).not.toHaveProperty('authorization');
    // A User-Agent is required — the endpoint 400s without one.
    expect(calls[0].headers['user-agent']).toContain('Valentin');
  });

  it('flattens areas into one time-sorted slot list', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 });

    expect(result?.venue.name).toBe('NOEMA');
    expect(result?.availabilityId).toBe('6a9174b28a3792002c557e1e');
    expect(result?.slots.map((slot) => slot.time)).toEqual(['1930', '2000', '2000', '2030']);
  });

  it('marks only method:seat as bookable', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 });

    // 19:30 comes back as `disabled` — shown to the user by Ontopo, but not
    // bookable. Treating it as free is how you promise a table that isn't there.
    expect(result?.slots.find((slot) => slot.time === '1930')?.bookable).toBe(false);
    expect(result?.slots.filter((slot) => slot.bookable)).toHaveLength(3);
  });

  it('keeps a Hebrew area id intact for the round trip', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 });

    // The area id is opaque and frequently Hebrew; it has to go back byte for
    // byte or the checkout call fails.
    expect(result?.slots[0].area).toBe('מסעדה');
    expect(result?.slots[0].areaLabel).toBe('Inside');
  });

  it('returns an empty slot list, not null, when the venue is simply full', async () => {
    stubFetch(() => NO_TABLES);

    const result = await fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 });

    // "Full" and "unreachable" are different answers and the tools say different
    // things about them.
    expect(result).not.toBeNull();
    expect(result?.slots).toEqual([]);
  });

  it('returns null on a non-OK response instead of throwing', async () => {
    stubFetch(() => null);

    await expect(
      fetchAvailability(VENUE, { date: '20260905', time: '2000', size: 2 }),
    ).resolves.toBeNull();
  });

  /*
   * This test used to assert the opposite — that an uncurated slug returned null
   * without making a request — and that assertion was the bug, written down and
   * guarded. Ontopo books Buckaroo in Ra'anana and had tables free on six of the
   * next seven nights; Valentin refused, because five Tel Aviv restaurants were
   * the whole of what it could name. The curated list is a source of *taste*, not
   * a list of what exists, and the request is now sent for any venue a caller can
   * name a slug for.
   */
  it('checks a venue that is not in the curated list, because Ontopo will', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await fetchAvailability(
      { slug: '58310837', name: 'Buckaroo', city: "Ra'anana" },
      { date: '20260905', time: '2000', size: 2 },
    );

    expect(calls).toHaveLength(1);
    expect((calls[0].body as { slug: string }).slug).toBe('58310837');
    // The venue comes back as given, so the caller can say what it asked about
    // rather than looking it up again.
    expect(result?.venue.name).toBe('Buckaroo');
    expect(result?.slots.length).toBeGreaterThan(0);
  });
});

describe('createCheckout', () => {
  it('sends area and availability_id, and singular "area"', async () => {
    stubFetch(() => ({ checkout_id: 'QbnyJrlN2' }));

    const checkout = await createCheckout(SLUG, {
      date: '20260905',
      time: '2000',
      size: 2,
      area: 'מסעדה',
      availabilityId: 'abc123',
    });

    expect(checkout).toEqual({
      checkoutId: 'QbnyJrlN2',
      url: 'https://ontopo.com/en/checkout/QbnyJrlN2',
    });
    // `criteria.areas` (plural) does not exist — the GraphQL layer rejects it by
    // name. This assertion is here because the plural is the natural guess.
    expect(calls[0].body.criteria).toEqual({
      date: '20260905',
      time: '2000',
      size: '2',
      area: 'מסעדה',
    });
    expect(calls[0].body.availability_id).toBe('abc123');
  });

  it('returns null when Ontopo answers without a checkout id', async () => {
    stubFetch(() => ({ areas: [] }));

    await expect(
      createCheckout(SLUG, {
        date: '20260905',
        time: '2000',
        size: 2,
        area: 'x',
        availabilityId: 'abc',
      }),
    ).resolves.toBeNull();
  });
});

describe('find_restaurants', () => {
  it('answers from the list without calling Ontopo', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await findRestaurantsTool.execute({ query: 'wine bar' }, { userId: 'user-1', sessionId: 's1' });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('tells the model to say so rather than invent a restaurant', async () => {
    const result = await findRestaurantsTool.execute(
      { query: 'haifa teppanyaki' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/inventing a restaurant/i);
    expect(result.data).toEqual({ venues: [] });
  });

  it('is read-only', () => {
    expect(findRestaurantsTool.requiresConfirmation).toBe(false);
    expect(findRestaurantsTool.confirm).toBeUndefined();
  });
});

describe('check_availability', () => {
  it('reports real bookable times grouped by area', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'NOEMA', date: '2026-09-05', time: '20:00', party_size: 2 },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Inside: 20:00, 20:30');
    expect(result.summary).toContain('Outside: 20:00');
  });

  it('resolves a partial venue name', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    // The model writes "Montefiore" for "Hotel Montefiore" constantly.
    await checkAvailabilityTool.execute(
      { restaurant: 'Montefiore', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(calls[0].body.slug).toBe('33687997');
  });

  it('does not send a bare date shifted by a timezone', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    await checkAvailabilityTool.execute(
      { restaurant: 'NOEMA', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    // `new Date('2026-09-05')` is UTC midnight, which is 4 September in Israel.
    expect((calls[0].body.criteria as Record<string, unknown>).date).toBe('20260905');
  });

  it('defaults to a party of two at 20:00', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    await checkAvailabilityTool.execute(
      { restaurant: 'NOEMA', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(calls[0].body.criteria).toMatchObject({ time: '2000', size: '2' });
  });

  it('refuses a restaurant that is not bookable', async () => {
    const result = await checkAvailabilityTool.execute(
      { restaurant: 'The French Laundry', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not one of the restaurants/i);
    expect(calls).toHaveLength(0);
  });

  it('says it could not check, rather than guessing, when Ontopo is down', async () => {
    stubFetch(() => null);

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'NOEMA', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/do not\s+guess/i);
  });

  it('offers another night when the venue is full', async () => {
    stubFetch(() => NO_TABLES);

    const result = await checkAvailabilityTool.execute(
      { restaurant: 'NOEMA', date: '2026-09-05' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/nothing bookable/i);
  });
});

describe('propose_reservation', () => {
  const args = {
    restaurant: 'NOEMA',
    date: '2026-09-05',
    time: '20:00',
    party_size: 2,
    area: 'Inside',
    occasion: 'your anniversary',
  };

  it('returns a proposal and books nothing', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 's1' });

    expect(result.ok).toBe(true);
    expect(result.proposal).toBeDefined();
    // One call — the availability re-check. No checkout is minted here, so the
    // link is not already burning its fifteen minutes while the user reads.
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => !('availability_id' in call.body))).toBe(true);
  });

  it('carries the booking details in the server-only payload', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 's1' });

    expect(result.proposal?.payload).toMatchObject({
      slug: SLUG,
      date: '20260905',
      time: '2000',
      size: 2,
      area: 'מסעדה',
    });
  });

  it('tells the user nothing is held', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 's1' });

    expect(result.proposal?.summary).toMatch(/nothing is held/i);
    expect(result.summary).toMatch(/do not say it is booked/i);
  });

  it('scopes the proposal to the session that asked', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 'session-9' });

    expect(result.proposal?.sessionId).toBe('session-9');
  });

  it('expires the proposal in fifteen minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'));
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 's1' });

    expect(result.proposal?.expiresAt).toBe('2026-09-05T10:15:00.000Z');
  });

  it('offers what is free instead when the requested slot has gone', async () => {
    stubFetch(() => NO_TABLES);

    const result = await proposeReservationTool.execute(args, { userId: 'user-1', sessionId: 's1' });

    // Not an error — there is a useful answer to give.
    expect(result.ok).toBe(true);
    expect(result.proposal).toBeUndefined();
    expect(result.summary).toMatch(/no longer bookable/i);
  });

  it('will not propose a slot Ontopo marked disabled', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(
      { ...args, time: '19:30' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.proposal).toBeUndefined();
    expect(result.summary).toMatch(/no longer bookable/i);
  });

  it('honours the requested area rather than substituting another', async () => {
    stubFetch(() => NOEMA_AVAILABILITY);

    const result = await proposeReservationTool.execute(
      { ...args, area: 'Outside' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.proposal?.payload).toMatchObject({ area: 'outside' });
  });

  it('refuses a time it cannot send to Ontopo', async () => {
    const result = await proposeReservationTool.execute(
      { ...args, time: 'sometime after eight' },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('propose_reservation confirm', () => {
  const proposal = {
    id: 'p1',
    sessionId: 's1',
    service: 'ontopo' as const,
    title: 'NOEMA',
    summary: 'Table for 2',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    payload: {
      slug: SLUG,
      venueName: 'NOEMA',
      date: '20260905',
      readableDate: 'Saturday, 5 September',
      time: '2000',
      size: 2,
      area: 'מסעדה',
    },
  };

  it('re-checks availability, then mints the checkout link', async () => {
    stubFetch(({ body }) =>
      'availability_id' in body ? { checkout_id: 'QbnyJrlN2' } : NOEMA_AVAILABILITY,
    );

    const result = await proposeReservationTool.confirm?.(proposal, { userId: 'user-1', sessionId: 's1' });

    expect(result?.ok).toBe(true);
    expect(result?.data).toMatchObject({ url: 'https://ontopo.com/en/checkout/QbnyJrlN2' });
    // Two calls: the fresh availability search, then the checkout mint. The
    // availability id from the proposal is minutes old and Ontopo will not take it.
    expect(calls).toHaveLength(2);
    expect(calls[1].body.availability_id).toBe('6a9174b28a3792002c557e1e');
  });

  it('fails without minting when the table went in the meantime', async () => {
    stubFetch(() => NO_TABLES);

    const result = await proposeReservationTool.confirm?.(proposal, { userId: 'user-1', sessionId: 's1' });

    expect(result?.ok).toBe(false);
    expect(result?.summary).toMatch(/nothing was reserved/i);
    // No second call — we do not try to mint a link for a table that is gone.
    expect(calls).toHaveLength(1);
  });

  it('says nothing was reserved when Ontopo will not open a booking page', async () => {
    stubFetch(({ body }) => ('availability_id' in body ? null : NOEMA_AVAILABILITY));

    const result = await proposeReservationTool.confirm?.(proposal, { userId: 'user-1', sessionId: 's1' });

    expect(result?.ok).toBe(false);
    expect(result?.summary).toMatch(/nothing was reserved/i);
  });

  it('fails clearly when the proposal lost its payload', async () => {
    const result = await proposeReservationTool.confirm?.(
      { ...proposal, payload: undefined },
      { userId: 'user-1', sessionId: 's1' },
    );

    expect(result?.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('registration', () => {
  it('exports the three tools, one of which writes', () => {
    expect(ontopoTools.map((tool) => tool.name)).toEqual([
      'find_restaurants',
      'check_availability',
      'propose_reservation',
    ]);
    expect(ontopoTools.filter((tool) => tool.requiresConfirmation)).toHaveLength(1);
  });

  it('gives every write tool a confirm and every read tool none', () => {
    for (const tool of ontopoTools) {
      expect(tool.service).toBe('ontopo');
      expect(Boolean(tool.confirm)).toBe(tool.requiresConfirmation);
    }
  });
});
