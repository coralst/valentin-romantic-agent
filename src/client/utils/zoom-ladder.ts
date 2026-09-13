/**
 * The zoom ladder: where the rungs are, how far each region may travel, and what a
 * keystroke means.
 *
 * ## Why two regions rather than one browser zoom
 *
 * Cmd+/− in the browser zooms the whole tab, which is the one thing that cannot be
 * asked for here. Presenting this app means wanting *less* of the shell — more of the
 * transcript on screen at once — and at the same time *more* of the architecture
 * drawer, so one Fargate card can be pointed at from across a room. A single zoom
 * cannot do both, so there are two, and the accelerator applies to whichever region
 * the pointer is in.
 *
 * Everything in this file is arithmetic on numbers and one key name, so it is
 * testable without a DOM.
 */

/** The two things that zoom independently. */
export type ZoomRegion = 'page' | 'architecture';

export interface ZoomBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Fixed rungs, near enough to Chrome's own.
 *
 * A multiplier (`× 1.1` per press) is tempting and wrong: round-tripping in and out
 * lands on 0.9999999, so the readout says 100% while the layout is not at 100% and
 * the reset button looks like it did nothing. Fixed rungs also keep the type landing
 * on whole pixels at the sizes anyone actually stops at.
 */
export const ZOOM_STEPS: readonly number[] = [
  0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];

/** The rung both regions start on, and the one the reset returns to. */
export const DEFAULT_ZOOM = 1;

/**
 * How far each region may travel, and why they differ.
 *
 * The page *reflows* at its zoom, so its floor is the smallest type still readable
 * across a room and its ceiling is the point past which the drawer and the composer
 * start fighting over the last of the window. The architecture drawer only ever
 * paints a fixed canvas larger — nothing reflows, it just gets bigger and pans — so
 * it is allowed to go to 3×, which is the whole reason the feature exists.
 *
 * Both bounds are themselves rungs, deliberately. A bound that falls between two
 * rungs is a ceiling the steppers can never reach, so the `+` button would sit there
 * enabled and do nothing at the top of its range.
 */
export const ZOOM_BOUNDS: Record<ZoomRegion, ZoomBounds> = {
  page: { min: 0.6, max: 1.25 },
  architecture: { min: 0.5, max: 3 },
};

/** What a keystroke is asking for. */
export type ZoomIntent = 'in' | 'out' | 'reset';

/**
 * Tolerance for comparing a stored or clamped zoom against a rung.
 *
 * Zooms arrive from `localStorage` as strings and from the bounds as divisions, so
 * exact equality against a rung is not safe even though every rung is one decimal
 * place.
 */
const EPSILON = 1e-6;

export function clampZoom(value: number, bounds: ZoomBounds): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

/** The rungs a region is allowed to stand on. */
function rungsWithin(bounds: ZoomBounds): readonly number[] {
  const inside = ZOOM_STEPS.filter(
    (step) => step >= bounds.min - EPSILON && step <= bounds.max + EPSILON,
  );
  // A bounds pair that excludes every rung would otherwise make `stepZoom` return
  // `undefined`. Falling back to the bounds themselves keeps the control usable.
  return inside.length > 0 ? inside : [bounds.min, bounds.max];
}

/**
 * The next rung up (`direction: 1`) or down (`direction: -1`), or the current value
 * when there is no rung left in that direction.
 *
 * Written against `>` / `<` rather than an index lookup so a zoom restored from an
 * older ladder — or clamped to a bound that is not itself a rung — still steps onto
 * the nearest rung instead of refusing to move.
 */
export function stepZoom(current: number, direction: 1 | -1, bounds: ZoomBounds): number {
  const rungs = rungsWithin(bounds);
  if (direction > 0) {
    return rungs.find((rung) => rung > current + EPSILON) ?? rungs[rungs.length - 1];
  }
  return (
    [...rungs].reverse().find((rung) => rung < current - EPSILON) ?? rungs[0]
  );
}

/** The zoom as a readout: `1` → `100%`. */
export function formatZoom(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * What a key name means to the zoom, or `null` if it means nothing.
 *
 * `+` and `_` are here beside `=` and `-` because a shifted `=` arrives as `+` on a
 * US layout and the numeric keypad sends `+` and `-` outright; leaving them out
 * makes the accelerator work only for people who do not hold shift.
 */
export function zoomIntent(key: string): ZoomIntent | null {
  switch (key) {
    case '=':
    case '+':
      return 'in';
    case '-':
    case '_':
      return 'out';
    case '0':
      return 'reset';
    default:
      return null;
  }
}

/** The zoom `intent` lands on, starting from `current`. */
export function applyZoomIntent(
  current: number,
  intent: ZoomIntent,
  bounds: ZoomBounds,
): number {
  if (intent === 'reset') return clampZoom(DEFAULT_ZOOM, bounds);
  return stepZoom(current, intent === 'in' ? 1 : -1, bounds);
}
