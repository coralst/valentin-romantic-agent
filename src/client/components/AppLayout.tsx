import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { PartnerProfilePanel } from './PartnerProfilePanel';
import { MobileNav } from './MobileNav';
import { ProfileStoreProvider } from '../context/profile-store-context';
import { DiscoveryProvider } from '../context/discovery-context';
import { usePreferenceIngestion } from '../hooks/use-preference-ingestion';
import { useChatContext } from '../context/chat-context';
import { SessionSidebar } from './SessionSidebar';
import { DemoToolbar } from './DemoToolbar';
import { useSessionContext } from '../context/session-context';
import { breakpoints, spacing, colors, typography, shadows, animation, borderRadius } from '../design-system/tokens';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.sm,
  padding: `${spacing.xs + 4}px ${spacing.md}px`,
  background: colors.headerGradient,
  backdropFilter: 'blur(12px)',
  boxShadow: shadows.header,
  position: 'relative',
  zIndex: 10,
};

const logoStyle: React.CSSProperties = {
  height: 40,
  objectFit: 'contain',
};

const brandStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.lg,
  fontWeight: typography.weights.bold,
  color: colors.softBurgundy,
  letterSpacing: '-0.01em',
};

const desktopStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  width: '100%',
};

const leftPanelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  backgroundColor: colors.borderSubtle,
};

const rightPanelStyle: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
};

const mobileContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
};

const mobilePanelStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
};

const outerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100%',
  backgroundColor: colors.background,
};

const liveRegionStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const menuButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  border: 'none',
  borderRadius: borderRadius.sm,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: typography.sizes.md,
  color: colors.textSecondary,
  marginRight: spacing.xs,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

/**
 * Owns the profile store for the whole layout, so surfaces outside the
 * profile panel (e.g. the demo toolbar) can read and clear profile state.
 */
export function AppLayout() {
  const { state: chatState } = useChatContext();
  return (
    <ProfileStoreProvider sessionId={chatState.sessionId}>
      <AppLayoutContent />
    </ProfileStoreProvider>
  );
}

function AppLayoutContent() {
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'profile'>('chat');
  const { setSidebarOpen } = useSessionContext();

  // The app's single preference-ingestion effect. It lives here because this is
  // the one component guaranteed to be inside both ProfileStoreProvider and
  // PreferencesProvider, and to be mounted exactly once regardless of which
  // panels are visible. Consumers read the result via useDiscoveryContext().
  const discovery = usePreferenceIngestion();

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.mobile - 1}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const profilePanel = <PartnerProfilePanel />;

  /* Live region for screen reader announcements (R8.4) */
  const liveRegion = (
    <div aria-live="polite" aria-atomic="true" style={liveRegionStyle} data-testid="live-region">
      {discovery.liveAnnouncement}
    </div>
  );

  if (isMobile) {
    return (
      <DiscoveryProvider value={discovery}>
        <div style={outerStyle} data-testid="app-layout" data-layout="mobile">
          <header style={headerStyle}>
            <button
              style={menuButtonStyle}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open session history"
              data-testid="sidebar-menu-button"
            >
              &#9776;
            </button>
            <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
            <span style={brandStyle}>Valentin</span>
            <DemoToolbar />
          </header>
          <MobileNav activePanel={activePanel} onPanelChange={setActivePanel} />
          <div style={mobilePanelStyle}>
            {activePanel === 'chat' ? <ChatPanel /> : profilePanel}
          </div>
          <SessionSidebar isMobile={true} />
          {liveRegion}
        </div>
      </DiscoveryProvider>
    );
  }

  return (
    <DiscoveryProvider value={discovery}>
      <div style={outerStyle} data-testid="app-layout" data-layout="desktop">
        <header style={headerStyle}>
          <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
          <span style={brandStyle}>Valentin</span>
          <DemoToolbar />
        </header>
        <div style={desktopStyle}>
          <SessionSidebar isMobile={false} />
          <div style={leftPanelStyle}>
            <ChatPanel />
          </div>
          <div style={dividerStyle} />
          <div style={rightPanelStyle}>
            {profilePanel}
          </div>
        </div>
        {liveRegion}
      </div>
    </DiscoveryProvider>
  );
}
