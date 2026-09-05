/**
 * The services Valentin can be given reach into, and the limits each one comes
 * with.
 *
 * **One row per provider, named after the provider.** This is a reversal, and the
 * reasoning that produced the old shape is worth keeping because it was not wrong,
 * only outweighed. Rows used to be named for capabilities — "Restaurant booking",
 * "Flower delivery" — so that the panel could not be mistaken for a grid of
 * partner logos, since the app has no partnership with anybody. What that cost was
 * the answer to the question a visitor actually asks in front of a consent sheet:
 * *whose* account is this about to touch. "Messages · email & WhatsApp" hid the
 * fact that pressing Connect posts a Google OAuth secret to this server, and two
 * separate rows ("Flower delivery", "Groceries & gifts") were one Wolt client wearing
 * two hats, so the page claimed nine reaches where seven existed.
 *
 * Naming the provider fixes both, and the endorsement worry is handled where it
 * belongs: the marks in `design-system/brand-marks.tsx` are our drawings rather than
 * trademark assets, and the footer still says in words that nothing here implies a
 * partnership.
 *
 * The consequence for the data is that {@link IntegrationService.id} is now the
 * `IntegrationId` of the service behind it, and `backing` is a one-element array
 * of the same value. That is pinned by a test rather than left to drift.
 *
 * Every row now has `backing`, Spotify included — it was the last aspirational one
 * and `src/server/integrations/spotify` is what retired it. The field still earns
 * its place: `backing` names the services behind a capability, and the panel asks
 * the server whether those services are actually configured. A row that reads
 * "Connected" while no account was ever contacted is the one thing this surface
 * must not imply — which is exactly why readiness is data here and not a comment.
 */

import type { IntegrationId } from '../../shared/interfaces/integrations';
import type { BrandMarkId } from '../design-system/brand-marks';

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
  /**
   * The provider's name, shown as the row's title.
   *
   * For every backed row this must equal `INTEGRATION_LABELS[backing[0]]` — the
   * server already owns the human name for each service and sends it on
   * `GET /api/integrations`, so a second spelling here is a second thing to keep
   * in sync. `integration-catalogue.test.ts` asserts the two agree.
   */
  name: string;
  /**
   * The services that actually carry this capability out, or `undefined` while it
   * is still aspirational.
   *
   * An array rather than a single id, even though every current row has exactly
   * one: a capability is only as ready as its least-ready service, and the
   * readiness fold (`capabilityReadiness`) is what encodes that. Collapsing this
   * to a scalar would have to be undone the first time a row genuinely spans two
   * providers — which is what the old combined Messages row was, and how it came
   * to report "needs credentials" for email that worked.
   */
  backing?: readonly IntegrationId[];
  /**
   * What this provider does for you, in three or four words — the line under the
   * name.
   *
   * This is the half of the old row title that the provider name displaced, and it
   * is load-bearing rather than decorative: "Amadeus" alone means nothing to most
   * visitors, and "flights & hotels" is the whole of what they need.
   */
  capability: string;
  /** Which mark from the design system is drawn beside the name. */
  mark: BrandMarkId;
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
    id: 'ontopo',
    name: 'Ontopo',
    backing: ['ontopo'],
    capability: 'restaurant tables',
    mark: 'ontopo',
    blurb: 'Finds somewhere quiet near her favourites, and holds the table.',
    scopes: [
      { label: 'search restaurants', detail: 'Read-only', reach: 'read' },
      { label: 'offer you a table to confirm', detail: 'The booking only happens once you press Confirm', reach: 'write' },
      /*
       * There was a "cancel a booking he made" scope here, and no cancel tool
       * behind it — Ontopo's integration proposes and books, and that is all.
       * A scope the visitor grants and nothing can exercise is the same lie as a
       * cap on a capability that cannot spend; see `defaultCapUsd`.
       */
    ],
    defaultCapUsd: null,
  },
  /*
   * Its own row rather than a second `backing` on Ontopo's.
   *
   * The two services do sit behind one user-visible job — "somewhere quiet within
   * 10 km" needs Places to find it and Ontopo to book it — and the first draft of
   * this collapsed them into one row for that reason. `integration-catalogue.test.ts`
   * is right to reject that: a row is titled with its provider's name, and a row
   * backed by two providers has no honest title. It also hides the thing a visitor
   * most needs to see, which is that discovery can be dark while booking still
   * works. Two rows say that by themselves.
   *
   * Nothing here is bookable. That is stated in the blurb because it is the one
   * distinction the whole integration layer turns on.
   */
  {
    id: 'google-places',
    name: 'Google Places',
    backing: ['google-places'],
    capability: 'places near you',
    mark: 'google-places',
    blurb: 'Looks for somewhere within reach of you. Nothing here is his to book.',
    scopes: [
      {
        label: 'find places near you',
        detail: 'Read-only — a city or a coordinate is all it needs, and neither is stored',
        reach: 'read',
      },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    backing: ['google-calendar'],
    capability: 'your own diary',
    mark: 'google-calendar',
    blurb: 'Checks you are actually free before he promises her an evening.',
    scopes: [
      { label: 'read busy / free', detail: 'Times only — not titles, not guests', reach: 'read' },
      { label: 'create events', detail: 'Only events he tells you about in the conversation', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    /*
     * One row where there were two.
     *
     * "Flower delivery" and "Groceries & gifts" were the same `find_gift_delivery`
     * tool against the same unauthenticated Wolt catalogue, differing only in the
     * `kind` argument it passes — `florist` for one, `grocery` and
     * `general_merchandise` for the other. As two rows they were two grants, two
     * consent sheets and two "live" badges for one client, which overstated the
     * page's reach and made the fan's spacing worse for nothing.
     */
    id: 'wolt',
    name: 'Wolt',
    backing: ['wolt'],
    // Kept to three words: the node is 190px wide and the Connect affordance sits at
    // its right edge, so a longer line runs under the plus.
    capability: 'flowers, gifts & food',
    mark: 'wolt',
    blurb: 'Tulips, not roses — and breakfast ordered the night before.',
    /*
     * These scopes used to read "place an order" as a `spend`, with an $80 cap.
     * Neither was ever true, and marking the row live is what made it matter: a
     * visitor reading "live" plus "place an order · $80" concludes Valentin holds a
     * card. He does not. `propose_gift` cannot order and cannot pay — Wolt checkout
     * needs a logged-in account and a stored card, so confirming a gift opens the
     * shop's own Wolt page and stops there. The human pays Wolt directly.
     *
     * So the reach is `write`, not `spend`, and the cap is null. A slider on a
     * capability that cannot spend is the same theatre as a slider on "create a
     * playlist", and the whole point of this panel is that its limits are real.
     */
    scopes: [
      { label: 'see what is deliverable to you today', detail: "Read-only — Wolt's public catalogue, and no account is needed", reach: 'read' },
      { label: 'offer you a shop to confirm', detail: 'Confirming opens that shop on Wolt, where you choose the bouquet or fill the basket and pay Wolt yourself — he never orders and never pays', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    capability: 'playlists',
    mark: 'spotify',
    blurb: 'Builds the playlist for the drive there.',
    /*
     * Spotify, and real as of this change.
     *
     * `find_music` searches the catalogue with an app credential and
     * `propose_playlist` writes a private playlist with a user one, so the row
     * has code behind it either way. The two credentials buy different things
     * and the row is honest about the weaker case: with an id and secret but no
     * account, confirming a playlist hands over track links rather than saving,
     * and both the card and the reply say so.
     */
    backing: ['spotify'],
    scopes: [
      {
        label: 'search Spotify for songs she likes',
        detail: "Read-only — the public catalogue, and your listening history is never read",
        reach: 'read',
      },
      {
        /*
         * "create playlists" was the old wording and claimed slightly too much:
         * whether anything is created depends on a Spotify account being
         * connected, and where it isn't, confirming produces a list of links.
         * Naming the confirm step instead of the outcome is the version that
         * cannot become false between one deployment and another.
         */
        label: 'offer you a playlist to confirm',
        detail:
          'Confirming saves it as a private playlist when a Spotify account is connected — ' +
          'otherwise he hands you the songs as links. He never touches playlists you made, ' +
          'and nothing he makes is public',
        reach: 'write',
      },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'amadeus',
    name: 'Amadeus',
    backing: ['amadeus'],
    capability: 'flights & hotels',
    mark: 'amadeus',
    // Not "priced against the cap you set" any more: there is no cap, because
    // there is no purchase — see the re-check scope below.
    blurb: 'Surprise weekends, priced for real before you commit to one.',
    scopes: [
      { label: 'search flights and rooms', detail: 'Read-only', reach: 'read' },
      /*
       * This read "hold a booking", `spend`, against a $400 cap — and Amadeus
       * holds nothing. `proposeHotelBookingTool.confirm` re-prices the offer and
       * stops, deliberately: the booking endpoint wants a payment card in the
       * request body, and Valentin should never hold one. So confirming is a
       * *read* that tells you the room is still there at that price, and the cap
       * governed a purchase that cannot happen.
       */
      { label: 're-check a room is still available at that price', detail: 'No hold, no payment, no card details — you book with the hotel yourself', reach: 'read' },
    ],
    defaultCapUsd: null,
  },
  {
    /*
     * Gmail and WhatsApp were one "Messages" row, and splitting them is a fix
     * rather than a cosmetic change. They are separate readiness ids for a real
     * reason — Gmail needs one OAuth refresh token, WhatsApp needs a Meta business
     * account and pre-approved templates, a review measured in days — so the
     * combined row spent most of its life reporting `partial`, and its consent
     * sheet offered two unrelated credential forms stacked on top of each other.
     * One row per account means the badge is exact and the sheet asks for one
     * thing.
     */
    id: 'gmail',
    name: 'Gmail',
    backing: ['gmail'],
    capability: 'email',
    mark: 'gmail',
    blurb: 'Writes the note you meant to send. You read it before it goes.',
    scopes: [
      /*
       * This used to read "draft only — he can never send on your behalf", which
       * stopped being true the moment Gmail was wired up. He does send now; what he
       * cannot do is send unread. Overstating a limit is worse than stating a
       * weaker one, because the visitor calibrates on it.
       */
      { label: 'write the message for you', detail: 'You see the full text before anything is sent', reach: 'write' },
      { label: 'send it once you confirm', detail: 'Only the message on screen, only to the address named on it', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    backing: ['whatsapp'],
    capability: 'messages',
    mark: 'whatsapp',
    blurb: 'The short one, in the app she actually reads.',
    scopes: [
      { label: 'write the message for you', detail: 'You see the full text before anything is sent', reach: 'write' },
      /*
       * Worth spelling out on this row and not on Gmail's: WhatsApp will only
       * deliver a business-initiated message that matches a template Meta has
       * already approved, so "he can send anything you confirm" would be false here
       * in a way it is not for email.
       */
      { label: 'send it once you confirm', detail: 'Only through a message template WhatsApp has already approved, and only to the number named on it', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    /*
     * Not one provider's row: Tavily and DuckDuckGo are interchangeable tiers
     * behind the same two read-only tools, and the visitor is granting "he may
     * look things up on the web", not an account with either engine. That is why
     * the title is the capability itself — the same footing as the Hebrew
     * calendar row — and why there is no credential to connect.
     */
    id: 'web-search',
    name: 'Web search',
    backing: ['web-search'],
    capability: 'ideas from the web',
    mark: 'web-search',
    blurb: 'Finds the date ideas no catalogue has — events, articles, hidden spots.',
    scopes: [
      { label: 'search the web', detail: 'Read-only — public search results, no account involved', reach: 'read' },
      { label: 'read a page for details', detail: 'Read-only — he never fills a form, logs in, or buys anything', reach: 'read' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'hebcal',
    name: 'Hebrew calendar',
    backing: ['hebcal'],
    capability: 'Shabbat & holidays',
    mark: 'hebcal',
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
