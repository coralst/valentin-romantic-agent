import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useInspectorFocus,
  useSlidePanel,
  PANEL_SLIDE_MS,
  type PinnedPreference,
} from '../use-inspector-focus';

const PINNED: PinnedPreference = {
  preferenceId: 'pref-1',
  category: 'music',
  key: 'genre',
  spanId: 'span-9',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useInspectorFocus', () => {
  it('follows live traffic by default', () => {
    const { result } = renderHook(() => useInspectorFocus());

    expect(result.current.focus.mode).toBe('live');
    expect(result.current.isPinned).toBe(false);
    expect(result.current.focus.preference).toBeUndefined();
    expect(result.current.focus.nodes).toEqual([]);
  });

  it('pins one preference and the nodes its story touches', () => {
    const { result } = renderHook(() => useInspectorFocus());

    act(() => result.current.pinPreference(PINNED, ['bedrock', 'dynamodb', 'browser']));

    expect(result.current.isPinned).toBe(true);
    expect(result.current.focus.mode).toBe('pinned');
    expect(result.current.focus.preference).toEqual(PINNED);
    expect(result.current.focus.nodes).toEqual(['bedrock', 'dynamodb', 'browser']);
  });

  it('pins a preference that has no span, rather than refusing', () => {
    const { result } = renderHook(() => useInspectorFocus());
    const untraced: PinnedPreference = { preferenceId: 'pref-2', category: 'food', key: 'cuisine' };

    act(() => result.current.pinPreference(untraced, ['dynamodb']));

    expect(result.current.isPinned).toBe(true);
    expect(result.current.focus.preference?.spanId).toBeUndefined();
  });

  it('replaces the pinned preference when another card is pressed', () => {
    const { result } = renderHook(() => useInspectorFocus());

    act(() => result.current.pinPreference(PINNED, ['dynamodb']));
    act(() =>
      result.current.pinPreference(
        { preferenceId: 'pref-3', category: 'occasions', key: 'anniversary' },
        ['bedrock'],
      ),
    );

    expect(result.current.focus.preference?.preferenceId).toBe('pref-3');
    expect(result.current.focus.nodes).toEqual(['bedrock']);
  });

  it('returns to live and forgets the pinned story', () => {
    const { result } = renderHook(() => useInspectorFocus());

    act(() => result.current.pinPreference(PINNED, ['dynamodb']));
    act(() => result.current.resumeLive());

    expect(result.current.isPinned).toBe(false);
    expect(result.current.focus.mode).toBe('live');
    expect(result.current.focus.preference).toBeUndefined();
    expect(result.current.focus.nodes).toEqual([]);
  });

  it('keeps its callbacks identity-stable across focus changes', () => {
    const { result } = renderHook(() => useInspectorFocus());
    const { pinPreference, resumeLive } = result.current;

    act(() => result.current.pinPreference(PINNED, ['dynamodb']));

    expect(result.current.pinPreference).toBe(pinPreference);
    expect(result.current.resumeLive).toBe(resumeLive);
  });
});

describe('useSlidePanel', () => {
  it('starts closed and unmounted', () => {
    const { result } = renderHook(() => useSlidePanel());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMounted).toBe(false);
  });

  it('can start open', () => {
    const { result } = renderHook(() => useSlidePanel(true));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.isMounted).toBe(true);
  });

  it('mounts before it opens so the entry can animate', () => {
    const { result } = renderHook(() => useSlidePanel());

    act(() => result.current.open());

    expect(result.current.isMounted).toBe(true);
    expect(result.current.isOpen).toBe(true);
  });

  it('stays mounted through the exit transition, then unmounts', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSlidePanel(true));

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMounted).toBe(true);

    act(() => vi.advanceTimersByTime(PANEL_SLIDE_MS + 1));
    expect(result.current.isMounted).toBe(false);
  });

  it('reopening mid-exit cancels the unmount', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSlidePanel(true));

    act(() => result.current.close());
    act(() => vi.advanceTimersByTime(PANEL_SLIDE_MS / 2));
    act(() => result.current.open());

    act(() => vi.advanceTimersByTime(PANEL_SLIDE_MS * 2));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.isMounted).toBe(true);
  });

  it('toggles both ways', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSlidePanel());

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);

    act(() => vi.advanceTimersByTime(PANEL_SLIDE_MS + 1));
    expect(result.current.isMounted).toBe(false);
  });

  it('does not leave a timer running after unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useSlidePanel(true));

    act(() => result.current.close());
    unmount();

    expect(() => vi.advanceTimersByTime(PANEL_SLIDE_MS * 3)).not.toThrow();
  });
});
