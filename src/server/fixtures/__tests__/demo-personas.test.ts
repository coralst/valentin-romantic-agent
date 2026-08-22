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

describe('persona history', () => {
  const samantha = resolvePersona('samantha');

  it('gives Samantha several past conversations plus the current one', () => {
    // Fewer than three and the sidebar still looks freshly minted; more than a
    // handful and a presenter has to scroll to reach the live one.
    expect(samantha.history?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(samantha.history?.length ?? 0).toBeLessThanOrEqual(6);
  });

  it('leaves the fresh persona with no history at all', () => {
    expect(resolvePersona('fresh').history).toBeUndefined();
  });

  it('orders the conversations oldest first, ending with today', () => {
    const ages = (samantha.history ?? []).map((c) => c.daysAgo);

    for (let i = 1; i < ages.length; i += 1) {
      expect(ages[i]).toBeLessThan(ages[i - 1]);
    }
    // The last one is the conversation the seed returns and the profile hangs
    // off, so it has to be the newest.
    expect(ages[ages.length - 1]).toBe(0);
  });

  it('spreads the history over months rather than days', () => {
    const oldest = samantha.history?.[0]?.daysAgo ?? 0;

    expect(oldest).toBeGreaterThan(90);
  });

  it('gives every conversation a sidebar label and a real exchange', () => {
    for (const conversation of samantha.history ?? []) {
      expect(conversation.title.trim()).toBeTruthy();
      expect(conversation.turns.length).toBeGreaterThanOrEqual(4);
      for (const turn of conversation.turns) {
        expect(['user', 'agent']).toContain(turn.sender);
        expect(turn.content.trim()).toBeTruthy();
      }
    }
  });

  it('labels the conversations distinctly, so the sidebar is navigable', () => {
    const titles = (samantha.history ?? []).map((c) => c.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  // The point of the transcript is to be the visible evidence for the profile
  // panel beside it. A contradiction between the two is the one failure a
  // presenter cannot talk their way out of, so the load-bearing values are
  // pinned here rather than left to a reader's eye.
  it('says the same things the profile fixture says', () => {
    const transcript = (samantha.history ?? [])
      .flatMap((c) => c.turns.map((t) => t.content))
      .join('\n');

    const value = (key: string) =>
      DEMO_PROFILE_PREFERENCES.find((pref) => pref.key === key)?.value ?? '';

    expect(transcript).toContain('Samantha');
    expect(transcript).toContain('Sam');
    // Dates are spoken the way a person speaks them, so the ISO values are
    // checked componentwise.
    expect(value('birthday')).toBe('1994-06-12');
    expect(transcript).toContain('12 June 1994');
    expect(value('anniversary')).toBe('2021-09-18');
    expect(transcript).toContain('18 September 2021');
    expect(value('together since')).toBe('2019-03-02');
    expect(transcript).toContain('2 March 2019');

    expect(transcript).toContain(value('zodiac sign'));
    expect(transcript).toContain(value('favorite color'));
    expect(transcript).toContain(value('dream destination'));
    expect(transcript).toContain(value('clothing style'));
    expect(transcript).toContain('brown butter and sage');
    expect(transcript).toContain('close harmonies');
    expect(transcript).toContain('fig, cedar, a little vanilla');
    expect(transcript).toContain('$80');

    // Every hobby and every wish-list item is accounted for out loud.
    for (const list of ['hobbies', 'wish list'] as const) {
      for (const item of value(list).split(',')) {
        expect(transcript.toLowerCase()).toContain(item.trim().toLowerCase());
      }
    }
  });

  it('never mentions a fact the profile does not know', () => {
    // Flowers are the standing example: they are the obvious thing to write into
    // a romantic transcript and there is no flower field in the registry, so a
    // mention would be an assertion the profile panel cannot back up.
    const transcript = (samantha.history ?? [])
      .flatMap((c) => c.turns.map((t) => t.content))
      .join('\n')
      .toLowerCase();

    expect(transcript).not.toContain('favourite flower');
    expect(transcript).not.toContain('favorite flower');
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
