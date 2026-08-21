import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { PartnerProfilePanel } from './PartnerProfilePanel';
import { MobileNav } from './MobileNav';
import { ProfileStoreProvider } from '../context/profile-store-context';
import { useChatContext } from '../context/chat-context';
import { SessionSidebar } from './SessionSidebar';
import { DemoToolbar } from './DemoToolbar';
import { LiveArchitectureDrawer, reservedDrawerSpace } from './LiveArchitectureDrawer';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { ArchitectureDrawerProvider } from '../context/architecture-drawer-context';
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

/**
 * Everything to the right of the sidebar, and the positioning context the
 * architecture drawer anchors to.
 *
 * `position: relative` is load-bearing: the drawer is `position: absolute`, so
 * this wrapper is what makes it span exactly the chat + profile area regardless
 * of whether the sidebar is expanded (280px) or collapsed (56px). Anchoring to
 * the viewport instead would need `position: fixed`, and the header's
 * `backdrop-filter` makes it a containing block for fixed descendants — that is
 * the bug the old inspector had to portal out of `document.body` to escape.
 */
const contentAreaStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

/**
 * Space the drawer occupies, reserved from the content area rather than covered.
 *
 * Without this the drawer is a 424px overlay sitting on top of the bottom of the
 * chat — which is exactly where the composer is, so the composer becomes
 * unclickable the moment the drawer opens. "Not a dialog, no focus trap, composer
 * stays typable" is the drawer's whole contract, and occlusion breaks it just as
 * effectively as a modal would.
 *
 * jsdom performs no layout, so a unit test asserting the composer is focusable
 * passes whether or not something is painted over it. Only running the real app
 * catches this; a Playwright click did.
 *
 * `paddingBottom` on the flex container shrinks the panels' available height, so
 * the chat scrolls within what is left and the composer lands just above the
 * drawer's top edge. Collapsed, only the reopen bar is reserved.
 */
function contentAreaStyleWithDrawer(
  reserved: number,
): React.CSSProperties {
  return { ...contentAreaStyle, paddingBottom: reserved };
}

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
      {/* Above the layout because the magnifier lives in the sidebar and the
          drawer is mounted beside the chat — sibling subtrees. */}
      <ArchitectureDrawerProvider>
        <AppLayoutContent />
      </ArchitectureDrawerProvider>
    </ProfileStoreProvider>
  );
}

function AppLayoutContent() {
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'profile'>('chat');
  const { setSidebarOpen } = useSessionContext();
  // Read here rather than inside the drawer: the *layout* is what has to give up
  // the space, and only the layout owns the panels whose height it takes from.
  const { isOpen: isDrawerOpen } = useArchitectureDrawer();
  const reserved = reservedDrawerSpace(isDrawerOpen);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.mobile - 1}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const profilePanel = <PartnerProfilePanel />;

  if (isMobile) {
    return (
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
        <div
          style={{ ...mobilePanelStyle, position: 'relative', paddingBottom: reserved }}
          data-drawer-reserved={reserved}
        >
          {activePanel === 'chat' ? <ChatPanel /> : profilePanel}
          {/* The diagram is 916px wide, so on a phone it scrolls horizontally
              rather than being withheld — a presenter may well be on a laptop
              in a narrow window, and hiding the drawer there is worse. */}
          <LiveArchitectureDrawer />
        </div>
        <SessionSidebar isMobile={true} />
      </div>
    );
  }

  return (
    <div style={outerStyle} data-testid="app-layout" data-layout="desktop">
      <header style={headerStyle}>
        <img src="/logo.png" alt="Valentin logo" style={logoStyle} />
        <span style={brandStyle}>Valentin</span>
        <DemoToolbar />
      </header>
      <div style={desktopStyle}>
        <SessionSidebar isMobile={false} />
        <div
          style={contentAreaStyleWithDrawer(reserved)}
          data-drawer-reserved={reserved}
        >
          <div style={leftPanelStyle}>
            <ChatPanel />
          </div>
          <div style={dividerStyle} />
          <div style={rightPanelStyle}>
            {profilePanel}
          </div>
          <LiveArchitectureDrawer />
        </div>
      </div>
    </div>
  );
}
