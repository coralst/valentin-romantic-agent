import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useIsWideEnoughToDock,
  useReservedEdgeSpace,
  INSPECTOR_DOCK_MIN_WIDTH,
} from '../use-docked-panel';

/** Stub matchMedia with a fixed answer for min-width queries. */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('useIsWideEnoughToDock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports docked on a wide viewport', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsWideEnoughToDock());
    expect(result.current).toBe(true);
  });

  it('reports not docked on a narrow viewport', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsWideEnoughToDock());
    expect(result.current).toBe(false);
  });

  it('queries the projector-sized breakpoint by default', () => {
    const queries: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return {
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    });

    renderHook(() => useIsWideEnoughToDock());

    expect(queries[0]).toBe(`(min-width: ${INSPECTOR_DOCK_MIN_WIDTH}px)`);
  });
});

describe('useReservedEdgeSpace', () => {
  afterEach(() => {
    document.body.style.paddingRight = '';
    document.body.style.boxSizing = '';
  });

  it('reserves edge space while active', () => {
    renderHook(() => useReservedEdgeSpace(600, true));
    expect(document.body.style.paddingRight).toBe('600px');
  });

  it('reserves nothing while inactive', () => {
    renderHook(() => useReservedEdgeSpace(600, false));
    expect(document.body.style.paddingRight).toBe('');
  });

  it('releases the reserved space on unmount', () => {
    const { unmount } = renderHook(() => useReservedEdgeSpace(600, true));
    expect(document.body.style.paddingRight).toBe('600px');

    unmount();
    expect(document.body.style.paddingRight).toBe('');
  });
});
