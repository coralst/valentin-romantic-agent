import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ZoomProvider, useZoom } from '../zoom-context';
import { ZOOM_BOUNDS } from '../../utils/zoom-ladder';

/**
 * The one question this context answers: which of the two zooms does a keystroke
 * mean? Everything else about it is arithmetic, and lives in `zoom-ladder`.
 */

function Readout() {
  const { zoom, panResetToken } = useZoom();
  return (
    <>
      <span data-testid="page-zoom">{zoom.page}</span>
      <span data-testid="arch-zoom">{zoom.architecture}</span>
      <span data-testid="pan-token">{panResetToken}</span>
    </>
  );
}

function Harness() {
  return (
    <ZoomProvider>
      <Readout />
      {/* The shell. Unmarked, so it is the `page` region by default. */}
      <div data-testid="shell">
        <textarea data-testid="composer" />
      </div>
      {/* The drawer, marked the way `LiveArchitectureDrawer` marks it. */}
      <section data-zoom-region="architecture" data-testid="drawer">
        <button data-testid="drawer-button" type="button">
          Hide
        </button>
        <input data-testid="drawer-input" />
      </section>
    </ZoomProvider>
  );
}

/** The pointer entering `element`. Only the target matters to the listener. */
function pointAt(element: Element) {
  act(() => {
    element.dispatchEvent(new Event('pointerover', { bubbles: true }));
  });
}

function focusInto(element: Element) {
  act(() => {
    element.dispatchEvent(new Event('focusin', { bubbles: true }));
  });
}

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const pageZoom = () => Number(screen.getByTestId('page-zoom').textContent);
const archZoom = () => Number(screen.getByTestId('arch-zoom').textContent);
const panToken = () => Number(screen.getByTestId('pan-token').textContent);

beforeEach(() => {
  localStorage.clear();
});

describe('the accelerator picks a region by pointer', () => {
  it('zooms the page, and only the page, from the shell', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('shell'));

    press('-', { metaKey: true });

    expect(pageZoom()).toBe(0.9);
    // The whole point of two zooms: the diagram did not move.
    expect(archZoom()).toBe(1);
  });

  it('zooms the architecture, and only the architecture, from the drawer', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('drawer-button'));

    press('=', { metaKey: true });

    expect(archZoom()).toBe(1.1);
    expect(pageZoom()).toBe(1);
  });

  it('holds the two apart across a full setup — shell out, diagram in', () => {
    // The asked-for end state: more transcript on screen *and* a bigger diagram.
    render(<Harness />);

    pointAt(screen.getByTestId('shell'));
    press('-', { metaKey: true });
    press('-', { metaKey: true });

    pointAt(screen.getByTestId('drawer'));
    press('=', { metaKey: true });
    press('=', { metaKey: true });

    expect(pageZoom()).toBe(0.8);
    expect(archZoom()).toBe(1.25);
  });

  it('follows the keyboard when there is no pointer', () => {
    render(<Harness />);
    focusInto(screen.getByTestId('drawer-button'));

    press('=', { metaKey: true });

    expect(archZoom()).toBe(1.1);
    expect(pageZoom()).toBe(1);
  });

  it('treats Ctrl the same as Cmd', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('shell'));

    press('-', { ctrlKey: true });

    expect(pageZoom()).toBe(0.9);
  });

  it('reads a shifted plus as well as a bare equals', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('drawer'));

    press('+', { metaKey: true, shiftKey: true });

    expect(archZoom()).toBe(1.1);
  });
});

describe('the browser’s own zoom', () => {
  it('is prevented, or both zooms happen at once', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('shell'));

    expect(press('-', { metaKey: true }).defaultPrevented).toBe(true);
    expect(press('=', { metaKey: true }).defaultPrevented).toBe(true);
    expect(press('0', { metaKey: true }).defaultPrevented).toBe(true);
  });

  it('is left alone for keys that are not ours', () => {
    render(<Harness />);

    expect(press('a', { metaKey: true }).defaultPrevented).toBe(false);
    // Cmd+Alt+− belongs to whatever bound it; swallowing it would break that.
    expect(press('-', { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(pageZoom()).toBe(1);
  });
});

describe('bare + and − belong to the drawer alone', () => {
  it('zooms the architecture while the pointer is in the drawer', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('drawer'));

    press('+');
    expect(archZoom()).toBe(1.1);

    press('-');
    expect(archZoom()).toBe(1);
  });

  it('does nothing over the shell, where − is a hyphen', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('shell'));

    const event = press('-');

    expect(archZoom()).toBe(1);
    expect(pageZoom()).toBe(1);
    // Unprevented, or the composer never receives the character.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while typing, even inside the drawer', () => {
    // The trap this guards: a text field inside the region — the drawer has one — and
    // a zoom that eats every hyphen typed into it.
    render(<Harness />);
    const input = screen.getByTestId('drawer-input');
    pointAt(input);

    const event = press('-', {}, input);

    expect(archZoom()).toBe(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a bare 0 as a digit', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('drawer'));
    press('=', { metaKey: true });

    const event = press('0');

    expect(archZoom()).toBe(1.1);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('reset', () => {
  it('returns the pointed-at region to 100% and leaves the other alone', () => {
    render(<Harness />);

    pointAt(screen.getByTestId('shell'));
    press('-', { metaKey: true });
    pointAt(screen.getByTestId('drawer'));
    press('=', { metaKey: true });

    press('0', { metaKey: true });

    expect(archZoom()).toBe(1);
    expect(pageZoom()).toBe(0.9);
  });

  it('also asks the drawer to un-pan', () => {
    // Resetting the zoom while the diagram is scrolled into a corner would otherwise
    // leave a 100% diagram showing its own bottom-right edge.
    render(<Harness />);
    pointAt(screen.getByTestId('drawer'));
    const before = panToken();

    press('0', { metaKey: true });

    expect(panToken()).toBe(before + 1);
  });

  it('does not touch the pan when the page is what was reset', () => {
    render(<Harness />);
    pointAt(screen.getByTestId('shell'));
    const before = panToken();

    press('0', { metaKey: true });

    expect(panToken()).toBe(before);
  });
});

describe('the bounds', () => {
  it('stop each region at its own floor and ceiling', () => {
    render(<Harness />);

    pointAt(screen.getByTestId('shell'));
    for (let i = 0; i < 20; i += 1) press('-', { metaKey: true });
    expect(pageZoom()).toBe(ZOOM_BOUNDS.page.min);

    pointAt(screen.getByTestId('drawer'));
    for (let i = 0; i < 20; i += 1) press('=', { metaKey: true });
    expect(archZoom()).toBe(ZOOM_BOUNDS.architecture.max);
  });
});

describe('persistence', () => {
  it('remembers both levels for the next session', () => {
    const first = render(<Harness />);
    pointAt(screen.getByTestId('shell'));
    press('-', { metaKey: true });
    pointAt(screen.getByTestId('drawer'));
    press('=', { metaKey: true });
    first.unmount();

    render(<Harness />);

    expect(pageZoom()).toBe(0.9);
    expect(archZoom()).toBe(1.1);
  });

  it('ignores a stored value that is not a usable zoom', () => {
    // A zoom of 0 paints nothing at all, and `Number('')` is 0.
    localStorage.setItem('valentin_zoom_page', 'not a number');
    localStorage.setItem('valentin_zoom_architecture', '0');

    render(<Harness />);

    expect(pageZoom()).toBe(1);
    expect(archZoom()).toBe(1);
  });

  it('clamps a stored value from outside the region’s range', () => {
    localStorage.setItem('valentin_zoom_architecture', '99');

    render(<Harness />);

    expect(archZoom()).toBe(ZOOM_BOUNDS.architecture.max);
  });
});
