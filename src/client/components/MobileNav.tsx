import { colors, spacing, typography, borderRadius } from '../design-system/tokens';

type Panel = 'chat' | 'profile';

interface MobileNavProps {
  activePanel: Panel;
  onPanelChange: (panel: Panel) => void;
  /**
   * True when the full-page dossier has replaced both panels.
   *
   * Kept out of `Panel` on purpose: the dossier is a *surface*, owned by
   * `view-context`, not a third panel in this component's two-way switch. When
   * it is on screen neither Chat nor Profile is selected, and tapping either one
   * closes it on the way to that panel.
   */
  isDossierActive?: boolean;
  /** Shows the dossier. Absent when no view context sits above the layout. */
  onOpenDossier?: () => void;
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

/**
 * The mobile panel switch.
 *
 * The first two accessible names are "Chat" and "Profile" **verbatim** and must
 * stay that way: `responsive-layout.spec.ts:29-30` and `AppLayout.test.tsx:83,88`
 * both query by them, and `e2e/` is not this component's lane to edit.
 */
export function MobileNav({
  activePanel,
  onPanelChange,
  isDossierActive = false,
  onOpenDossier,
}: MobileNavProps) {
  const chatSelected = !isDossierActive && activePanel === 'chat';
  const profileSelected = !isDossierActive && activePanel === 'profile';

  return (
    <nav role="tablist" style={navStyle} data-testid="mobile-nav">
      <button
        role="tab"
        aria-selected={chatSelected}
        style={getTabStyle(chatSelected)}
        onClick={() => onPanelChange('chat')}
      >
        Chat
      </button>
      <button
        role="tab"
        aria-selected={profileSelected}
        style={getTabStyle(profileSelected)}
        onClick={() => onPanelChange('profile')}
      >
        Profile
      </button>
      {onOpenDossier && (
        <button
          role="tab"
          aria-selected={isDossierActive}
          style={getTabStyle(isDossierActive)}
          onClick={onOpenDossier}
          data-testid="mobile-nav-dossier"
        >
          Dossier
        </button>
      )}
    </nav>
  );
}
