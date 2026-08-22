import React, { createContext, useContext } from 'react';
import { useSlidePanel, type UseSlidePanelResult } from '../hooks/use-inspector-focus';

/**
 * Whether the Live Architecture drawer is showing.
 *
 * Lifted out of both components because the control and the drawer live in
 * sibling subtrees: the magnifier is in `SessionSidebar`, the drawer is mounted
 * by `AppLayout`. Following the same shape as `session-context`'s `sidebarOpen`,
 * but kept in its own file — the session reducer is about session history, and an
 * inspector toggle has no business in it.
 */

const ArchitectureDrawerContext = createContext<UseSlidePanelResult | null>(null);

export function ArchitectureDrawerProvider({ children }: { children: React.ReactNode }) {
  // `useSlidePanel` keeps `isMounted` alive for the length of the exit
  // transition, which is what lets the drawer animate out and keep its step
  // instead of unmounting and restarting the walkthrough.
  const panel = useSlidePanel(false);

  return (
    <ArchitectureDrawerContext.Provider value={panel}>
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
export function useArchitectureDrawer(): UseSlidePanelResult {
  const ctx = useContext(ArchitectureDrawerContext);
  return ctx ?? FALLBACK;
}

const FALLBACK: UseSlidePanelResult = {
  isOpen: false,
  isMounted: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
};
