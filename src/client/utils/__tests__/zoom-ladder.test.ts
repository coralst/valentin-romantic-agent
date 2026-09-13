import { describe, it, expect } from 'vitest';
import {
  applyZoomIntent,
  clampZoom,
  DEFAULT_ZOOM,
  formatZoom,
  stepZoom,
  ZOOM_BOUNDS,
  ZOOM_STEPS,
  zoomIntent,
} from '../zoom-ladder';

const PAGE = ZOOM_BOUNDS.page;
const ARCH = ZOOM_BOUNDS.architecture;

describe('the ladder itself', () => {
  it('is ordered, positive, and passes through 100%', () => {
    // 100% has to be a rung or the reset lands somewhere the steppers cannot reach.
    expect(ZOOM_STEPS).toContain(DEFAULT_ZOOM);
    for (const [index, step] of ZOOM_STEPS.entries()) {
      expect(step).toBeGreaterThan(0);
      if (index > 0) expect(step).toBeGreaterThan(ZOOM_STEPS[index - 1]);
    }
  });

  it('gives both regions at least one rung either side of 100%', () => {
    for (const bounds of [PAGE, ARCH]) {
      expect(bounds.min).toBeLessThan(DEFAULT_ZOOM);
      expect(bounds.max).toBeGreaterThan(DEFAULT_ZOOM);
    }
  });

  it('lets the architecture go further in than the page', () => {
    // The point of the feature: a diagram big enough to point at from a room, while
    // the shell is zoomed the other way to show more transcript.
    expect(ARCH.max).toBeGreaterThan(PAGE.max);
  });
});

describe('stepZoom', () => {
  it('walks to the next rung, not by a multiplier', () => {
    expect(stepZoom(1, 1, ARCH)).toBe(1.1);
    expect(stepZoom(1, -1, ARCH)).toBe(0.9);
  });

  it('stops at the bounds instead of running off the end', () => {
    expect(stepZoom(ARCH.max, 1, ARCH)).toBe(ARCH.max);
    expect(stepZoom(ARCH.min, -1, ARCH)).toBe(ARCH.min);
  });

  it('honours each region’s own ceiling', () => {
    // The page's ceiling is lower, so the same keystroke stops sooner there.
    expect(stepZoom(PAGE.max, 1, PAGE)).toBe(PAGE.max);
    expect(stepZoom(PAGE.max, 1, ARCH)).toBe(1.5);
  });

  it('has a reachable rung at every bound', () => {
    // A bound between two rungs is a ceiling the `+` button can never arrive at.
    for (const bounds of [PAGE, ARCH]) {
      expect(ZOOM_STEPS).toContain(bounds.min);
      expect(ZOOM_STEPS).toContain(bounds.max);
    }
  });

  it('round-trips exactly, which a multiplier would not', () => {
    // The bug fixed rungs exist to prevent: 1 × 1.1 ÷ 1.1 is 0.9999999, and a readout
    // saying 100% over a layout that is not at 100% is worse than no readout.
    let level = 1;
    for (let i = 0; i < 4; i += 1) level = stepZoom(level, 1, ARCH);
    for (let i = 0; i < 4; i += 1) level = stepZoom(level, -1, ARCH);
    expect(level).toBe(1);
  });

  it('steps onto the nearest rung from a value that is not one', () => {
    // A zoom restored from an older ladder, or clamped to a bound that is not a rung.
    expect(stepZoom(1.03, 1, ARCH)).toBe(1.1);
    expect(stepZoom(1.03, -1, ARCH)).toBe(1);
  });
});

describe('clampZoom', () => {
  it('holds a value inside its region', () => {
    expect(clampZoom(9, PAGE)).toBe(PAGE.max);
    expect(clampZoom(0.1, PAGE)).toBe(PAGE.min);
    expect(clampZoom(1, PAGE)).toBe(1);
  });

  it('falls back to 100% for a value that is not a number', () => {
    // Reached by a corrupt `localStorage` entry. A zoom of NaN paints nothing at all.
    expect(clampZoom(Number.NaN, ARCH)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY, ARCH)).toBe(DEFAULT_ZOOM);
  });
});

describe('zoomIntent', () => {
  it('reads both the unshifted and the shifted key', () => {
    // `Cmd+Shift+=` arrives as '+' on a US layout, and the keypad sends '+' outright.
    expect(zoomIntent('=')).toBe('in');
    expect(zoomIntent('+')).toBe('in');
    expect(zoomIntent('-')).toBe('out');
    expect(zoomIntent('_')).toBe('out');
    expect(zoomIntent('0')).toBe('reset');
  });

  it('claims nothing else', () => {
    for (const key of ['a', '1', 'Escape', 'ArrowUp', ' ', 'Enter']) {
      expect(zoomIntent(key)).toBeNull();
    }
  });
});

describe('applyZoomIntent', () => {
  it('routes in, out and reset', () => {
    expect(applyZoomIntent(1, 'in', ARCH)).toBe(1.1);
    expect(applyZoomIntent(1, 'out', ARCH)).toBe(0.9);
    expect(applyZoomIntent(2.5, 'reset', ARCH)).toBe(DEFAULT_ZOOM);
  });
});

describe('formatZoom', () => {
  it('reads as a whole percentage', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.6)).toBe('60%');
    expect(formatZoom(1.25)).toBe('125%');
    expect(formatZoom(3)).toBe('300%');
  });

  it('never shows a fraction of a percent', () => {
    // Float arithmetic reaches this even on a fixed ladder, via the bounds division.
    expect(formatZoom(0.7000000000000001)).toBe('70%');
  });
});
