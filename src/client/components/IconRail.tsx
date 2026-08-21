import { useEffect, useRef, useState } from 'react';
import { colors, radii, layout, typography, insets, spacing, animation } from '../design-system/tokens';
import { DemoToolbar } from './DemoToolbar';

/** Which of the rail's view buttons is currently the active surface. */
export type RailView = 'chat' | 'profile';

interface IconRailProps {
  /** 'column' is the 76px desktop rail; 'row' is the 56px mobile top strip. */
  orientation: 'column' | 'row';
  /**
   * The surface currently on screen, so the matching button can report
   * `aria-pressed`. On desktop both surfaces are visible at once, so pass
   * `null` and neither button claims to be pressed.
   */
  activeView: RailView | null;
  onViewChange?: (view: RailView) => void;
  /** Opens the conversation history — the ☰ button. Mobile only in practice. */
  onOpenSessions: () => void;
}

const INACTIVE_ICON_COLOR = 'rgba(255, 253, 251, 0.6)';
const ACTIVE_ICON_BACKGROUND = 'rgba(255, 253, 251, 0.16)';

function getRailStyle(orientation: 'column' | 'row'): React.CSSProperties {
  const isRow = orientation === 'row';
  return {
    backgroundColor: colors.claret,
    display: 'flex',
    flexDirection: isRow ? 'row' : 'column',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    minHeight: 0,
    ...(isRow
      ? { padding: `0 ${insets.tight}px` }
      : { padding: `${spacing.sm}px 0 ${insets.snug}px`, overflowY: 'auto' }),
  };
}

function getCrestStyle(orientation: 'column' | 'row'): React.CSSProperties {
  const size = orientation === 'row' ? 34 : layout.crestSize;
  return {
    width: size,
    height: size,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.porcelain,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.22)',
    // The crest sits apart from the button cluster on the vertical rail; on the
    // horizontal strip the shared 8px gap is already enough.
    marginBottom: orientation === 'column' ? 12 : 0,
  };
}

const crestImageStyle: React.CSSProperties = {
  width: '120%',
  height: '120%',
  objectFit: 'cover',
};

function getIconButtonStyle(isActive: boolean): React.CSSProperties {
  return {
    width: layout.iconButtonSize,
    height: layout.iconButtonSize,
    flexShrink: 0,
    borderRadius: radii.icon,
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.control,
    lineHeight: 1,
    backgroundColor: isActive ? ACTIVE_ICON_BACKGROUND : 'transparent',
    color: isActive ? '#FFFFFF' : INACTIVE_ICON_COLOR,
    transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  };
}

const spacerStyle: React.CSSProperties = { flex: 1 };

const popoverWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flexShrink: 0,
};

/**
 * The demo popover. It is anchored to the ⚙ button rather than laid out inline
 * because the rail is only 76px wide and the toolbar's controls are ~360px.
 */
function getPopoverStyle(orientation: 'column' | 'row'): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 200,
    backgroundColor: colors.porcelain,
    borderRadius: radii.panel,
    padding: insets.tight,
    boxShadow: '0 4px 12px rgba(42, 34, 38, 0.08), 0 24px 56px rgba(42, 34, 38, 0.18)',
    ...(orientation === 'column'
      ? { bottom: 0, left: `calc(100% + 10px)` }
      : { top: `calc(100% + 10px)`, right: 0 }),
  };
}

/**
 * Column 1 of the window: Valentin's crest, the view switches, and the demo
 * controls behind a gear.
 *
 * On mobile this same component renders as a horizontal claret strip. It is the
 * only chrome above the content there, so it also carries the brand and the
 * demo controls that used to live in the deleted app header.
 */
export function IconRail({
  orientation,
  activeView,
  onViewChange,
  onOpenSessions,
}: IconRailProps) {
  const [isDemoOpen, setDemoOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Dismiss the popover on outside click or Escape, the way a menu should.
  useEffect(() => {
    if (!isDemoOpen) return;

    const handlePointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setDemoOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDemoOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isDemoOpen]);

  return (
    <nav
      style={getRailStyle(orientation)}
      data-testid="icon-rail"
      data-orientation={orientation}
      aria-label="Valentin"
    >
      <div style={getCrestStyle(orientation)}>
        <img src="/logo.png" alt="Valentin logo" style={crestImageStyle} />
      </div>

      <button
        type="button"
        style={getIconButtonStyle(activeView === 'chat')}
        aria-label="Conversation"
        aria-pressed={activeView === null ? undefined : activeView === 'chat'}
        onClick={() => onViewChange?.('chat')}
        data-testid="rail-chat-button"
      >
        &#9670;
      </button>

      <button
        type="button"
        style={getIconButtonStyle(activeView === 'profile')}
        aria-label="Her profile"
        aria-pressed={activeView === null ? undefined : activeView === 'profile'}
        onClick={() => onViewChange?.('profile')}
        data-testid="rail-profile-button"
      >
        &#9829;
      </button>

      <button
        type="button"
        style={getIconButtonStyle(false)}
        aria-label="Open session history"
        onClick={onOpenSessions}
        data-testid="sidebar-menu-button"
      >
        &#9776;
      </button>

      <div style={spacerStyle} />

      <div style={popoverWrapperStyle} ref={wrapperRef}>
        <button
          type="button"
          style={getIconButtonStyle(isDemoOpen)}
          aria-label="Demo controls"
          aria-expanded={isDemoOpen}
          onClick={() => setDemoOpen((open) => !open)}
          data-testid="rail-demo-button"
        >
          &#9881;
        </button>
        {isDemoOpen && (
          <div style={getPopoverStyle(orientation)} data-testid="rail-demo-popover">
            <DemoToolbar />
          </div>
        )}
      </div>
    </nav>
  );
}
