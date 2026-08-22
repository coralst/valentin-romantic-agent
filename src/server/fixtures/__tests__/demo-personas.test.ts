import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERSONA_ID,
  DEMO_PERSONAS,
  describePersonas,
  resolvePersona,
} from '../demo-personas';
import { DEMO_PROFILE_PREFERENCES } from '../demo-profile';

describe('DEMO_PERSONAS', () => {
  it('offers a populated profile and an empty one', () => {
    const ids = DEMO_PERSONAS.map((persona) => persona.id);

    expect(ids).toContain('samantha');
    expect(ids).toContain('fresh');
  });

  it('gives every persona copy a landing page can render', () => {
    for (const persona of DEMO_PERSONAS) {
      expect(persona.name).toBeTruthy();
      expect(persona.blurb).toBeTruthy();
    }
  });

  it('seeds the whole fixture for Samantha and nothing for a fresh start', () => {
    expect(resolvePersona('samantha').preferences).toHaveLength(
      DEMO_PROFILE_PREFERENCES.length,
    );
    expect(resolvePersona('fresh').preferences).toHaveLength(0);
  });

  it('uses unique ids, so resolvePersona is unambiguous', () => {
    const ids = DEMO_PERSONAS.map((persona) => persona.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolvePersona', () => {
  it('returns the named persona', () => {
    expect(resolvePersona('fresh').name).toBe('Start fresh');
  });

  it('falls back to the default when nothing was asked for', () => {
    // Every pre-persona caller posts an empty body, so this is the common path,
    // not an edge case.
    expect(resolvePersona(undefined).id).toBe(DEFAULT_PERSONA_ID);
  });

  // The id arrives in the body of an unauthenticated endpoint. Throwing would
  // hand a stranger a one-line way to fill the error logs.
  it.each([
    ['an unknown id', 'nobody-by-that-name'],
    ['a number', 42],
    ['null', null],
    ['an object', { id: 'samantha' }],
  ])('falls back to the default on %s', (_label, input) => {
    expect(resolvePersona(input).id).toBe(DEFAULT_PERSONA_ID);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => resolvePersona(Symbol('nope'))).not.toThrow();
  });
});

describe('describePersonas', () => {
  it('reports a field count per persona', () => {
    const described = describePersonas();

    expect(described).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'samantha',
          name: 'Samantha',
          fieldCount: DEMO_PROFILE_PREFERENCES.length,
        }),
        expect.objectContaining({ id: 'fresh', fieldCount: 0 }),
      ]),
    );
  });

  it('carries counts but never the preference values', () => {
    // This feeds the unauthenticated GET /api/config. Anything that leaks in
    // here leaks to everyone.
    //
    // Checked field by field rather than against the whole serialised body: the
    // partner's name legitimately appears as the persona's label, and the
    // nickname "Sam" is a substring of "Samantha" — a body-wide `toContain`
    // fails on a leak that isn't one.
    for (const described of describePersonas()) {
      expect(Object.keys(described).sort()).toEqual([
        'blurb',
        'fieldCount',
        'id',
        'name',
      ]);

      const carriesNoValues = `${described.id} ${described.blurb}`;
      for (const pref of DEMO_PROFILE_PREFERENCES) {
        expect(carriesNoValues).not.toContain(pref.value);
      }
    }
  });

  it('describes exactly the personas that exist', () => {
    expect(describePersonas().map((p) => p.id)).toEqual(
      DEMO_PERSONAS.map((p) => p.id),
    );
  });
});
