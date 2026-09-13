import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wiring: a confirmed reservation leaves a copy in the inbox.
 *
 * `reservation-email.test.ts` covers what the mail says. This covers whether it is
 * sent at all, on which of `confirm`'s outcomes, and — the part most likely to
 * regress — that a mail which does not go cannot damage the reservation or the
 * sentence reporting it.
 *
 * `sendReservationSummary` is faked rather than driven through Gmail, because the
 * question here is the call and its arguments. Faking it also means the assertions
 * read as the contract between the two modules, which is the thing an edit to either
 * one could break.
 */

const { sendReservationSummary } = vi.hoisted(() => ({
  sendReservationSummary: vi.fn(),
}));
vi.mock('../reservation-email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reservation-email')>()),
  sendReservationSummary,
}));

const { completeCheckout } = vi.hoisted(() => ({ completeCheckout: vi.fn() }));
vi.mock('../checkout-form', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../checkout-form')>()),
  completeCheckout,
}));

import { config } from '../../../config';
import { proposeReservationTool } from '../tools';
import type { ToolContext } from '../../tool-registry';

const SLUG = '15172114'; // NOEMA, from the curated list.
const CTX: ToolContext = { userId: 'user-1', sessionId: 's1' };

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
    place: 'Jaffa Port',
    city: 'Tel Aviv',
    occasion: 'your anniversary',
  },
};

const AVAILABILITY = {
  page: { title: "There's a few seats available for you" },
  areas: [
    {
      id: 'מסעדה',
      name: 'Inside',
      options: [{ time: '2000', method: 'seat', text: 'Book now', score: 1 }],
    },
  ],
  recommended: [{ id: 'מסעדה', time: '2000', method: 'seat' }],
  method: 'seat',
  venue: { slug: SLUG, campaign: null },
  availability_id: '6a9174b28a3792002c557e1e',
};

const NO_TABLES = {
  page: { title: 'Nothing free' },
  areas: [],
  recommended: [],
  availability_id: 'aaa111',
};

/** Answer the availability search, then the checkout mint. */
function stubFetch(availability: unknown = AVAILABILITY) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const result = 'availability_id' in body ? { checkout_id: 'QbnyJrlN2' } : availability;
      return {
        ok: true,
        status: 200,
        json: async () => result,
        text: async () => JSON.stringify(result),
      } as unknown as Response;
    }),
  );
}

type Mutable = Record<string, unknown>;
const GUEST_KEYS = [
  'ontopoAutoComplete',
  'ontopoGuestFirstName',
  'ontopoGuestLastName',
  'ontopoGuestEmail',
  'ontopoGuestPhone',
] as const;
const originalConfig: Mutable = {};

/** Configure a full guest identity, which is what switches on auto-completion. */
function withGuestIdentity() {
  const integrations = config.integrations as unknown as Mutable;
  integrations.ontopoAutoComplete = true;
  integrations.ontopoGuestFirstName = 'Noa';
  integrations.ontopoGuestLastName = 'Shaked';
  integrations.ontopoGuestEmail = 'noa@example.com';
  integrations.ontopoGuestPhone = '0528712774';
}

beforeEach(() => {
  const integrations = config.integrations as unknown as Mutable;
  for (const key of GUEST_KEYS) originalConfig[key] = integrations[key];
  // Off by default, so the bare case is the link handoff every deployment has today.
  integrations.ontopoAutoComplete = false;

  sendReservationSummary.mockReset();
  sendReservationSummary.mockResolvedValue({ sent: true, channel: 'gmail' });
  completeCheckout.mockReset();
  stubFetch();
});

afterEach(() => {
  const integrations = config.integrations as unknown as Mutable;
  for (const [key, value] of Object.entries(originalConfig)) integrations[key] = value;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the proposal carries what the mail needs', () => {
  it('puts the place, the city and the occasion on the payload', async () => {
    const result = await proposeReservationTool.execute(
      {
        restaurant: 'NOEMA',
        date: '2026-09-05',
        time: '20:00',
        party_size: 2,
        occasion: 'your anniversary',
      },
      CTX,
    );

    // `place` is the human line and `city` is what resolves an Ontopo city slug; a
    // neighbourhood in `city` would produce no page link at all.
    expect(result.proposal?.payload).toMatchObject({
      place: 'Jaffa Port',
      city: 'Tel Aviv',
      occasion: 'your anniversary',
    });
  });
});

describe('confirm mails the reservation', () => {
  it('mails a link handoff as not booked, with the details and both links', async () => {
    const result = await proposeReservationTool.confirm?.(proposal, CTX);

    expect(result?.ok).toBe(true);
    expect(sendReservationSummary).toHaveBeenCalledTimes(1);
    expect(sendReservationSummary).toHaveBeenCalledWith(
      {
        venueName: 'NOEMA',
        place: 'Jaffa Port',
        readableDate: 'Saturday, 5 September',
        time: '20:00',
        partySize: 2,
        // Ontopo's display name, not the opaque Hebrew identifier the payload carries.
        area: 'Inside',
        occasion: 'your anniversary',
        booked: false,
        guestName: undefined,
        checkoutUrl: 'https://ontopo.com/en/checkout/QbnyJrlN2',
        venuePageUrl: `https://ontopo.com/en/il/tel-aviv/page/${SLUG}`,
      },
      CTX,
    );
  });

  it('mails a completed booking as booked, under the name it went under', async () => {
    withGuestIdentity();
    completeCheckout.mockResolvedValue({ booked: true, guestName: 'Noa Shaked' });

    const result = await proposeReservationTool.confirm?.(proposal, CTX);

    expect(result?.ok).toBe(true);
    expect(sendReservationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ booked: true, guestName: 'Noa Shaked' }),
      CTX,
    );
  });

  it('mails an auto-complete that fell short as not booked', async () => {
    withGuestIdentity();
    completeCheckout.mockResolvedValue({
      booked: false,
      reason: 'no confirmation shown',
      guestName: 'Noa Shaked',
    });

    await proposeReservationTool.confirm?.(proposal, CTX);

    // The form was not finished, so this is a handoff — and must be mailed as one
    // even though a guest identity exists and Ontopo may have half the form.
    expect(sendReservationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ booked: false }),
      CTX,
    );
  });

  it('mails nothing when nothing was reserved', async () => {
    stubFetch(NO_TABLES);

    const result = await proposeReservationTool.confirm?.(proposal, CTX);

    expect(result?.ok).toBe(false);
    expect(sendReservationSummary).not.toHaveBeenCalled();
  });

  it('still mails a proposal minted before the payload grew its new fields', async () => {
    const legacy = {
      ...proposal,
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

    const result = await proposeReservationTool.confirm?.(legacy, CTX);

    // A card already on someone's screen when this deployed must not break, and the
    // mail degrades to the facts it has rather than refusing to go.
    expect(result?.ok).toBe(true);
    expect(sendReservationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ place: null, occasion: null, venuePageUrl: null }),
      CTX,
    );
  });
});

describe('the mail never damages the reservation', () => {
  it('mentions the inbox only when the mail actually went', async () => {
    const sentResult = await proposeReservationTool.confirm?.(proposal, CTX);
    expect(sentResult?.reply).toContain(`I've emailed you the details.`);

    sendReservationSummary.mockResolvedValue({ sent: false, channel: 'log' });
    const loggedResult = await proposeReservationTool.confirm?.(proposal, CTX);

    expect(loggedResult?.ok).toBe(true);
    expect(loggedResult?.reply).not.toContain('emailed');
    // The link is the whole point of this reply and survives a dark mail channel.
    expect(loggedResult?.reply).toContain('https://ontopo.com/en/checkout/QbnyJrlN2');
  });

  it('keeps a booking that Ontopo confirmed when the mail throws', async () => {
    withGuestIdentity();
    completeCheckout.mockResolvedValue({ booked: true, guestName: 'Noa Shaked' });
    sendReservationSummary.mockRejectedValue(new Error('Gmail exploded'));

    // `sendReservationSummary` is documented never to throw; this proves the caller
    // does not depend on that promise being kept, because the table is already held.
    const result = await proposeReservationTool.confirm?.(proposal, CTX);

    expect(result?.ok).toBe(true);
    expect(result?.reply).toContain('Booked');
    expect(result?.reply).not.toContain('emailed');
  });
});
