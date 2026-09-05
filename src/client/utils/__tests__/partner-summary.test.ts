import { describe, expect, it } from 'vitest';
import { derivePartnerSummary } from '../partner-summary';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

/** A lookup over a plain record, matching the profile store's accessor shape. */
function lookup(values: Record<string, string>) {
  return (fieldId: string) =>
    values[fieldId] === undefined ? null : { value: values[fieldId] };
}

function preference(
  partial: Partial<PreferenceWithHistory> & { key: string; value: string },
): PreferenceWithHistory {
  return {
    id: `pref-${partial.key}`,
    sessionId: 'session-1',
    category: 'food',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    history: [],
    ...partial,
  };
}

describe('derivePartnerSummary', () => {
  it('says nothing at all about an empty profile', () => {
    const summary = derivePartnerSummary(lookup({}), [], null);

    expect(summary.sentences).toEqual([]);
    expect(summary.tags).toEqual([]);
  });

  it('opens with her name and city', () => {
    const summary = derivePartnerSummary(
      lookup({ home_city: 'Tel Aviv' }),
      [],
      'Maya',
    );

    expect(summary.sentences[0]).toBe('Maya lives in Tel Aviv.');
  });

  it('falls back to "She" when the name is not known yet', () => {
    const summary = derivePartnerSummary(lookup({ home_city: 'Tel Aviv' }), [], null);

    expect(summary.sentences[0]).toBe('She lives in Tel Aviv.');
  });

  it('joins cuisine and restaurant style into one sentence', () => {
    const summary = derivePartnerSummary(
      lookup({ favorite_cuisine: 'Mediterranean', restaurant_style: 'Quiet and romantic' }),
      [],
      'Maya',
    );

    expect(summary.sentences).toContain(
      'She loves mediterranean, somewhere quiet and romantic.',
    );
  });

  it('omits a clause whose field is missing rather than leaving a gap', () => {
    const summary = derivePartnerSummary(
      lookup({ favorite_cuisine: 'Mediterranean' }),
      [],
      'Maya',
    );

    expect(summary.sentences).toContain('She loves mediterranean.');
    expect(summary.sentences.join(' ')).not.toContain('somewhere');
  });

  it('speaks her week in weekdays, not in the stored @-form', () => {
    const summary = derivePartnerSummary(
      lookup({ weekly_rhythm: 'Tue@pottery@heavy, Fri@finishes work at 17:00@light' }),
      [],
      'Maya',
    );

    const said = summary.sentences.join(' ');
    expect(said).toContain('pottery on Tuesdays');
    expect(said).toContain('finishes work at 17:00 on Fridays');
    expect(said).not.toContain('@');
  });

  it('drops a rhythm entry whose day the parser could not read', () => {
    const summary = derivePartnerSummary(
      lookup({ weekly_rhythm: 'whenever@yoga@light' }),
      [],
      'Maya',
    );

    expect(summary.sentences.join(' ')).not.toContain('yoga');
  });

  it('tags an allergy as a constraint, not as a taste', () => {
    const summary = derivePartnerSummary(
      lookup({}),
      [preference({ key: 'shellfish_allergy', value: 'badly allergic to shellfish' })],
      'Maya',
    );

    const constraint = summary.tags.find((tag) => tag.tone === 'constraint');
    expect(constraint).toBeDefined();
    expect(constraint?.label.toLowerCase()).toContain('shellfish');
  });

  it('puts constraints before tastes, because a rule outranks a preference', () => {
    const summary = derivePartnerSummary(
      lookup({ favorite_cuisine: 'Mediterranean' }),
      [preference({ key: 'shellfish_allergy', value: 'badly allergic to shellfish' })],
      'Maya',
    );

    expect(summary.tags[0].tone).toBe('constraint');
    expect(summary.tags.some((tag) => tag.tone === 'taste')).toBe(true);
  });

  it('truncates a tag too long to stay scannable', () => {
    const summary = derivePartnerSummary(
      lookup({
        favorite_cuisine:
          'Mediterranean, Levantine, Italian and anything with a lot of lemon in it',
      }),
      [],
      'Maya',
    );

    const tag = summary.tags.find((candidate) => candidate.id === 'taste:favorite_cuisine');
    expect(tag?.label.endsWith('…')).toBe(true);
    expect(tag?.label.length).toBeLessThanOrEqual(26);
  });

  it('ignores a field that holds only whitespace', () => {
    const summary = derivePartnerSummary(lookup({ home_city: '   ' }), [], 'Maya');

    expect(summary.sentences).toEqual([]);
    expect(summary.tags).toEqual([]);
  });

  it('keeps tag ids stable across re-extraction', () => {
    const first = derivePartnerSummary(
      lookup({}),
      [preference({ id: 'pref-a', key: 'shellfish_allergy', value: 'no shellfish' })],
      'Maya',
    );
    const second = derivePartnerSummary(
      lookup({}),
      [preference({ id: 'pref-b-reextracted', key: 'shellfish_allergy', value: 'no shellfish' })],
      'Maya',
    );

    expect(first.tags[0].id).toBe(second.tags[0].id);
  });
});
