import { describe, it, expect } from 'vitest';
import { PROFILE_FIELD_IDS } from '../../../shared/constants/profile-fields';
import {
  buildSystemPrompt,
  partnerNameFrom,
  EXTRACT_PREFERENCES_TOOL,
  VALENTIN_SYSTEM_PROMPT,
  type KnownFact,
} from '../prompts';
import type { Outing } from '../../../shared/interfaces/outing';

const samantha: KnownFact[] = [
  { key: 'partner_name', fieldId: 'partner_name', value: 'Samantha' },
  { key: 'favorite_cuisine', fieldId: 'favorite_cuisine', value: 'Northern Italian' },
  { key: 'shellfish_allergy', fieldId: null, value: 'allergic to shellfish' },
];

describe('VALENTIN_SYSTEM_PROMPT', () => {
  it('names both goals, so he has a job after the profile is complete', () => {
    expect(VALENTIN_SYSTEM_PROMPT).toMatch(/GOAL 1/);
    expect(VALENTIN_SYSTEM_PROMPT).toMatch(/GOAL 2/);
  });

  it('does not prescribe a fixed opening interview order', () => {
    // The old prompt said "Start by asking for the partner's name, then
    // age/birthday, then gender", which is what made him interrogate.
    expect(VALENTIN_SYSTEM_PROMPT).not.toMatch(/Start by asking for the partner's name/);
  });
});

describe('partnerNameFrom', () => {
  it('finds the name by field id', () => {
    expect(partnerNameFrom(samantha)).toBe('Samantha');
  });

  it('finds the name by key when no field id was recorded', () => {
    expect(
      partnerNameFrom([{ key: 'partner_name', value: 'Mira' }]),
    ).toBe('Mira');
  });

  it('is null when the name is not known', () => {
    expect(partnerNameFrom([{ key: 'hobbies', value: 'pottery' }])).toBeNull();
    expect(partnerNameFrom([])).toBeNull();
  });

  it('treats a blank name as unknown rather than greeting an empty string', () => {
    expect(
      partnerNameFrom([{ key: 'partner_name', fieldId: 'partner_name', value: '   ' }]),
    ).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  it('puts goal 1 live and asks for nothing yet when he knows nothing', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toMatch(/You know nothing about her yet/);
    expect(prompt).toMatch(/GOAL 1 is live/);
    expect(prompt).not.toMatch(/WHAT YOU KNOW ABOUT/);
  });

  it('puts goal 2 live once there is a profile', () => {
    const prompt = buildSystemPrompt(samantha);
    expect(prompt).toMatch(/GOAL 2 is live/);
    expect(prompt).toMatch(/do not ask him to tell you about his partner/);
  });

  it('carries every known fact into the prompt', () => {
    const prompt = buildSystemPrompt(samantha);
    expect(prompt).toContain('Samantha');
    expect(prompt).toContain('Northern Italian');
    // The off-registry facts matter most — an allergy has no profile field.
    expect(prompt).toContain('allergic to shellfish');
  });

  it('renders field ids as readable labels, not snake_case', () => {
    expect(buildSystemPrompt(samantha)).toContain('favorite cuisine: Northern Italian');
  });

  it('lists the fields still unknown, so gaps can be filled in passing', () => {
    const prompt = buildSystemPrompt(samantha);
    expect(prompt).toMatch(/Still unknown:/);
    expect(prompt).toContain('birthday');
    expect(prompt).toMatch(/Do not interrogate/);
  });

  it('tells him to stop collecting once every field is known', () => {
    const complete: KnownFact[] = PROFILE_FIELD_IDS.map((id) => ({
      key: id,
      fieldId: id,
      value: id === 'partner_name' ? 'Samantha' : 'something',
    }));
    const prompt = buildSystemPrompt(complete);
    expect(prompt).toMatch(/You know every field on her profile/);
    expect(prompt).not.toMatch(/Still unknown:/);
  });

  it('keeps the persona in front of the state block', () => {
    const prompt = buildSystemPrompt(samantha);
    expect(prompt.indexOf('You are Valentin')).toBeLessThan(
      prompt.indexOf('CURRENT STATE'),
    );
  });

  it('addresses her generically when the profile has facts but no name', () => {
    const prompt = buildSystemPrompt([{ key: 'hobbies', fieldId: 'hobbies', value: 'pottery' }]);
    expect(prompt).toMatch(/GOAL 2 is live/);
    expect(prompt).toContain('his partner');
  });

  describe('the outing history block', () => {
    const visit = (over: Partial<Outing> = {}): Outing => ({
      id: `out-${Math.random()}`,
      venueSlug: 'claro',
      venueName: 'Claro',
      city: 'Tel Aviv',
      occursOn: '2026-06-12',
      confirmedAt: '2026-06-05T09:00:00.000Z',
      rating: null,
      verdict: null,
      note: null,
      ratedAt: null,
      ...over,
    });

    it('is absent when they have not been anywhere', () => {
      expect(buildSystemPrompt(samantha)).not.toMatch(/WHERE YOU HAVE ALREADY TAKEN HER/);
    });

    it('names the place, the city and the rating', () => {
      const prompt = buildSystemPrompt(samantha, false, [visit({ rating: 4, verdict: 'again' })]);

      expect(prompt).toMatch(/WHERE YOU HAVE ALREADY TAKEN HER/);
      expect(prompt).toContain('Claro, Tel Aviv on 2026-06-12 — she rated it 4/5, "again"');
    });

    it('says an unrated place is unrated rather than implying it went well', () => {
      const prompt = buildSystemPrompt(samantha, false, [visit()]);
      expect(prompt).toContain('not rated yet');
    });

    it('carries the do-not-re-offer rule, which is what the rating is for', () => {
      const prompt = buildSystemPrompt(samantha, false, [visit({ rating: 2 })]);
      expect(prompt).toMatch(/rated 3 or below/);
      expect(prompt).toMatch(/never present one of these as a new discovery/i);
    });

    it('caps the list, because this is sent on every single turn', () => {
      const many = Array.from({ length: 25 }, (_, index) =>
        visit({ venueName: `Place ${index}` }),
      );

      const prompt = buildSystemPrompt(samantha, false, many);

      expect(prompt).toContain('Place 0');
      expect(prompt).not.toContain('Place 20');
    });

    it('stays out of the opening turn, which should introduce him', () => {
      expect(buildSystemPrompt([], false, [visit({ rating: 5 })])).not.toContain('Claro');
    });
  });
});

/**
 * The tool schema is the contract between the model and
 * `preference-extractor.ts`. These pin the parts the extractor reads by name — a
 * renamed array or a widened enum would not fail to compile, it would just
 * silently stop recording her family.
 */
describe('EXTRACT_PREFERENCES_TOOL', () => {
  const properties = EXTRACT_PREFERENCES_TOOL.input_schema.properties as Record<
    string,
    Record<string, unknown>
  >;

  it('asks for people and tasks alongside the preferences', () => {
    expect(Object.keys(properties).sort()).toEqual(['people', 'preferences', 'tasks']);
  });

  it('requires only preferences, so a quiet turn is a valid answer', () => {
    // Most turns mention nobody and commit to nothing. Requiring all three would
    // push the model to invent a relative to fill the array.
    expect(EXTRACT_PREFERENCES_TOOL.input_schema.required).toEqual(['preferences']);
  });

  it('needs a relationship and a rung for a person, but not a name', () => {
    const person = properties.people.items as { required: string[]; properties: object };
    expect(person.required).toEqual(['relationship', 'generation']);
    // The nullable name is the point of the feature: "her brother, whose name I
    // never caught" has to be recordable.
    expect(person.required).not.toContain('name');
  });

  it('offers exactly the four rungs the tree draws', () => {
    const person = properties.people.items as {
      properties: { generation: { enum: string[] } };
    };
    expect([...person.properties.generation.enum].sort()).toEqual([
      'elder',
      'grandparent',
      'peer',
      'younger',
    ]);
  });

  it('needs only a title for a task, and never asks the model for `done`', () => {
    const task = properties.tasks.items as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(task.required).toEqual(['title']);
    // Ticking is his act. A model that could set `done` could erase it.
    expect(Object.keys(task.properties)).not.toContain('done');
  });

  it('tells the model that a relative’s birthday is not her birthday', () => {
    // The one confusion that would put her sister's date in the field the
    // countdown reads as hers.
    expect(EXTRACT_PREFERENCES_TOOL.description).toMatch(/never in a preference/);
  });
});
