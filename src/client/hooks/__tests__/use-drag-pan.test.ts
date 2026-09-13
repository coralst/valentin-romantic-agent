import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDragPan, type UseDragPanOptions } from '../use-drag-pan';

/**
 * A stand-in for the scroll container.
 *
 * jsdom has no layout, so `scrollLeft` on a real element is a getter that always
 * answers 0 — asserting against one would test nothing. A plain object records the
 * writes, which is the whole of what this hook does.
 */
function fakeViewport(start: { scrollLeft?: number; scrollTop?: number } = {}) {
  const node = {
    scrollLeft: start.scrollLeft ?? 0,
    scrollTop: start.scrollTop ?? 0,
  };
  return { node, ref: { current: node as unknown as HTMLElement } };
}

function pointerDownOn(
  overrides: Partial<{ button: number; clientX: number; clientY: number; target: Element }> = {},
) {
  const preventDefault = vi.fn();
  const event = {
    button: 0,
    clientX: 0,
    clientY: 0,
    target: document.createElement('div'),
    preventDefault,
    ...overrides,
  };
  return { event: event as unknown as React.PointerEvent<HTMLElement>, preventDefault };
}

/** A pointer event the window listener will read `clientX`/`clientY` off. */
function movePointer(type: 'pointermove' | 'pointerup', clientX = 0, clientY = 0) {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX, clientY }));
  });
}

function setup(options: UseDragPanOptions = {}) {
  const viewport = fakeViewport();
  const hook = renderHook((props: UseDragPanOptions) => useDragPan(viewport.ref, props), {
    initialProps: options,
  });
  return { ...viewport, hook };
}

describe('dragging the diagram', () => {
  it('scrolls the box the opposite way, so the content follows the pointer', () => {
    const { node, hook } = setup();

    act(() => hook.result.current.onPointerDown(pointerDownOn({ clientX: 100, clientY: 50 }).event));
    movePointer('pointermove', 60, 20);

    // Dragged 40px left and 30px up: the view moves 40 right and 30 down to match.
    expect(node.scrollLeft).toBe(40);
    expect(node.scrollTop).toBe(30);
  });

  it('measures from where the drag started, not from the last move', () => {
    const { node, hook } = setup();

    act(() => hook.result.current.onPointerDown(pointerDownOn({ clientX: 100, clientY: 100 }).event));
    movePointer('pointermove', 90, 100);
    movePointer('pointermove', 70, 100);

    // 30 from the origin, not 10 + 20 accumulated off a moving base.
    expect(node.scrollLeft).toBe(30);
  });

  it('converts the pointer’s pixels into the scroller’s units', () => {
    // Under a page zoom of 0.5 a 50px drag is 100 units of scroll, or the diagram
    // visibly slides out from under the cursor.
    const { node, hook } = setup({ scale: 0.5 });

    act(() => hook.result.current.onPointerDown(pointerDownOn({ clientX: 50 }).event));
    movePointer('pointermove', 0, 0);

    expect(node.scrollLeft).toBe(100);
  });

  it('reports the grab, for the cursor', () => {
    const { hook } = setup();
    expect(hook.result.current.isPanning).toBe(false);

    act(() => hook.result.current.onPointerDown(pointerDownOn().event));
    expect(hook.result.current.isPanning).toBe(true);

    movePointer('pointerup');
    expect(hook.result.current.isPanning).toBe(false);
  });

  it('stops when the button comes up, wherever it comes up', () => {
    const { node, hook } = setup();

    act(() => hook.result.current.onPointerDown(pointerDownOn({ clientX: 100 }).event));
    movePointer('pointermove', 90);
    movePointer('pointerup', 90);
    movePointer('pointermove', 0);

    // The move after release must not still be dragging the view.
    expect(node.scrollLeft).toBe(10);
  });

  it('prevents the default, or the drag selects the diagram’s labels', () => {
    const { hook } = setup();
    const down = pointerDownOn();

    act(() => hook.result.current.onPointerDown(down.event));

    expect(down.preventDefault).toHaveBeenCalled();
  });
});

describe('what is not a pan', () => {
  it('a drag that starts on a button', () => {
    // Missing a button is not asking to pan, and panning would swallow its click.
    const { node, hook } = setup();
    const button = document.createElement('button');

    act(() => hook.result.current.onPointerDown(pointerDownOn({ target: button, clientX: 100 }).event));
    movePointer('pointermove', 0);

    expect(hook.result.current.isPanning).toBe(false);
    expect(node.scrollLeft).toBe(0);
  });

  it('a drag that starts on something inside a button', () => {
    const { hook } = setup();
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.append(label);
    document.body.append(button);

    act(() => hook.result.current.onPointerDown(pointerDownOn({ target: label }).event));

    expect(hook.result.current.isPanning).toBe(false);
    button.remove();
  });

  it('the middle or right button', () => {
    const { hook } = setup();

    act(() => hook.result.current.onPointerDown(pointerDownOn({ button: 1 }).event));
    expect(hook.result.current.isPanning).toBe(false);

    act(() => hook.result.current.onPointerDown(pointerDownOn({ button: 2 }).event));
    expect(hook.result.current.isPanning).toBe(false);
  });
});

describe('the reset token', () => {
  it('returns the view to its corner when it is bumped', () => {
    const { node, hook } = setup({ resetToken: 0 });
    act(() => hook.result.current.onPointerDown(pointerDownOn({ clientX: 100 }).event));
    movePointer('pointermove', 0);
    expect(node.scrollLeft).toBe(100);

    hook.rerender({ resetToken: 1 });

    expect(node.scrollLeft).toBe(0);
    expect(node.scrollTop).toBe(0);
  });

  it('does nothing on the first render', () => {
    // Otherwise every mount would scroll a view somebody had already panned.
    const viewport = fakeViewport({ scrollLeft: 40, scrollTop: 20 });
    renderHook(() => useDragPan(viewport.ref, { resetToken: 0 }));

    expect(viewport.node.scrollLeft).toBe(40);
    expect(viewport.node.scrollTop).toBe(20);
  });
});
