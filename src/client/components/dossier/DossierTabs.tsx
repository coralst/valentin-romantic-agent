import { colors, insets, radii, typography } from '../../design-system/tokens';
import { CARD_HAIRLINE } from './board-tones';
import { toneInk, type AccentTone } from './accent-tones';

/**
 * Which slice of the board is on screen.
 *
 * `overview` is not "all" — it is the curated first screen: what's coming, what
 * to do, and the two or three things Valentin wants settled. The other tabs are
 * the deep views you go to on purpose. Keeping them separate is what lets the
 * overview stay short enough to be read standing up.
 */
export type DossierTab = 'overview' | 'known' | 'gifts' | 'people' | 'memories';

export interface TabDefinition {
  id: DossierTab;
  label: string;
  /** Shown as a count pill. Omitted when there is nothing to count. */
  count?: number | null;
  tone: AccentTone;
}

const barStyle: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: `9px ${insets.roomy}px`,
  background: colors.porcelain,
  borderBottom: CARD_HAIRLINE,
  overflowX: 'auto',
  minWidth: 0,
};

const mobileBarStyle: React.CSSProperties = {
  ...barStyle,
  padding: `8px ${insets.tight}px`,
};

const tabStyle: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  border: 'none',
  cursor: 'pointer',
  background: 'transparent',
  borderRadius: radii.pill,
  padding: '7px 13px',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.medium,
  color: colors.inkMuted,
  whiteSpace: 'nowrap',
};

/**
 * The selected tab is filled in its own family's ink rather than in claret.
 *
 * So the tab bar and the cards under it agree: press "Her people" and the bar
 * turns mauve, and the mauve cards below are the ones that answered.
 */
const activeTabStyle = (tone: AccentTone): React.CSSProperties => ({
  ...tabStyle,
  background: toneInk(tone),
  color: colors.textOnAccent,
  fontWeight: typography.weights.semibold,
});

const countStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  fontWeight: typography.weights.medium,
  color: colors.inkFaint,
};

const activeCountStyle: React.CSSProperties = {
  ...countStyle,
  color: 'rgba(255, 255, 255, 0.78)',
};

interface DossierTabsProps {
  tabs: TabDefinition[];
  active: DossierTab;
  onSelect: (tab: DossierTab) => void;
  isMobile?: boolean;
}

/**
 * The dossier's segmented control.
 *
 * `role="tablist"` with real `aria-selected` state rather than a row of buttons:
 * this is the page's primary navigation once the board is more than one screen
 * tall, and a screen reader user needs to hear that pressing one changes what
 * follows.
 */
export function DossierTabs({
  tabs,
  active,
  onSelect,
  isMobile = false,
}: DossierTabsProps) {
  return (
    <div
      style={isMobile ? mobileBarStyle : barStyle}
      role="tablist"
      aria-label="Which part of her dossier"
      data-testid="dossier-tabs"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            style={isActive ? activeTabStyle(tab.tone) : tabStyle}
            onClick={() => onSelect(tab.id)}
            data-testid={`dossier-tab-${tab.id}`}
          >
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span style={isActive ? activeCountStyle : countStyle}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
