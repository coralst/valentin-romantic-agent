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
import { SessionEntry } from './SessionEntry';

/**
 * Column 2 of the window: the wordmark, the new-conversation button and the
 * conversation list on a sand ground.
 *
 * There is deliberately no collapsed rail any more. The mockup has no collapsed
 * state, and the 76px claret icon rail in column 1 now plays the role the old
 * collapse-to-rail mode was serving.
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
  } = useSessionContext();

  const { sessions, activeSessionId, sidebarOpen } = state;

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

  const wordmark = (
    <div style={wordmarkRowStyle}>
      <div>
        <h3 style={wordmarkNameStyle}>Valentin</h3>
      </div>
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
  );

  const body = (
    <>
      {wordmark}
      <div style={wordmarkSubtitleStyle}>Romantic Agent</div>
      <button style={newChatButtonStyle} onClick={handleNewChat} aria-label="New chat">
        + New conversation
      </button>
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
              onSelect={switchSession}
              onDelete={removeSession}
              onRename={renameSession}
            />
          ))
        )}
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
