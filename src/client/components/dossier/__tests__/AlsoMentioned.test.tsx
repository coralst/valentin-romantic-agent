import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlsoMentioned, groupUnmappedPreferences } from '../AlsoMentioned';
import { resolveField } from '../../../utils/preference-field-mapper';
import type { PreferenceWithHistory } from '../../../../shared/interfaces/preference';

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'hobbies',
    key: 'collections',
    value: 'vinyl records',
    confidence: 0.8,
    sourceMessageId: 'msg-1',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

/*
 * These are data-integrity tests, not styling tests.
 *
 * Between Stage 4 and Stage 6 an extraction that resolved to no registry field
 * had nowhere on screen to go, so it was silently dropped from the UI. This card
 * is the rescue point; if these assertions fail, output is being lost again.
 */
describe('AlsoMentioned — rescuing unmapped extraction output', () => {
  it('renders a preference that resolves to no registry field', () => {
    const unmapped = preference();
    // Guard the premise: if the mapper ever learns this key, the test is moot.
    expect(resolveField(unmapped.category, unmapped.key)).toBeNull();

    render(<AlsoMentioned preferences={[unmapped]} />);
    expect(screen.getByTestId('dossier-also-mentioned')).toBeInTheDocument();
    expect(screen.getByText('vinyl records')).toBeInTheDocument();
  });

  it('leaves mapped preferences out — they belong to Everything I know', () => {
    const mapped = preference({ category: 'personality_traits', key: 'nickname', value: 'Mira' });
    expect(resolveField(mapped.category, mapped.key)).toBe('nickname');

    render(<AlsoMentioned preferences={[mapped]} />);
    expect(screen.queryByText('Mira')).not.toBeInTheDocument();
    expect(screen.getByTestId('dossier-also-mentioned-empty')).toBeInTheDocument();
  });

  it('leaves cautions out — KeepInMind already shows them, louder', () => {
    const allergy = preference({ category: 'food', key: 'allergies', value: 'shellfish' });
    expect(resolveField(allergy.category, allergy.key)).toBeNull();

    render(<AlsoMentioned preferences={[allergy]} />);
    expect(screen.queryByText(/shellfish/)).not.toBeInTheDocument();
  });

  it('reuses CategoryGroup and PreferenceCard, grouped by category', () => {
    render(
      <AlsoMentioned
        preferences={[
          preference({ id: 'a', category: 'hobbies', key: 'collections' }),
          preference({ id: 'b', category: 'travel', key: 'travel style', value: 'slow trains' }),
        ]}
      />,
    );
    const groups = screen.getAllByTestId('category-group');
    expect(groups).toHaveLength(2);
    expect(screen.getAllByTestId('preference-card')).toHaveLength(2);
  });

  it('counts every rescued preference in the head pill', () => {
    render(
      <AlsoMentioned
        preferences={[
          preference({ id: 'a', key: 'collections' }),
          preference({ id: 'b', key: 'weekend habits', value: 'sea swimming' }),
        ]}
      />,
    );
    // Scoped to the card head: `CategoryGroup` renders its own count pill, which
    // also reads "2" when a single category holds both.
    const head = screen.getByText('Also mentioned').parentElement;
    expect(head?.textContent).toBe('Also mentioned2');
  });
});

describe('groupUnmappedPreferences', () => {
  it('orders buckets canonically rather than by arrival', () => {
    const groups = groupUnmappedPreferences([
      preference({ id: 'a', category: 'travel', key: 'travel style' }),
      preference({ id: 'b', category: 'food', key: 'texture' }),
    ]);
    // `food` precedes `travel` in PREFERENCE_CATEGORIES, so the card's sections
    // do not reshuffle as new extractions arrive.
    expect(groups.map((group) => group.category)).toEqual(['food', 'travel']);
  });

  it('drops empty buckets rather than rendering headings with nothing under them', () => {
    expect(groupUnmappedPreferences([])).toEqual([]);
  });
});
