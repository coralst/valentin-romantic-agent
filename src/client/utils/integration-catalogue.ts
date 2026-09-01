/**
 * The services Valentin can be given reach into, and the limits each one comes
 * with.
 *
 * Capability names rather than brand names ("Restaurant booking", not a named
 * booking site) on purpose: the app has no partnership with anybody, and a
 * logo-and-trademark grid would claim one. The category line under each name is
 * what tells the visitor which kind of provider sits behind it.
 *
 * Some of these are now real and some are still aspirational, and {@link
 * IntegrationService.backing} is what separates them. A capability with no
 * `backing` reaches nothing: connecting it records a grant in the browser and
 * nothing else. A capability with `backing` names the services behind it, and the
 * panel asks the server whether those services are actually configured. A row
 * that reads "Connected" while no account was ever contacted is the one thing this
 * surface must not imply — which is exactly why the distinction is data here and
 * not a comment.
 */

import type { IntegrationId } from '../../shared/interfaces/integrations';

/**
 * How far a single permission reaches, which is what decides how loudly the
 * consent sheet has to say it.
 *
 * `read` looks, `write` changes something in the world at no cost, `spend` moves
 * money. Only `spend` scopes are what the cap applies to.
 */
export type IntegrationReach = 'read' | 'write' | 'spend';

export interface IntegrationScope {
  /** Shown verbatim on the card and in the consent sheet. */
  label: string;
  /** One line on what the visitor is actually agreeing to. */
  detail: string;
  reach: IntegrationReach;
}

export interface IntegrationService {
  id: string;
  name: string;
  /**
   * The services that actually carry this capability out, or `undefined` while it
   * is still aspirational.
   *
   * More than one is normal: Messages is Gmail *and* WhatsApp, and a visitor does
   * not care which of the two a nudge went out through. Being an array is also what
   * keeps the panel honest — a capability is only as ready as its least-ready
   * service, so a Messages row with WhatsApp unconfigured must not read "ready".
   */
  backing?: readonly IntegrationId[];
  /** The kind of provider behind the capability, e.g. "flower delivery". */
  category: string;
  /** The glyph shown in the fan-out node and the mobile card. */
  glyph: string;
  /** What connecting it buys you, in Valentin's register. */
  blurb: string;
  scopes: IntegrationScope[];
  /**
   * The cap offered in the consent sheet, in whole USD, or `null` for services
   * that cannot spend — a slider on "create a playlist" is theatre, and theatre
   * around permissions teaches people to click past the real ones.
   */
  defaultCapUsd: number | null;
}

export const INTEGRATION_CATALOGUE: readonly IntegrationService[] = [
  {
    id: 'dining',
    name: 'Restaurant booking',
    backing: ['ontopo'],
    category: 'reservations',
    glyph: '🍽',
    blurb: 'Finds somewhere quiet near her favourites, and holds the table.',
    scopes: [
      { label: 'search restaurants', detail: 'Read-only', reach: 'read' },
      { label: 'offer you a table to confirm', detail: 'The booking only happens once you press Confirm', reach: 'write' },
      { label: 'cancel a booking he made', detail: 'Never one you made yourself', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'calendar',
    name: 'Calendar',
    backing: ['google-calendar'],
    category: 'your own diary',
    glyph: '📅',
    blurb: 'Checks you are actually free before he promises her an evening.',
    scopes: [
      { label: 'read busy / free', detail: 'Times only — not titles, not guests', reach: 'read' },
      { label: 'create events', detail: 'Only events he tells you about in the conversation', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'flowers',
    name: 'Flower delivery',
    category: 'florists',
    glyph: '💐',
    blurb: 'Tulips, not roses — he is the one who remembers which.',
    /*
     * Wolt, and it has been real since the browser tier landed.
     *
     * This entry carried no `backing`, so the panel badged it "not built yet"
     * while `buildToolRegistry` was registering `woltTools` on every boot —
     * `ready.wolt` needs no credential, because Wolt's catalogue endpoint is
     * unauthenticated. The visitor was told a working capability contacts
     * nobody, which is the one direction this panel must never be wrong in.
     *
     * `find_gift_delivery` maps `flowers` to Wolt's `florist` product line, so
     * this row is the same real code as Ontopo behind the dining row.
     */
    backing: ['wolt'],
    /*
     * These scopes used to read "place an order" as a `spend`, with an $80 cap.
     * Neither was ever true, and marking the row live is what made it matter: a
     * visitor reading "live" plus "place an order · $80" concludes Valentin holds a
     * card. He does not. `propose_gift` cannot order and cannot pay — Wolt checkout
     * needs a logged-in account and a stored card, so confirming a gift card opens
     * the shop's own Wolt page and stops there. The human pays Wolt directly.
     *
     * So the reach is `write`, not `spend`, and the cap is null. A slider on a
     * capability that cannot spend is the same theatre as a slider on "create a
     * playlist", and the whole point of this panel is that its limits are real.
     */
    scopes: [
      { label: 'see which florists deliver to you today', detail: "Read-only — Wolt's public catalogue, and no account is needed", reach: 'read' },
      { label: 'offer you a shop to confirm', detail: 'Confirming opens that shop on Wolt, where you choose the bouquet and pay Wolt yourself — he never orders and never pays', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'grocery',
    name: 'Groceries & gifts',
    category: 'retail',
    glyph: '🛒',
    blurb: 'Breakfast in bed, ordered the night before.',
    // The same Wolt tools as the florist row above: `find_gift_delivery` covers
    // `groceries`, `gift`, `wine` and `sweets` as well as `flowers`, so this row
    // was mislabelled "not built yet" for exactly the same reason.
    backing: ['wolt'],
    /*
     * Same correction as the florist row, and the same reason. "Build a basket" and
     * "check out" were both fiction: the Wolt tools read a venue list and hand over
     * a link, so there is no basket anywhere in this codebase to put anything in and
     * nothing that can be charged. Claiming a basket is worse than claiming nothing,
     * because it is specific enough to be believed.
     */
    scopes: [
      { label: 'search what is deliverable near you', detail: "Read-only — Wolt's public catalogue, and no account is needed", reach: 'read' },
      { label: 'offer you a shop to confirm', detail: 'Confirming opens that shop on Wolt, where you fill the basket and pay Wolt yourself — he never checks out', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'music',
    name: 'Music',
    category: 'streaming',
    glyph: '🎵',
    blurb: 'Builds the playlist for the drive there.',
    scopes: [
      { label: 'create playlists', detail: 'He cannot change playlists you made', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'rides',
    name: 'Ride booking',
    category: 'transport',
    glyph: '🚗',
    blurb: 'A car at the door ten minutes before you need one.',
    scopes: [
      { label: 'price a trip', detail: 'Read-only', reach: 'read' },
      { label: 'book the ride', detail: 'Asks you in the conversation first, every time', reach: 'spend' },
    ],
    defaultCapUsd: 40,
  },
  {
    id: 'travel',
    name: 'Travel',
    backing: ['amadeus'],
    category: 'flights & hotels',
    glyph: '✈️',
    blurb: 'Surprise weekends, priced against the cap you set.',
    scopes: [
      { label: 'search flights and rooms', detail: 'Read-only', reach: 'read' },
      { label: 'hold a booking', detail: 'A hold, never a purchase, and always with your yes', reach: 'spend' },
    ],
    defaultCapUsd: 400,
  },
  {
    id: 'messages',
    name: 'Messages',
    backing: ['gmail', 'whatsapp'],
    category: 'email & WhatsApp',
    glyph: '✉️',
    blurb: 'Writes what you want to say. You read it before it goes.',
    scopes: [
      /*
       * This used to read "draft only — he can never send on your behalf", which
       * stopped being true the moment Gmail and WhatsApp were wired up. He does
       * send now; what he cannot do is send unread. Overstating a limit is worse
       * than stating a weaker one, because the visitor calibrates on it.
       */
      { label: 'write the message for you', detail: 'You see the full text before anything is sent', reach: 'write' },
      { label: 'send it once you confirm', detail: 'Only the message on screen, only to the person named on it', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'occasions',
    name: 'Occasions',
    backing: ['hebcal'],
    category: 'the Hebrew calendar',
    glyph: '🕯',
    blurb: 'Knows when Shabbat comes in, and which Hebrew date your anniversary really is.',
    scopes: [
      /*
       * Genuinely read-only and genuinely local: the Hebrew calendar is computed
       * in-process, so this row needs no account and can never be unconfigured.
       * It is here because it is the reason Valentin does not offer an Israeli
       * couple a Friday-night restaurant.
       */
      { label: 'read the Hebrew calendar', detail: 'Computed on the server — no account, nothing sent anywhere', reach: 'read' },
      { label: 'candle-lighting for your city', detail: 'A city name is all it needs', reach: 'read' },
    ],
    defaultCapUsd: null,
  },
] as const;

/** Lookup by id, or `undefined` for an id the catalogue has since dropped. */
export function findIntegration(id: string): IntegrationService | undefined {
  return INTEGRATION_CATALOGUE.find((service) => service.id === id);
}

/**
 * True when real code stands behind this capability.
 *
 * "Live" here means *built*, not *ready* — whether the credentials exist is the
 * server's answer, not the catalogue's, and the two are deliberately separate so a
 * missing refresh token reads as "needs credentials" rather than as a capability
 * that was never written.
 */
export function isLive(service: IntegrationService): boolean {
  return (service.backing?.length ?? 0) > 0;
}

/** True when any of a service's scopes can spend money. */
export function canSpend(service: IntegrationService): boolean {
  return service.scopes.some((scope) => scope.reach === 'spend');
}
