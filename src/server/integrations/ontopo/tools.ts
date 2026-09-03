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
  type BookableVenue,
  type OntopoSlot,
} from './client';
import {
  findVenues,
  isRestaurantStyle,
  resolveVenueName,
  type CuratedVenue,
} from './venues';
import { isGeoPoint, type GeoPoint } from '../../../shared/constants/geo';
import { RESTAURANT_STYLE_OPTIONS } from '../../../shared/constants/profile-fields';
// The one cross-integration import in this file, and only at the tool layer: a
// radius needs a coordinate, and `geocode` is where coordinates come from. `venues.ts`
// stays pure so the bookable list has no dependency on a Maps key.
import { geocode } from '../google-places/client';
import { resolveAnyVenue, venuesInCity, knownCities } from './discovery';
import { completeCheckout, type CheckoutGuest } from './checkout-form';
import { config } from '../../config';
import { logger } from '../../logging';

/**
 * The guest to book under, or null if this deployment should not complete bookings.
 *
 * All four fields or none. A partial identity cannot be submitted — Ontopo's form
 * requires every one of them — and guessing the missing piece is exactly the
 * failure worth avoiding: a reservation with a wrong phone number is one the
 * restaurant cannot confirm and the guest cannot cancel. So an incomplete
 * configuration means the link handoff, which always works.
 */
export function guestForCheckout(): CheckoutGuest | null {
  if (!config.integrations.ontopoAutoComplete) return null;

  const firstName = config.integrations.ontopoGuestFirstName?.trim();
  const lastName = config.integrations.ontopoGuestLastName?.trim();
  const email = config.integrations.ontopoGuestEmail?.trim();
  const phone = config.integrations.ontopoGuestPhone?.trim();

  if (!firstName || !lastName || !email || !phone) return null;
  return { firstName, lastName, email, phone };
}

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

/**
 * Resolve whatever the model called the venue to something bookable.
 *
 * Curated list first, then live discovery from Ontopo's city page. The order is the
 * safety property: the curated entries are instant, need no browser, and carry the
 * notes that let Valentin say *why* a room suits an anniversary, so the common case
 * never depends on a scrape. Discovery is what stops "we do not book there" from
 * being false — Ontopo lists Buckaroo in Ra'anana with tables free most nights, and
 * before this it was refused before a request was ever sent.
 *
 * `city` is what makes the fallback possible at all: Ontopo has no all-Israel
 * listing, only per-city pages, so without a city there is no page to read.
 */
async function resolveVenue(
  value: unknown,
  city: unknown,
): Promise<BookableVenue | undefined> {
  if (typeof value !== 'string') return undefined;
  const curated = resolveVenueName(value);
  if (curated) return curated;
  const where = typeof city === 'string' ? city : undefined;
  return (await resolveAnyVenue(value, where)) ?? undefined;
}

/**
 * Where a venue is, in the finest grain we actually have.
 *
 * Curated entries carry a neighbourhood, which is the more useful thing to say —
 * "in Montefiore" locates a room, "in Tel Aviv" barely narrows it. A discovered
 * venue has only its city, and that still orients someone reading the card.
 */
function placeOf(venue: BookableVenue | CuratedVenue): string | undefined {
  if ('neighbourhood' in venue && venue.neighbourhood) return venue.neighbourhood;
  return venue.city;
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
 * Resolve where "near me" is, without making the radius depend on a Maps key.
 *
 * Explicit coordinates win. Otherwise the city goes through `geocode`, which is
 * cached — and the cache is seeded by `POST /api/session/:id/location` via
 * `rememberCityCoords`, so a user who shared their position gets a working radius
 * even on a deployment with no Places key at all. Only a cold cache needs the
 * network, and a failure there returns `undefined` rather than throwing, so the
 * search degrades to "no radius applied" instead of to an error.
 */
async function resolveNear(input: Record<string, unknown>): Promise<GeoPoint | undefined> {
  const lat = input.lat;
  const lon = input.lon;
  if (typeof lat === 'number' && typeof lon === 'number' && isGeoPoint({ lat, lon })) {
    return { lat, lon };
  }

  const near = typeof input.near === 'string' ? input.near.trim() : '';
  if (!near) return undefined;
  return (await geocode(near)) ?? undefined;
}

/** Kilometres in, metres out, or nothing when the model did not ask for a radius. */
function readRadiusMetres(input: Record<string, unknown>): number | undefined {
  const km = input.radius_km;
  if (typeof km !== 'number' || !Number.isFinite(km) || km <= 0) return undefined;
  // Same ceiling as the stored `search_radius` options top out at.
  return Math.min(Math.round(km * 1000), 50_000);
}

/**
 * Narrow the field before checking any dates.
 *
 * Answers from the curated list and makes no network call unless a radius has to be
 * resolved from a city name, which is deliberate: "somewhere romantic in Jaffa" is a
 * question about taste, and asking Ontopo about twenty venues to answer it would be
 * twenty requests to tell the user something the list already knows.
 *
 * `style` and `radius_km` exist because the profile now stores both. Without them
 * the two answers the user is most likely to want — "the kind of room I said I
 * liked", "close enough to actually go" — would be facts sitting in the dossier that
 * no search could use.
 */
export const findRestaurantsTool: AgentTool = {
  name: 'find_restaurants',
  description:
    'Search the restaurants Valentin can book in Tel Aviv and Jaffa, by mood, ' +
    'cuisine or neighbourhood — "quiet and romantic", "wine bar", "Jaffa", ' +
    '"Italian". Pass style and radius_km when the profile records them, so the ' +
    'shortlist matches what they already told you. Returns names with a short note ' +
    'on each. Use this first when the user has not named a specific place, then ' +
    'check_availability on the one they like. Only these venues are bookable; do ' +
    'not offer a restaurant that is not in the result.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What they are after: a mood, a cuisine, a neighbourhood, or a name. ' +
          'Omit to see the default shortlist.',
      },
      style: {
        type: 'string',
        enum: [...RESTAURANT_STYLE_OPTIONS],
        description:
          'The stored restaurant_style, passed verbatim. Anything else is ignored.',
      },
      near: {
        type: 'string',
        description:
          'The city to measure the radius from — normally their home_city. ' +
          'Required for radius_km unless you pass lat and lon.',
      },
      lat: { type: 'number', description: 'Latitude to measure from, if known.' },
      lon: { type: 'number', description: 'Longitude to measure from, if known.' },
      radius_km: {
        type: 'number',
        description:
          'How far they will travel, from their stored search_radius. Ignored ' +
          'without near or lat/lon.',
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

    const rawStyle = typeof input.style === 'string' ? input.style.trim() : '';
    const style = isRestaurantStyle(rawStyle) ? rawStyle : undefined;

    const radiusMetres = readRadiusMetres(input);
    const origin = radiusMetres === undefined ? undefined : await resolveNear(input);
    // Asked for a radius but we could not work out from where. Searching without it
    // and saying so beats both silently ignoring it and returning nothing.
    const radiusUnresolved = radiusMetres !== undefined && origin === undefined;

    const matches = findVenues(query, limit, { style, origin, radiusMetres });
    const criteria = [
      query ? `"${query}"` : '',
      style ? `style ${style}` : '',
      origin && radiusMetres ? `within ${Math.round(radiusMetres / 1000)} km` : '',
    ]
      .filter(Boolean)
      .join(', ');

    if (matches.length === 0) {
      return {
        ok: true,
        summary:
          `Nothing in the bookable list matches ${criteria || 'that'}. Say so rather ` +
          `than inventing a restaurant, and offer to relax whichever part is the ` +
          `constraint — the list covers Tel Aviv and Jaffa only, so a radius that ` +
          `excludes both excludes everything.`,
        data: { venues: [] },
      };
    }

    const caveat = radiusUnresolved
      ? ' Could not work out where to measure from, so the distance limit was not ' +
        'applied — tell them the list is Tel Aviv and Jaffa rather than implying it ' +
        'was filtered.'
      : '';

    return {
      ok: true,
      summary:
        `${matches.length} option(s)${criteria ? ` for ${criteria}` : ''}: ` +
        `${matches.map(describeVenue).join(' | ')}.${caveat}`,
      data: {
        venues: matches.map((venue) => ({
          slug: venue.slug,
          name: venue.name,
          city: venue.city,
          neighbourhood: venue.neighbourhood,
          cuisine: venue.cuisine,
          vibes: venue.vibes,
        })),
        radiusApplied: !radiusUnresolved && radiusMetres !== undefined,
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
    const venue = await resolveVenue(input.restaurant, input.city);
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

    const availability = await fetchAvailability(venue, { date: date.ontopo, time, size });
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
 * What happens after confirmation depends on how the deployment is configured, and
 * both shapes are honest:
 *
 * - **No guest identity set** (the default) — `confirm` mints the link and stops.
 *   Nothing is reserved; Ontopo holds the table when the human completes the form.
 * - **Guest identity set** — `confirm` also completes that form, and the table is
 *   genuinely booked. See {@link guestForCheckout} and `checkout-form.ts`.
 *
 * This used to be link-only, on the reasoning that the last step belonged to a
 * human. That reasoning conflated two different things: the *authority* to book,
 * and the *typing* required to book. The authority still belongs to the human and
 * is still enforced — `confirm` is unreachable until someone presses Confirm on the
 * proposal card. Only the typing moved. What must never happen is claiming a
 * booking that did not complete, so the summary this returns is driven by whether
 * Ontopo actually showed its confirmation, and the fallback says "not booked".
 */
export const proposeReservationTool: AgentTool = {
  name: 'propose_reservation',
  description:
    'Offer the user a specific table at a specific time. Calling this books ' +
    'NOTHING — it puts a card in front of them, and only their confirmation acts. ' +
    'Use only after check_availability returned that exact time. When you call ' +
    'this, say you have found a table and it is waiting for them to confirm; never ' +
    'say it is booked or held. After they confirm, the result tells you whether the ' +
    'reservation completed or whether they still need to finish it on a link — ' +
    'report exactly what that result says and never upgrade a link into a booking.',
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
    const venue = await resolveVenue(input.restaurant, input.city);
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
    const availability = await fetchAvailability(venue, { date: date.ontopo, time, size });
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
        // A neighbourhood only exists on the curated entries; a discovered venue
        // has its city and nothing finer, and "in Ra'anana" still orients someone.
        `${placeOf(venue) ? ` in ${placeOf(venue)}` : ''}. ` +
        // The card has to promise what confirming will actually do, and that
        // differs by deployment. Saying "nothing is held" where confirming books
        // outright would be the worst possible wording to get wrong.
        (guestForCheckout()
          ? `Confirming books this table with Ontopo and sends you the confirmation. ` +
            `Nothing is held until you confirm.`
          : `Confirming opens Ontopo's booking page, where you finish the reservation. ` +
            `Nothing is held until you do.`),
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
    const availability = await fetchAvailability({ slug, name: venueName }, { date, time, size });
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

    const when = `${readableDate ? ` on ${readableDate}` : ''} at ${formatSlotTime(time)}`;

    /*
     * Finish the form ourselves when we can, and hand over the link when we cannot.
     *
     * `guestForCheckout` returns null unless a full identity is configured, so the
     * default deployment behaves exactly as this tool always has. When it does
     * return one, the reservation is completed here — the authority for that came
     * from the human who pressed Confirm to reach this method at all.
     */
    const guest = guestForCheckout();
    if (guest) {
      const outcome = await completeCheckout(checkout.url, guest);
      if (outcome.booked) {
        return {
          ok: true,
          summary:
            `Booked. ${venueName}${when} for ${size}, under the name ${outcome.guestName}. ` +
            `Ontopo confirmed it and sends the confirmation and the cancellation link by ` +
            `SMS and email. Tell them it is booked, tell them the name the table is under, ` +
            `and mention they can cancel from that message.`,
          data: {
            booked: true,
            venue: venueName,
            time: formatSlotTime(time),
            guestName: outcome.guestName,
            url: checkout.url,
          },
        };
      }

      // Fell short of a confirmation. The link is still live, so this degrades to
      // the handoff rather than to a failure — and it must not claim a booking.
      logger.warn('ontopo.auto-complete-fell-back', {
        venue: venueName,
        cause: (outcome.reason ?? 'unknown').slice(0, 200),
      });
      return {
        ok: true,
        summary:
          `I could not finish the booking form for ${venueName}${when}, so nothing is ` +
          `booked yet — but the page is open and holding. Give them the link and say they ` +
          `need to complete it themselves. Do not say it is booked.`,
        data: {
          booked: false,
          venue: venueName,
          time: formatSlotTime(time),
          url: checkout.url,
          fellBackBecause: outcome.reason,
        },
      };
    }

    return {
      ok: true,
      summary:
        `Ontopo's booking page is open for ${venueName}${when} for ${size}. Give them the ` +
        `link and be clear that the table is theirs once they finish the form there.`,
      data: { booked: false, url: checkout.url, venue: venueName, time: formatSlotTime(time) },
    };
  },
};

export const ontopoTools: AgentTool[] = [
  findRestaurantsTool,
  checkAvailabilityTool,
  proposeReservationTool,
];
