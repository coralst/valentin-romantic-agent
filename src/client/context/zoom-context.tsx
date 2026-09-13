import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useZoomLevels, type UseZoomLevelsResult } from '../hooks/use-zoom-levels';
import { DEFAULT_ZOOM, zoomIntent, type ZoomRegion } from '../utils/zoom-ladder';

/**
 * Two zoom levels — the shell's and the architecture drawer's — and the one
 * accelerator that drives whichever of them you are pointing at.
 *
 * ## Why the region is the pointer's, not a mode
 *
 * A toggle ("now zooming the drawer") is a thing to remember and a thing to get
 * wrong: you press Cmd+− expecting more transcript and instead shrink the diagram you
 * were just pointing at. The pointer already says which region you mean, so it is the
 * pointer that decides. Focus does too, for anyone driving the app from the keyboard.
 *
 * Marked in the DOM with `data-zoom-region="architecture"` rather than by comparing
 * against a ref: the drawer unmounts when it is closed and remounts when it is
 * reopened, and an attribute survives that without a subscription.
 */
const ARCHITECTURE_REGION_SELECTOR = '[data-zoom-region="architecture"]';

export type ZoomValue = UseZoomLevelsResult;

const ZoomContext = createContext<ZoomValue | null>(null);

/** Elements whose own handling of a keystroke beats the zoom's. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function regionOf(target: EventTarget | null): ZoomRegion {
  if (!(target instanceof Element)) return 'page';
  return target.closest(ARCHITECTURE_REGION_SELECTOR) === null ? 'page' : 'architecture';
}

export function ZoomProvider({ children }: { children: React.ReactNode }) {
  const levels = useZoomLevels();
  const { applyIntent } = levels;

  /*
   * A ref rather than state: the region changes on every pointer move across the
   * drawer's edge, and re-rendering the whole shell for a value only a keydown reads
   * would make the app stutter for nothing visible.
   */
  const region = useRef<ZoomRegion>('page');

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const track = (event: Event) => {
      region.current = regionOf(event.target);
    };

    // Capture phase, so a handler inside the drawer that stops propagation cannot
    // leave the region stale — and `pointerover` rather than `pointermove` because it
    // fires once per element crossed instead of once per pixel.
    document.addEventListener('pointerover', track, true);
    document.addEventListener('focusin', track, true);
    return () => {
      document.removeEventListener('pointerover', track, true);
      document.removeEventListener('focusin', track, true);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const intent = zoomIntent(event.key);
      if (intent === null) return;

      if (event.metaKey || event.ctrlKey) {
        /*
         * The browser's own zoom is the thing being replaced, so this
         * `preventDefault` is the feature, not a defensive flourish: without it both
         * zooms happen at once and the tab's zoom is the one nobody asked for.
         *
         * Alt is left alone — Cmd+Alt+− is not ours, and swallowing it would break
         * whatever it belongs to.
         */
        if (event.altKey) return;
        event.preventDefault();
        applyIntent(region.current, intent);
        return;
      }

      // Unmodified keys are the drawer's alone, and only while it is what you are
      // pointing at. A bare `-` typed into the composer is a hyphen, and `0` is a
      // digit everywhere — so neither is claimed here.
      if (intent === 'reset') return;
      if (region.current !== 'architecture') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      applyIntent('architecture', intent);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyIntent]);

  return <ZoomContext.Provider value={levels}>{children}</ZoomContext.Provider>;
}

/**
 * Read the zoom levels.
 *
 * Returns an inert 100%/100% value when there is no provider rather than throwing.
 * `AppWindow` and the drawer are both mounted standalone in tests, and a hard throw
 * would make the provider a hidden dependency of every one of those.
 */
export function useZoom(): ZoomValue {
  return useContext(ZoomContext) ?? FALLBACK;
}

const FALLBACK: ZoomValue = {
  zoom: { page: DEFAULT_ZOOM, architecture: DEFAULT_ZOOM },
  zoomIn: () => {},
  zoomOut: () => {},
  resetZoom: () => {},
  applyIntent: () => {},
  panResetToken: 0,
};
