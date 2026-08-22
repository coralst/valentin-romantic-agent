import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../utils/motion-preference';

/**
 * Step-through playback for a recorded sequence of steps.
 *
 * Two properties matter, and both come from rehearsing this on a stage:
 *
 * 1. **Rendering is cumulative, never incremental.** The view is handed the
 *    step index and rebuilds its entire state from steps `0..index`. Stepping
 *    backwards is therefore exact rather than an attempt to undo — an undo-based
 *    version drifted after the first backward step, which is precisely when a
 *    presenter uses it ("wait, go back").
 * 2. **Manual stepping wins.** Touching next/previous stops autoplay rather than
 *    racing it. A timer that keeps firing while someone is talking over a step
 *    moves the diagram out from under them.
 */
export interface UseFlowPlaybackOptions {
  /** Total number of steps. Playback clamps to `stepCount - 1`. */
  stepCount: number;
  /**
   * Per-step dwell time. A function so a step can hold longer than its
   * neighbours — a 380 ms Bedrock call deserves more time on screen than a
   * 1 ms load-balancer hop, and equal dwell makes the slow beats invisible.
   */
  dwellMsForStep?: (index: number) => number;
  /** Fallback dwell when no per-step value is given. */
  defaultDwellMs?: number;
}

export interface UseFlowPlaybackResult {
  /** Current step, always in `[0, stepCount - 1]`; -1 when there are no steps. */
  index: number;
  isPlaying: boolean;
  /** True once the last step has been reached. */
  isComplete: boolean;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  /** Back to step 0, paused. */
  restart: () => void;
  /** Jump straight to a step, paused. Clamped. */
  goTo: (index: number) => void;
}

/** Default dwell: slow enough to narrate a step over, fast enough not to drag. */
export const DEFAULT_STEP_DWELL_MS = 1100;

export function useFlowPlayback({
  stepCount,
  dwellMsForStep,
  defaultDwellMs = DEFAULT_STEP_DWELL_MS,
}: UseFlowPlaybackOptions): UseFlowPlaybackResult {
  const [index, setIndex] = useState(stepCount > 0 ? 0 : -1);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  // An empty flow stays at -1: flooring at 0 would hand the view step 0 of a
  // flow that has no step 0.
  const clamp = useCallback(
    (value: number) => (stepCount === 0 ? -1 : Math.max(0, Math.min(value, stepCount - 1))),
    [stepCount],
  );

  // A shorter flow (or a switch between flows) must not leave the index past
  // the end, which would render a step that no longer exists.
  useEffect(() => {
    if (stepCount === 0) {
      setIndex(-1);
      return;
    }
    setIndex((current) => (current < 0 ? 0 : Math.min(current, stepCount - 1)));
  }, [stepCount]);

  const pause = useCallback(() => {
    clearTimer();
    setIsPlaying(false);
  }, [clearTimer]);

  const play = useCallback(() => {
    if (stepCount === 0) return;
    // Pressing play on the final step replays from the start, rather than
    // appearing to do nothing.
    setIndex((current) => (current >= stepCount - 1 ? 0 : current));
    setIsPlaying(true);
  }, [stepCount]);

  const next = useCallback(() => {
    pause();
    setIndex((current) => clamp(current + 1));
  }, [pause, clamp]);

  const previous = useCallback(() => {
    pause();
    setIndex((current) => clamp(current - 1));
  }, [pause, clamp]);

  const restart = useCallback(() => {
    pause();
    setIndex(stepCount > 0 ? 0 : -1);
  }, [pause, stepCount]);

  const goTo = useCallback(
    (target: number) => {
      pause();
      setIndex(stepCount > 0 ? clamp(target) : -1);
    },
    [pause, clamp, stepCount],
  );

  // Advance while playing. Reduced motion halves the dwell rather than
  // disabling playback: the objection is to things moving, and stepping through
  // a static diagram faster is closer to that than removing the walkthrough.
  useEffect(() => {
    if (!isPlaying || index < 0) return;
    if (index >= stepCount - 1) {
      setIsPlaying(false);
      return;
    }

    const base = dwellMsForStep?.(index) ?? defaultDwellMs;
    const dwell = prefersReducedMotion() ? Math.round(base / 2) : base;

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      setIndex((current) => Math.min(current + 1, stepCount - 1));
    }, dwell);

    return clearTimer;
  }, [isPlaying, index, stepCount, dwellMsForStep, defaultDwellMs, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    index,
    isPlaying,
    isComplete: stepCount > 0 && index >= stepCount - 1,
    play,
    pause,
    next,
    previous,
    restart,
    goTo,
  };
}
