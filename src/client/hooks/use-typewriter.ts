import { useEffect, useRef, useState } from 'react';

/** Options controlling the typewriter reveal. */
export interface UseTypewriterOptions {
  /** Whether the animation should run at all. When false, full text shows instantly. */
  enabled?: boolean;
  /** Milliseconds between each revealed character. Lower = faster. */
  speedMs?: number;
}

/** Result of the typewriter hook. */
export interface UseTypewriterResult {
  /** The portion of text revealed so far. */
  displayedText: string;
  /** True once the full text has been revealed. */
  isComplete: boolean;
}

/**
 * Detect the user's reduced-motion preference. Guarded for SSR/jsdom where
 * matchMedia may be undefined.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const DEFAULT_SPEED_MS = 18;

/**
 * Reveals `text` one character at a time at a fast, modern cadence.
 *
 * Accessibility: when the user prefers reduced motion, the full text is shown
 * immediately with no animation. Callers are responsible for exposing the full
 * text to assistive tech (the animated value is presentational only).
 *
 * The animation runs once per unique `text` value. If `text` changes, the
 * reveal restarts from the beginning.
 */
export function useTypewriter(
  text: string,
  { enabled = true, speedMs = DEFAULT_SPEED_MS }: UseTypewriterOptions = {},
): UseTypewriterResult {
  const shouldAnimate = enabled && !prefersReducedMotion();

  const [displayedText, setDisplayedText] = useState(
    shouldAnimate ? '' : text,
  );
  const indexRef = useRef(0);

  useEffect(() => {
    // No animation: show everything at once.
    if (!shouldAnimate) {
      setDisplayedText(text);
      indexRef.current = text.length;
      return;
    }

    // Restart reveal for the new text.
    indexRef.current = 0;
    setDisplayedText('');

    const timer = setInterval(() => {
      indexRef.current += 1;
      setDisplayedText(text.slice(0, indexRef.current));

      if (indexRef.current >= text.length) {
        clearInterval(timer);
      }
    }, speedMs);

    return () => clearInterval(timer);
  }, [text, shouldAnimate, speedMs]);

  return {
    displayedText,
    isComplete: displayedText.length >= text.length,
  };
}
