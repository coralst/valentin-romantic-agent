import { useEffect } from 'react';

import { glowSelectors, glowTargetKey, type GlowTarget } from '../utils/glow-target';
import { prefersReducedMotion } from '../utils/motion-preference';

/**
 * Paints the glow onto whatever is currently on screen for a set of targets.
 *
 * The attribute is the whole mechanism: this hook writes `data-glow` onto the
 * matched elements and `global-styles.ts` decides what that looks like. Keeping
 * the *look* in CSS is not a stylistic preference — inline styles cannot declare
 * keyframes at all (`global-styles.ts`), and the ring has to sit on nodes owned
 * by five different components.
 *
 * ---
 * WHY THIS TOUCHES THE DOM DIRECTLY
 *
 * Every alternative is worse here. Threading a prop down would put a
 * `glowingIds` set through `MessageHistory` → `MessageBubble`, `BriefRail` →
 * `GoodToKnow`, the header strip and the proposal list, to carry state none of
 * those components has any other use for. A context would still need each of
 * them to read it, and would still need the DOM for the scroll. The set of
 * things that can glow is open — it grows every time a beat learns a new target
 * — and a prop-threaded version has to be re-plumbed for each one.
 *
 * The read is also strictly one-way and self-healing: nothing here owns any
 * element, the attribute is removed on the next change, and an element that has
 * since unmounted simply does not match. React re-rendering underneath us cannot
 * leave a stale glow behind, because the next paint queries fresh.
 */

/** The attribute the stylesheet keys on. */
export const GLOW_ATTRIBUTE = 'data-glow';

/**
 * How insistent the glow is.
 *
 * `preview` is a hover: a still ring, no pulse and no scroll, because the
 * pointer is sweeping a list of forty rows and anything that moved the
 * transcript would make the list unusable. `pin` is a click: the presenter has
 * chosen this one, so it pulses and the app brings it into view.
 */
export type GlowStrength = 'preview' | 'pin';

/**
 * Nearest ancestor that actually scrolls.
 *
 * `+ 1` on the height comparison, because a container whose content is a
 * sub-pixel taller than its box reports `scrollHeight > clientHeight` while
 * having nowhere to go, and scrolling it produces a visible twitch and no
 * movement.
 */
function scrollableAncestor(element: Element): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Bring an element into the middle of its own scroller.
 *
 * Deliberately not `element.scrollIntoView()`, which walks *every* scrollable
 * ancestor and has already sheared this app's window grid once — the reason
 * `MessageHistory` writes `scrollTop` on the one container it owns and says so in
 * a comment. `container.scrollTo` moves that container and nothing else.
 *
 * A fully visible element is left alone: re-centring something the viewer is
 * already looking at is movement with no information in it.
 */
function revealWithin(container: HTMLElement, element: Element): void {
  const containerBox = container.getBoundingClientRect();
  const elementBox = element.getBoundingClientRect();

  const alreadyVisible =
    elementBox.top >= containerBox.top && elementBox.bottom <= containerBox.bottom;
  if (alreadyVisible) return;

  const centring = (container.clientHeight - elementBox.height) / 2;
  const desired = container.scrollTop + (elementBox.top - containerBox.top) - centring;
  const top = Math.max(0, Math.min(desired, container.scrollHeight - container.clientHeight));

  /*
   * `scrollTo` is not implemented in jsdom, and a transcript that does not scroll
   * is far better than a test suite that throws — the same trade `MessageHistory`
   * makes for `ResizeObserver`.
   */
  try {
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
  } catch {
    // Fall through to the direct assignment below.
  }
  container.scrollTop = top;
}

/** Every element currently on screen for these targets, in target order. */
function matchElements(targets: readonly GlowTarget[]): Element[] {
  const found: Element[] = [];
  const seen = new Set<Element>();

  for (const target of targets) {
    for (const selector of glowSelectors(target)) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        found.push(element);
      }
    }
  }

  return found;
}

export function useGlowPainter(targets: readonly GlowTarget[], strength: GlowStrength): void {
  /*
   * Keyed on the targets' identities rather than the array, which is rebuilt on
   * every render of the provider: an array dependency would re-run the paint —
   * and re-run the scroll — on every unrelated state change in the app.
   */
  const signature = targets.map(glowTargetKey).join('|');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (targets.length === 0) return;

    const elements = matchElements(targets);
    if (elements.length === 0) return;

    for (const element of elements) element.setAttribute(GLOW_ATTRIBUTE, strength);

    /*
     * One scroll per scroller, not one per element. A preference is on screen in
     * two independent scroll regions — the badge in the transcript, the chip in
     * the brief rail — and each has to be revealed in its own. Scrolling to the
     * last match alone would leave the other container wherever it happened to
     * be.
     */
    if (strength === 'pin') {
      const revealed = new Set<HTMLElement>();
      for (const element of elements) {
        const container = scrollableAncestor(element);
        if (!container || revealed.has(container)) continue;
        revealed.add(container);
        revealWithin(container, element);
      }
    }

    return () => {
      for (const element of elements) element.removeAttribute(GLOW_ATTRIBUTE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands in for `targets`; see above.
  }, [signature, strength]);
}
