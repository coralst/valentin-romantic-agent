import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  automaticDrawerHeight,
  DEFAULT_DRAWER_HEIGHT,
  drawerHeightBounds,
  MIN_DRAWER_HEIGHT,
  MIN_SHELL_AUTO,
  MIN_SHELL_DRAGGED,
  useDrawerHeight,
} from '../use-drawer-height';

/** jsdom does not resize itself; this is how a window height is asserted against. */
function setViewportHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
  window.dispatchEvent(new Event('resize'));
}

const TALL = 1400;
const LAPTOP = 900;
const SHORT = 700;

describe('automaticDrawerHeight — the height nobody asked for', () => {
  it('opens to the full drawer when the window can afford it', () => {
    expect(automaticDrawerHeight(TALL)).toBe(DEFAULT_DRAWER_HEIGHT);
  });

  it('gives up height rather than starving the shell', () => {
    // The bug this replaced: an unclamped 454px on a laptop left the brief rail's
    // scroll region ~200px and buried half of it.
    expect(automaticDrawerHeight(LAPTOP)).toBe(LAPTOP - MIN_SHELL_AUTO);
    expect(automaticDrawerHeight(LAPTOP)).toBeLessThan(DEFAULT_DRAWER_HEIGHT);
  });

  it('stops shrinking at a height that can still hold a diagram', () => {
    expect(automaticDrawerHeight(400)).toBe(MIN_DRAWER_HEIGHT);
    expect(automaticDrawerHeight(1)).toBe(MIN_DRAWER_HEIGHT);
  });

  it('falls back to the full height before the window has been measured', () => {
    // Server render, or the first paint. Falling back to 0 would collapse the drawer.
    expect(automaticDrawerHeight(undefined)).toBe(DEFAULT_DRAWER_HEIGHT);
  });

  it('never returns something a shell could not survive on a normal window', () => {
    for (const h of [768, 800, 900, 1080, 1200, 1440, 2160]) {
      const drawer = automaticDrawerHeight(h);
      expect(h - drawer).toBeGreaterThanOrEqual(Math.min(MIN_SHELL_AUTO, h - MIN_DRAWER_HEIGHT));
    }
  });
});

describe('drawerHeightBounds — how far a drag may go', () => {
  it('lets a deliberate drag go taller than the automatic height', () => {
    // The whole point of the two floors: the drawer is modest by default and
    // generous when asked.
    expect(drawerHeightBounds(LAPTOP).max).toBeGreaterThan(automaticDrawerHeight(LAPTOP));
  });

  it('always leaves room for the composer', () => {
    expect(drawerHeightBounds(LAPTOP).max).toBe(LAPTOP - MIN_SHELL_DRAGGED);
  });

  it('never inverts the range on a very short window', () => {
    // A max below the min makes every clamp downstream nonsense.
    for (const h of [1, 100, 300, 500, 700]) {
      const { min, max } = drawerHeightBounds(h);
      expect(max).toBeGreaterThanOrEqual(min);
    }
  });

  it('keeps the floor a diagram can live in', () => {
    expect(drawerHeightBounds(TALL).min).toBe(MIN_DRAWER_HEIGHT);
  });
});

describe('useDrawerHeight', () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportHeight(TALL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts at the automatic height, with nothing chosen', () => {
    const { result } = renderHook(() => useDrawerHeight());
    expect(result.current.height).toBe(DEFAULT_DRAWER_HEIGHT);
    expect(result.current.isCustom).toBe(false);
  });

  it('takes a height it is given', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(600));

    expect(result.current.height).toBe(600);
    expect(result.current.isCustom).toBe(true);
  });

  it('rounds a fractional height, because pixels are not fractional here', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(500.6));
    expect(result.current.height).toBe(501);
  });

  it('clamps a drag past the ceiling instead of covering the composer', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(99_999));
    expect(result.current.height).toBe(drawerHeightBounds(TALL).max);
  });

  it('clamps a drag past the floor instead of collapsing', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(-500));
    expect(result.current.height).toBe(MIN_DRAWER_HEIGHT);
  });

  it('forgets the choice on reset', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(600));
    act(() => result.current.reset());

    expect(result.current.height).toBe(DEFAULT_DRAWER_HEIGHT);
    expect(result.current.isCustom).toBe(false);
  });

  it('remembers the height for the next session', () => {
    const first = renderHook(() => useDrawerHeight());
    act(() => first.result.current.setHeight(620));
    first.unmount();

    const second = renderHook(() => useDrawerHeight());
    expect(second.result.current.height).toBe(620);
    expect(second.result.current.isCustom).toBe(true);
  });

  it('forgets it across sessions once reset', () => {
    const first = renderHook(() => useDrawerHeight());
    act(() => first.result.current.setHeight(620));
    act(() => first.result.current.reset());
    first.unmount();

    expect(renderHook(() => useDrawerHeight()).result.current.height).toBe(
      DEFAULT_DRAWER_HEIGHT,
    );
  });

  /*
   * The reason the clamp is on read and not on write.
   *
   * Clamping on write would rewrite the stored value every time the window changed
   * size: drag it tall on a monitor, close the laptop lid, and the height would be
   * squashed to fit and *stay* squashed when the monitor came back.
   */
  it('remembers the height it was asked for, not the height it could fit', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(900));
    expect(result.current.height).toBe(900);

    act(() => setViewportHeight(SHORT));
    expect(result.current.height).toBe(drawerHeightBounds(SHORT).max);

    act(() => setViewportHeight(TALL));
    expect(result.current.height).toBe(900);
  });

  it('follows the window down and back up when nothing was chosen', () => {
    const { result } = renderHook(() => useDrawerHeight());

    act(() => setViewportHeight(LAPTOP));
    expect(result.current.height).toBe(automaticDrawerHeight(LAPTOP));

    act(() => setViewportHeight(TALL));
    expect(result.current.height).toBe(DEFAULT_DRAWER_HEIGHT);
  });

  it('stays inside its bounds at every window height, chosen or not', () => {
    const { result } = renderHook(() => useDrawerHeight());
    act(() => result.current.setHeight(5000));

    for (const h of [1, 300, 700, 900, 1440, 2400]) {
      act(() => setViewportHeight(h));
      const { min, max } = drawerHeightBounds(h);
      expect(result.current.height).toBeGreaterThanOrEqual(min);
      expect(result.current.height).toBeLessThanOrEqual(max);
    }
  });
});

describe('useDrawerHeight — storage that misbehaves', () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportHeight(TALL);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores a stored value that is not a number', () => {
    localStorage.setItem('valentin_drawer_height', 'tall please');
    expect(renderHook(() => useDrawerHeight()).result.current.height).toBe(
      DEFAULT_DRAWER_HEIGHT,
    );
  });

  it('ignores a stored zero, which would be an unopenable drawer', () => {
    // `Number('')` is 0, so an empty string used to read back as a valid height.
    for (const bad of ['0', '', '-40', 'NaN', 'Infinity']) {
      localStorage.setItem('valentin_drawer_height', bad);
      expect(renderHook(() => useDrawerHeight()).result.current.height).toBe(
        DEFAULT_DRAWER_HEIGHT,
      );
    }
  });

  it('still works when localStorage throws, as in private browsing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });

    const { result } = renderHook(() => useDrawerHeight());
    expect(result.current.height).toBe(DEFAULT_DRAWER_HEIGHT);

    // The resize still has to work for this session, it just cannot be remembered.
    act(() => result.current.setHeight(600));
    expect(result.current.height).toBe(600);
  });
});
