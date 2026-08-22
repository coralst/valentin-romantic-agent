import { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography, radii, animation } from '../design-system/tokens';
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
  gap: 2,
  padding: '11px 13px',
  borderRadius: radii.chip,
  cursor: 'pointer',
  transition: `all ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  border: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
  fontFamily: typography.bodyFontFamily,
};

/** The title row: an olive presence dot on the active row, then the name. */
const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
};

const activeDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  flexShrink: 0,
  borderRadius: radii.pill,
  backgroundColor: colors.olive,
};

const titleStyle: React.CSSProperties = {
  fontSize: typography.px.body,
  fontWeight: typography.weights.medium,
  color: colors.ink,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** "11m ago · 8 messages" — the mockup folds time and count into one line. */
const sublineStyle: React.CSSProperties = {
  fontSize: typography.px.caption,
  color: colors.inkFaint,
  margin: 0,
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
  borderRadius: radii.icon,
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
  backgroundColor: colors.claret,
};

const deleteButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  backgroundColor: colors.error,
};

const renameInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: `4px ${spacing.xs / 2}px`,
  fontSize: typography.px.body,
  fontWeight: typography.weights.medium,
  fontFamily: typography.bodyFontFamily,
  color: colors.ink,
  border: `1px solid ${colors.claret}`,
  borderRadius: radii.icon,
  backgroundColor: colors.porcelain,
  outline: 'none',
};

export function SessionEntry({ session, isActive, onSelect, onDelete, onRename }: SessionEntryProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const title = session.title || session.partnerName || 'New conversation';

  // "11m ago · 8 messages". The mockup drops the old message-preview line and
  // the count badge in favour of this single muted subline.
  const subline = [
    formatRelativeTime(session.lastActivity),
    session.messageCount > 0
      ? `${session.messageCount} ${session.messageCount === 1 ? 'message' : 'messages'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

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

  // The active row lifts off the sand as a white card; hover is a much quieter
  // wash, so only one row ever reads as selected.
  const entryStyle: React.CSSProperties = {
    ...entryBaseStyle,
    backgroundColor: isActive
      ? colors.surface
      : isHovered
        ? 'rgba(255, 255, 255, 0.55)'
        : 'transparent',
    boxShadow: isActive ? '0 2px 6px rgba(42, 34, 38, 0.06)' : 'none',
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
        <div style={titleRowStyle}>
          {isActive && <i style={activeDotStyle} aria-hidden="true" />}
          <p style={titleStyle}>{title}</p>
        </div>
      )}
      <p style={sublineStyle}>{subline}</p>
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
