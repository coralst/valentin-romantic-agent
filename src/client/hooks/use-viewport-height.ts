import { useEffect, useState } from 'react';

/**
 * The window's inner height, kept current as it changes.
 *
 * A hook rather than a read at render time because the value has to survive a
 * resize: the architecture drawer reserves space out of the shell, and the amount
 * it is allowed to reserve depends on how tall the window is *now*. Reading
 * `window.innerHeight` inline would fix the answer at first paint and leave a
 * dragged-shorter window with a drawer that has starved the rail above it.
 *
 * The repo's other two responsive reads use `matchMedia` (`AppLayout`), which
 * answers a yes/no question. This one needs the number, so it listens to `resize`.
 *
 * Returns `undefined` before the first measurement and in any environment without
 * a `window`, so callers fall back to their unclamped default rather than to zero —
 * a clamp against a height of 0 would collapse the thing it is protecting.
 */
export function useViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(() =>
    typeof window === 'undefined' ? undefined : window.innerHeight,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const measure = () => setHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return height;
}
