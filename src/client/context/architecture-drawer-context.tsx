import React, { createContext, useContext, useMemo } from 'react';
import { useSlidePanel, type UseSlidePanelResult } from '../hooks/use-inspector-focus';
import {
  DEFAULT_DRAWER_HEIGHT,
  MIN_DRAWER_HEIGHT,
  useDrawerHeight,
  type UseDrawerHeightResult,
} from '../hooks/use-drawer-height';

/**
 * Whether the Live Architecture drawer is showing.
 *
 * Lifted out of both components because the control and the drawer live in
 * sibling subtrees: the magnifier is in `SessionSidebar`, the drawer is mounted
 * by `AppLayout`. Following the same shape as `session-context`'s `sidebarOpen`,
 * but kept in its own file — the session reducer is about session history, and an
 * inspector toggle has no business in it.
 */

/**
 * Open state *and* height, in one context.
 *
 * The height is here rather than inside the drawer because two subtrees have to
 * agree on it: `AppLayout` reserves that many pixels at the foot of the window
 * frame, and the drawer fills them. Computed separately in each — which is how it
 * started — they drift the moment one changes, and the failure is the panel
 * covering the very composer the reservation exists to keep clear.
 */
export type ArchitectureDrawerValue = UseSlidePanelResult & UseDrawerHeightResult;

const ArchitectureDrawerContext = createContext<ArchitectureDrawerValue | null>(null);

export function ArchitectureDrawerProvider({ children }: { children: React.ReactNode }) {
  // `useSlidePanel` keeps `isMounted` alive for the length of the exit
  // transition, which is what lets the drawer animate out and keep its step
  // instead of unmounting and restarting the walkthrough.
  const panel = useSlidePanel(false);
  const sizing = useDrawerHeight();

  const value = useMemo(() => ({ ...panel, ...sizing }), [panel, sizing]);

  return (
    <ArchitectureDrawerContext.Provider value={value}>
      {children}
    </ArchitectureDrawerContext.Provider>
  );
}

/**
 * Read the drawer's open state.
 *
 * Returns a closed, inert panel when there is no provider rather than throwing.
 * The magnifier renders in three sidebar surfaces, several of which are mounted
 * standalone in tests; a hard throw would make the provider a hidden dependency
 * of every one of those tests.
 */
export function useArchitectureDrawer(): ArchitectureDrawerValue {
  const ctx = useContext(ArchitectureDrawerContext);
  return ctx ?? FALLBACK;
}

const FALLBACK: ArchitectureDrawerValue = {
  isOpen: false,
  isMounted: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  height: DEFAULT_DRAWER_HEIGHT,
  bounds: { min: MIN_DRAWER_HEIGHT, max: DEFAULT_DRAWER_HEIGHT },
  setHeight: () => {},
  reset: () => {},
  isCustom: false,
};
