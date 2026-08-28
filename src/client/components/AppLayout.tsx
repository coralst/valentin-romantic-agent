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
import { AppWindow, DOSSIER_COLUMNS, windowCellStyle, windowCellGrowStyle } from './AppWindow';
import { IconRail } from './IconRail';
import { LiveArchitectureDrawer, reservedDrawerSpace } from './LiveArchitectureDrawer';
import {
  ArchitectureDrawerProvider,
  useArchitectureDrawer,
} from '../context/architecture-drawer-context';
import { ArchitectureEngineProvider } from '../context/architecture-engine-context';
import { useSessionContext } from '../context/session-context';
import { breakpoints, layout } from '../design-system/tokens';

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
 * The positioning context the architecture drawer anchors to, and the region
 * that gives up the space the drawer occupies.
 *
 * Two things are load-bearing here.
 *
 * `position: relative`, because the drawer is `position: absolute` and this is
 * what makes it span exactly the region below. It must NOT be `position: fixed`
 * and must not portal to `document.body`: the app window sets `overflow: hidden`
 * to keep its 34px radius crisp, so the window's own clip is what keeps the
 * drawer's bottom corners inside the frame instead of running past it. (The old
 * inspector portalled out to escape the deleted header's `backdrop-filter`; that
 * reason is gone, and the replacement reason points the other way — stay inside.)
 *
 * `paddingBottom`, because the drawer is a 424px overlay pinned to the bottom of
 * this region — which is exactly where the composer sits. Reserving the space
 * rather than covering it is the drawer's whole contract ("not a dialog, no focus
 * trap, composer stays typable"); occlusion breaks it just as effectively as a
 * modal would. `boxSizing: border-box` is what makes the padding shrink the
 * children's height rather than growing the region past its grid track.
 *
 * The amount comes from `reservedDrawerSpace()`, which lives next to the heights
 * it derives from so the layout cannot drift out of agreement with the drawer.
 */
function drawerHostStyle(
  gridColumn: string,
  reserved: number,
  isChatShell: boolean,
): React.CSSProperties {
  return {
    gridColumn,
    position: 'relative',
    boxSizing: 'border-box',
    paddingBottom: reserved,
    display: 'grid',
    // Chat + brief keep their own tracks inside the host, so wrapping them does
    // not change the window's column template.
    gridTemplateColumns: isChatShell
      ? `minmax(0, 1fr) ${layout.briefRailWidth}px`
      : 'minmax(0, 1fr)',
    gridTemplateRows: '100%',
    minWidth: 0,
    minHeight: 0,
    // The reopen bar parks itself at `translateY(100%)` while the drawer is up,
    // i.e. 34px *below* this host's bottom edge. A transform does not affect
    // layout but it does extend the scrollable overflow area, so without this
    // clip the host is 34px taller than its grid track — and the first thing to
    // scroll it (sending a message, which scrolls the transcript to the bottom)
    // slides the whole window grid up by 34px, dragging the icon rail and the
    // sidebar to `top: -20` and shearing the crest off the top of the frame.
    // Found by driving a real turn with the drawer open; no unit test sees it,
    // because jsdom performs no layout and so has no overflow to scroll.
    overflow: 'hidden',
  };
}

/** The chat shell's host covers the chat and brief tracks (columns 3 and 4). */
const CHAT_COLUMNS_SPAN = '3 / 5';
/** With the conversation list collapsed those are columns 2 and 3 instead. */
const CHAT_COLUMNS_SPAN_NO_LIST = '2 / 4';
/** The dossier's host covers the single board track (column 2). */
const DOSSIER_COLUMN_SPAN = '2 / 3';

/**
 * The chat shell with the conversation list hidden: rail | chat | brief.
 *
 * `DESKTOP_COLUMNS` minus the list track, rather than keeping the track and
 * hiding its occupant — the point of the ☰ on a wide screen is to give the
 * conversation the 226px, and an empty track would leave a hole instead.
 */
const COLLAPSED_CHAT_COLUMNS = [
  `${layout.iconRailWidth}px`,
  'minmax(0, 1fr)',
  `${layout.briefRailWidth}px`,
].join(' ');

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
        {/* Here for the same sibling-subtree reason, one level in: the engine
            switch is in the icon rail, the diagram it redraws is in the drawer. */}
        <ArchitectureEngineProvider>
          <AppLayoutContent />
        </ArchitectureEngineProvider>
      </ArchitectureDrawerProvider>
    </ProfileStoreProvider>
  );
}

function AppLayoutContent() {
  const [isMobile, setIsMobile] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'profile'>('chat');
  const { setSidebarOpen } = useSessionContext();

  /*
   * Whether the desktop conversation list is showing.
   *
   * Local to the layout rather than `session-context`'s `sidebarOpen`: that flag
   * is the *mobile* overlay's, it starts closed, and reusing it would open the
   * desktop shell with its list column already collapsed. Here the column is a
   * permanent part of the shell that the ☰ takes away, so the default is shown.
   */
  const [isListOpen, setListOpen] = useState(true);

  // Read here rather than inside the drawer: the *layout* is what has to give up
  // the space, and only the layout owns the regions whose height it takes from.
  const { isOpen: isDrawerOpen } = useArchitectureDrawer();
  const reserved = reservedDrawerSpace(isDrawerOpen);

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
    // `closeDossier` rather than `setSurface('chat')`, so the history entry the
    // dossier pushed is dropped on this route out too — otherwise the browser's
    // Back button would have a spent entry to consume before it did anything.
    if (isDossier) view.closeDossier();
  };

  /**
   * What the rail's ◆ and ♥ do on desktop.
   *
   * The desktop rail used to be rendered without `onViewChange` at all, which
   * made the ◆ call an undefined prop — it looked like a button and did nothing.
   * Both surfaces are on screen there, so "switch to chat" means "leave the
   * dossier if it is up, and put the caret in the composer"; see `returnToChat`.
   */
  const changeDesktopView = (panel: 'chat' | 'profile') => {
    if (panel === 'chat') view.returnToChat();
    else view.openDossier();
  };

  /**
   * The crest is "home": it lands on the conversation from wherever you are.
   *
   * A no-op on desktop chat — that is the honest answer there, because home is
   * already what you are looking at — and never an error. `closeDossier` is
   * guarded rather than called blind so a click on the chat shell does not yank
   * focus to the ♥ for no reason.
   */
  const goHome = () => {
    if (isDossier) view.closeDossier();
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
                onGoHome={() => changePanel('chat')}
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
                {/* On mobile the composer is nearly the whole screen, so the
                    drawer occluding it matters more here, not less — hence the
                    same reserved space as on desktop. `flex: 1` alongside
                    `minHeight: 0` keeps this region filling the cell rather than
                    sizing to its content, which would float the composer
                    mid-screen. */}
                <div
                  style={{
                    ...windowCellGrowStyle,
                    position: 'relative',
                    boxSizing: 'border-box',
                    paddingBottom: reserved,
                  }}
                  data-drawer-reserved={reserved}
                >
                  {/* The dossier replaces both panels full-bleed rather than
                      sitting inside one of them. */}
                  {isDossier ? (
                    <DossierView isMobile />
                  ) : activePanel === 'chat' ? (
                    <ChatPanel />
                  ) : (
                    profilePanel
                  )}
                  {/* The diagram is 916px wide, so on a phone it scrolls
                      horizontally rather than being withheld — a presenter may
                      well be on a laptop in a narrow window, and hiding the
                      drawer there is worse. */}
                  <LiveArchitectureDrawer />
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
          {/* Two columns for the dossier, four for the chat shell — three with
              the conversation list collapsed. The rail keeps its 76px across all
              three, so it does not shift under the cursor. */}
          <AppWindow
            variant="desktop"
            columns={isDossier ? DOSSIER_COLUMNS : isListOpen ? undefined : COLLAPSED_CHAT_COLUMNS}
          >
            {/* In the chat shell both surfaces are on screen at once, so no rail
                button claims to be the active view. The dossier is a single
                surface, so there the ♥ does. */}
            <IconRail
              orientation="column"
              activeView={null}
              onViewChange={changeDesktopView}
              onGoHome={goHome}
              // The list is a permanent column here, so the ☰ is a two-way
              // toggle: hiding it hands the 226px to the conversation.
              onOpenSessions={() => setListOpen((open) => !open)}
              isSessionsOpen={isListOpen}
              isDossierActive={isDossier}
              onToggleDossier={view.toggleDossier}
              dossierToggleRef={view.dossierToggleRef}
            />
            {isDossier ? (
              /* The drawer follows the dossier rather than unmounting with the
                 chat shell: closing it on a surface switch would drop the
                 presenter's place in the walkthrough mid-sentence. */
              <div
                style={drawerHostStyle(DOSSIER_COLUMN_SPAN, reserved, false)}
                data-drawer-reserved={reserved}
              >
                <DossierView />
                <LiveArchitectureDrawer />
              </div>
            ) : (
              <>
                {isListOpen && <SessionSidebar isMobile={false} />}
                <div
                  style={drawerHostStyle(
                    isListOpen ? CHAT_COLUMNS_SPAN : CHAT_COLUMNS_SPAN_NO_LIST,
                    reserved,
                    true,
                  )}
                  data-drawer-reserved={reserved}
                >
                  <div style={windowCellStyle}>
                    <ChatPanel />
                  </div>
                  <div style={windowCellStyle}>{profilePanel}</div>
                  <LiveArchitectureDrawer />
                </div>
              </>
            )}
          </AppWindow>
          {liveRegion}
        </div>
      </ViewProvider>
    </DiscoveryProvider>
  );
}
