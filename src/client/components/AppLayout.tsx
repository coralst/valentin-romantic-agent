import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { PartnerProfilePanel } from './PartnerProfilePanel';
import { MobileNav } from './MobileNav';
import { ProfileStoreProvider } from '../context/profile-store-context';
import { useChatContext } from '../context/chat-context';
import { breakpoints, spacing, colors, typography, shadows } from '../design-system/tokens';

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

export function AppLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'profile'>('chat');
  const { state: chatState } = useChatContext();

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.mobile - 1}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const profilePanel = (
    <ProfileStoreProvider sessionId={chatState.sessionId}>
      <PartnerProfilePanel />
    </ProfileStoreProvider>
  );

  if (isMobile) {
    return (
      <div style={outerStyle} data-testid="app-layout" data-layout="mobile">
        <header style={headerStyle}>
          <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
          <span style={brandStyle}>Valentin</span>
        </header>
        <MobileNav activePanel={activePanel} onPanelChange={setActivePanel} />
        <div style={mobilePanelStyle}>
          {activePanel === 'chat' ? <ChatPanel /> : profilePanel}
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle} data-testid="app-layout" data-layout="desktop">
      <header style={headerStyle}>
        <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
        <span style={brandStyle}>Valentin</span>
      </header>
      <div style={desktopStyle}>
        <div style={leftPanelStyle}>
          <ChatPanel />
        </div>
        <div style={dividerStyle} />
        <div style={rightPanelStyle}>
          {profilePanel}
        </div>
      </div>
    </div>
  );
}
