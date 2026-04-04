import { useState } from 'react';
import type { PreferenceCategory, PreferenceWithHistory } from '../../shared/interfaces/preference';
import { CATEGORY_LABELS } from '../../shared/constants/categories';
import { PreferenceCard } from './PreferenceCard';
import { PreferenceHighlight } from './PreferenceHighlight';
import { colors, spacing, borderRadius, typography, shadows } from '../design-system/tokens';

interface CategoryGroupProps {
  category: PreferenceCategory;
  preferences: PreferenceWithHistory[];
  highlightedIds: Set<string>;
  onHighlightEnd: (preferenceId: string) => void;
}

const groupStyle: React.CSSProperties = {
  marginBottom: spacing.md,
  borderRadius: borderRadius.lg,
  backgroundColor: colors.surface,
  boxShadow: shadows.card,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${spacing.sm}px ${spacing.md}px`,
  cursor: 'pointer',
  backgroundColor: colors.cream,
  userSelect: 'none',
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.md,
  fontWeight: typography.weights.semibold,
  color: colors.text,
};

const countStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  fontWeight: typography.weights.medium,
};

const listStyle: React.CSSProperties = {
  padding: spacing.sm,
};

export function CategoryGroup({ category, preferences, highlightedIds, onHighlightEnd }: CategoryGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const meta = CATEGORY_LABELS[category];

  return (
    <div data-testid="category-group" data-category={category} style={groupStyle}>
      <div
        style={headerStyle}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        aria-expanded={isOpen}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsOpen(!isOpen); }}
      >
        <span style={labelStyle}>
          {isOpen ? '▾' : '▸'} {meta.label}
        </span>
        <span style={countStyle}>{preferences.length}</span>
      </div>
      {isOpen && (
        <div style={listStyle}>
          {preferences.map((pref) => (
            <PreferenceHighlight
              key={pref.id}
              isHighlighted={highlightedIds.has(pref.id)}
              onHighlightEnd={() => onHighlightEnd(pref.id)}
            >
              <PreferenceCard
                preference={pref}
                isHighlighted={highlightedIds.has(pref.id)}
              />
            </PreferenceHighlight>
          ))}
        </div>
      )}
    </div>
  );
}
