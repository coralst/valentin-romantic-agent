import { describe, it, expect } from 'vitest';
import { DEMO_PROFILE_PREFERENCES } from '../demo-profile';
import { resolveField } from '../../../client/utils/preference-field-mapper';
import { PROFILE_FIELD_REGISTRY } from '../../../client/utils/profile-field-registry';

/**
 * Samantha must know everything the panel says she knows.
 *
 * `http-routes.test.ts` asserts the same contract through a seeded session,
 * which is the end-to-end version. This is the unit-level one, and it exists
 * because of the specific way the contract breaks: someone adds a field to the
 * registry, the rail's tally silently goes from "18 of 18" to "18 of 21", and
 * the login flow that was supposed to open on a complete profile now opens on an
 * incomplete one. Reading the fixture directly makes that failure point at the
 * fixture rather than at a route.
 *
 * The registry lives under `src/client/`, which the server may not import at
 * runtime — but a test may, and having the two sides in one assertion is the
 * entire value here.
 */
describe('DEMO_PROFILE_PREFERENCES', () => {
  const resolved = new Map<string, string>();
  for (const pref of DEMO_PROFILE_PREFERENCES) {
    const fieldId = resolveField(pref.category, pref.key);
    if (fieldId) resolved.set(fieldId, pref.value);
  }

  it('fills every field in the registry', () => {
    const missing = PROFILE_FIELD_REGISTRY.filter(
      (field) => !resolved.has(field.id),
    ).map((field) => field.id);

    expect(missing).toEqual([]);
  });

  it('writes no preference that resolves to nothing', () => {
    const unresolved = DEMO_PROFILE_PREFERENCES.filter(
      (pref) => resolveField(pref.category, pref.key) === null,
    ).map((pref) => `${pref.category}:${pref.key}`);

    expect(unresolved).toEqual([]);
  });

  it('writes one preference per field, not two competing for one', () => {
    expect(resolved.size).toBe(DEMO_PROFILE_PREFERENCES.length);
  });

  it('knows her sizes, including the scale they are quoted in', () => {
    // The demo is a gift assistant. A size with no scale ("6") is a fact you
    // cannot act on, so the fixture states both and this pins it.
    for (const id of ['clothing_size', 'shoe_size'] as const) {
      expect(resolved.get(id)).toMatch(/UK|EU|US/);
    }
    expect(resolved.get('ring_size')).toBeTruthy();
  });

  /**
   * The seeded rows must carry the same `fieldId` a live extraction would.
   *
   * The client can reach a field id from `(category, key)` through the registry,
   * so the panel was always right. The *server* cannot: it reads preferences
   * straight out of storage to build Valentin's system prompt, and `fieldId` is
   * the only field it can key on. With it absent, a fully-seeded Samantha looked
   * empty to him — `partnerNameFrom` found no name, so he greeted the visitor as
   * a stranger, and every one of the twenty-one fields was reported to him as
   * "still unknown".
   */
  it('stamps the canonical field id on every row, as extraction does', () => {
    const wrong = DEMO_PROFILE_PREFERENCES.filter(
      (pref) => pref.fieldId !== resolveField(pref.category, pref.key),
    ).map((pref) => `${pref.category}:${pref.key} -> ${String(pref.fieldId)}`);

    expect(wrong).toEqual([]);
  });

  it('names the partner under the id the server looks her up by', () => {
    const name = DEMO_PROFILE_PREFERENCES.find(
      (pref) => pref.fieldId === 'partner_name',
    );
    expect(name?.value).toBe('Samantha');
  });

  it('gives every value a confidence a panel can render', () => {
    for (const pref of DEMO_PROFILE_PREFERENCES) {
      expect(pref.confidence).toBeGreaterThan(0);
      expect(pref.confidence).toBeLessThanOrEqual(1);
    }
  });
});
