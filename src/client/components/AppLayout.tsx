import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { ProfileDashboard } from './ProfileDashboard';
import { MobileNav } from './MobileNav';
import { breakpoints, spacing, colors, typography } from '../design-system/tokens';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.sm,
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderBottom: `1px solid ${colors.border}`,
  backgroundColor: colors.background,
};

const logoStyle: React.CSSProperties = {
  height: 80,
  objectFit: 'contain',
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
  borderRight: '1px solid #E0D5CC',
};

const rightPanelStyle: React.CSSProperties = {
  width: 400,
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
};

export function AppLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'profile'>('chat');

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.mobile - 1}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  if (isMobile) {
    return (
      <div style={outerStyle} data-testid="app-layout" data-layout="mobile">
        <header style={headerStyle}>
          <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
        </header>
        <MobileNav activePanel={activePanel} onPanelChange={setActivePanel} />
        <div style={mobilePanelStyle}>
          {activePanel === 'chat' ? <ChatPanel /> : <ProfileDashboard />}
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle} data-testid="app-layout" data-layout="desktop">
      <header style={headerStyle}>
        <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
      </header>
      <div style={desktopStyle}>
        <div style={leftPanelStyle}>
          <ChatPanel />
        </div>
        <div style={rightPanelStyle}>
          <ProfileDashboard />
        </div>
      </div>
    </div>
  );
}
