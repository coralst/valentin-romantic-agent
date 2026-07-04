import { colors, spacing, typography, borderRadius } from '../design-system/tokens';

type Panel = 'chat' | 'profile';

interface MobileNavProps {
  activePanel: Panel;
  onPanelChange: (panel: Panel) => void;
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  backgroundColor: colors.surface,
  borderBottom: `1px solid ${colors.borderSubtle}`,
};

const tabBaseStyle: React.CSSProperties = {
  flex: 1,
  padding: `${spacing.xs}px`,
  textAlign: 'center',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  fontFamily: typography.bodyFontFamily,
  cursor: 'pointer',
  border: 'none',
  backgroundColor: 'transparent',
  borderRadius: borderRadius.md,
  transition: 'all 200ms ease',
};

function getTabStyle(isActive: boolean): React.CSSProperties {
  return {
    ...tabBaseStyle,
    color: isActive ? colors.softBurgundy : colors.textSecondary,
    backgroundColor: isActive ? colors.background : 'transparent',
    fontWeight: isActive ? typography.weights.semibold : typography.weights.medium,
  };
}

export function MobileNav({ activePanel, onPanelChange }: MobileNavProps) {
  return (
    <nav role="tablist" style={navStyle} data-testid="mobile-nav">
      <button
        role="tab"
        aria-selected={activePanel === 'chat'}
        style={getTabStyle(activePanel === 'chat')}
        onClick={() => onPanelChange('chat')}
      >
        Chat
      </button>
      <button
        role="tab"
        aria-selected={activePanel === 'profile'}
        style={getTabStyle(activePanel === 'profile')}
        onClick={() => onPanelChange('profile')}
      >
        Profile
      </button>
    </nav>
  );
}
