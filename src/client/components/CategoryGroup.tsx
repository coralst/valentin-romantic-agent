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
  marginBottom: spacing.sm,
  borderRadius: borderRadius.lg,
  backgroundColor: colors.surface,
  border: `1px solid ${colors.borderSubtle}`,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${spacing.xs + 4}px ${spacing.sm}px`,
  cursor: 'pointer',
  backgroundColor: colors.surface,
  userSelect: 'none',
  transition: 'background-color 150ms ease',
};

const labelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  color: colors.text,
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
};

const chevronStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  transition: 'transform 200ms ease',
};

const countStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  fontWeight: typography.weights.medium,
  backgroundColor: colors.background,
  padding: `2px ${spacing.xs}px`,
  borderRadius: borderRadius.full,
};

const listStyle: React.CSSProperties = {
  padding: `0 ${spacing.xs}px ${spacing.xs}px`,
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
          <span style={{ ...chevronStyle, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
          {meta.label}
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
