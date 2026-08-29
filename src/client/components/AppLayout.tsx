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
  windowCellStyle,
  windowCellGrowStyle,
} from './AppWindow';
import { IconRail } from './IconRail';
import { LiveArchitectureDrawer, reservedDrawerSpace } from './LiveArchitectureDrawer';
import {
  ArchitectureDrawerProvider,
  useArchitectureDrawer,
} from '../context/architecture-drawer-context';
import { useSessionContext } from '../context/session-context';
import { IntegrationsProvider } from '../context/integrations-context';
import { IntegrationsPanel } from './IntegrationsPanel';
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
 * The region the chat shell's two panels share, wrapped so they can span a
 * contiguous pair of window columns.
 *
 * The architecture drawer used to anchor here and reserve its space with this
 * region's `paddingBottom`. It no longer does: the drawer is a full-width strip at
 * the foot of `AppWindow`, and the window reserves the space for it on every
 * column at once (`bottomInset`), the icon rail and the conversation list
 * included. Anchoring it here made the bar start in the middle of the frame.
 *
 * `overflow: hidden` stays, and stays load-bearing for the same reason it always
 * was: a `translateY` does not affect layout but it does extend the scrollable
 * overflow area, so an unclipped region can be scrolled taller than its grid
 * track — and the first thing to scroll it (sending a message, which scrolls the
 * transcript to the bottom) slides the whole window grid up, dragging the icon
 * rail with it and shearing the crest off the top of the frame. Found by driving a
 * real turn; no unit test sees it, because jsdom performs no layout.
 */
function panelHostStyle(gridColumn: string, isChatShell: boolean): React.CSSProperties {
  return {
    gridColumn,
    position: 'relative',
    boxSizing: 'border-box',
    display: 'grid',
    // Chat + brief keep their own tracks inside the host, so wrapping them does
    // not change the window's column template.
    gridTemplateColumns: isChatShell
      ? `minmax(0, 1fr) ${layout.briefRailWidth}px`
      : 'minmax(0, 1fr)',
    gridTemplateRows: '100%',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  };
}

/** The chat shell's host covers the chat and brief tracks (columns 3 and 4). */
const CHAT_COLUMNS_SPAN = '3 / 5';
/** With the conversation list collapsed those are columns 2 and 3 instead. */
const CHAT_COLUMNS_SPAN_NO_LIST = '2 / 4';

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
      {/* Her family and his to-do list are *not* mounted here. They were, while
          they were localStorage-only, but the server now pushes `person_update`
          and `task_update` over the socket, and the socket provider is above
          this component — see `HerRecordsProviders` in `App`. */}
      {/* Above the layout because the magnifier lives in the sidebar and the
          drawer is mounted beside the chat — sibling subtrees. */}
      {/* The engine provider is deliberately NOT here beside it. The switch has to
          be readable by `WebSocketProvider`, which is above this component, because
          the engine decides which socket path the chat opens — so it lives in
          `App.tsx` instead. See the note there. */}
      <ArchitectureDrawerProvider>
        {/* Above the layout for the same reason: the badge that counts grants
            lives on the rail, and the panel that changes the count is mounted
            beside the chat. */}
        <IntegrationsProvider>
          <AppLayoutContent />
        </IntegrationsProvider>
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

  /*
   * Whether the window is too narrow to afford the conversation list a column.
   *
   * THE OTHER HALF OF THE SCALING FIX (see `chat-measure.ts` for the first).
   *
   * Three of the shell's four tracks are fixed pixel measurements, so every pixel
   * the window loses comes out of the chat column alone. Holding all three on a
   * 1000px window leaves the transcript 312px — three or four words a line, with
   * the composer pill narrower than its own placeholder. The list is the one of
   * the three with somewhere to go: it already has an overlay presentation for
   * mobile, so below the breakpoint it uses that and the ☰ raises it, exactly as
   * it does on a phone.
   *
   * A media query rather than the chat column's measured width: the column's width
   * is a *consequence* of this decision, so reading it back to make the decision
   * is a loop that settles by oscillating.
   */
  const [isNarrowDesktop, setNarrowDesktop] = useState(false);

  /*
   * Whether the integrations fan is up.
   *
   * A panel over the shell rather than a fifth surface: what it shows is "what
   * Valentin can reach", which is a fact *about* the conversation you are having,
   * and closing it should put you back exactly where you were. `useState` keeps
   * that true — no history entry, nothing persisted, gone on reload.
   */
  const [isIntegrationsOpen, setIntegrationsOpen] = useState(false);
  const toggleIntegrations = () => setIntegrationsOpen((open) => !open);

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

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoints.conversationList - 1}px)`);
    setNarrowDesktop(mql.matches);

    const handler = (e: MediaQueryListEvent) => setNarrowDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  /*
   * The list occupies a column only if it fits and has not been dismissed.
   *
   * `isListOpen` stays the user's preference rather than being overwritten when the
   * window narrows, so widening the window back out restores the column they had.
   */
  const hasListColumn = !isNarrowDesktop && isListOpen;

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
   * What the rail's ◆ does on desktop.
   *
   * The desktop rail used to be rendered without `onViewChange` at all, which
   * made the ◆ call an undefined prop — it looked like a button and did nothing.
   * Both surfaces are on screen there, so "switch to chat" means "leave the
   * dossier if it is up, and put the caret in the composer"; see `returnToChat`.
   * The 'profile' branch is kept because `RailView` still allows it, and the one
   * honest answer to it is her profile — but nothing in the rail asks for it any
   * more now that her portrait is the door.
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
   * focus to her portrait in the brief for no reason.
   */
  const goHome = () => {
    if (isDossier) view.closeDossier();
  };

  if (isMobile) {
    return (
      <DiscoveryProvider value={discovery}>
        <ViewProvider value={view}>
          <div data-testid="app-layout" data-layout="mobile" data-surface={view.surface}>
            <AppWindow
              variant="mobile"
              bottomInset={reserved}
              /* On mobile the composer is nearly the whole screen, so the drawer
                 occluding it matters more here, not less — hence the same
                 reserved strip as on desktop. */
              footer={<LiveArchitectureDrawer />}
            >
              <IconRail
                orientation="row"
                activeView={activePanel}
                onViewChange={changePanel}
                onGoHome={() => changePanel('chat')}
                onOpenSessions={() => setSidebarOpen(true)}
                onOpenIntegrations={toggleIntegrations}
                isIntegrationsOpen={isIntegrationsOpen}
              />
              <div style={windowCellStyle}>
                <MobileNav
                  activePanel={activePanel}
                  onPanelChange={changePanel}
                  isDossierActive={isDossier}
                  onOpenDossier={view.openDossier}
                />
                {/* `flex: 1` alongside `minHeight: 0` keeps this region filling
                    the cell rather than sizing to its content, which would float
                    the composer mid-screen. */}
                <div
                  style={{ ...windowCellGrowStyle, position: 'relative' }}
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
                </div>
              </div>
              {/* Inside the window, below the claret strip, so the same rail
                  button that opened it is still there to close it. */}
              {isIntegrationsOpen && (
                <IntegrationsPanel isMobile onClose={() => setIntegrationsOpen(false)} />
              )}
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
            bottomInset={reserved}
            /* The drawer follows both surfaces rather than unmounting with the
               chat shell: closing it on a surface switch would drop the
               presenter's place in the walkthrough mid-sentence. Rendered by the
               window, so its bar is one line across the whole bottom edge. */
            footer={<LiveArchitectureDrawer />}
            columns={hasListColumn ? undefined : COLLAPSED_CHAT_COLUMNS}
          >
            {/* `activeView={null}`: on desktop the chat shell shows both
                surfaces at once, so no rail button claims to be the active
                view. Her profile is not in the rail at all — it opens from her
                portrait in the brief. */}
            <IconRail
              orientation="column"
              activeView={null}
              onViewChange={changeDesktopView}
              onGoHome={goHome}
              // Wide enough for the column, the ☰ is a two-way toggle: hiding it
              // hands the 226px to the conversation. Too narrow for it, there is
              // no column to toggle, so the ☰ raises the overlay instead — the
              // same thing it does on mobile.
              onOpenSessions={
                isNarrowDesktop
                  ? () => setSidebarOpen(true)
                  : () => setListOpen((open) => !open)
              }
              isSessionsOpen={hasListColumn}
              onOpenIntegrations={toggleIntegrations}
              isIntegrationsOpen={isIntegrationsOpen}
            />
            {/* Her file is a *thread*, not a surface swap: the conversation list
                and the brief rail stay exactly where they are and only the middle
                column changes what it shows. The window therefore keeps its
                chat-shell column template on both surfaces — nothing under the
                cursor moves when you open her file, and the rail's "Coming next"
                and "What to do next" stay readable beside the board they
                summarise, which is the whole point of the layout. */}
            {hasListColumn && <SessionSidebar isMobile={false} />}
            <div
              style={panelHostStyle(
                hasListColumn ? CHAT_COLUMNS_SPAN : CHAT_COLUMNS_SPAN_NO_LIST,
                true,
              )}
            >
              <div style={windowCellStyle}>
                {isDossier ? <DossierView /> : <ChatPanel />}
              </div>
              <div style={windowCellStyle}>{profilePanel}</div>
            </div>
            {/* Spans every track except the rail's, over both surfaces — the
                dossier is as good a place to ask "what can he reach?" as the
                chat is, and unmounting it on a surface switch would be a
                surprise rather than a courtesy. */}
            {isIntegrationsOpen && (
              <IntegrationsPanel
                isMobile={false}
                onClose={() => setIntegrationsOpen(false)}
              />
            )}
          </AppWindow>
          {/* The overlay presentation of the list, for the widths where it has no
              column. Outside `AppWindow` because it is `position: fixed` and the
              window sets `overflow: hidden` to keep its 34px radius crisp — inside,
              the frame would clip it. It renders nothing until the ☰ opens it. */}
          {isNarrowDesktop && <SessionSidebar isMobile={true} />}
          {liveRegion}
        </div>
      </ViewProvider>
    </DiscoveryProvider>
  );
}
