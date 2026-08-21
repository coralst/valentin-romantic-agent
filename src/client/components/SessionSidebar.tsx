import { useEffect } from 'react';
import { colors, spacing, typography, shadows, borderRadius, animation, breakpoints } from '../design-system/tokens';
import { useSessionContext } from '../context/session-context';
import { SessionEntry } from './SessionEntry';
import { ArchitectureToggle } from './ArchitectureToggle';

/** Exported so the architecture drawer can start where the sidebar ends. */
export const SIDEBAR_WIDTH = 280;
export const RAIL_WIDTH = 56;

const sidebarExpandedStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  minWidth: SIDEBAR_WIDTH,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: colors.surfaceElevated,
  borderRight: `1px solid ${colors.borderSubtle}`,
  transition: `width ${animation.durations.normal}ms ${animation.easing.easeInOut}, min-width ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  overflow: 'hidden',
};

const sidebarRailStyle: React.CSSProperties = {
  ...sidebarExpandedStyle,
  width: RAIL_WIDTH,
  minWidth: RAIL_WIDTH,
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
  position: 'relative',
  width: SIDEBAR_WIDTH,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: colors.surface,
  boxShadow: shadows.cardHover,
  transition: `transform ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  zIndex: 101,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${spacing.xs + 4}px ${spacing.xs + 4}px`,
  borderBottom: `1px solid ${colors.borderSubtle}`,
  gap: spacing.xs,
};

const headerRailStyle: React.CSSProperties = {
  ...headerStyle,
  flexDirection: 'column',
  padding: `${spacing.xs + 4}px ${spacing.xs / 2}px`,
  gap: spacing.xs,
};

const newChatButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: `6px ${spacing.xs + 4}px`,
  background: colors.accentGradient,
  color: colors.textOnAccent,
  border: 'none',
  borderRadius: borderRadius.sm,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  fontFamily: typography.bodyFontFamily,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const newChatIconOnlyStyle: React.CSSProperties = {
  ...newChatButtonStyle,
  padding: '6px 8px',
  borderRadius: borderRadius.sm,
};

const toggleButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: borderRadius.sm,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const sessionListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: `${spacing.xs}px ${spacing.xs / 2}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.md,
  textAlign: 'center',
  flex: 1,
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  fontFamily: typography.bodyFontFamily,
  lineHeight: typography.lineHeights.normal,
};

interface SessionSidebarProps {
  isMobile: boolean;
}

export function SessionSidebar({ isMobile }: SessionSidebarProps) {
  const {
    state,
    activeSession,
    createSession,
    switchSession,
    removeSession,
    renameSession,
    toggleSidebar,
    setSidebarOpen,
  } = useSessionContext();

  const { sessions, activeSessionId, sidebarCollapsed, sidebarOpen } = state;

  // Close mobile sidebar on Escape
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isMobile, sidebarOpen, setSidebarOpen]);

  const handleNewChat = () => {
    createSession();
  };

  const handleSelect = (id: string) => {
    switchSession(id);
  };

  const handleDelete = (id: string) => {
    removeSession(id);
  };

  const handleRename = (id: string, title: string) => {
    renameSession(id, title);
  };

  // Mobile: render as overlay when open
  if (isMobile) {
    if (!sidebarOpen) return null;

    return (
      <div style={mobileOverlayStyle} data-testid="session-sidebar-overlay">
        <div
          style={mobileBackdropStyle}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
        <aside style={mobileSidebarStyle} data-testid="session-sidebar" role="complementary" aria-label="Session history">
          <div style={headerStyle}>
            <button style={newChatButtonStyle} onClick={handleNewChat} aria-label="New chat">
              <span>+</span>
              <span>New chat</span>
            </button>
            <ArchitectureToggle compact />
            <button
              style={toggleButtonStyle}
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              &times;
            </button>
          </div>
          <div style={sessionListStyle} data-testid="session-list">
            {sessions.length === 0 ? (
              <div style={emptyStateStyle} data-testid="session-empty-state">
                <p style={emptyTextStyle}>
                  No conversations yet. Start your first chat to begin building a relationship profile.
                </p>
              </div>
            ) : (
              sessions.map((session) => (
                <SessionEntry
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                  onRename={handleRename}
                />
              ))
            )}
          </div>
        </aside>
      </div>
    );
  }

  // Desktop: collapsed rail
  if (sidebarCollapsed) {
    return (
      <aside style={sidebarRailStyle} data-testid="session-sidebar" data-collapsed="true" role="complementary" aria-label="Session history">
        <div style={headerRailStyle}>
          <button style={newChatIconOnlyStyle} onClick={handleNewChat} aria-label="New chat" title="New chat">
            <span>+</span>
          </button>
          <ArchitectureToggle compact />
          <button
            style={toggleButtonStyle}
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            &#9654;
          </button>
        </div>
      </aside>
    );
  }

  // Desktop: expanded
  return (
    <aside style={sidebarExpandedStyle} data-testid="session-sidebar" data-collapsed="false" role="complementary" aria-label="Session history">
      <div style={headerStyle}>
        <button style={newChatButtonStyle} onClick={handleNewChat} aria-label="New chat">
          <span>+</span>
          <span>New chat</span>
        </button>
        <ArchitectureToggle compact />
        <button
          style={toggleButtonStyle}
          onClick={toggleSidebar}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          &#9664;
        </button>
      </div>
      <div style={sessionListStyle} data-testid="session-list">
        {sessions.length === 0 ? (
          <div style={emptyStateStyle} data-testid="session-empty-state">
            <p style={emptyTextStyle}>
              No conversations yet. Start your first chat to begin building a relationship profile.
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionEntry
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))
        )}
      </div>
    </aside>
  );
}
