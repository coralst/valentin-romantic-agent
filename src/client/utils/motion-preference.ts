/**
 * Detect the user's reduced-motion preference. Guarded for SSR/jsdom where
 * matchMedia may be undefined.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
