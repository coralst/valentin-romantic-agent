import { useCallback, useEffect, useState } from 'react';
import {
  applyZoomIntent,
  clampZoom,
  DEFAULT_ZOOM,
  ZOOM_BOUNDS,
  type ZoomIntent,
  type ZoomRegion,
} from '../utils/zoom-ladder';

/**
 * The two zoom levels, remembered between sessions.
 *
 * Persisted for the same reason the drawer's height is (`use-drawer-height`): the
 * levels are a presenter's setup, not a transient view state, and having to re-zoom
 * the drawer after every reload is exactly the friction the feature exists to remove.
 *
 * One key per region rather than one JSON blob, so a corrupt or half-written value
 * costs you one region's zoom instead of both.
 */
const STORAGE_KEYS: Record<ZoomRegion, string> = {
  page: 'valentin_zoom_page',
  architecture: 'valentin_zoom_architecture',
};

export type ZoomLevels = Record<ZoomRegion, number>;

export interface UseZoomLevelsResult {
  zoom: ZoomLevels;
  zoomIn: (region: ZoomRegion) => void;
  zoomOut: (region: ZoomRegion) => void;
  resetZoom: (region: ZoomRegion) => void;
  /** Apply a keystroke's `intent` to `region`. */
  applyIntent: (region: ZoomRegion, intent: ZoomIntent) => void;
  /**
   * Bumped whenever the architecture zoom is reset.
   *
   * The pan offset lives on the drawer's scroll container, which this hook cannot
   * reach; a token it can watch is how "reset" gets to mean "back to 100% *and* back
   * to the top-left" rather than leaving the diagram scrolled off its own corner.
   */
  panResetToken: number;
}

function readStored(region: ZoomRegion): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[region]);
    if (raw === null || raw === '') return DEFAULT_ZOOM;
    const parsed = Number(raw);
    // `Number('')` is 0 and a zoom of 0 paints nothing at all, so anything that is
    // not a usable positive number is discarded rather than clamped up from zero.
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ZOOM;
    return clampZoom(parsed, ZOOM_BOUNDS[region]);
  } catch {
    return DEFAULT_ZOOM;
  }
}

function writeStored(region: ZoomRegion, value: number): void {
  try {
    localStorage.setItem(STORAGE_KEYS[region], String(value));
  } catch {
    // A zoom that cannot be remembered is worth strictly more than one that throws
    // in private browsing.
  }
}

export function useZoomLevels(): UseZoomLevelsResult {
  const [zoom, setZoom] = useState<ZoomLevels>(() => ({
    page: readStored('page'),
    architecture: readStored('architecture'),
  }));
  const [panResetToken, setPanResetToken] = useState(0);

  /*
   * Written from an effect rather than inside the state updater. Updaters have to be
   * pure — React may call one twice for the same dispatch — and a double write is
   * only harmless by luck. Watching the committed value is both correct and simpler.
   */
  useEffect(() => {
    writeStored('page', zoom.page);
    writeStored('architecture', zoom.architecture);
  }, [zoom]);

  const applyIntent = useCallback((region: ZoomRegion, intent: ZoomIntent) => {
    setZoom((current) => {
      const next = applyZoomIntent(current[region], intent, ZOOM_BOUNDS[region]);
      return next === current[region] ? current : { ...current, [region]: next };
    });
    if (intent === 'reset' && region === 'architecture') {
      setPanResetToken((token) => token + 1);
    }
  }, []);

  const zoomIn = useCallback(
    (region: ZoomRegion) => applyIntent(region, 'in'),
    [applyIntent],
  );
  const zoomOut = useCallback(
    (region: ZoomRegion) => applyIntent(region, 'out'),
    [applyIntent],
  );
  const resetZoom = useCallback(
    (region: ZoomRegion) => applyIntent(region, 'reset'),
    [applyIntent],
  );

  return { zoom, zoomIn, zoomOut, resetZoom, applyIntent, panResetToken };
}
