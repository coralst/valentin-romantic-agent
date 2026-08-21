import { useState, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { BriefRail } from './BriefRail';
import { DossierView } from './DossierView';
import { MobileNav } from './MobileNav';
import { ProfileStoreProvider } from '../context/profile-store-context';
import { DiscoveryProvider } from '../context/discovery-context';
import { ViewProvider, useViewState } from '../context/view-context';
import { usePreferenceIngestion } from '../hooks/use-preference-ingestion';
import { useChatContext } from '../context/chat-context';
import { SessionSidebar } from './SessionSidebar';
import {
  AppWindow,
  DOSSIER_COLUMNS,
  windowCellStyle,
  windowCellGrowStyle,
} from './AppWindow';
import { IconRail } from './IconRail';
import { useSessionContext } from '../context/session-context';
import { breakpoints } from '../design-system/tokens';

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

  /*
   * The app's only surface state: chat shell vs full-page dossier.
   *
   * `useState`, not a router and not localStorage — see the long note in
   * `context/view-context.tsx` for why persisting it or portalling the dossier
   * were both rejected.
   */
  const view = useViewState();
  const isDossier = view.surface === 'dossier';

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

  // The brief needs to know the breakpoint itself: on mobile it goes full-width
  // and drops the scroll fade, which at the foot of a full-height panel reads as
  // a rendering fault rather than as depth.
  const profilePanel = <BriefRail isMobile={isMobile} />;

  /* Live region for screen reader announcements (R8.4) */
  const liveRegion = (
    <div aria-live="polite" aria-atomic="true" style={liveRegionStyle} data-testid="live-region">
      {discovery.liveAnnouncement}
    </div>
  );

  /**
   * Tapping a mobile tab leaves the dossier on the way to that panel.
   *
   * Without this the tab would appear to do nothing: the panel behind the
   * dossier would change while the dossier stayed on top of it.
   */
  const changePanel = (panel: 'chat' | 'profile') => {
    setActivePanel(panel);
    view.setSurface('chat');
  };

  if (isMobile) {
    return (
      <DiscoveryProvider value={discovery}>
        <ViewProvider value={view}>
          <div data-testid="app-layout" data-layout="mobile" data-surface={view.surface}>
            <AppWindow variant="mobile">
              <IconRail
                orientation="row"
                activeView={activePanel}
                onViewChange={changePanel}
                onOpenSessions={() => setSidebarOpen(true)}
                isDossierActive={isDossier}
                onToggleDossier={view.toggleDossier}
                dossierToggleRef={view.dossierToggleRef}
              />
              <div style={windowCellStyle}>
                <MobileNav
                  activePanel={activePanel}
                  onPanelChange={changePanel}
                  isDossierActive={isDossier}
                  onOpenDossier={view.openDossier}
                />
                <div style={windowCellGrowStyle}>
                  {/* The dossier replaces both panels full-bleed rather than
                      sitting inside one of them. */}
                  {isDossier ? (
                    <DossierView isMobile />
                  ) : activePanel === 'chat' ? (
                    <ChatPanel />
                  ) : (
                    profilePanel
                  )}
                </div>
              </div>
            </AppWindow>
            <SessionSidebar isMobile={true} />
            {liveRegion}
          </div>
        </ViewProvider>
      </DiscoveryProvider>
    );
  }

  return (
    <DiscoveryProvider value={discovery}>
      <ViewProvider value={view}>
        <div data-testid="app-layout" data-layout="desktop" data-surface={view.surface}>
          {/* Two columns for the dossier, four for the chat shell. The rail keeps
              its 76px across both, so it does not shift under the cursor. */}
          <AppWindow variant="desktop" columns={isDossier ? DOSSIER_COLUMNS : undefined}>
            {/* In the chat shell both surfaces are on screen at once, so no rail
                button claims to be the active view. The dossier is a single
                surface, so there the ♥ does. */}
            <IconRail
              orientation="column"
              activeView={null}
              onOpenSessions={() => setSidebarOpen(true)}
              isDossierActive={isDossier}
              onToggleDossier={view.toggleDossier}
              dossierToggleRef={view.dossierToggleRef}
            />
            {isDossier ? (
              <DossierView />
            ) : (
              <>
                <SessionSidebar isMobile={false} />
                <div style={windowCellStyle}>
                  <ChatPanel />
                </div>
                <div style={windowCellStyle}>{profilePanel}</div>
              </>
            )}
          </AppWindow>
          {liveRegion}
        </div>
      </ViewProvider>
    </DiscoveryProvider>
  );
}
