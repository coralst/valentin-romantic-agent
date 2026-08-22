import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToWsEvents } from '../utils/ws-event-observer';

/**
 * Which source the architecture drawer is reading from.
 *
 * `live` follows real WebSocket traffic and measured spans; `demo` steps through
 * a scripted flow. They are not two renderings of the same thing — live mode is
 * the proof that the system does this, demo mode is the explanation of what it
 * does. A running system can't be paused mid-hop to talk over, and on a
 * conference network it may not fire at all.
 */
export type ArchitectureMode = 'live' | 'demo';

export interface UseArchitectureModeResult {
  mode: ArchitectureMode;
  /** True once any WebSocket event has been observed since mount. */
  hasLiveTraffic: boolean;
  /** True when the user picked the mode themselves. */
  isUserChosen: boolean;
  setMode: (mode: ArchitectureMode) => void;
  /** Back to following traffic automatically. */
  clearOverride: () => void;
}

/**
 * Pick a mode, defaulting to whichever one will actually show something.
 *
 * Starts in `demo`, because the drawer must never open blank — a blank diagram in
 * front of a room is the worst available failure, and at open time we cannot know
 * whether a socket exists. Flips to `live` on the first observed event, since real
 * traffic beats a script whenever real traffic is available.
 *
 * Once the user picks a mode it sticks, permanently. An arriving heartbeat must
 * not yank the view out from under a presenter mid-sentence — that is a worse
 * outcome than showing a script while the socket is up.
 */
export function useArchitectureMode(
  initialMode: ArchitectureMode = 'demo',
): UseArchitectureModeResult {
  const [mode, setModeState] = useState<ArchitectureMode>(initialMode);
  const [hasLiveTraffic, setHasLiveTraffic] = useState(false);
  const [isUserChosen, setIsUserChosen] = useState(false);
  // Read inside the subscriber, so the effect does not resubscribe when the user
  // picks a mode — resubscribing would be harmless but the seam is shared, and
  // churning it on every render is how a subscriber leak starts.
  const isUserChosenRef = useRef(false);

  useEffect(() => {
    return subscribeToWsEvents(() => {
      setHasLiveTraffic(true);
      if (!isUserChosenRef.current) setModeState('live');
    });
  }, []);

  const setMode = useCallback((next: ArchitectureMode) => {
    isUserChosenRef.current = true;
    setIsUserChosen(true);
    setModeState(next);
  }, []);

  const clearOverride = useCallback(() => {
    isUserChosenRef.current = false;
    setIsUserChosen(false);
    setHasLiveTraffic((seen) => {
      // Traffic already seen means live is the honest default again; otherwise
      // fall back to demo rather than opening onto nothing.
      setModeState(seen ? 'live' : 'demo');
      return seen;
    });
  }, []);

  return { mode, hasLiveTraffic, isUserChosen, setMode, clearOverride };
}
