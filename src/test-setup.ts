import '@testing-library/jest-dom';

// jsdom doesn't implement scrollIntoView.
// Guarded because this setup file also runs for suites that opt into the node
// environment (the CDK synth tests under infra/), where there is no DOM.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};

  /*
   * jsdom implements no part of the Pointer Capture API, so the resize handle in
   * LiveArchitectureDrawer threw `setPointerCapture is not a function` on every
   * pointerdown. React swallowed it into an unhandled rejection rather than a
   * test failure, which is the worst shape for this: every assertion still
   * passed and reported green while `npm test` exited 1 — so CI's required
   * "Unit Tests (vitest)" check failed with nothing in the summary explaining
   * why.
   *
   * Stubbed here rather than made optional in the component. The real browser
   * has these methods, and a drag that silently skips capture stops tracking the
   * pointer once it leaves the handle — so guarding the call in the component
   * would trade a loud test-only error for a quiet production bug.
   *
   * `capturedPointers` keeps the trio honest: `endDrag` only releases when
   * `hasPointerCapture` agrees, and a stub that always returned false would let
   * a broken release path pass.
   */
  const capturedPointers = new WeakMap<Element, Set<number>>();

  Element.prototype.setPointerCapture = function setPointerCapture(pointerId: number) {
    const held = capturedPointers.get(this) ?? new Set<number>();
    held.add(pointerId);
    capturedPointers.set(this, held);
  };

  Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId: number) {
    return capturedPointers.get(this)?.has(pointerId) ?? false;
  };

  Element.prototype.releasePointerCapture = function releasePointerCapture(pointerId: number) {
    capturedPointers.get(this)?.delete(pointerId);
  };
}
