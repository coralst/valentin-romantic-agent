import { colors, radii, insets, layout } from '../design-system/tokens';

export type AppWindowVariant = 'desktop' | 'mobile';

interface AppWindowProps {
  variant: AppWindowVariant;
  /**
   * Overrides the desktop column track list.
   *
   * The dossier replaces columns 2–4 with a single wide board while keeping the
   * icon rail, so the *window* has to change shape — the alternative is a
   * four-column grid with three empty tracks, or a portal, and the dossier is
   * not an overlay (see `context/view-context.tsx`). Ignored on mobile, which is
   * always a single 100% column.
   */
  columns?: string;
  /**
   * A full-width strip pinned to the foot of the frame — the architecture drawer.
   *
   * Rendered by the window rather than by one of the columns because it has to be
   * one unbroken line across the whole bottom edge, and no single grid track can
   * be that. It is laid out on top of the frame's own padding box, so pair it with
   * `bottomInset` to keep it from covering the columns.
   */
  footer?: React.ReactNode;
  /**
   * Height the frame gives up at the bottom, for `footer` to occupy.
   *
   * Padding on the frame rather than on each column: the strip spans every track,
   * so every track has to make room for it, and one number on the frame cannot
   * drift out of agreement with itself the way four could.
   */
  bottomInset?: number;
  children?: React.ReactNode;
}

/**
 * The two-layer shadow from option-5d-brief.html:19 — a tight contact shadow to
 * seat the window on the linen, plus a wide soft one to lift it off the page.
 */
const WINDOW_SHADOW =
  '0 4px 12px rgba(42, 34, 38, 0.05), 0 30px 70px rgba(42, 34, 38, 0.10)';

/** Height of the horizontal claret strip that replaces the rail on mobile. */
export const MOBILE_STRIP_HEIGHT = 56;

/**
 * The four columns of the desktop shell: icon rail | conversation list | chat |
 * brief. `minmax(0, 1fr)` on the chat column (rather than a bare `1fr`) is what
 * lets it shrink below its content's intrinsic width instead of forcing the
 * grid wider than the window.
 */
export const DESKTOP_COLUMNS = [
  `${layout.iconRailWidth}px`,
  `${layout.conversationListWidth}px`,
  'minmax(0, 1fr)',
  `${layout.briefRailWidth}px`,
].join(' ');

/**
 * The two columns of the dossier shell: icon rail | board (`full-profile.html:19`).
 *
 * The rail keeps its exact 76px so switching surfaces does not shift it by a
 * pixel — the ♥ you clicked has to still be under the cursor.
 */
export const DOSSIER_COLUMNS = [
  `${layout.iconRailWidth}px`,
  'minmax(0, 1fr)',
].join(' ');

function getPageStyle(variant: AppWindowVariant): React.CSSProperties {
  return {
    boxSizing: 'border-box',
    height: '100vh',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.linen,
    // A floating window would eat 28px of a 375px viewport, so on mobile the
    // frame goes full-bleed and the inset collapses to nothing.
    padding: variant === 'mobile' ? 0 : insets.tight,
  };
}

function getFrameStyle(
  variant: AppWindowVariant,
  columns?: string,
  bottomInset = 0,
): React.CSSProperties {
  const isMobile = variant === 'mobile';
  return {
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: colors.porcelain,
    borderRadius: isMobile ? 0 : radii.window,
    overflow: 'hidden',
    boxShadow: isMobile ? 'none' : WINDOW_SHADOW,
    // The containing block for the footer strip. Absolute rather than a grid row
    // so the strip can slide (the drawer animates on `transform`) without the
    // window's tracks resizing under it mid-transition.
    position: 'relative',
    // `border-box` is what makes this shrink the tracks rather than growing the
    // frame past the viewport.
    paddingBottom: bottomInset,
    display: 'grid',
    // Mobile stacks: claret top strip, then whatever the caller puts below it.
    gridTemplateColumns: isMobile ? '100%' : (columns ?? DESKTOP_COLUMNS),
    gridTemplateRows: isMobile ? `${MOBILE_STRIP_HEIGHT}px minmax(0, 1fr)` : '100%',
  };
}

/**
 * The outer frame of the app: a cream window floating on linen.
 *
 * Children are laid out directly as grid items, so each child is responsible
 * for its own `minWidth: 0` / `minHeight: 0` (see `windowCellStyle`).
 */
export function AppWindow({
  variant,
  columns,
  footer,
  bottomInset,
  children,
}: AppWindowProps) {
  return (
    <div style={getPageStyle(variant)} data-testid="app-window-page">
      <div
        style={getFrameStyle(variant, columns, bottomInset)}
        data-testid="app-window"
        // The reservation is the frame's, so the assertion about it belongs here
        // too — on the element whose padding is doing the work.
        data-bottom-inset={bottomInset ?? 0}
      >
        {children}
        {footer !== undefined && (
          // Zero height, so the strip's own children size it upward from the
          // frame's bottom edge. `left/right: 0` on the *padding* box is what
          // takes it across the icon rail as well as the panels.
          <div style={footerHostStyle} data-testid="app-window-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const footerHostStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: 0,
  zIndex: 20,
};

/**
 * Shared style for a scrollable grid child of the window.
 *
 * `minWidth: 0` and `minHeight: 0` are load-bearing, not defensive: a grid
 * item's default `min-*: auto` sizes it to its content, so without these the
 * chat column grows to fit the whole transcript and pushes the composer out
 * through the bottom of the window. The mockup calls this out explicitly at
 * option-5d-brief.html:41-42.
 */
export const windowCellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

/**
 * A window cell that is itself a flex child and must fill its parent — e.g. the
 * chat/profile area sitting under the mobile tab bar. Without `flex: 1` the
 * inner cell sizes to its content and the composer floats mid-screen instead of
 * sitting at the bottom of the window.
 */
export const windowCellGrowStyle: React.CSSProperties = {
  ...windowCellStyle,
  flex: 1,
};
