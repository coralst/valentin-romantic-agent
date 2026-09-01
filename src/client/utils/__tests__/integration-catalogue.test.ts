import { describe, it, expect } from 'vitest';
import { INTEGRATION_CATALOGUE, canSpend, findIntegration } from '../integration-catalogue';
import { INTEGRATION_IDS } from '../../../shared/interfaces/integrations';

/*
 * This panel's whole claim is that it tells the truth about what Valentin can
 * reach, so the one bug it must not have is a built capability badged as not
 * built. That is exactly what shipped: `flowers` and `grocery` carried no
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
  it('backs the rows Wolt actually serves', () => {
    // find_gift_delivery maps `flowers` -> florist and `groceries`/`gift` ->
    // grocery + general_merchandise, so both rows are the same real code.
    for (const id of ['flowers', 'grocery']) {
      expect(findIntegration(id)?.backing).toContain('wolt');
    }
  });

  it('backs every row whose provider exists, and no others', () => {
    const backed = Object.fromEntries(
      INTEGRATION_CATALOGUE.map((service) => [service.id, service.backing ?? []]),
    );

    expect(backed.dining).toContain('ontopo');
    expect(backed.occasions).toContain('hebcal');
    expect(backed.calendar).toContain('google-calendar');
    expect(backed.travel).toContain('amadeus');
    expect(backed.messages).toEqual(expect.arrayContaining(['gmail', 'whatsapp']));

    // Genuinely unbuilt: there is no music or rides integration anywhere in
    // src/server/integrations, so "not built yet" is the honest badge and these
    // must stay unbacked until one exists.
    expect(backed.music).toHaveLength(0);
    expect(backed.rides).toHaveLength(0);
  });

  it('never names a service id the server does not know', () => {
    for (const service of INTEGRATION_CATALOGUE) {
      for (const id of service.backing ?? []) {
        expect(INTEGRATION_IDS).toContain(id);
      }
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
   * Marking the Wolt rows live fixed "this reaches nobody" and immediately created a
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
    expect(woltBacked.map((service) => service.id)).toEqual(['flowers', 'grocery']);

    for (const service of woltBacked) {
      expect(canSpend(service)).toBe(false);
      expect(service.defaultCapUsd).toBeNull();
      // And the row still has to say what confirming does, or removing the spend
      // claim would just leave the visitor guessing.
      expect(service.scopes.some((scope) => /wolt/i.test(scope.detail))).toBe(true);
    }
  });
});
