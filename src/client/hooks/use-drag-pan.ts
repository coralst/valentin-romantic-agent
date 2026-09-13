import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag a surface to scroll the box it lives in — grab the diagram and move it.
 *
 * ## Why it scrolls rather than translates
 *
 * The obvious implementation keeps an `{x, y}` offset in state and paints it as a
 * `translate`. That means owning the clamp too: how far left is too far, what happens
 * when the zoom changes under an offset, what the wheel does to an offset it does not
 * know about. Driving `scrollLeft`/`scrollTop` on a real scroll container hands all of
 * that to the browser, which already clamps at the edges, already re-clamps when the
 * content resizes, and already lets a trackpad scroll the same view the drag does.
 */
export interface UseDragPanOptions {
  /**
   * CSS zoom in force between the pointer's pixels and the scroller's own units.
   *
   * `clientX` is in real viewport pixels while `scrollLeft` is in the scroller's local
   * units, so under a zoomed ancestor a 100px drag would move the content by 100/zoom
   * units and the diagram would visibly slide out from under the cursor. Dividing here
   * is what keeps the grab 1:1.
   */
  scale?: number;
  /** Bump to return the view to its top-left corner. */
  resetToken?: number;
}

export interface UseDragPanResult {
  /** True from the first move of a drag, for the `grabbing` cursor. */
  isPanning: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * Things whose own pointer handling beats panning: a drag that starts on a button is
 * someone missing the button, not someone asking to pan.
 */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"]';

export function useDragPan(
  viewport: React.RefObject<HTMLElement | null>,
  { scale = 1, resetToken = 0 }: UseDragPanOptions = {},
): UseDragPanResult {
  const [isPanning, setIsPanning] = useState(false);
  const origin = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // Read through a ref so a zoom change mid-drag does not re-bind the move listener
  // and lose the drag with it.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Primary button only: middle-click is paste-and-scroll on Linux and right is
      // the context menu, and claiming either would surprise someone.
      if (event.button !== 0) return;
      const node = viewport.current;
      if (node === null) return;
      if (
        event.target instanceof Element &&
        event.target.closest(INTERACTIVE_SELECTOR) !== null
      ) {
        return;
      }

      origin.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      };
      // Stops the drag from turning into a text selection across the diagram's labels.
      event.preventDefault();
      setIsPanning(true);
    },
    [viewport],
  );

  useEffect(() => {
    if (!isPanning) return;

    const onPointerMove = (event: PointerEvent) => {
      const node = viewport.current;
      const start = origin.current;
      if (node === null || start === null) return;

      const zoom = scaleRef.current || 1;
      node.scrollLeft = start.scrollLeft - (event.clientX - start.x) / zoom;
      node.scrollTop = start.scrollTop - (event.clientY - start.y) / zoom;
    };

    const stop = () => {
      origin.current = null;
      setIsPanning(false);
    };

    /*
     * On the window rather than the surface. A drag that leaves the drawer — dragging
     * the far edge of the diagram in from off-screen is the normal way to do it — has
     * to keep panning, and has to end when the button is released out there rather
     * than sticking to the cursor for ever.
     */
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [isPanning, viewport]);

  useEffect(() => {
    // Nothing to undo on the first render; only a later bump is a reset.
    if (resetToken === 0) return;
    const node = viewport.current;
    if (node === null) return;
    // Assignment rather than `scrollTo`: there is nothing to animate here, and
    // `Element.prototype.scrollTo` does not exist in jsdom — so calling it would make
    // a reset throw in every test that performs one.
    node.scrollLeft = 0;
    node.scrollTop = 0;
  }, [resetToken, viewport]);

  return { isPanning, onPointerDown };
}
