import { useEffect, useState } from 'react';

/**
 * Minimum viewport width at which the Inspector docks beside the app instead
 * of overlaying it. Below this the panel would leave too little room for the
 * chat to stay usable, so it overlays instead.
 */
export const INSPECTOR_DOCK_MIN_WIDTH = 1100;

/** Whether the viewport is wide enough to dock a panel of `panelWidth`. */
export function useIsWideEnoughToDock(minWidth = INSPECTOR_DOCK_MIN_WIDTH): boolean {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(`(min-width: ${minWidth}px)`);
    setIsWide(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [minWidth]);

  return isWide;
}

/**
 * Reserves horizontal space at the right edge of the document while active, so
 * a fixed-position panel sits *beside* the app rather than on top of it.
 *
 * This keeps the panel self-contained: it can dock without the surrounding
 * layout knowing it exists, which is what lets the Inspector mount from a
 * toolbar button rather than being threaded through the layout tree.
 */
export function useReservedEdgeSpace(width: number, isActive: boolean): void {
  useEffect(() => {
    if (!isActive || typeof document === 'undefined') return;

    const { body } = document;
    const previousPadding = body.style.paddingRight;
    const previousBoxSizing = body.style.boxSizing;

    body.style.paddingRight = `${width}px`;
    body.style.boxSizing = 'border-box';

    return () => {
      body.style.paddingRight = previousPadding;
      body.style.boxSizing = previousBoxSizing;
    };
  }, [width, isActive]);
}
