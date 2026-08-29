import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFlowTraversal } from '../use-flow-traversal';
import { FLOW_LEG_MS } from '../../utils/aws-demo-flows';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Report a reduced-motion preference to `prefersReducedMotion()`. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/**
 * Let one beat elapse.
 *
 * One `act` per beat, deliberately: the next beat's timer is scheduled by an effect,
 * which React does not run until the current update has committed. Advancing 10×
 * inside a single `act` therefore fires exactly one timer — the same way the browser
 * behaves, just easier to get wrong in a test.
 */
function advanceOneLeg() {
  act(() => {
    vi.advanceTimersByTime(FLOW_LEG_MS);
  });
}

/** Walk a whole step's worth of beats, and then some. */
function advanceLegs(count: number) {
  for (let i = 0; i < count; i += 1) advanceOneLeg();
}

describe('useFlowTraversal', () => {
  it('starts at the first beat, where the traffic already is', () => {
    const { result } = renderHook(() => useFlowTraversal({ legCount: 5, resetKey: 'a' }));

    expect(result.current).toBe(0);
  });

  it('advances one beat at a time', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result } = renderHook(() => useFlowTraversal({ legCount: 5, resetKey: 'a' }));

    advanceOneLeg();
    expect(result.current).toBe(1);
    advanceOneLeg();
    expect(result.current).toBe(2);
  });

  it('rests on the last beat instead of looping', () => {
    // The end of a step's journey is the traffic sitting in its destination, and
    // that is the state the diagram should hold while the step is current.
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result } = renderHook(() => useFlowTraversal({ legCount: 3, resetKey: 'a' }));

    advanceLegs(20);
    expect(result.current).toBe(2);
  });

  it('starts over when a new step arrives', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useFlowTraversal({ legCount: 5, resetKey: key }),
      { initialProps: { key: 'step-1' } },
    );

    advanceOneLeg();
    advanceOneLeg();
    expect(result.current).toBe(2);

    rerender({ key: 'step-2' });
    // Immediately, in the same render: via an effect the new step would show the
    // previous step's beat for one frame, which on a short step is a visible flash
    // of the traffic in the wrong place.
    expect(result.current).toBe(0);
  });

  it('holds still while disabled, so a paused diagram stays parked', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result } = renderHook(() =>
      useFlowTraversal({ legCount: 5, resetKey: 'a', enabled: false }),
    );

    advanceLegs(10);
    expect(result.current).toBe(0);
  });

  it('gives reduced motion the destination rather than a faster trip to it', () => {
    // Someone who has asked the OS to stop things moving is not helped by the same
    // movement at double speed.
    vi.useFakeTimers();
    stubReducedMotion(true);
    const { result } = renderHook(() => useFlowTraversal({ legCount: 7, resetKey: 'a' }));

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe(6);
  });

  it('never reports a beat the step does not have', () => {
    // A step replaced by a shorter one in the same render would otherwise leave a
    // stale index pointing past the end of the new route.
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result, rerender } = renderHook(
      ({ legCount }: { legCount: number }) => useFlowTraversal({ legCount, resetKey: 'same' }),
      { initialProps: { legCount: 7 } },
    );

    advanceOneLeg();
    advanceOneLeg();
    advanceOneLeg();
    rerender({ legCount: 2 });

    expect(result.current).toBeLessThanOrEqual(1);
  });
});
