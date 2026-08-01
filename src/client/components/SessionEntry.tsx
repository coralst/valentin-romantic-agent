import { useState } from 'react';
import { colors, spacing, typography, shadows, borderRadius, animation } from '../design-system/tokens';
import { formatRelativeTime } from '../hooks/use-session-store';
import type { StoredSession } from '../hooks/use-session-store';

interface SessionEntryProps {
  session: StoredSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const entryBaseStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: `${spacing.xs}px ${spacing.xs + 4}px`,
  borderRadius: borderRadius.md,
  cursor: 'pointer',
  transition: `all ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  border: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
  fontFamily: typography.bodyFontFamily,
};

const titleStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  color: colors.text,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const previewStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing.xs,
};

const timeStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
};

const badgeStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: typography.weights.medium,
  backgroundColor: colors.dustyRose,
  color: colors.text,
  borderRadius: borderRadius.full,
  padding: '1px 6px',
  lineHeight: 1.4,
};

const deleteButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: borderRadius.sm,
  backgroundColor: colors.error,
  color: '#fff',
  fontSize: '0.75rem',
  cursor: 'pointer',
  opacity: 0,
  transition: `opacity ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  lineHeight: 1,
  padding: 0,
};

export function SessionEntry({ session, isActive, onSelect, onDelete }: SessionEntryProps) {
  const [isHovered, setIsHovered] = useState(false);

  const lastMessage = session.messages.length > 0
    ? session.messages[session.messages.length - 1].content
    : '';
  const preview = lastMessage.length > 40 ? lastMessage.slice(0, 40) + '...' : lastMessage;
  const title = session.partnerName || 'New conversation';

  const entryStyle: React.CSSProperties = {
    ...entryBaseStyle,
    backgroundColor: isActive ? colors.highlight : isHovered ? colors.champagne : 'transparent',
    boxShadow: isHovered ? shadows.subtle : 'none',
  };

  const deleteVisibleStyle: React.CSSProperties = {
    ...deleteButtonStyle,
    opacity: isHovered ? 1 : 0,
  };

  return (
    <button
      style={entryStyle}
      onClick={() => onSelect(session.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label={`Switch to session: ${title}`}
      aria-current={isActive ? 'true' : undefined}
      data-testid="session-entry"
    >
      <p style={titleStyle}>{title}</p>
      {preview && <p style={previewStyle}>{preview}</p>}
      <div style={metaRowStyle}>
        <span style={timeStyle}>{formatRelativeTime(session.lastActivity)}</span>
        {session.messageCount > 0 && (
          <span style={badgeStyle}>{session.messageCount}</span>
        )}
      </div>
      <span
        style={deleteVisibleStyle}
        role="button"
        tabIndex={0}
        aria-label={`Delete session: ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            onDelete(session.id);
          }
        }}
        data-testid="delete-session-button"
      >
        &times;
      </span>
    </button>
  );
}
