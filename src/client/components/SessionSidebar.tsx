import { useEffect } from 'react';
import {
  colors,
  spacing,
  typography,
  shadows,
  radii,
  insets,
  layout,
  animation,
} from '../design-system/tokens';
import { useSessionContext } from '../context/session-context';
import { useOptionalViewContext } from '../context/view-context';
import { SessionEntry } from './SessionEntry';
import { ArchitectureToggle } from './ArchitectureToggle';

/**
 * Column 2 of the window: the wordmark, the architecture magnifier, the
 * new-conversation button and the conversation list on a sand ground.
 *
 * There is deliberately no collapsed rail any more. The mockup has no collapsed
 * state, and the 76px claret icon rail in column 1 now plays the role the old
 * collapse-to-rail mode was serving. The drawer therefore no longer needs a
 * `SIDEBAR_WIDTH` / `RAIL_WIDTH` pair exported from here — the column is one
 * fixed `layout.conversationListWidth`, and the drawer is anchored by a grid
 * wrapper in `AppLayout` rather than by a hardcoded left inset.
 */
const columnStyle: React.CSSProperties = {
  width: layout.conversationListWidth,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: colors.sand,
  padding: `22px ${insets.tight}px ${spacing.sm}px`,
};

const mobileOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,
  display: 'flex',
};

const mobileBackdropStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  transition: `opacity ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
};

const mobileSidebarStyle: React.CSSProperties = {
  ...columnStyle,
  position: 'relative',
  height: '100%',
  boxShadow: shadows.cardHover,
  transition: `transform ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  zIndex: 101,
};

const wordmarkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: spacing.xs,
};

const wordmarkActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flexShrink: 0,
};

const wordmarkNameStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingLg,
  fontWeight: typography.weights.normal,
  color: colors.ink,
  lineHeight: 1.1,
  margin: 0,
};

const wordmarkSubtitleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.labelLoose,
  color: colors.inkFaint,
  marginBottom: spacing.sm,
};

const newChatButtonStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '11px 0',
  backgroundColor: colors.claret,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  fontWeight: typography.weights.medium,
  marginBottom: spacing.sm,
  boxShadow: '0 5px 14px rgba(140, 47, 69, 0.26)',
};

const closeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  flexShrink: 0,
  border: 'none',
  borderRadius: radii.icon,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: typography.px.control,
  color: colors.inkMuted,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const sessionListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.sm,
  textAlign: 'center',
  flex: 1,
};

const emptyTextStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkFaint,
  lineHeight: typography.lineHeights.normal,
};

const noticeStripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: spacing.xs,
  margin: `${spacing.xs}px ${spacing.xs / 2}px 0`,
  padding: `${spacing.xs}px ${spacing.xs + 2}px`,
  borderRadius: radii.kv,
  backgroundColor: colors.champagne,
  color: colors.inkMuted,
};

const errorStripStyle: React.CSSProperties = {
  ...noticeStripStyle,
  backgroundColor: 'rgba(180, 70, 70, 0.10)',
  color: colors.error,
};

const noticeTextStyle: React.CSSProperties = {
  flex: 1,
  fontSize: typography.px.label,
  fontFamily: typography.bodyFontFamily,
  lineHeight: typography.lineHeights.normal,
};

const noticeDismissStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  lineHeight: 1,
  cursor: 'pointer',
  color: 'inherit',
  fontSize: typography.px.control,
};

/**
 * "Her file", pinned above the conversations.
 *
 * Her file now opens *in the chat column* rather than replacing the whole shell,
 * which leaves the list on screen beside it — and a list where nothing is
 * selected, while a board is clearly on screen, reads as the app having lost
 * track of where you are. So it is a thread: pinned, always first, selected
 * whenever the board is up.
 *
 * Not a `SessionEntry`: it has no transcript, no message count, no last-activity
 * line, and it can be neither renamed nor deleted. Reusing the row would mean
 * making all five of those optional to say one thing.
 */
const herFileRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  width: '100%',
  textAlign: 'left',
  cursor: 'pointer',
  border: 'none',
  borderRadius: radii.kv,
  padding: `9px ${spacing.xs + 2}px`,
  marginBottom: 4,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const herFileActiveStyle: React.CSSProperties = {
  ...herFileRowStyle,
  backgroundColor: colors.champagne,
  color: colors.claret,
  fontWeight: typography.weights.medium,
};

const herFileIdleStyle: React.CSSProperties = {
  ...herFileRowStyle,
  backgroundColor: 'transparent',
  color: colors.inkMuted,
};

interface SessionSidebarProps {
  isMobile: boolean;
}

export function SessionSidebar({ isMobile }: SessionSidebarProps) {
  const {
    state,
    createSession,
    switchSession,
    removeSession,
    renameSession,
    setSidebarOpen,
    dismissNotice,
  } = useSessionContext();

  const { sessions, activeSessionId, sidebarOpen, loading, error, notice } = state;

  /*
   * Optional, like `BriefRail`'s: this column is mounted on its own in unit
   * tests, and a conversation list that crashed without the surface state would
   * be the wrong trade for a pinned row.
   */
  const view = useOptionalViewContext();
  const isHerFile = view?.surface === 'dossier';

  // Close mobile sidebar on Escape
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  // Every handler below talks to the server now. The failure is surfaced by the
  // context as `state.error`, so these only need to stop an unhandled rejection
  // from reaching the console.
  /*
   * Picking a conversation has to move you to it, not just change which one is
   * active underneath the surface you are already on.
   *
   * The conversation list is pinned beside the dossier as well as the chat shell,
   * so both of these are reachable while `surface === 'dossier'`. Without the
   * `returnToChat`, "+ New conversation" created the session, made it active, and
   * left the dossier on screen — the new conversation existed and there was no way
   * into it. Selecting an existing one was worse: the middle column had nothing
   * left to render, so it went blank while the surface still said `dossier`.
   *
   * `returnToChat` rather than `closeDossier`: this is "take me to the
   * conversation", which also puts the caret in the composer, and is a no-op for
   * the surface when you are already in the chat shell — exactly what the icon
   * rail's ◆ does.
   */
  const handleNewChat = () => {
    view?.returnToChat();
    void createSession().catch(() => {});
  };

  const handleSelect = (id: string) => {
    // Awaited, unlike the new chat above: `switchSession` leaves the current
    // conversation active when its fetch fails (see session-context), so moving
    // the surface first would eject the reader out of her file and land them back
    // in the conversation they already had, with only an error strip to explain
    // it. Staying put on failure is the smaller loss.
    void switchSession(id)
      .then(() => view?.returnToChat())
      .catch(() => {});
  };

  const handleDelete = (id: string) => {
    void removeSession(id).catch(() => {});
  };

  const handleRename = (id: string, title: string) => {
    void renameSession(id, title).catch(() => {});
  };

  /** The list body: loading, empty, or the conversations themselves */
  const renderList = () => {
    if (loading && sessions.length === 0) {
      return (
        <div style={emptyStateStyle} data-testid="session-list-loading">
          <p style={emptyTextStyle}>Loading your conversations…</p>
        </div>
      );
    }

    if (sessions.length === 0) {
      return (
        <div style={emptyStateStyle} data-testid="session-empty-state">
          <p style={emptyTextStyle}>
            No conversations yet. Start your first chat to begin building a relationship profile.
          </p>
        </div>
      );
    }

    return sessions.map((session) => (
      <SessionEntry
        key={session.id}
        session={session}
        // While her file is up, the conversation is not what you are looking at,
        // so two rows must not both claim to be selected.
        isActive={!isHerFile && session.id === activeSessionId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    ));
  };

  /** The notice strip, shown for a discarded local history or a failed call */
  const renderMessage = () => {
    const text = error ?? notice;
    if (!text) return null;

    return (
      <div
        style={error ? errorStripStyle : noticeStripStyle}
        role="status"
        data-testid={error ? 'session-error' : 'session-notice'}
      >
        <span style={noticeTextStyle}>{text}</span>
        <button
          style={noticeDismissStyle}
          onClick={dismissNotice}
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    );
  };

  const wordmark = (
    <div style={wordmarkRowStyle}>
      <div>
        <h3 style={wordmarkNameStyle}>Valentin</h3>
      </div>
      {/* The magnifier that raises the Live Architecture drawer. It sits here
          rather than in the demo toolbar so it is reachable from every screen —
          on mobile the toolbar is behind the rail's gear, two taps away. Compact
          in both surfaces: the column is 226px and the text variant crowds the
          wordmark. */}
      <div style={wordmarkActionsStyle}>
        <ArchitectureToggle compact />
        {isMobile && (
          <button
            style={closeButtonStyle}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );

  const body = (
    <>
      {wordmark}
      <div style={wordmarkSubtitleStyle}>Romantic Agent</div>
      <button style={newChatButtonStyle} onClick={handleNewChat} aria-label="New chat">
        + New conversation
      </button>
      {renderMessage()}
      {view && (
        <button
          type="button"
          style={isHerFile ? herFileActiveStyle : herFileIdleStyle}
          onClick={() => {
            if (isHerFile) view.returnToChat();
            else view.openDossier();
            if (isMobile) setSidebarOpen(false);
          }}
          aria-current={isHerFile ? 'true' : undefined}
          data-testid="her-file-thread"
        >
          <span aria-hidden="true">◆</span>
          Her file
        </button>
      )}
      <div style={sessionListStyle} data-testid="session-list">
        {renderList()}
      </div>
    </>
  );

  // Mobile: render as overlay when open
  if (isMobile) {
    if (!sidebarOpen) return null;

    return (
      <div style={mobileOverlayStyle} data-testid="session-sidebar-overlay">
        <div style={mobileBackdropStyle} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        <aside
          style={mobileSidebarStyle}
          data-testid="session-sidebar"
          role="complementary"
          aria-label="Session history"
        >
          {body}
        </aside>
      </div>
    );
  }

  return (
    <aside
      style={columnStyle}
      data-testid="session-sidebar"
      role="complementary"
      aria-label="Session history"
    >
      {body}
    </aside>
  );
}
