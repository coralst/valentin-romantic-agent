import { usePreferencesContext } from '../context/preferences-context';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import { CategoryGroup } from './CategoryGroup';
import { EmptyState } from './EmptyState';
import { colors, spacing, typography, shadows } from '../design-system/tokens';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: colors.surface,
  overflowY: 'auto',
};

const headerStyle: React.CSSProperties = {
  padding: `${spacing.md}px ${spacing.md}px ${spacing.xs}px`,
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xl,
  fontWeight: typography.weights.bold,
  color: colors.text,
  letterSpacing: '-0.01em',
};

const subtitleStyle: React.CSSProperties = {
  padding: `0 ${spacing.md}px ${spacing.sm}px`,
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
};

const listStyle: React.CSSProperties = {
  padding: `0 ${spacing.sm}px ${spacing.md}px`,
  flex: 1,
};

export function ProfileDashboard() {
  const { state, dispatch } = usePreferencesContext();

  const nonEmptyCategories = PREFERENCE_CATEGORIES.filter(
    (cat) => state.preferences[cat].length > 0,
  );

  const isEmpty = nonEmptyCategories.length === 0;

  const handleHighlightEnd = (preferenceId: string) => {
    dispatch({ type: 'CLEAR_HIGHLIGHT', preferenceId });
  };

  return (
    <div style={panelStyle} data-testid="profile-dashboard">
      <h2 style={headerStyle}>Partner Profile</h2>
      <p style={subtitleStyle}>Preferences discovered through conversation</p>
      {isEmpty ? (
        <EmptyState />
      ) : (
        <div style={listStyle}>
          {nonEmptyCategories.map((cat) => (
            <CategoryGroup
              key={cat}
              category={cat}
              preferences={state.preferences[cat]}
              highlightedIds={state.recentlyUpdated}
              onHighlightEnd={handleHighlightEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}
