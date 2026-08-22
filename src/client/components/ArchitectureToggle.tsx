import { useState } from 'react';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { colors, borderRadius, typography, animation } from '../design-system/tokens';

/**
 * The one control that raises the Live Architecture drawer.
 *
 * Lives in the sidebar in all three of its surfaces — expanded, collapsed rail,
 * and the mobile overlay — so it is reachable from every screen. Previously the
 * toggle sat in the demo toolbar, which meant the diagram was only available from
 * wherever that toolbar happened to be rendered.
 *
 * The accessible name is deliberately distinct from `Collapse sidebar` /
 * `Expand sidebar`: those are matched by name in the sidebar's tests, and a
 * third button whose name overlapped would make those queries ambiguous.
 *
 * The name is also *stable* across open and closed, with `aria-pressed` carrying
 * the state. Swapping the name to "Hide…" when open collided with the drawer's own
 * Hide control — two buttons, one name — and renaming a toggle under a screen
 * reader as it is activated is confusing in its own right.
 */

export const ARCHITECTURE_TOGGLE_LABEL = 'Architecture drawer';
/** Hover hint only; the accessible name stays put. */
export const ARCHITECTURE_TOGGLE_HIDE_HINT = 'Hide the architecture drawer';
export const ARCHITECTURE_TOGGLE_SHOW_HINT = 'Show the architecture drawer';

/** Magnifying glass, drawn rather than a glyph so it matches at every size. */
function MagnifierIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.6 4.6" />
    </svg>
  );
}

export interface ArchitectureToggleProps {
  /** Icon-only, for the collapsed rail. */
  compact?: boolean;
}

export function ArchitectureToggle({ compact = false }: ArchitectureToggleProps) {
  const { isOpen, toggle } = useArchitectureDrawer();
  const [isHovered, setIsHovered] = useState(false);

  const hint = isOpen ? ARCHITECTURE_TOGGLE_HIDE_HINT : ARCHITECTURE_TOGGLE_SHOW_HINT;

  return (
    <button
      type="button"
      onClick={toggle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      aria-label={ARCHITECTURE_TOGGLE_LABEL}
      aria-pressed={isOpen}
      title={hint}
      data-testid="architecture-toggle"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: compact ? 28 : undefined,
        height: 28,
        padding: compact ? 0 : '0 8px',
        border: `1px solid ${isOpen ? colors.softBurgundy : 'transparent'}`,
        borderRadius: borderRadius.sm,
        // Pressed reads as pressed: on a projector a hover-only affordance is
        // invisible from the back of the room.
        backgroundColor: isOpen ? colors.highlight : isHovered ? colors.borderSubtle : 'transparent',
        color: isOpen ? colors.softBurgundy : colors.textSecondary,
        cursor: 'pointer',
        fontSize: typography.sizes.xs,
        fontWeight: typography.weights.semibold,
        fontFamily: typography.bodyFontFamily,
        transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
        flexShrink: 0,
      }}
    >
      <MagnifierIcon />
      {!compact && <span>Architecture</span>}
    </button>
  );
}
