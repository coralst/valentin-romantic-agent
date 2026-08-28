/**
 * The services Valentin can be given reach into, and the limits each one comes
 * with.
 *
 * Capability names rather than brand names ("Restaurant booking", not a named
 * booking site) on purpose: the app has no partnership with anybody, and a
 * logo-and-trademark grid would claim one. The category line under each name is
 * what tells the visitor which kind of provider sits behind it.
 *
 * Nothing here reaches the network. Connecting a service in this build records a
 * grant in the browser and nothing else — the panel says so out loud, because a
 * row that reads "Connected" while no account was ever contacted is the one thing
 * this surface must not imply.
 */

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
    category: 'reservations',
    glyph: '🍽',
    blurb: 'Finds somewhere quiet near her favourites, and holds the table.',
    scopes: [
      { label: 'search restaurants', detail: 'Read-only', reach: 'read' },
      { label: 'book up to 4 seats', detail: 'Larger tables come back to you first', reach: 'write' },
      { label: 'cancel a booking he made', detail: 'Never one you made yourself', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
  {
    id: 'calendar',
    name: 'Calendar',
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
    scopes: [
      { label: 'browse what is in season', detail: 'Read-only', reach: 'read' },
      { label: 'place an order', detail: 'Asks you in the conversation first, every time', reach: 'spend' },
    ],
    defaultCapUsd: 80,
  },
  {
    id: 'grocery',
    name: 'Groceries & gifts',
    category: 'retail',
    glyph: '🛒',
    blurb: 'Breakfast in bed, ordered the night before.',
    scopes: [
      { label: 'search the catalogue', detail: 'Read-only', reach: 'read' },
      { label: 'build a basket', detail: 'Nothing is charged for a basket', reach: 'write' },
      { label: 'check out', detail: 'Asks you in the conversation first, every time', reach: 'spend' },
    ],
    defaultCapUsd: 60,
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
    category: 'messaging',
    glyph: '✉️',
    blurb: 'Drafts what you want to say. You are the one who presses send.',
    scopes: [
      { label: 'draft only', detail: 'He can never send on your behalf', reach: 'write' },
    ],
    defaultCapUsd: null,
  },
] as const;

/** Lookup by id, or `undefined` for an id the catalogue has since dropped. */
export function findIntegration(id: string): IntegrationService | undefined {
  return INTEGRATION_CATALOGUE.find((service) => service.id === id);
}

/** True when any of a service's scopes can spend money. */
export function canSpend(service: IntegrationService): boolean {
  return service.scopes.some((scope) => scope.reach === 'spend');
}
