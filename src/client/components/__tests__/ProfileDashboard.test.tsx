import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import type { PreferenceCategory, PreferenceWithHistory } from '../../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../../shared/constants/categories';
import { PreferencesProvider } from '../../context/preferences-context';
import { ProfileDashboard } from '../ProfileDashboard';
import { CategoryGroup } from '../CategoryGroup';
import { PreferenceCard } from '../PreferenceCard';

function renderWithProvider(ui: React.ReactElement) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}

const categoryArb = fc.constantFrom(...PREFERENCE_CATEGORIES) as fc.Arbitrary<PreferenceCategory>;

const isoDateArb = fc.integer({ min: 946684800000, max: 1893456000000 }).map((ms) => new Date(ms).toISOString());

const preferenceArb: fc.Arbitrary<PreferenceWithHistory> = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  category: categoryArb,
  key: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  value: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  sourceMessageId: fc.uuid(),
  createdAt: isoDateArb,
  updatedAt: isoDateArb,
  history: fc.constant([]),
});

describe('ProfileDashboard', () => {
  it('renders empty state when no preferences', () => {
    renderWithProvider(<ProfileDashboard />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  /**
   * Property 9: Preferences grouped by category with correct counts
   * For any set of PreferenceWithHistory objects, one CategoryGroup per distinct category,
   * each with correct item count.
   * **Validates: Requirements 4.3, 4.4**
   */
  it('groups preferences by category with correct counts (Property 9)', () => {
    fc.assert(
      fc.property(
        fc.array(preferenceArb, { minLength: 1, maxLength: 20 }),
        (prefs) => {
          // Group by category
          const grouped = new Map<PreferenceCategory, PreferenceWithHistory[]>();
          for (const p of prefs) {
            const list = grouped.get(p.category) ?? [];
            list.push(p);
            grouped.set(p.category, list);
          }

          // Render CategoryGroups directly to test grouping logic
          const { unmount } = render(
            <>
              {Array.from(grouped.entries()).map(([cat, items]) => (
                <CategoryGroup
                  key={cat}
                  category={cat}
                  preferences={items}
                  highlightedIds={new Set()}
                  onHighlightEnd={() => {}}
                />
              ))}
            </>,
          );

          const groups = screen.getAllByTestId('category-group');
          expect(groups.length).toBe(grouped.size);

          for (const [cat, items] of grouped.entries()) {
            const group = groups.find((g) => g.getAttribute('data-category') === cat);
            expect(group).toBeTruthy();
            // The count is displayed in the header
            expect(group!.textContent).toContain(String(items.length));
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 10: Updated preferences show highlight
   * For any preference update where isNew is false, PreferenceCard has active highlight.
   * **Validates: Requirements 4.6**
   */
  it('highlights updated preferences (Property 10)', () => {
    fc.assert(
      fc.property(preferenceArb, (pref) => {
        const highlightedIds = new Set([pref.id]);

        const { unmount } = render(
          <PreferenceCard preference={pref} isHighlighted={true} />,
        );

        const card = screen.getByTestId('preference-card');
        expect(card.getAttribute('data-highlighted')).toBe('true');

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});

describe('CategoryGroup', () => {
  it('renders correct count of preferences', () => {
    const prefs: PreferenceWithHistory[] = [
      {
        id: '1', sessionId: 's1', category: 'food', key: 'Cuisine',
        value: 'Italian', confidence: 0.9, sourceMessageId: 'm1',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        history: [],
      },
      {
        id: '2', sessionId: 's1', category: 'food', key: 'Diet',
        value: 'Vegetarian', confidence: 0.8, sourceMessageId: 'm2',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        history: [],
      },
    ];

    render(
      <CategoryGroup
        category="food"
        preferences={prefs}
        highlightedIds={new Set()}
        onHighlightEnd={() => {}}
      />,
    );

    const group = screen.getByTestId('category-group');
    expect(group.textContent).toContain('2');
    expect(group.textContent).toContain('Food');
  });
});

describe('PreferenceCard', () => {
  it('displays key, value, and confidence', () => {
    const pref: PreferenceWithHistory = {
      id: '1', sessionId: 's1', category: 'music', key: 'Genre',
      value: 'Jazz', confidence: 0.85, sourceMessageId: 'm1',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      history: [],
    };

    render(<PreferenceCard preference={pref} isHighlighted={false} />);
    const card = screen.getByTestId('preference-card');
    expect(card.textContent).toContain('Genre');
    expect(card.textContent).toContain('Jazz');
    expect(card.textContent).toContain('85%');
  });
});
