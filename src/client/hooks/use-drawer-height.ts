import { useCallback, useMemo, useState } from 'react';
import { useViewportHeight } from './use-viewport-height';

/**
 * How tall the Live Architecture drawer is, and how tall it is allowed to be.
 *
 * ## Why the height is state rather than a constant
 *
 * It used to be `DRAWER_HEIGHT = 454`, then a value clamped against the viewport so
 * the drawer could not starve the shell above it. Both are the same assumption: that
 * one number suits every purpose. It does not. Pointing at the topology wants a tall
 * drawer and a glance at the chat; watching a preference land in the feed *while*
 * reading her brief wants the opposite. Whoever is presenting is the only one who
 * knows which, so the height is theirs to set.
 *
 * ## Two different floors, on purpose
 *
 * `MIN_SHELL_AUTO` is the room the shell keeps when *nobody has asked* — the drawer
 * opens at a height that leaves the rail and the composer usable, because a drawer
 * that buries them the first time it is opened is a bug, which is exactly what the
 * unclamped 454px was.
 *
 * `MIN_SHELL_DRAGGED` is much smaller, because a drag is a deliberate request. Once
 * someone takes hold of the handle and pulls, refusing to give them a tall diagram
 * is second-guessing them. It is not zero: the composer has to stay reachable, or
 * the drawer becomes a modal without saying so.
 */

/** Shortest useful drawer. Below this it is chrome pretending to be a diagram. */
export const MIN_DRAWER_HEIGHT = 240;

/** Room the shell keeps at the height the drawer opens itself to. */
export const MIN_SHELL_AUTO = 560;

/** Room the shell keeps when the height was dragged. Enough for the composer. */
export const MIN_SHELL_DRAGGED = 260;

/** Tallest the drawer opens itself to, before anyone drags it. */
export const DEFAULT_DRAWER_HEIGHT = 454;

const STORAGE_KEY = 'valentin_drawer_height';

export interface DrawerHeightBounds {
  min: number;
  max: number;
}

export interface UseDrawerHeightResult {
  /** The height to render, already inside `bounds`. */
  height: number;
  bounds: DrawerHeightBounds;
  /** Set an explicit height. Clamped; persisted for the next session. */
  setHeight: (next: number) => void;
  /** Forget the explicit height and go back to the automatic one. */
  reset: () => void;
  /** Whether the height on screen is one somebody chose. */
  isCustom: boolean;
}

/** The height the drawer picks for itself on a viewport of `viewportHeight`. */
export function automaticDrawerHeight(viewportHeight: number | undefined): number {
  if (viewportHeight === undefined) return DEFAULT_DRAWER_HEIGHT;
  return Math.max(
    MIN_DRAWER_HEIGHT,
    Math.min(DEFAULT_DRAWER_HEIGHT, viewportHeight - MIN_SHELL_AUTO),
  );
}

/** How far a drag is allowed to go on a viewport of `viewportHeight`. */
export function drawerHeightBounds(viewportHeight: number | undefined): DrawerHeightBounds {
  if (viewportHeight === undefined) {
    return { min: MIN_DRAWER_HEIGHT, max: DEFAULT_DRAWER_HEIGHT };
  }
  // `Math.max` on the ceiling as well: on a viewport shorter than the two floors
  // combined the range would otherwise invert, and a max below the min makes every
  // clamp downstream nonsense.
  return {
    min: MIN_DRAWER_HEIGHT,
    max: Math.max(MIN_DRAWER_HEIGHT, viewportHeight - MIN_SHELL_DRAGGED),
  };
}

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    // A stored value that is not a usable number is discarded rather than trusted:
    // `Number('')` is 0, and a drawer 0px tall cannot be dragged back open.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(height: number | null): void {
  try {
    if (height === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(height));
  } catch {
    // A drawer that cannot remember its height is worth strictly more than one
    // that throws in private browsing.
  }
}

export function useDrawerHeight(): UseDrawerHeightResult {
  const viewportHeight = useViewportHeight();
  const [chosen, setChosen] = useState<number | null>(() => readStored());

  const bounds = useMemo(() => drawerHeightBounds(viewportHeight), [viewportHeight]);

  /*
   * The chosen height is clamped on read, not on write.
   *
   * Clamping on write would quietly rewrite the stored value every time the window
   * changed size: drag the drawer tall on a big monitor, open the laptop lid, and the
   * height would be squashed to fit and *kept* squashed when you plugged the monitor
   * back in. Storing the request and clamping the render keeps the intent.
   */
  const height = useMemo(() => {
    if (chosen === null) return automaticDrawerHeight(viewportHeight);
    return Math.min(Math.max(chosen, bounds.min), bounds.max);
  }, [chosen, viewportHeight, bounds]);

  const setHeight = useCallback((next: number) => {
    const rounded = Math.round(next);
    setChosen(rounded);
    writeStored(rounded);
  }, []);

  const reset = useCallback(() => {
    setChosen(null);
    writeStored(null);
  }, []);

  return { height, bounds, setHeight, reset, isCustom: chosen !== null };
}
