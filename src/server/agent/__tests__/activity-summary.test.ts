import { describe, it, expect } from 'vitest';
import {
  INPUT_SUMMARY_MAX_CHARS,
  OUTCOME_MAX_CHARS,
  summariseToolInput,
  summariseToolOutcome,
} from '../activity-summary';

describe('summariseToolInput', () => {
  it('shows the values that cannot be about a person', () => {
    expect(
      summariseToolInput({ city: 'Tel Aviv', party_size: 2, when: '2026-09-12' }),
    ).toBe('city: Tel Aviv · party_size: 2 · when: 2026-09-12');
  });

  it('describes the shape of anything else rather than its value', () => {
    const summary = summariseToolInput({
      to: 'maya@example.com',
      body: 'I was thinking about the peonies you loved at the market on Friday morning',
    });

    expect(summary).toBe('to: <email> · body: <14 words>');
    // The whole point: the line is informative and names nobody.
    expect(summary).not.toContain('maya');
    expect(summary).not.toContain('peonies');
  });

  it('redacts a key nobody has thought about yet', () => {
    // Default-deny. A key added to a tool schema tomorrow must be redacted
    // without anyone remembering to come back here.
    expect(summariseToolInput({ some_new_field: 'Maya' })).toBe('some_new_field: <text>');
  });

  it('keeps his address out of the trail', () => {
    expect(summariseToolInput({ lat: 32.0853, lon: 34.7818 })).toBe(
      'lat: <number> · lon: <number>',
    );
  });

  it('caps one long field so it cannot wrap the trail', () => {
    const summary = summariseToolInput({ query: 'a'.repeat(400) });

    expect(summary.length).toBeLessThanOrEqual(INPUT_SUMMARY_MAX_CHARS);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('says nothing at all for a tool called with nothing', () => {
    // `''` renders as no summary, which is the truth. `{}` looks like a bug.
    expect(summariseToolInput({})).toBe('');
    expect(summariseToolInput({ city: undefined })).toBe('');
  });
});

describe('summariseToolOutcome', () => {
  it('takes the fact and leaves the coaching behind', () => {
    expect(
      summariseToolOutcome(
        'Ontopo returned nothing for Saturday. Tell the user plainly — do not pretend it worked.',
        false,
      ),
    ).toBe('Ontopo returned nothing for Saturday.');
  });

  it('caps a long first sentence', () => {
    const outcome = summariseToolOutcome(`${'b'.repeat(200)}.`, true);
    expect(outcome.length).toBeLessThanOrEqual(OUTCOME_MAX_CHARS);
  });

  it('still renders as something when the tool said nothing', () => {
    expect(summariseToolOutcome('', true)).toBe('done');
    expect(summariseToolOutcome('   ', false)).toBe('failed');
  });
});
