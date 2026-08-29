import { randomUUID } from 'node:crypto';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';
import {
  CHECKOUT_TTL_MS,
  createCheckout,
  fetchAvailability,
  formatSlotTime,
  toOntopoDate,
  toOntopoTime,
  type Availability,
  type OntopoSlot,
} from './client';
import { findVenues, resolveVenueName, type CuratedVenue } from './venues';

/**
 * Booking a table, in three tools that match how the conversation actually goes.
 *
 * `find_restaurants` narrows the room, `check_availability` finds out whether a
 * night works, and `propose_reservation` hands over a link. They are separate
 * because the model needs to be able to stop after any one of them — most
 * exchanges about dinner never reach a booking, and a single do-everything tool
 * would force a proposal card onto someone who was still thinking out loud.
 *
 * Only the third writes anything, and even it writes nothing until confirmed.
 */

/** Parse the date the model supplied into Ontopo's `YYYYMMDD`. */
function parseDate(value: unknown): { ontopo: string; readable: string } | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();

  // Already compact.
  if (/^\d{8}$/.test(text)) {
    const readable = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
    return { ontopo: text, readable };
  }

  // A bare `YYYY-MM-DD` parses as UTC midnight, which is the previous civil day
  // in Israel. Anchor to local noon so the date the model wrote is the date sent.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(bare ? `${text}T12:00:00` : text);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    ontopo: toOntopoDate(parsed),
    readable: parsed.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  };
}

function parseSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.round(value), 1), 20);
}

/** Resolve whatever the model called the venue to a curated entry. */
function resolveVenue(value: unknown): CuratedVenue | undefined {
  if (typeof value !== 'string') return undefined;
  return resolveVenueName(value);
}

/** One line per venue, for the model to quote from. */
function describeVenue(venue: CuratedVenue): string {
  const tags = venue.cuisine.length ? venue.cuisine.join(', ') : venue.vibes.join(', ');
  const where = venue.neighbourhood ? `${venue.neighbourhood}, ${venue.city}` : venue.city;
  return `${venue.name} (${where}; ${tags}) — ${venue.note}`;
}

/** Render a slot grid as prose, distinguishing bookable from merely shown. */
function describeSlots(slots: readonly OntopoSlot[]): string {
  const bookable = slots.filter((slot) => slot.bookable);
  if (bookable.length === 0) return 'nothing bookable';

  // Group by area, because "20:00 inside or 20:30 on the terrace" is a real
  // choice a person cares about and a flat time list throws it away.
  const byArea = new Map<string, string[]>();
  for (const slot of bookable) {
    const label = slot.areaLabel || slot.area || 'main room';
    const times = byArea.get(label) ?? [];
    times.push(formatSlotTime(slot.time));
    byArea.set(label, times);
  }

  return [...byArea.entries()]
    .map(([area, times]) => `${area}: ${times.join(', ')}`)
    .join('; ');
}

/**
 * Narrow the field before checking any dates.
 *
 * Answers from the curated list and makes no network call, which is deliberate:
 * "somewhere romantic in Jaffa" is a question about taste, and asking Ontopo about
 * twenty venues to answer it would be twenty requests to tell the user something
 * the list already knows.
 */
export const findRestaurantsTool: AgentTool = {
  name: 'find_restaurants',
  description:
    'Search the restaurants Valentin can book in Tel Aviv and Jaffa, by mood, ' +
    'cuisine or neighbourhood — "quiet and romantic", "wine bar", "Jaffa", ' +
    '"Italian". Returns names with a short note on each. Use this first when the ' +
    'user has not named a specific place, then check_availability on the one they ' +
    'like. Only these venues are bookable; do not offer a restaurant that is not ' +
    'in the result.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What they are after: a mood, a cuisine, a neighbourhood, or a name. ' +
          'Omit to see the default shortlist.',
      },
      limit: { type: 'number', description: 'How many to return. Defaults to 5.' },
    },
    required: [],
  },
  service: 'ontopo',
  requiresConfirmation: false,
  async execute(input) {
    const limit =
      typeof input.limit === 'number' && input.limit > 0
        ? Math.min(Math.round(input.limit), 10)
        : 5;
    const query = typeof input.query === 'string' ? input.query : undefined;
    const matches = findVenues(query, limit);

    if (matches.length === 0) {
      return {
        ok: true,
        summary:
          `Nothing in the bookable list matches "${String(query)}". Say so rather than ` +
          `inventing a restaurant, and offer to look for something adjacent — the list ` +
          `covers Tel Aviv and Jaffa only.`,
        data: { venues: [] },
      };
    }

    return {
      ok: true,
      summary: `${matches.length} option(s): ${matches.map(describeVenue).join(' | ')}`,
      data: {
        venues: matches.map((venue) => ({
          slug: venue.slug,
          name: venue.name,
          city: venue.city,
          neighbourhood: venue.neighbourhood,
          cuisine: venue.cuisine,
          vibes: venue.vibes,
        })),
      },
    };
  },
};

/**
 * What is actually free, from Ontopo, right now.
 *
 * The time asked for is a centre and not a filter — Ontopo returns a window either
 * side of it — so this tool reports the whole window and lets the model offer
 * 20:30 when 20:00 is gone. That is most of its value: the alternative is a
 * yes/no answer that ends the conversation on a no.
 */
export const checkAvailabilityTool: AgentTool = {
  name: 'check_availability',
  description:
    'Ask Ontopo which tables are actually free at one restaurant on a given ' +
    'date, for a given party size. Returns real bookable times grouped by seating ' +
    'area, including times either side of the one asked for. Always check this ' +
    'before proposing a reservation, and check Shabbat first for a Friday or ' +
    'Saturday — most of these kitchens are closed then.',
  input_schema: {
    type: 'object',
    properties: {
      restaurant: {
        type: 'string',
        description: 'Name of the restaurant, from find_restaurants.',
      },
      date: { type: 'string', description: 'The date, as "2026-09-05".' },
      time: {
        type: 'string',
        description: 'Preferred time, as "20:00". Ontopo returns nearby times too.',
      },
      party_size: { type: 'number', description: 'How many people. Defaults to 2.' },
    },
    required: ['restaurant', 'date'],
  },
  service: 'ontopo',
  requiresConfirmation: false,
  async execute(input) {
    const venue = resolveVenue(input.restaurant);
    if (!venue) {
      return {
        ok: false,
        summary:
          `"${String(input.restaurant)}" is not one of the restaurants Valentin can ` +
          `book. Use find_restaurants and offer something from that list instead of ` +
          `promising this one.`,
      };
    }

    const date = parseDate(input.date);
    if (!date) {
      return {
        ok: false,
        summary: `I could not read "${String(input.date)}" as a date. Ask the user which day they mean.`,
      };
    }

    const time = toOntopoTime(typeof input.time === 'string' ? input.time : '20:00') ?? '2000';
    const size = parseSize(input.party_size);

    const availability = await fetchAvailability(venue.slug, { date: date.ontopo, time, size });
    if (!availability) {
      return {
        ok: false,
        summary:
          `Ontopo did not answer for ${venue.name}. Tell the user you could not check ` +
          `that one and offer to try another restaurant or another night — do not ` +
          `guess whether it is free.`,
      };
    }

    const bookable = availability.slots.filter((slot) => slot.bookable);
    if (bookable.length === 0) {
      return {
        ok: true,
        summary:
          `${venue.name} has nothing bookable for ${size} on ${date.readable} around ` +
          `${formatSlotTime(time)}. Offer a different night, or another restaurant.`,
        data: { venue: venue.name, date: date.readable, slots: [] },
      };
    }

    return {
      ok: true,
      summary:
        `${venue.name} on ${date.readable} for ${size} — ${describeSlots(availability.slots)}. ` +
        `Offer the user a specific time from this list, then use propose_reservation.`,
      data: {
        venue: venue.name,
        slug: venue.slug,
        date: date.readable,
        partySize: size,
        slots: bookable.map((slot) => ({
          time: formatSlotTime(slot.time),
          area: slot.areaLabel || slot.area,
        })),
      },
    };
  },
};

/** Pick the slot the user actually asked for, or say why we cannot. */
function chooseSlot(
  availability: Availability,
  wantedTime: string,
  wantedArea: unknown,
): OntopoSlot | undefined {
  const bookable = availability.slots.filter((slot) => slot.bookable);
  const areaWanted = typeof wantedArea === 'string' ? wantedArea.toLowerCase() : null;

  const matchesArea = (slot: OntopoSlot) =>
    !areaWanted ||
    slot.area.toLowerCase() === areaWanted ||
    slot.areaLabel.toLowerCase() === areaWanted;

  // Exact time in the requested area is the only thing we will book without
  // comment. Anything else and the model has to go back to the user, because
  // silently moving someone's anniversary dinner by half an hour is exactly the
  // kind of helpfulness nobody asked for.
  return bookable.find((slot) => slot.time === wantedTime && matchesArea(slot));
}

/**
 * Offer a table, and stop.
 *
 * This tool deliberately does not touch Ontopo. It checks the slot is real and
 * then returns a proposal; the checkout link is minted in {@link confirm}, once a
 * human has said yes. Minting it here would be worse in two ways — the link would
 * already be burning its fifteen minutes while the user read the card, and
 * Valentin would be holding a live booking page for a decision nobody made.
 *
 * Even after confirmation nothing is reserved. Ontopo holds the table when the
 * human completes the form the link opens, which means Valentin can hand over a
 * working link and still say, accurately, that the table is not yet booked. That
 * happens to be the most honest possible shape for this integration, and it is
 * worth not "improving".
 */
export const proposeReservationTool: AgentTool = {
  name: 'propose_reservation',
  description:
    'Offer the user a specific table at a specific time. This does NOT book ' +
    'anything — it shows them a card to confirm, and only then produces an Ontopo ' +
    'checkout link where they finish the booking themselves. Use only after ' +
    'check_availability returned that exact time. Never tell the user a table is ' +
    'booked or held; say you have found one and it is waiting for them to confirm.',
  input_schema: {
    type: 'object',
    properties: {
      restaurant: { type: 'string', description: 'Name of the restaurant.' },
      date: { type: 'string', description: 'The date, as "2026-09-05".' },
      time: {
        type: 'string',
        description: 'Exact time from check_availability, as "20:30".',
      },
      party_size: { type: 'number', description: 'How many people. Defaults to 2.' },
      area: {
        type: 'string',
        description:
          'Seating area from check_availability, e.g. "Inside", "Outside". Omit ' +
          'to take whichever area has that time.',
      },
      occasion: {
        type: 'string',
        description:
          'What the evening is, e.g. "your anniversary". Shown on the card so the ' +
          'user sees why this night. Keep it brief.',
      },
    },
    required: ['restaurant', 'date', 'time'],
  },
  service: 'ontopo',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const venue = resolveVenue(input.restaurant);
    if (!venue) {
      return {
        ok: false,
        summary: `"${String(input.restaurant)}" is not bookable. Use find_restaurants first.`,
      };
    }

    const date = parseDate(input.date);
    if (!date) {
      return {
        ok: false,
        summary: `I could not read "${String(input.date)}" as a date.`,
      };
    }

    const time = toOntopoTime(typeof input.time === 'string' ? input.time : '');
    if (!time) {
      return {
        ok: false,
        summary:
          `"${String(input.time)}" is not a time I can send to Ontopo. Use a time from ` +
          `check_availability, like "20:30".`,
      };
    }

    const size = parseSize(input.party_size);

    // Re-check rather than trust the earlier call. Minutes have passed and these
    // are popular rooms; proposing a slot that went while the user was talking is
    // the failure this whole tool exists to avoid.
    const availability = await fetchAvailability(venue.slug, { date: date.ontopo, time, size });
    if (!availability || !availability.availabilityId) {
      return {
        ok: false,
        summary:
          `Ontopo did not answer for ${venue.name}, so I cannot offer that table. Tell ` +
          `the user plainly and suggest trying again or another night.`,
      };
    }

    const slot = chooseSlot(availability, time, input.area);
    if (!slot) {
      return {
        ok: true,
        summary:
          `${formatSlotTime(time)} is no longer bookable at ${venue.name}. What is ` +
          `free now: ${describeSlots(availability.slots)}. Offer one of these instead — ` +
          `do not propose the time they asked for.`,
        data: { slots: availability.slots.filter((s) => s.bookable) },
      };
    }

    const areaLabel = slot.areaLabel || slot.area;
    const occasion =
      typeof input.occasion === 'string' && input.occasion.trim()
        ? ` for ${input.occasion.trim()}`
        : '';

    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'ontopo',
      title: `${venue.name}, ${date.readable} at ${formatSlotTime(slot.time)}`,
      summary:
        `Table for ${size}${occasion} — ${areaLabel} at ${venue.name}` +
        `${venue.neighbourhood ? ` in ${venue.neighbourhood}` : ''}. ` +
        `Confirming opens Ontopo's booking page, where you finish the reservation. ` +
        `Nothing is held until you do.`,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
      // Read back in `confirm`. Never sent to the client.
      payload: {
        slug: venue.slug,
        venueName: venue.name,
        date: date.ontopo,
        readableDate: date.readable,
        time: slot.time,
        size,
        area: slot.area,
      },
    };

    return {
      ok: true,
      summary:
        `I've put a card in front of them for ${venue.name}, ${date.readable} at ` +
        `${formatSlotTime(slot.time)}, ${areaLabel}, for ${size}. Tell them what you found ` +
        `and that it needs their confirmation. Do not say it is booked.`,
      proposal,
      data: {
        venue: venue.name,
        time: formatSlotTime(slot.time),
        area: areaLabel,
        partySize: size,
      },
    };
  },

  async confirm(proposal): Promise<ToolResult> {
    const payload = proposal.payload ?? {};
    const slug = typeof payload.slug === 'string' ? payload.slug : null;
    const date = typeof payload.date === 'string' ? payload.date : null;
    const time = typeof payload.time === 'string' ? payload.time : null;
    const area = typeof payload.area === 'string' ? payload.area : null;
    const size = typeof payload.size === 'number' ? payload.size : 2;
    const venueName = typeof payload.venueName === 'string' ? payload.venueName : 'the restaurant';
    const readableDate = typeof payload.readableDate === 'string' ? payload.readableDate : '';

    if (!slug || !date || !time || !area) {
      return {
        ok: false,
        summary:
          `That reservation is missing the details needed to open Ontopo. Apologise and ` +
          `offer to look the table up again.`,
      };
    }

    // Ontopo needs a fresh availability id to mint a checkout, and the one from
    // the proposal is minutes old. Re-searching also re-confirms the slot still
    // exists, so a table taken in the meantime fails here rather than handing
    // over a link to a full restaurant.
    const availability = await fetchAvailability(slug, { date, time, size });
    if (!availability?.availabilityId) {
      return {
        ok: false,
        summary:
          `Ontopo did not answer when I went to open the booking for ${venueName}. ` +
          `Nothing was reserved. Offer to try again.`,
      };
    }

    const stillThere = availability.slots.some(
      (slot) => slot.time === time && slot.area === area && slot.bookable,
    );
    if (!stillThere) {
      return {
        ok: false,
        summary:
          `${formatSlotTime(time)} at ${venueName} was taken before they confirmed. ` +
          `Nothing was reserved. What is free now: ${describeSlots(availability.slots)}. ` +
          `Apologise and offer one of these.`,
      };
    }

    const checkout = await createCheckout(slug, {
      date,
      time,
      size,
      area,
      availabilityId: availability.availabilityId,
    });
    if (!checkout) {
      return {
        ok: false,
        summary:
          `Ontopo would not open a booking page for ${venueName}. Nothing was reserved. ` +
          `Suggest they try again in a moment.`,
      };
    }

    return {
      ok: true,
      summary:
        `Ontopo's booking page is open for ${venueName}${readableDate ? ` on ${readableDate}` : ''} ` +
        `at ${formatSlotTime(time)} for ${size}. Give them the link and be clear that the ` +
        `table is theirs once they finish the form there.`,
      data: { url: checkout.url, venue: venueName, time: formatSlotTime(time) },
    };
  },
};

export const ontopoTools: AgentTool[] = [
  findRestaurantsTool,
  checkAvailabilityTool,
  proposeReservationTool,
];
