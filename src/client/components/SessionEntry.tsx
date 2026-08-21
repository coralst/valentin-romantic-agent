import { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography, shadows, borderRadius, animation } from '../design-system/tokens';
import { formatRelativeTime } from '../hooks/use-session-store';
import type { StoredSession } from '../hooks/use-session-store';

interface SessionEntryProps {
  session: StoredSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
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

const actionRowStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  display: 'flex',
  gap: 4,
};

const actionButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: borderRadius.sm,
  color: '#fff',
  fontSize: '0.75rem',
  cursor: 'pointer',
  opacity: 0,
  transition: `opacity ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  lineHeight: 1,
  padding: 0,
};

const renameButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: colors.softBurgundy,
};

const deleteButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: colors.error,
};

const renameInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: `4px ${spacing.xs / 2}px`,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  fontFamily: typography.bodyFontFamily,
  color: colors.text,
  border: `1px solid ${colors.softBurgundy}`,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surface,
  outline: 'none',
};

export function SessionEntry({ session, isActive, onSelect, onDelete, onRename }: SessionEntryProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const lastMessage = session.messages.length > 0
    ? session.messages[session.messages.length - 1].content
    : '';
  const preview = lastMessage.length > 40 ? lastMessage.slice(0, 40) + '...' : lastMessage;
  const title = session.title || session.partnerName || 'New conversation';

  // Focus and select the input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setDraftTitle(session.title || session.partnerName || '');
    setIsEditing(true);
  };

  const commitRename = () => {
    if (!isEditing) return;
    setIsEditing(false);
    onRename(session.id, draftTitle);
  };

  const cancelRename = () => {
    setIsEditing(false);
    setDraftTitle('');
  };

  const entryStyle: React.CSSProperties = {
    ...entryBaseStyle,
    backgroundColor: isActive ? colors.highlight : isHovered ? colors.champagne : 'transparent',
    boxShadow: isHovered ? shadows.subtle : 'none',
    cursor: isEditing ? 'default' : 'pointer',
  };

  const renameVisibleStyle: React.CSSProperties = {
    ...renameButtonStyle,
    opacity: isHovered ? 1 : 0,
  };

  const deleteVisibleStyle: React.CSSProperties = {
    ...deleteButtonStyle,
    opacity: isHovered ? 1 : 0,
  };

  const meta = (
    <>
      {isEditing ? (
        <input
          ref={inputRef}
          style={renameInputStyle}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelRename();
            }
          }}
          aria-label={`Rename session: ${title}`}
          maxLength={60}
          data-testid="rename-session-input"
        />
      ) : (
        <p style={titleStyle}>{title}</p>
      )}
      {preview && <p style={previewStyle}>{preview}</p>}
      <div style={metaRowStyle}>
        <span style={timeStyle}>{formatRelativeTime(session.lastActivity)}</span>
        {session.messageCount > 0 && (
          <span style={badgeStyle}>{session.messageCount}</span>
        )}
      </div>
    </>
  );

  const actions = !isEditing && (
    <div style={actionRowStyle}>
      <span
        style={renameVisibleStyle}
        role="button"
        tabIndex={0}
        aria-label={`Rename session: ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            startEditing();
          }
        }}
        data-testid="rename-session-button"
      >
        &#9998;
      </span>
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
    </div>
  );

  // While editing, render a non-button container so the <input> is valid
  // and keystrokes/focus aren't swallowed by an enclosing <button>.
  if (isEditing) {
    return (
      <div
        style={entryStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        data-testid="session-entry"
      >
        {meta}
      </div>
    );
  }

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
      {meta}
      {actions}
    </button>
  );
}
