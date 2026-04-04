import { colors, spacing, typography } from '../design-system/tokens';

type Panel = 'chat' | 'profile';

interface MobileNavProps {
  activePanel: Panel;
  onPanelChange: (panel: Panel) => void;
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: `1px solid ${colors.border}`,
  backgroundColor: colors.surface,
};

const tabBaseStyle: React.CSSProperties = {
  flex: 1,
  padding: `${spacing.sm}px`,
  textAlign: 'center',
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.medium,
  fontFamily: typography.bodyFontFamily,
  cursor: 'pointer',
  border: 'none',
  backgroundColor: 'transparent',
  transition: 'all 200ms ease',
};

function getTabStyle(isActive: boolean): React.CSSProperties {
  return {
    ...tabBaseStyle,
    color: isActive ? colors.softBurgundy : colors.textSecondary,
    borderBottom: isActive ? `2px solid ${colors.softBurgundy}` : '2px solid transparent',
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
