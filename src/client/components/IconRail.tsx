import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { colors, radii, layout, typography, insets, spacing, animation } from '../design-system/tokens';
import { DemoToolbar } from './DemoToolbar';
import { UserChip } from './UserChip';

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
  /**
   * True when the full-page dossier is the surface on screen.
   *
   * Separate from `activeView` on purpose: on desktop `activeView` is `null`
   * because chat and brief are both visible, but the dossier genuinely *is* a
   * single active surface and the ♥ has to say so.
   */
  isDossierActive?: boolean;
  /** Toggles the dossier. When absent the ♥ falls back to `onViewChange`. */
  onToggleDossier?: () => void;
  /**
   * Attached to the ♥. Closing the dossier — via `.back` or Escape — returns
   * focus here rather than stranding it on a removed element.
   */
  dossierToggleRef?: React.RefObject<HTMLButtonElement | null>;
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
 *
 * It is `position: fixed` and portalled to the body because the app window
 * clips its children (`overflow: hidden`, to keep the 34px radius crisp) — an
 * absolutely positioned popover inside the rail is sliced off at the window
 * edge. Coordinates come from the gear's own bounding box.
 */
function getPopoverStyle(
  orientation: 'column' | 'row',
  anchor: DOMRect,
): React.CSSProperties {
  return {
    position: 'fixed',
    zIndex: 200,
    backgroundColor: colors.porcelain,
    borderRadius: radii.panel,
    padding: insets.tight,
    boxShadow: '0 4px 12px rgba(42, 34, 38, 0.08), 0 24px 56px rgba(42, 34, 38, 0.18)',
    ...(orientation === 'column'
      ? // Beside the gear, bottom-aligned to it.
        { left: anchor.right + 10, bottom: window.innerHeight - anchor.bottom }
      : // Below the strip, right-aligned to the gear.
        { top: anchor.bottom + 10, right: window.innerWidth - anchor.right }),
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
  isDossierActive = false,
  onToggleDossier,
  dossierToggleRef,
}: IconRailProps) {
  const [isDemoOpen, setDemoOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const measureAnchor = useCallback(() => {
    const rect = gearRef.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
  }, []);

  // Measure before paint so the popover never renders at a stale position.
  useLayoutEffect(() => {
    if (isDemoOpen) measureAnchor();
  }, [isDemoOpen, measureAnchor]);

  // Keep the popover glued to the gear if the viewport changes under it.
  useEffect(() => {
    if (!isDemoOpen) return;
    window.addEventListener('resize', measureAnchor);
    return () => window.removeEventListener('resize', measureAnchor);
  }, [isDemoOpen, measureAnchor]);

  // Dismiss the popover on outside click or Escape, the way a menu should.
  useEffect(() => {
    if (!isDemoOpen) return;

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      // The popover is portalled out of the rail, so it is not a DOM descendant
      // of the wrapper — check it separately or clicking it would dismiss it.
      const insideGear = wrapperRef.current?.contains(target) ?? false;
      const insidePopover = popoverRef.current?.contains(target) ?? false;
      if (!insideGear && !insidePopover) setDemoOpen(false);
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

  /*
   * Two independent notions of "active", collapsed into one pair of flags.
   *
   * `activeView` is the mobile panel switch, where exactly one of chat/brief is
   * on screen. `isDossierActive` is the desktop full-page surface, where
   * `activeView` is deliberately `null` because chat and brief share the window.
   * The ♥ lights up for either, and `aria-pressed` is only meaningful when at
   * least one of them is actually a single-surface state — on plain desktop chat
   * both buttons stay unpressed, which is what `IconRail.test.tsx:76` asserts.
   */
  const isProfileActive = isDossierActive || activeView === 'profile';
  const isChatActive = !isDossierActive && activeView === 'chat';
  const hasSurfaceState = isDossierActive || activeView !== null;

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
        style={getIconButtonStyle(isChatActive)}
        aria-label="Conversation"
        aria-pressed={hasSurfaceState ? isChatActive : undefined}
        onClick={() => onViewChange?.('chat')}
        data-testid="rail-chat-button"
      >
        &#9670;
      </button>

      <button
        ref={dossierToggleRef}
        type="button"
        style={getIconButtonStyle(isProfileActive)}
        aria-label="Her profile"
        aria-pressed={hasSurfaceState ? isProfileActive : undefined}
        onClick={() => (onToggleDossier ? onToggleDossier() : onViewChange?.('profile'))}
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
          ref={gearRef}
          type="button"
          style={getIconButtonStyle(isDemoOpen)}
          aria-label="Demo controls"
          aria-expanded={isDemoOpen}
          onClick={() => setDemoOpen((open) => !open)}
          data-testid="rail-demo-button"
        >
          &#9881;
        </button>
        {isDemoOpen &&
          anchor &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={popoverRef}
              style={getPopoverStyle(orientation, anchor)}
              data-testid="rail-demo-popover"
            >
              {/* Who you are sits above the demo controls: the rail has no
                  header to hang it off, and "account" and "demo" belong to the
                  same cluster from the audience's point of view. Renders
                  nothing when there is no AuthProvider. */}
              <UserChip />
              <DemoToolbar />
            </div>,
            document.body,
          )}
      </div>
    </nav>
  );
}
