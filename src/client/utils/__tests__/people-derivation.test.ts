import { describe, it, expect } from 'vitest';
import type { Person } from '../../../shared/interfaces/person';
import { isGap, displayName, unnamedLabel } from '../../../shared/interfaces/person';
import {
  countGaps,
  daysUntilBirthday,
  gapQuestions,
  groupByGeneration,
  upcomingBirthdays,
} from '../people-derivation';

function person(overrides: Partial<Person> = {}): Person {
  // Spread, not `??` per field: `name: null` is a meaningful value here (it is
  // how a gap is recorded), and `overrides.name ?? 'Leah'` would silently name
  // every gap in every test.
  return {
    id: 'p1',
    name: 'Leah',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: null,
    note: null,
    source: 'manual',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('person records', () => {
  it('treats a missing or blank name as a gap, not as a person called ""', () => {
    expect(isGap(person({ name: null }))).toBe(true);
    expect(isGap(person({ name: '   ' }))).toBe(true);
    expect(isGap(person({ name: 'Leah' }))).toBe(false);
  });

  it('labels a gap with the question you would actually ask', () => {
    // "Brother?" rather than "Unknown" — the card is a prompt, so it is phrased
    // as one.
    expect(unnamedLabel(person({ name: null, relationship: 'brother' }))).toBe('Brother?');
    expect(displayName(person({ name: null, relationship: 'best friend' }))).toBe(
      'Best friend?',
    );
    expect(displayName(person({ name: 'Noa' }))).toBe('Noa');
  });
});

describe('groupByGeneration', () => {
  it('puts named people before gaps within a row', () => {
    // So the tree reads "here is what I know, then what I am missing" rather than
    // interleaving the two.
    const rows = groupByGeneration([
      person({ id: 'gap', name: null, relationship: 'brother' }),
      person({ id: 'leah', name: 'Leah' }),
    ]);
    expect(rows.peer.map((p) => p.id)).toEqual(['leah', 'gap']);
  });

  it('keeps every row present even when empty, so the tree can draw four rows', () => {
    const rows = groupByGeneration([]);
    expect(rows).toEqual({ grandparent: [], elder: [], peer: [], younger: [] });
  });

  it('draws grandparents on their own rung, not folded in with her parents', () => {
    const rows = groupByGeneration([
      person({ id: 'miriam', name: 'Miriam', generation: 'grandparent' }),
      person({ id: 'ruth', name: 'Ruth', generation: 'elder' }),
    ]);
    expect(rows.grandparent.map((p) => p.id)).toEqual(['miriam']);
    expect(rows.elder.map((p) => p.id)).toEqual(['ruth']);
  });

  it('falls back rather than dropping a row written by an older build', () => {
    // A stored PERSON# row predating `grandparent` has a generation this build
    // may not recognise. Losing her would be worse than drawing her a rung off.
    const rows = groupByGeneration([
      person({ id: 'legacy', generation: 'ancestor' as never }),
    ]);
    expect(rows.elder.map((p) => p.id)).toEqual(['legacy']);
  });
});

describe('daysUntilBirthday', () => {
  // `now` is built without a `Z`, i.e. in the runner's own zone, because the
  // function reads it with local getters — "today where the user is standing".
  // Pinning it to UTC would make these assertions depend on the runner's offset.
  it('reads a birthday as annual — a March date in August means next March', () => {
    expect(daysUntilBirthday('1994-03-02', new Date('2026-08-22T12:00:00'))).toBe(192);
  });

  it('returns 0 on the day itself rather than 365', () => {
    expect(daysUntilBirthday('1990-06-12', new Date('2026-06-12T23:00:00'))).toBe(0);
  });

  it('reads the birthday itself as a bare calendar date, not as UTC midnight local', () => {
    // `new Date('1990-06-12')` is UTC midnight, which is 11 June in California.
    // The countdown must not be a day out because of where you are standing.
    expect(daysUntilBirthday('1990-06-13', new Date('2026-06-12T12:00:00'))).toBe(1);
  });

  it('rejects an unparseable date instead of rendering NaN days', () => {
    expect(daysUntilBirthday('not a date')).toBeNull();
  });
});

describe('upcomingBirthdays', () => {
  const now = new Date('2026-08-22T09:00:00');

  it('sorts soonest first and drops anyone with no birthday', () => {
    const list = upcomingBirthdays(
      [
        person({ id: 'miriam', name: 'Miriam', birthday: '1962-02-04' }),
        person({ id: 'leah', name: 'Leah', birthday: '1988-09-09' }),
        person({ id: 'nameless', name: 'Ben', birthday: null }),
      ],
      now,
    );
    expect(list.map((entry) => entry.person.id)).toEqual(['leah', 'miriam']);
    expect(list[0].daysUntil).toBe(18);
  });
});

describe('gaps', () => {
  it('counts them and turns each into a question for the composer', () => {
    const people = [
      person({ id: 'leah', name: 'Leah' }),
      person({ id: 'g1', name: null, relationship: 'Brother' }),
      person({ id: 'g2', name: null, relationship: 'Best friend' }),
    ];
    expect(countGaps(people)).toBe(2);
    expect(gapQuestions(people)).toEqual([
      "What's her brother's name?",
      "What's her best friend's name?",
    ]);
  });
});
