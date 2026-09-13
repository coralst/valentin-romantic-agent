import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { dedupeGlowTargets, type GlowTarget } from '../utils/glow-target';
import { useGlowPainter, type GlowStrength } from '../hooks/use-glow-painter';

/**
 * Which beat in the architecture feed is currently accounting for itself.
 *
 * One place for it, above both the drawer and the app window, because the two
 * ends of the gesture are in different subtrees: the feed row that is pointed at
 * lives in the footer, and the reply, badge, chip and strip tile it glows live
 * inside the window. Neither can own the state.
 */

/** A row or group asking for its own targets to be glowed. */
export interface GlowSelection {
  /**
   * The feed key that asked — a `FeedGroup.id` or a `FeedRow.key`.
   *
   * Carried so the feed can render its own pressed state without a second piece
   * of state that could disagree with this one. It is not used to find anything.
   */
  key: string;
  targets: readonly GlowTarget[];
}

export interface GlowContextValue {
  /** The row or group whose glow is held on, if any. */
  pinnedKey: string | null;
  /** Pin a selection, or unpin it when it is already the pinned one. */
  togglePin: (selection: GlowSelection) => void;
  clearPin: () => void;
  /** Show a selection for as long as the pointer is on it. `null` clears. */
  preview: (selection: GlowSelection | null) => void;
}

const NO_TARGETS: readonly GlowTarget[] = [];

/**
 * An inert value rather than a throw, matching `useArchitectureDrawer`.
 *
 * Half the components that can glow are also mounted on their own in unit tests,
 * with no provider above them. Throwing would make "renders a message bubble" a
 * test about context wiring.
 */
const FALLBACK: GlowContextValue = {
  pinnedKey: null,
  togglePin: () => {},
  clearPin: () => {},
  preview: () => {},
};

const GlowContext = createContext<GlowContextValue | null>(null);

export function GlowProvider({ children }: { children: React.ReactNode }) {
  const [pinned, setPinned] = useState<GlowSelection | null>(null);
  const [previewed, setPreviewed] = useState<GlowSelection | null>(null);

  const togglePin = useCallback((selection: GlowSelection) => {
    setPinned((current) => (current?.key === selection.key ? null : selection));
  }, []);

  const clearPin = useCallback(() => setPinned(null), []);

  const preview = useCallback((selection: GlowSelection | null) => {
    setPreviewed(selection);
  }, []);

  /*
   * A hover over the pinned row keeps the pin's strength rather than demoting it
   * to a preview. Otherwise moving the pointer back onto the row you just
   * clicked would stop the pulse and read as having lost the selection.
   */
  const active = previewed ?? pinned;
  const strength: GlowStrength =
    previewed === null || (pinned !== null && previewed.key === pinned.key) ? 'pin' : 'preview';

  const targets = useMemo(
    () => (active ? dedupeGlowTargets(active.targets) : NO_TARGETS),
    [active],
  );

  useGlowPainter(targets, strength);

  const value = useMemo<GlowContextValue>(
    () => ({ pinnedKey: pinned?.key ?? null, togglePin, clearPin, preview }),
    [pinned?.key, togglePin, clearPin, preview],
  );

  return <GlowContext.Provider value={value}>{children}</GlowContext.Provider>;
}

export function useGlow(): GlowContextValue {
  return useContext(GlowContext) ?? FALLBACK;
}
