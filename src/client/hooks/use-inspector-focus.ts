import { useCallback, useRef, useState } from 'react';
import type { AwsNodeId } from '../utils/aws-architecture';

/**
 * What the Inspector is currently pointed at.
 *
 * `live` is the default: the diagram follows whatever traffic arrives. `pinned`
 * means the audience asked about one specific thing — a preference row was
 * clicked — and the diagram should hold that story instead of being overwritten
 * by the next heartbeat.
 *
 * This distinction exists because the panel has two jobs on stage. Most of the
 * time it narrates the system as it runs. But the moment worth pausing on is
 * "where did *this* fact come from", and a live feed scrolling underneath that
 * answer destroys it.
 */
export type InspectorFocusMode = 'live' | 'pinned';

/** A preference the audience asked about, identified for replay. */
export interface PinnedPreference {
  /** Stable id of the preference row that was clicked. */
  preferenceId: string;
  category: string;
  key: string;
  /**
   * Correlates the row back to the spans that produced it. Undefined when the
   * preference predates span telemetry — the panel then shows the diagram
   * without per-hop durations rather than showing nothing.
   */
  spanId?: string;
}

export interface InspectorFocus {
  mode: InspectorFocusMode;
  /** Set only in `pinned` mode. */
  preference?: PinnedPreference;
  /** Nodes the pinned story touches, so the diagram can hold them lit. */
  nodes: readonly AwsNodeId[];
}

export interface UseInspectorFocusResult {
  focus: InspectorFocus;
  /** Pin the diagram to one preference's provenance. */
  pinPreference: (preference: PinnedPreference, nodes: readonly AwsNodeId[]) => void;
  /** Return to following live traffic. */
  resumeLive: () => void;
  /** True while pinned — the view uses this to pause its live highlighting. */
  isPinned: boolean;
}

const LIVE: InspectorFocus = { mode: 'live', nodes: [] };

/**
 * Owns whether the Inspector is following live traffic or holding one
 * preference's provenance.
 *
 * Layout-independent on purpose: the bottom drawer, the docked side panel and
 * the click-through popover all need exactly this state, so choosing between
 * those presentations later doesn't touch this file. Whichever surface renders
 * it, pressing a preference card calls `pinPreference` and closing the story
 * calls `resumeLive`.
 */
export function useInspectorFocus(): UseInspectorFocusResult {
  const [focus, setFocus] = useState<InspectorFocus>(LIVE);

  // Identity-stable across renders so consumers can pass these straight to
  // memoised children (the preference cards) without re-rendering the list on
  // every focus change.
  const pinPreference = useCallback((preference: PinnedPreference, nodes: readonly AwsNodeId[]) => {
    setFocus({ mode: 'pinned', preference, nodes });
  }, []);

  const resumeLive = useCallback(() => {
    setFocus(LIVE);
  }, []);

  return { focus, pinPreference, resumeLive, isPinned: focus.mode === 'pinned' };
}

/**
 * Open/closed state for a surface that slides in, with the animation duration
 * separated from the mount.
 *
 * A panel that unmounts the instant it is closed cannot animate out — it just
 * disappears. So `isMounted` outlives `isOpen` by the transition duration, and
 * the view drives its transform off `isOpen` while driving its presence off
 * `isMounted`.
 */
export interface UseSlidePanelResult {
  isOpen: boolean;
  /** True while the panel should exist in the DOM, including during exit. */
  isMounted: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/** Matches the slide transition in the view; keep the two in step. */
export const PANEL_SLIDE_MS = 280;

export function useSlidePanel(initiallyOpen = false): UseSlidePanelResult {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [isMounted, setIsMounted] = useState(initiallyOpen);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const open = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = undefined;
    }
    setIsMounted(true);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Reopening during the exit clears this timer, so a fast toggle can never
    // unmount a panel that is on its way back in.
    exitTimerRef.current = setTimeout(() => {
      setIsMounted(false);
      exitTimerRef.current = undefined;
    }, PANEL_SLIDE_MS);
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  return { isOpen, isMounted, open, close, toggle };
}
