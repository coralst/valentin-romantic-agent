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
 * `IntegrationId` of the service behind it and `backing` is a one-element array of
 * the same value, for every row without exception. That is pinned by a test rather
 * than left to drift.
 *
 * {@link IntegrationService.backing} stays optional even though nothing omits it
 * today, because it is what separates a real reach from a drawing and that
 * distinction has to stay expressible. A capability with no `backing` reaches
 * nothing: connecting it records a grant in the browser and nothing else. A
 * capability with `backing` names the services behind it, and the panel asks the
 * server whether those services are actually configured. A row that reads
 * "Connected" while no account was ever contacted is the one thing this surface must
 * not imply — which is exactly why the distinction is data here and not a comment.
 *
 * Every row is backed as of the Spotify merge, so "not built yet" is currently
 * unreachable. Keep it working anyway: it is how the next unbuilt row tells the
 * truth on the day it is added, and deleting the state would mean the honest badge
 * has to be reinvented under deadline.
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
      { label: 'cancel a booking he made', detail: 'Never one you made yourself', reach: 'write' },
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
    /*
     * Real, and the last row that was not.
     *
     * `find_music` searches the catalogue with an app credential and
     * `propose_playlist` writes a private playlist with a user one, so the row has
     * code behind it either way. The two credentials buy different things and the row
     * is honest about the weaker case: with an id and secret but no account,
     * confirming a playlist hands over track links rather than saving, and both the
     * card and the reply say so.
     *
     * This row carried no `backing` for exactly one deployment, because the Spotify
     * server tier lived on an unmerged branch and a catalogue written against `main`
     * could not see it. "Not built yet" was true of the code in front of me and false
     * of the code that existed — which is the same class of mistake as the Wolt rows,
     * arrived at from the opposite direction.
     */
    id: 'spotify',
    name: 'Spotify',
    backing: ['spotify'],
    capability: 'playlists',
    mark: 'spotify',
    blurb: 'Builds the playlist for the drive there.',
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
  /*
   * Amadeus is deliberately absent, and it is the only provider this catalogue
   * leaves out while its server tier stays in the tree.
   *
   * `src/server/integrations/amadeus/` is real code and `CONNECT_RECIPES.amadeus`
   * still describes its key pair — nothing there was deleted, because the flight and
   * hotel search works. What it cannot do is be honest on this page. Amadeus was the
   * one row carrying a `spend` scope and a $400 cap, against a *test sandbox* whose
   * results are representative rather than bookable: the row offered a visitor a
   * money slider for a hold that cannot be placed. Every other row on this page had
   * just been corrected in the opposite direction, and leaving one theatrical cap
   * behind would undo the point of the exercise.
   *
   * Removing the row rather than the scope is the smaller lie. A travel row with the
   * cap stripped out still promises weekends away that this deployment cannot book;
   * no row promises nothing. If the credentials are ever pointed at production
   * Amadeus, the row comes back with its cap and means it.
   */
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
