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

function getFrameStyle(variant: AppWindowVariant, columns?: string): React.CSSProperties {
  const isMobile = variant === 'mobile';
  return {
    height: '100%',
    width: '100%',
    backgroundColor: colors.porcelain,
    borderRadius: isMobile ? 0 : radii.window,
    overflow: 'hidden',
    // The positioning context for overlays that cover part of the window without
    // taking part in its grid — currently the integrations panel. Placing such an
    // overlay with `gridColumn`/`gridRow` instead looks right until you notice
    // that an explicitly placed item makes the grid's auto-placement step skip
    // the cells it claims, which bumps the auto-placed shell children (the
    // conversation list, the mobile content region) into an implicit extra row.
    // `relative` also keeps the overlay inside the window's own clip, which is
    // what preserves the 34px radius; see the note on `drawerHostStyle`.
    position: 'relative',
    boxShadow: isMobile ? 'none' : WINDOW_SHADOW,
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
export function AppWindow({ variant, columns, children }: AppWindowProps) {
  return (
    <div style={getPageStyle(variant)} data-testid="app-window-page">
      <div style={getFrameStyle(variant, columns)} data-testid="app-window">
        {children}
      </div>
    </div>
  );
}

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
