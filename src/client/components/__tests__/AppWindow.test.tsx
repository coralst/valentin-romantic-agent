import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AppWindow, windowCellStyle } from '../AppWindow';
import { ZoomProvider } from '../../context/zoom-context';
import { layout, radii, insets } from '../../design-system/tokens';

describe('AppWindow', () => {
  it('lays the desktop frame out as the four mocked columns', () => {
    render(
      <AppWindow variant="desktop">
        <div />
      </AppWindow>,
    );
    const frame = screen.getByTestId('app-window');
    expect(frame.style.gridTemplateColumns).toBe(
      `${layout.iconRailWidth}px ${layout.conversationListWidth}px minmax(0, 1fr) ${layout.briefRailWidth}px`,
    );
  });

  it('floats the desktop window on an inset linen page with a 34px radius', () => {
    render(
      <AppWindow variant="desktop">
        <div />
      </AppWindow>,
    );
    expect(screen.getByTestId('app-window-page').style.padding).toBe(`${insets.tight}px`);
    expect(screen.getByTestId('app-window').style.borderRadius).toBe(`${radii.window}px`);
    expect(screen.getByTestId('app-window').style.overflow).toBe('hidden');
  });

  it('goes full-bleed on mobile so the frame does not eat a 375px viewport', () => {
    render(
      <AppWindow variant="mobile">
        <div />
      </AppWindow>,
    );
    // jsdom serialises a unitless zero as "0", not "0px".
    expect(screen.getByTestId('app-window-page').style.padding).toBe('0px');
    const frame = screen.getByTestId('app-window');
    expect(frame.style.borderRadius).toBe('0');
    expect(frame.style.boxShadow).toBe('none');
    // Stacked rows, not columns: the rail becomes a top strip.
    expect(frame.style.gridTemplateColumns).toBe('100%');
  });

  describe('the page zoom', () => {
    /** Cmd+− with the pointer on the shell — the shell's own zoom, not the tab's. */
    function zoomTheShellOut(times: number) {
      for (let i = 0; i < times; i += 1) {
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: '-', metaKey: true, cancelable: true }),
          );
        });
      }
    }

    function renderZoomable() {
      localStorage.clear();
      return render(
        <ZoomProvider>
          <AppWindow variant="desktop">
            <div />
          </AppWindow>
        </ZoomProvider>,
      );
    }

    it('starts at 100% and needs no arithmetic there', () => {
      renderZoomable();
      const page = screen.getByTestId('app-window-page');
      expect(page.dataset.pageZoom).toBe('1');
      expect(page.style.height).toBe('100vh');
    });

    it('re-lays-out the shell smaller, rather than painting it smaller', () => {
      renderZoomable();
      zoomTheShellOut(2);

      const page = screen.getByTestId('app-window-page');
      expect(page.dataset.pageZoom).toBe('0.8');
      // `zoom`, not a transform: a transform would shrink the window and leave linen
      // around it, showing the same messages smaller instead of showing more of them.
      expect(page.style.transform).toBe('');
    });

    it('divides the viewport units back out, so the frame is still one screen', () => {
      renderZoomable();
      zoomTheShellOut(2);

      const page = screen.getByTestId('app-window-page');
      // 125vh × 0.8 = one screen. Left at 100vh the frame would stop short of the
      // bottom and stand on a band of linen.
      expect(page.style.height).toBe('125vh');
    });

    it('leaves the width alone, because a percentage is already zoom-relative', () => {
      // Measured regression: `125%` here rendered the frame 393px wider than a 1600px
      // viewport and carried the brief rail off the right-hand edge. Under `zoom` a
      // percentage resolves against an already-converted containing block, so only the
      // absolute units (`vh` above) need the division.
      renderZoomable();
      zoomTheShellOut(2);

      expect(screen.getByTestId('app-window-page').style.width).toBe('100%');
    });

    it('is not applied by the frame, which keeps its own 100%', () => {
      renderZoomable();
      zoomTheShellOut(2);

      // Zoom compounds down the tree; a second one here would square it.
      expect(screen.getByTestId('app-window').style.height).toBe('100%');
    });
  });

  it('zeroes the min sizes on window cells so the composer cannot be pushed out', () => {
    // Regression guard for option-5d-brief.html:41-42. A grid item defaults to
    // min-height:auto, which sizes it to its content — the chat column would
    // then grow to fit the whole transcript and push the composer out of the
    // window rather than scrolling.
    expect(windowCellStyle.minHeight).toBe(0);
    expect(windowCellStyle.minWidth).toBe(0);
  });
});
