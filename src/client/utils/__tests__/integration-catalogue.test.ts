import { describe, it, expect } from 'vitest';
import { INTEGRATION_CATALOGUE, canSpend, findIntegration } from '../integration-catalogue';
import { INTEGRATION_IDS, INTEGRATION_LABELS } from '../../../shared/interfaces/integrations';

/*
 * This panel's whole claim is that it tells the truth about what Valentin can
 * reach, so the one bug it must not have is a built capability badged as not
 * built. That is exactly what shipped once: `flowers` and `grocery` carried no
 * `backing`, so both rendered "not built yet" while the server registered
 * `woltTools` on every boot — Wolt's catalogue endpoint is unauthenticated, so
 * `ready.wolt` is unconditionally true.
 *
 * These tests pin the direction that matters. A row with no `backing` tells the
 * visitor it contacts nobody, so adding a service without wiring its row is the
 * failure to catch; the reverse (a row naming a service that does not exist) is
 * caught by the type checker, because `backing` is `IntegrationId[]`.
 */
describe('integration catalogue', () => {
  it('backs the row Wolt actually serves', () => {
    // find_gift_delivery maps `flowers` -> florist and `groceries`/`gift` ->
    // grocery + general_merchandise, which is why this is one row and not two.
    expect(findIntegration('wolt')?.backing).toContain('wolt');
  });

  it('backs every row whose provider exists, and no others', () => {
    const backed = Object.fromEntries(
      INTEGRATION_CATALOGUE.map((service) => [service.id, service.backing ?? []]),
    );

    expect(backed.ontopo).toContain('ontopo');
    expect(backed.hebcal).toContain('hebcal');
    expect(backed['google-calendar']).toContain('google-calendar');
    expect(backed.amadeus).toContain('amadeus');
    expect(backed.wolt).toContain('wolt');
    // Split rows, deliberately: Gmail and WhatsApp have separate readiness and
    // separate credential forms, and the combined row reported "needs credentials"
    // for email that worked.
    expect(backed.gmail).toEqual(['gmail']);
    expect(backed.whatsapp).toEqual(['whatsapp']);

    // Spotify, since `spotifyTools` registers on any deployment holding an app
    // credential — the same correction the Wolt rows needed, made before the row
    // could spend a release badged "not built yet" over working code.
    expect(backed.spotify).toContain('spotify');
  });

  /*
   * The rides row is gone rather than unbacked, and this asserts it stays gone.
   *
   * "Ride booking · not built yet" was a promise with nothing behind it: no
   * provider client, no tool, no credential to supply, and a $40 spend cap on a
   * capability that could not spend. A row a visitor can grant and that then does
   * nothing at all teaches them the rest of the page is decorative too.
   *
   * Spotify used to be the one admitted exception here. It no longer is — the
   * server grew a Spotify client — so the honest assertion is now that *nothing*
   * is unbacked, which is a stronger guarantee than the one it replaces.
   */
  it('lists no capability that was never built', () => {
    const unbacked = INTEGRATION_CATALOGUE.filter(
      (service) => (service.backing?.length ?? 0) === 0,
    );
    expect(unbacked.map((service) => service.id)).toEqual([]);
  });

  /*
   * The music row's counterpart to the Wolt spend assertion above, and the same
   * class of over-claim.
   *
   * Whether a playlist is *saved* depends on a user refresh token being present;
   * with only an app credential, confirming hands over track links. So the row may
   * not promise a created playlist outright — it has to name the confirm step and
   * the condition. Pinned because "offer you a playlist to confirm" is exactly the
   * sort of careful wording a later edit would helpfully shorten to "create
   * playlists", which is the claim that can be false.
   */
  it('does not promise the Spotify row saves a playlist unconditionally', () => {
    const music = findIntegration('spotify');
    expect(music?.backing).toContain('spotify');
    expect(canSpend(music!)).toBe(false);
    expect(music?.defaultCapUsd).toBeNull();

    const write = music?.scopes.find((scope) => scope.reach === 'write');
    expect(write).toBeDefined();
    // Says what confirming does, and that saving is conditional on an account.
    expect(write!.label).toMatch(/confirm/i);
    expect(write!.detail).toMatch(/connected/i);
    expect(write!.detail).toMatch(/link/i);
  });

  it('never names a service id the server does not know', () => {
    for (const service of INTEGRATION_CATALOGUE) {
      for (const id of service.backing ?? []) {
        expect(INTEGRATION_IDS).toContain(id);
      }
    }
  });

  /*
   * One row per provider, which is what lets the row be titled with the provider's
   * name at all. If a future row genuinely spans two services it will fail here,
   * and the fix is to give it a name of its own — not to quietly title it after
   * whichever backing service happens to be first.
   */
  it('is one row per provider, titled with that provider name', () => {
    for (const service of INTEGRATION_CATALOGUE) {
      const backing = service.backing ?? [];
      if (backing.length === 0) continue;
      expect(backing).toHaveLength(1);
      expect(service.id).toBe(backing[0]);
      // The server already owns the human name for each service and sends it on
      // GET /api/integrations. A second spelling here is a second thing to drift.
      expect(service.name).toBe(INTEGRATION_LABELS[backing[0]]);
    }
  });

  it('gives every row a distinct id and a mark', () => {
    const ids = INTEGRATION_CATALOGUE.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const service of INTEGRATION_CATALOGUE) {
      expect(service.mark.length).toBeGreaterThan(0);
      // The line under the provider name is what tells a visitor what "Amadeus"
      // even is, so it is not optional.
      expect(service.capability.length).toBeGreaterThan(0);
    }
  });

  /*
   * `browser` and `events` are real ids the server reports readiness for, but
   * they are deliberately absent from this catalogue: the browser is a transport
   * other rows travel over rather than a destination a visitor connects, and
   * `events` has no card yet. Asserted so that stays a decision rather than an
   * oversight — if a card is added later, this is the line that will fail and
   * ask whether it was meant.
   */
  it('leaves the transport-only ids out of the visitor-facing list', () => {
    const ids = INTEGRATION_CATALOGUE.map((service) => service.id);
    expect(ids).not.toContain('browser');
    expect(ids).not.toContain('events');
  });

  /*
   * The other direction of the same honesty, and the one that bit hardest.
   *
   * Marking the Wolt row live fixed "this reaches nobody" and immediately created a
   * worse claim: "live" beside "place an order · up to $80" tells a visitor Valentin
   * holds a card. He does not, and cannot — `propose_gift` confirms by opening the
   * shop's own Wolt page, because Wolt checkout needs a logged-in account and a
   * stored card that Valentin must never have. So no Wolt-backed row may claim a
   * `spend` scope or carry a cap.
   *
   * Pinned per-service rather than as a comment because the failure mode is a scope
   * label edited in isolation, months from now, by someone who reasonably assumes a
   * delivery capability can buy things.
   */
  it('never claims a Wolt row can spend, because the order is always handed off', () => {
    const woltBacked = INTEGRATION_CATALOGUE.filter((service) =>
      service.backing?.includes('wolt'),
    );

    // If this is empty the assertions below are vacuous, which is its own bug.
    expect(woltBacked.map((service) => service.id)).toEqual(['wolt']);

    for (const service of woltBacked) {
      expect(canSpend(service)).toBe(false);
      expect(service.defaultCapUsd).toBeNull();
      // And the row still has to say what confirming does, or removing the spend
      // claim would just leave the visitor guessing.
      expect(service.scopes.some((scope) => /wolt/i.test(scope.detail))).toBe(true);
    }
  });
});
