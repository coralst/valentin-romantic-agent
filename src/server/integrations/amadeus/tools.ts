import { randomUUID } from 'node:crypto';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';
import {
  OFFER_TTL_MS,
  fetchOffer,
  searchActivities,
  searchHotels,
  type HotelOffer,
} from './client';

/**
 * A night away, and something to do with the afternoon.
 *
 * Amadeus is the "escape the city" half of Valentin: a hotel for an anniversary
 * weekend, and a tour or a tasting to build the day around. Three tools, and
 * only one of them writes.
 *
 * ## Where the write actually stops, and why
 *
 * `propose_hotel_booking` proposes; confirming **re-prices the offer and stops
 * there**. It does not call `POST /v2/booking/hotel-orders`, and that is a
 * decision rather than an omission: that endpoint requires a payment card in the
 * request body. Valentin should never hold card details, should never ask a user
 * to type them into a chat window, and a demo that did would be demonstrating
 * something nobody should ship. So confirmation does the thing a booking flow
 * genuinely does one step earlier — verifies the room is still there at the
 * stated price — and hands the last step to the human.
 *
 * That leaves the confirm step honest and useful: "still available, still
 * ₪1,240, free cancellation until the 3rd" is real information, freshly
 * fetched, and it is the difference between a suggestion and a plan.
 */

/** Amadeus wants `YYYY-MM-DD` and nothing else. */
function parseIsoDate(value: unknown): { iso: string; readable: string } | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();

  // Anchor a bare date to local noon before parsing. `new Date('2026-09-05')` is
  // UTC midnight, which is the 4th in Israel — and a hotel booked for the wrong
  // night is a worse failure than a rejected input.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(bare ? `${text}T12:00:00` : text);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return {
    iso: `${year}-${month}-${day}`,
    readable: parsed.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  };
}

function parseAdults(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.round(value), 1), 9);
}

/** The night after a given ISO date, for when only a check-in was given. */
function nextDay(iso: string): string {
  const parsed = new Date(`${iso}T12:00:00`);
  parsed.setDate(parsed.getDate() + 1);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function money(offer: Pick<HotelOffer, 'total' | 'currency'>): string {
  return offer.currency ? `${offer.total} ${offer.currency}` : offer.total;
}

function describeOffer(offer: HotelOffer): string {
  const cancel = offer.refundable ? 'free cancellation' : 'non-refundable';
  return `${offer.hotelName} — ${money(offer)} total, ${offer.room} (${cancel}) [offer ${offer.offerId}]`;
}

/**
 * Priced rooms for a real stay.
 *
 * Returns the offer ids alongside the prose, because `propose_hotel_booking`
 * needs one and the model has no other way to get it. They are opaque and ugly
 * and must not be read out to the user — the tool description says so.
 */
export const searchHotelsTool: AgentTool = {
  name: 'search_hotels',
  description:
    'Find hotels with real prices for a specific stay — a city, a check-in and ' +
    'a check-out date. Returns the cheapest few offers with the total price, the ' +
    'room type and whether it can be cancelled free. Use this for a night away ' +
    'or a weekend, not for dinner. Each result carries an offer id: keep it for ' +
    'propose_hotel_booking, but never read an offer id out to the user.',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'City name, e.g. "Tel Aviv", "Jerusalem", "Eilat".',
      },
      check_in: { type: 'string', description: 'Arrival date as YYYY-MM-DD, e.g. "2026-09-05".' },
      check_out: {
        type: 'string',
        description: 'Departure date as YYYY-MM-DD, e.g. "2026-09-06". Defaults to one night.',
      },
      adults: { type: 'number', description: 'How many adults. Defaults to 2.' },
    },
    required: ['city', 'check_in'],
  },
  service: 'amadeus',
  requiresConfirmation: false,
  async execute(input) {
    const checkIn = parseIsoDate(input.check_in);
    if (!checkIn) {
      return {
        ok: false,
        summary: `I could not read "${String(input.check_in)}" as a date. Ask which night they mean.`,
      };
    }

    const parsedOut = parseIsoDate(input.check_out);
    const checkOut = parsedOut && parsedOut.iso > checkIn.iso ? parsedOut.iso : nextDay(checkIn.iso);
    const adults = parseAdults(input.adults);
    const city = typeof input.city === 'string' ? input.city.trim() : '';
    if (city === '') {
      return { ok: false, summary: 'No city was given. Ask where they want to go.' };
    }

    const offers = await searchHotels({
      city,
      checkInDate: checkIn.iso,
      checkOutDate: checkOut,
      adults,
    });

    if (offers === null) {
      return {
        ok: false,
        summary:
          `Amadeus did not answer for ${city}. Tell the user you could not check hotels ` +
          `and offer to try again or suggest somewhere by name — do not invent prices.`,
      };
    }

    if (offers.length === 0) {
      return {
        ok: true,
        summary:
          `Amadeus has no rooms listed in ${city} for ${checkIn.readable}. This build ` +
          `runs against Amadeus' test inventory, which does not cover every city — say ` +
          `you could not find anything available rather than that the city is full.`,
        data: { city, offers: [] },
      };
    }

    return {
      ok: true,
      summary:
        `${offers.length} option(s) in ${city} for ${adults} from ${checkIn.readable}: ` +
        `${offers.map(describeOffer).join(' | ')}. Describe one or two in your own words, ` +
        `then use propose_hotel_booking with its offer id if they like it.`,
      data: {
        city,
        checkIn: checkIn.iso,
        checkOut,
        adults,
        offers: offers.map((offer) => ({
          offerId: offer.offerId,
          hotel: offer.hotelName,
          total: offer.total,
          currency: offer.currency,
          room: offer.room,
          refundable: offer.refundable,
        })),
      },
    };
  },
};

/**
 * Something to do, from a commercial tours inventory.
 *
 * Worth knowing what this is not: it is not event discovery. It knows about boat
 * trips and wine tours and knows nothing about a gallery opening on Thursday.
 * The tool description says so plainly so the model does not present a kayak
 * rental as "what's on this weekend".
 */
export const searchActivitiesTool: AgentTool = {
  name: 'search_activities',
  description:
    'Find bookable tours, tastings and experiences in a city — boat trips, food ' +
    'tours, workshops. This is a commercial tours catalogue, not a listing of ' +
    'local events, so do not present its results as "what is on this weekend". ' +
    'Good for building a day around a trip.',
  input_schema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name, e.g. "Tel Aviv".' },
      limit: { type: 'number', description: 'How many to return. Defaults to 5.' },
    },
    required: ['city'],
  },
  service: 'amadeus',
  requiresConfirmation: false,
  async execute(input) {
    const city = typeof input.city === 'string' ? input.city.trim() : '';
    if (city === '') {
      return { ok: false, summary: 'No city was given. Ask where they are going.' };
    }
    const limit =
      typeof input.limit === 'number' && input.limit > 0 ? Math.min(Math.round(input.limit), 10) : 5;

    const activities = await searchActivities(city, limit);
    if (activities === null) {
      return {
        ok: false,
        summary:
          `Amadeus did not answer for activities in ${city}. Say you could not look them ` +
          `up rather than suggesting something you have not verified exists.`,
      };
    }

    if (activities.length === 0) {
      return {
        ok: true,
        summary:
          `Amadeus lists no activities in ${city}. Its test inventory is patchy outside ` +
          `major tourist cities — say you found nothing bookable, and suggest something ` +
          `from the conversation instead.`,
        data: { city, activities: [] },
      };
    }

    return {
      ok: true,
      summary:
        `${activities.length} in ${city}: ` +
        activities
          .map((a) => `${a.name} (${a.price} ${a.currency}) — ${a.description}`)
          .join(' | '),
      data: { city, activities },
    };
  },
};

/**
 * Offer a specific room, and stop.
 *
 * `execute` re-prices the offer before showing a card, for the same reason
 * `propose_reservation` re-checks Ontopo: minutes have passed since the search
 * and a card quoting a price that has moved is worse than no card. `confirm`
 * re-prices again and reports; see the file header for why it deliberately goes
 * no further.
 */
export const proposeHotelBookingTool: AgentTool = {
  name: 'propose_hotel_booking',
  description:
    'Offer the user a specific hotel room from search_hotels. This does NOT book ' +
    'or pay for anything — it shows them a card, and confirming re-checks that ' +
    'the room is still available at that price. They complete the booking and ' +
    'payment themselves; Valentin never handles card details. Never tell the ' +
    'user a hotel is booked.',
  input_schema: {
    type: 'object',
    properties: {
      offer_id: {
        type: 'string',
        description: 'The offer id from search_hotels. Required — do not invent one.',
      },
      occasion: {
        type: 'string',
        description:
          'What the trip is, e.g. "your anniversary weekend". Shown on the card. Brief.',
      },
    },
    required: ['offer_id'],
  },
  service: 'amadeus',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const offerId = typeof input.offer_id === 'string' ? input.offer_id.trim() : '';
    if (offerId === '') {
      return {
        ok: false,
        summary:
          'No offer id was given. Use search_hotels first and pass the offer id it returned.',
      };
    }

    const offer = await fetchOffer(offerId);
    if (!offer) {
      return {
        ok: false,
        summary:
          `That room is no longer available at that price — Amadeus does not recognise the ` +
          `offer any more. Search again and offer them what is there now.`,
      };
    }

    const occasion =
      typeof input.occasion === 'string' && input.occasion.trim()
        ? ` for ${input.occasion.trim()}`
        : '';
    const nights = `${offer.checkInDate} to ${offer.checkOutDate}`;

    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'amadeus',
      title: `${offer.hotelName}, ${nights}`,
      summary:
        `${offer.room} — ${money(offer)} total${occasion}. ` +
        `${offer.refundable ? 'Free cancellation.' : 'Non-refundable.'} ` +
        `Confirming re-checks the room is still there at this price. Nothing is booked ` +
        `and no payment is taken — you finish the booking with the hotel yourself.`,
      expiresAt: new Date(Date.now() + OFFER_TTL_MS).toISOString(),
      // Read back in `confirm`. Never sent to the client.
      payload: {
        offerId: offer.offerId,
        hotelName: offer.hotelName,
        nights,
        total: offer.total,
        currency: offer.currency,
      },
    };

    return {
      ok: true,
      summary:
        `I've put a card in front of them for ${offer.hotelName}, ${nights}, ` +
        `${money(offer)}. Describe the room and be clear that confirming checks ` +
        `availability rather than booking it.`,
      proposal,
      data: { hotel: offer.hotelName, total: offer.total, currency: offer.currency },
    };
  },

  async confirm(proposal): Promise<ToolResult> {
    const payload = proposal.payload ?? {};
    const offerId = typeof payload.offerId === 'string' ? payload.offerId : null;
    const hotelName = typeof payload.hotelName === 'string' ? payload.hotelName : 'the hotel';
    const quotedTotal = typeof payload.total === 'string' ? payload.total : '';
    const currency = typeof payload.currency === 'string' ? payload.currency : '';

    if (!offerId) {
      return {
        ok: false,
        summary:
          `That hotel offer is missing the id needed to re-check it. Apologise and offer ` +
          `to search again.`,
        reply:
          `That hotel offer has lost the id I need to re-check it — I'm sorry. Shall I search ` +
          `again?`,
      };
    }

    const offer = await fetchOffer(offerId);
    if (!offer) {
      return {
        ok: false,
        summary:
          `${hotelName} is no longer holding that room — Amadeus does not recognise the ` +
          `offer any more. Nothing was booked and nothing was charged. Offer to look again.`,
        reply:
          `${hotelName} isn't holding that room any more. Nothing was booked and nothing was ` +
          `charged. Shall I look again?`,
      };
    }

    // The price moving is not a failure, but it must be said out loud. A confirm
    // step that quietly reports a different number than the card showed is the
    // one thing that would make this whole flow untrustworthy.
    const moved = quotedTotal !== '' && offer.total !== quotedTotal;

    return {
      ok: true,
      summary:
        `${hotelName} still has that room for ${offer.checkInDate} to ${offer.checkOutDate}, ` +
        `at ${money(offer)}` +
        (moved ? ` — the price changed from ${quotedTotal} ${currency}, so say so. ` : '. ') +
        `${offer.refundable ? 'Free cancellation.' : 'Non-refundable.'} ` +
        `No payment was taken and nothing is booked: tell them the room is available and ` +
        `that they complete the booking with the hotel themselves.`,
      reply:
        `${hotelName} still has that room, ${offer.checkInDate} to ${offer.checkOutDate}, at ` +
        `${money(offer)}` +
        (moved ? ` — the price has moved from ${quotedTotal} ${currency}. ` : '. ') +
        `${offer.refundable ? 'Free cancellation.' : 'Non-refundable.'} Nothing is booked and ` +
        `no payment was taken — you complete it with the hotel yourself.`,
      data: {
        hotel: hotelName,
        total: offer.total,
        currency: offer.currency,
        refundable: offer.refundable,
        priceChanged: moved,
      },
    };
  },
};

export const amadeusTools: AgentTool[] = [
  searchHotelsTool,
  searchActivitiesTool,
  proposeHotelBookingTool,
];
