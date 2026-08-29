import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../utils/motion-preference';
import { FLOW_LEG_MS } from '../utils/aws-demo-flows';

/**
 * Walks the traffic through one step, one beat at a time.
 *
 * The diagram used to render a step as a finished fact: the moment a step became
 * current, every node on its route lit and every segment animated at once. On a
 * step from the browser to AgentCore Memory that is eight boxes glowing
 * simultaneously, which tells a room that eight things are *involved* when the
 * question they are actually asking is "where is the request now?".
 *
 * So a step is played rather than shown. This hook owns nothing but the beat index
 * within the current step; `frameForStep` turns that index into "the arrow between
 * ALB and Fargate is live and no box is lit". One node or one arrow, never both,
 * never several.
 *
 * Deliberately *not* part of `useFlowPlayback`. Playback is what a presenter drives
 * — steps, Next, Back — and its unit has to stay the step, or "Step 4 of 11" would
 * turn into "Step 17 of 43" and the Next button would need seven clicks to cross
 * one hop. This is the sub-animation underneath a step, which is why live mode can
 * use it with no playback at all: a live beat arrives, and it walks.
 */
export interface UseFlowTraversalOptions {
  /** How many beats the current step is made of. */
  legCount: number;
  /**
   * Changes when there is a new step to walk. Any stable identity works — a step
   * index in demo mode, a beat key in live mode — because all this hook does with
   * it is notice that it is different and start over.
   */
  resetKey: string | number | null;
  /** Off while nothing is playing, so a paused diagram stays where it was parked. */
  enabled?: boolean;
  msPerLeg?: number;
}

/**
 * The beat within the current step, from 0 to `legCount - 1`.
 *
 * Stops at the last one rather than looping: the end of a step's journey is the
 * traffic sitting in its destination, and that is the state the diagram should rest
 * in for as long as the step is current.
 */
export function useFlowTraversal({
  legCount,
  resetKey,
  enabled = true,
  msPerLeg = FLOW_LEG_MS,
}: UseFlowTraversalOptions): number {
  const [leg, setLeg] = useState(0);

  // The step this hook is currently walking. Compared during render rather than in
  // an effect so a new step's first beat is beat 0 on the very frame it becomes
  // current — via an effect, the new step would render for one frame showing the
  // *previous* step's beat index, which on a short step is a visible flash of the
  // traffic in the wrong place.
  const walkingRef = useRef(resetKey);
  if (walkingRef.current !== resetKey) {
    walkingRef.current = resetKey;
    setLeg(0);
  }

  useEffect(() => {
    if (!enabled) return;
    // Reduced motion gets the destination, not a faster trip to it. Someone who has
    // asked the OS to stop things moving is not helped by the same movement at
    // double speed.
    if (prefersReducedMotion()) {
      setLeg(legCount - 1);
      return;
    }
    if (leg >= legCount - 1) return;

    const timer = setTimeout(() => setLeg((current) => current + 1), msPerLeg);
    return () => clearTimeout(timer);
  }, [leg, legCount, enabled, msPerLeg, resetKey]);

  // Clamp on the way out as well as on the way in: `legCount` can shrink under a
  // stale index when a step is replaced by a shorter one in the same render.
  return Math.min(leg, Math.max(0, legCount - 1));
}
