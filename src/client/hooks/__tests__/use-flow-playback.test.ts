import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFlowPlayback, DEFAULT_STEP_DWELL_MS } from '../use-flow-playback';

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

describe('useFlowPlayback', () => {
  it('starts paused on the first step', () => {
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 5 }));

    expect(result.current.index).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isComplete).toBe(false);
  });

  it('reports -1 and no completion for an empty flow', () => {
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 0 }));

    expect(result.current.index).toBe(-1);
    expect(result.current.isComplete).toBe(false);

    act(() => result.current.next());
    expect(result.current.index).toBe(-1);
  });

  it('steps forward and back', () => {
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 4 }));

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(2);

    act(() => result.current.previous());
    expect(result.current.index).toBe(1);
  });

  it('clamps at both ends', () => {
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 2 }));

    act(() => result.current.previous());
    expect(result.current.index).toBe(0);

    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    expect(result.current.isComplete).toBe(true);
  });

  it('advances on a timer while playing', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3 }));

    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS + 1));
    expect(result.current.index).toBe(1);

    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS + 1));
    expect(result.current.index).toBe(2);
  });

  it('stops playing at the end', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 2 }));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS + 1));

    expect(result.current.index).toBe(1);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isComplete).toBe(true);
  });

  it('honours a per-step dwell so a slow call holds longer', () => {
    vi.useFakeTimers();
    const dwellMsForStep = (index: number) => (index === 0 ? 4000 : 100);
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3, dwellMsForStep }));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.index).toBe(0);

    act(() => vi.advanceTimersByTime(3900));
    expect(result.current.index).toBe(1);

    act(() => vi.advanceTimersByTime(150));
    expect(result.current.index).toBe(2);
  });

  it('lets a manual step win over autoplay', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 5 }));

    act(() => result.current.play());
    act(() => result.current.next());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.index).toBe(1);

    // The cancelled autoplay timer must not fire afterwards.
    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS * 3));
    expect(result.current.index).toBe(1);
  });

  it('pause stops the timer where it stands', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 5 }));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS + 1));
    act(() => result.current.pause());

    const settled = result.current.index;
    act(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS * 4));

    expect(result.current.index).toBe(settled);
    expect(result.current.isPlaying).toBe(false);
  });

  it('replays from the start when play is pressed on the last step', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3 }));

    act(() => result.current.goTo(2));
    expect(result.current.isComplete).toBe(true);

    act(() => result.current.play());
    expect(result.current.index).toBe(0);
    expect(result.current.isPlaying).toBe(true);
  });

  it('restart and goTo both pause', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 6 }));

    act(() => result.current.play());
    act(() => result.current.goTo(4));
    expect(result.current.index).toBe(4);
    expect(result.current.isPlaying).toBe(false);

    act(() => result.current.play());
    act(() => result.current.restart());
    expect(result.current.index).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });

  it('clamps goTo into range', () => {
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3 }));

    act(() => result.current.goTo(99));
    expect(result.current.index).toBe(2);

    act(() => result.current.goTo(-4));
    expect(result.current.index).toBe(0);
  });

  it('pulls the index back in range when the flow gets shorter', () => {
    const { result, rerender } = renderHook((props: { stepCount: number }) =>
      useFlowPlayback(props),
    { initialProps: { stepCount: 8 } });

    act(() => result.current.goTo(7));
    expect(result.current.index).toBe(7);

    rerender({ stepCount: 3 });
    expect(result.current.index).toBe(2);
  });

  it('halves the dwell under reduced motion rather than refusing to play', () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3, defaultDwellMs: 1000 }));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));

    expect(result.current.index).toBe(1);
  });

  it('uses the full dwell when motion is not reduced', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { result } = renderHook(() => useFlowPlayback({ stepCount: 3, defaultDwellMs: 1000 }));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(520));
    expect(result.current.index).toBe(0);

    act(() => vi.advanceTimersByTime(520));
    expect(result.current.index).toBe(1);
  });

  it('clears its timer on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useFlowPlayback({ stepCount: 5 }));

    act(() => result.current.play());
    unmount();

    expect(() => vi.advanceTimersByTime(DEFAULT_STEP_DWELL_MS * 5)).not.toThrow();
  });
});
