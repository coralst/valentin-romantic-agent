import { randomUUID } from 'node:crypto';
import type { ActionProposal, AgentTool } from '../tool-registry';
import {
  coordsFor,
  describeWoltVenue,
  filterByProductLine,
  matchVenues,
  venuesNear,
  woltCities,
  type WoltVenue,
} from './client';

/**
 * Flowers, gifts and wine, delivered — the three capabilities that were drawings.
 *
 * Two tools, deliberately: one that looks, one that offers. `find_gift_delivery`
 * makes no proposal, because "are there florists in Ra'anana" is a question and
 * putting a confirmation card in front of someone who asked a question is the
 * behaviour this whole layer is built to avoid.
 *
 * **Nothing is ever ordered here.** Wolt's checkout needs a logged-in account and a
 * stored card, and Valentin must never touch payment details — so `propose_gift`
 * hands over a link to the venue's own Wolt page and stops. The human pays Wolt
 * directly. That is not a limitation to be engineered around: it means an
 * unattended agent physically cannot spend anyone's money, which is the strongest
 * form the propose-then-confirm promise can take.
 */

/**
 * What each occasion actually maps to in Wolt's own taxonomy.
 *
 * Keyed on `product_line` rather than on tags. Tags are free text and inconsistent —
 * "grocery" and "groceries" both occur — while `product_line` is what Wolt itself
 * filters on, so `florist` reliably means a florist.
 */
const KIND_TO_PRODUCT_LINES: Record<string, readonly string[]> = {
  flowers: ['florist'],
  wine: ['alcohol'],
  // "A gift" is genuinely several categories, and a chocolate shop is filed under
  // grocery. Ordered so the most gift-like come first in the merged result.
  gift: ['florist', 'general_merchandise', 'alcohol', 'toys_games_and_kids', 'grocery'],
  sweets: ['grocery', 'general_merchandise'],
  groceries: ['grocery'],
};

const KINDS = Object.keys(KIND_TO_PRODUCT_LINES);

/** How many venues to hand the model. Enough to choose from, few enough to read. */
const DEFAULT_LIMIT = 5;

function readKind(value: unknown): string {
  const wanted = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return KIND_TO_PRODUCT_LINES[wanted] ? wanted : 'gift';
}

async function lookUp(
  city: unknown,
  kind: string,
  query: unknown,
  limit: number,
): Promise<
  | { ok: false; summary: string }
  | { ok: true; city: string; venues: WoltVenue[] }
> {
  const where = typeof city === 'string' ? city : '';
  const coords = coordsFor(where);
  if (!coords) {
    return {
      ok: false,
      summary:
        `I do not have a delivery area for "${where || 'nowhere'}". Ask which city, and ` +
        `note that Wolt delivery is covered here for: ${woltCities().join(', ')}.`,
    };
  }

  const all = await venuesNear(coords.lat, coords.lon);
  if (!all) {
    return {
      ok: false,
      summary:
        `Wolt did not answer for ${where}. Say you could not check what is deliverable ` +
        `right now and offer to try again — do not guess what is available.`,
    };
  }

  const ofKind = filterByProductLine(all, KIND_TO_PRODUCT_LINES[kind]);
  const matched = matchVenues(ofKind, typeof query === 'string' ? query : undefined);
  // Falling back to the unfiltered set matters: "roses" matches no florist *name*,
  // and answering "no florists" to that would be wrong when there are three.
  const venues = (matched.length ? matched : ofKind).slice(0, limit);
  return { ok: true, city: where, venues };
}

export const findGiftDeliveryTool: AgentTool = {
  name: 'find_gift_delivery',
  description:
    'Find flowers, wine, chocolates or a gift that can be delivered today in an ' +
    'Israeli city, via Wolt. Returns real shops with delivery estimates and whether ' +
    'they are open right now. Use this when the user wants something sent rather ' +
    'than booked. It only looks — use propose_gift once they have chosen.',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'Which city to deliver in, e.g. "Ra\'anana" or "Tel Aviv".',
      },
      kind: {
        type: 'string',
        description: `What sort of thing: one of ${KINDS.join(', ')}. Defaults to gift.`,
      },
      query: {
        type: 'string',
        description:
          'Optional refinement — a shop name, or words like "roses", "kosher", ' +
          '"chocolate". Omit to see what is nearby.',
      },
      limit: { type: 'number', description: `How many to return. Defaults to ${DEFAULT_LIMIT}.` },
    },
    required: ['city'],
  },
  service: 'wolt',
  requiresConfirmation: false,
  async execute(input) {
    const limit =
      typeof input.limit === 'number' && input.limit > 0
        ? Math.min(Math.round(input.limit), 10)
        : DEFAULT_LIMIT;
    const kind = readKind(input.kind);
    const result = await lookUp(input.city, kind, input.query, limit);
    if (!result.ok) return result;

    if (result.venues.length === 0) {
      return {
        ok: true,
        summary:
          `Nothing delivering ${kind} to ${result.city} on Wolt right now. Say so plainly ` +
          `and offer a different city or a different kind of gift — do not invent a shop.`,
        data: { kind, city: result.city, venues: [] },
      };
    }

    const open = result.venues.filter((v) => v.online);
    return {
      ok: true,
      summary:
        `${result.venues.length} option(s) for ${kind} in ${result.city}: ` +
        `${result.venues.map(describeWoltVenue).join(' | ')}. ` +
        (open.length
          ? `Offer one of the open ones, then use propose_gift.`
          : `All of these are closed right now, so say the delivery would be later.`),
      data: {
        kind,
        city: result.city,
        venues: result.venues.map((v) => ({
          slug: v.slug,
          name: v.name,
          online: v.online,
          etaMinutes: v.estimateMinutes,
          etaRange: v.estimateRange,
          rating: v.rating,
          address: v.address,
          tags: v.tags.slice(0, 5),
        })),
      },
    };
  },
};

export const GIFT_PROPOSAL_TTL_MS = 30 * 60_000;

export const proposeGiftTool: AgentTool = {
  name: 'propose_gift',
  description:
    'Offer to send flowers, wine or a gift from a specific Wolt shop. This does ' +
    'NOT order anything: it shows a card, and confirming opens that shop on Wolt ' +
    'where the user chooses the item and pays. Never say something has been ordered ' +
    'or sent. Use only after find_gift_delivery returned that shop.',
  input_schema: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'The city, as passed to find_gift_delivery.' },
      shop: { type: 'string', description: 'Shop name or slug from find_gift_delivery.' },
      kind: { type: 'string', description: `One of ${KINDS.join(', ')}. Defaults to gift.` },
      occasion: {
        type: 'string',
        description:
          'What it is for, e.g. "your anniversary". Shown on the card so the user ' +
          'sees why. Keep it brief.',
      },
      note: {
        type: 'string',
        description:
          'What to look for in the shop, e.g. "a dozen white roses". Shown on the ' +
          'card as guidance; Valentin cannot put it in the basket.',
      },
    },
    required: ['city', 'shop'],
  },
  service: 'wolt',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const kind = readKind(input.kind);
    const result = await lookUp(input.city, kind, input.shop, 10);
    if (!result.ok) return result;

    const wanted = typeof input.shop === 'string' ? input.shop.trim().toLowerCase() : '';
    const venue =
      result.venues.find((v) => v.slug.toLowerCase() === wanted) ??
      result.venues.find((v) => v.name.toLowerCase().includes(wanted));

    if (!venue) {
      return {
        ok: false,
        summary:
          `"${String(input.shop)}" is not one of the shops delivering to ${result.city}. ` +
          `Use find_gift_delivery and offer something from that result.`,
      };
    }

    const occasion = typeof input.occasion === 'string' && input.occasion.trim()
      ? ` for ${input.occasion.trim()}`
      : '';
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
    const when = venue.online
      ? `about ${venue.estimateRange ?? venue.estimateMinutes} minutes`
      : 'once they reopen';

    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'wolt',
      title: `${venue.name}${occasion}`,
      summary:
        `${note ? `${note} — from ` : 'From '}${venue.name}, delivering in ${when}. ` +
        `Confirming opens their Wolt page, where you pick exactly what you want and ` +
        `pay Wolt. Nothing is ordered until you do.`,
      // The URL is public and stable, so unlike an Ontopo checkout it does not
      // expire — but the card still carries a TTL, because a gift proposal that is
      // half an hour stale is about a conversation that has moved on.
      url: venue.url,
      expiresAt: new Date(Date.now() + GIFT_PROPOSAL_TTL_MS).toISOString(),
      payload: { slug: venue.slug, venueName: venue.name, url: venue.url, kind, note },
    };

    return {
      ok: true,
      summary:
        `I've put a card in front of them for ${venue.name}${occasion}. Tell them what you ` +
        `found and that confirming takes them to Wolt to choose and pay. Do not say it is ordered.`,
      data: { shop: venue.name, kind, etaMinutes: venue.estimateMinutes },
      proposal,
    };
  },

  /**
   * Confirming hands the link over. There is nothing to call.
   *
   * Every other confirm in this layer performs an action; this one cannot, and that
   * is the design rather than a gap. Wolt's basket lives behind a login and a card,
   * so the last step belongs to the human by construction — which is exactly why
   * this capability is safe to have at all.
   */
  async confirm(proposal) {
    const payload = proposal.payload ?? {};
    const url = typeof payload.url === 'string' ? payload.url : null;
    const venueName = typeof payload.venueName === 'string' ? payload.venueName : 'the shop';
    if (!url) {
      return {
        ok: false,
        summary:
          `That gift card is missing the shop link. Apologise and offer to look it up again.`,
      };
    }
    // No `booking` on purpose, even though this confirm knows a venue name.
    // `ToolResult.booking` feeds the outing history — "where you have already
    // taken her" — and it is read back to suggest or avoid places for a date. A
    // florist he had deliver to her door is not somewhere they went, and a survey
    // asking her how the evening at the flower shop was would be nonsense. Gifts
    // belong in gift history, which is a different record and does not exist yet.
    return {
      ok: true,
      summary:
        `Opened ${venueName} on Wolt for them. Tell them to choose what they want there and ` +
        `that Wolt takes the payment — you have not ordered anything.`,
      data: { url },
    };
  },
};

export const woltTools: readonly AgentTool[] = [findGiftDeliveryTool, proposeGiftTool];
