import { describe, it, expect } from 'vitest';
import { DEMO_OUTINGS, resolveDemoOutings } from '../demo-outings';
import { outingHistory, placesToAvoid, unratedOutings } from '../../../shared/interfaces/outing';
import { venueBySlug } from '../../integrations/ontopo/venues';

/** 4 September 2026 — fixed, so the point that the dates move with the clock is visible. */
const NOW = Date.UTC(2026, 8, 4);

describe('where he has taken her, as seeded', () => {
  it('gives every outing a distinct id', () => {
    // A duplicate would not fail loudly. It would overwrite, and the card would
    // simply be missing a place.
    const ids = DEMO_OUTINGS.map((outing) => outing.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves exactly one waiting on a verdict, so the survey has somewhere to draw', () => {
    const resolved = resolveDemoOutings(DEMO_OUTINGS, NOW);
    expect(unratedOutings(resolved)).toHaveLength(1);
  });

  it('ships one place worth returning to and one to keep quiet about', () => {
    // The two prompt rules the history block states need one row each to act on.
    // A seed of three unrated rows could demonstrate neither.
    const resolved = resolveDemoOutings(DEMO_OUTINGS, NOW);
    expect(placesToAvoid(resolved)).toHaveLength(1);
    expect(resolved.filter((outing) => (outing.rating ?? 0) >= 4)).toHaveLength(1);
  });

  it('names venues that really are bookable, not fixture-only inventions', () => {
    // The slugs are Ontopo's numeric ids. If one drifts, "you have been here
    // before" can never be demonstrated against a venue the booking flow returns.
    for (const outing of DEMO_OUTINGS) {
      expect(venueBySlug(outing.venueSlug ?? '')?.name).toBe(outing.venueName);
    }
  });

  it('puts every evening in the past, because an outing has happened', () => {
    for (const outing of DEMO_OUTINGS) {
      expect(outing.occurredDaysAgo).toBeGreaterThan(0);
    }
  });

  it('resolves the offsets against the moment it is given', () => {
    const byId = new Map(resolveDemoOutings(DEMO_OUTINGS, NOW).map((o) => [o.id, o]));

    expect(byId.get('demo-outing-brasserie-18')?.occursOn).toBe('2026-08-29');
    expect(byId.get('demo-outing-yaffo')?.occursOn).toBe('2026-07-25');
    expect(byId.get('demo-outing-noema')?.occursOn).toBe('2026-05-31');
  });

  it('confirms each booking before the evening it was for', () => {
    // `confirmedAt` is what both orderings sort on, so it has to be a real
    // instant per row rather than the seed moment three times over.
    for (const outing of resolveDemoOutings(DEMO_OUTINGS, NOW)) {
      expect(outing.confirmedAt.slice(0, 10) < (outing.occursOn ?? '')).toBe(true);
    }
  });

  it('orders newest first once resolved, which is how the card reads', () => {
    const names = outingHistory(resolveDemoOutings(DEMO_OUTINGS, NOW)).map((o) => o.venueName);
    expect(names).toEqual(['Brasserie 18', 'Yaffo Tel Aviv', 'NOEMA']);
  });

  it('stamps ratedAt on the rated pair and leaves it null on the third', () => {
    for (const outing of resolveDemoOutings(DEMO_OUTINGS, NOW)) {
      if (outing.rating === null) expect(outing.ratedAt).toBeNull();
      else expect(typeof outing.ratedAt).toBe('string');
    }
  });

  it('drops the offset field, so nothing downstream sees a fixture-only shape', () => {
    for (const outing of resolveDemoOutings(DEMO_OUTINGS, NOW)) {
      expect('occurredDaysAgo' in outing).toBe(false);
    }
  });
});
