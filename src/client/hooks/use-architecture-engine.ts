import { useCallback, useState } from 'react';
import type { ArchitectureEngine } from '../utils/aws-architecture';

/**
 * Which of the two backends the architecture drawer is showing.
 *
 * Separate from `useArchitectureMode`, and deliberately so: mode is *where the
 * beats come from* (live traffic or a script), engine is *which architecture they
 * ran through*. The two combine — you can watch either engine live, or step
 * through either engine's script — and collapsing them into one control would
 * make three of those four combinations unreachable.
 *
 * Unlike mode, this never changes itself. A view that flipped engines because a
 * span arrived from the other side would be reading the presenter's screen out
 * from under them; an unexpected span belongs in the feed, where it can be seen
 * and explained.
 */
export interface UseArchitectureEngineResult {
  engine: ArchitectureEngine;
  setEngine: (engine: ArchitectureEngine) => void;
  /** Flip to the other engine — what the keyboard shortcut and the chip both do. */
  toggleEngine: () => void;
}

export function useArchitectureEngine(
  initialEngine: ArchitectureEngine = 'valentin',
): UseArchitectureEngineResult {
  const [engine, setEngine] = useState<ArchitectureEngine>(initialEngine);

  const toggleEngine = useCallback(() => {
    setEngine((current) => (current === 'valentin' ? 'agentcore' : 'valentin'));
  }, []);

  return { engine, setEngine, toggleEngine };
}
