import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { useGlowPainter, GLOW_ATTRIBUTE, type GlowStrength } from '../use-glow-painter';
import type { GlowTarget } from '../../utils/glow-target';

/**
 * The hook paints onto whatever is already on screen, so the harness renders the
 * targets' markup as siblings of the painter rather than passing anything down —
 * which is the arrangement it has in the real app, where the drawer and the
 * transcript are in different subtrees.
 */
function Harness({
  targets,
  strength = 'pin',
  children,
}: {
  targets: readonly GlowTarget[];
  strength?: GlowStrength;
  children?: React.ReactNode;
}) {
  useGlowPainter(targets, strength);
  return <>{children}</>;
}

const MESSAGE: GlowTarget = { kind: 'message', messageId: 'message-9' };

/**
 * Give jsdom the geometry it does not have.
 *
 * jsdom lays nothing out: every `getBoundingClientRect` is zeroes and every
 * `scrollHeight` is 0, which makes each element both unscrollable and — because a
 * zero-height box is inside a zero-height box — permanently "already visible".
 * Both of those are the branches these two tests exist to cover, so the container
 * and the element are given real numbers: a 300px-tall scroller with 900px of
 * content, and a target sitting at 500px, well below the fold.
 */
function stubGeometry(container: HTMLElement, element: Element) {
  Object.defineProperty(container, 'scrollHeight', { value: 900, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
  container.getBoundingClientRect = () =>
    ({ top: 0, bottom: 300, height: 300 }) as DOMRect;
  element.getBoundingClientRect = () => ({ top: 500, bottom: 560, height: 60 }) as DOMRect;

  const scrollTo = vi.fn();
  Object.defineProperty(container, 'scrollTo', { value: scrollTo, configurable: true });
  return scrollTo;
}

/**
 * Paint after the geometry is in place.
 *
 * Mounted with nothing selected, stubbed, then given the target — so the effect
 * that scrolls runs against a laid-out DOM rather than against jsdom's zeroes.
 */
function renderThenSelect(strength: GlowStrength) {
  const markup = (targets: readonly GlowTarget[]) => (
    <Harness targets={targets} strength={strength}>
      <div style={{ overflowY: 'auto' }} data-testid="scroller">
        <div data-message-id="message-9">the reply</div>
      </div>
    </Harness>
  );

  const { container, rerender } = render(markup([]));

  const scroller = container.querySelector<HTMLElement>('[data-testid="scroller"]');
  const bubble = container.querySelector('[data-message-id="message-9"]');
  if (!scroller || !bubble) throw new Error('harness did not render');
  const scrollTo = stubGeometry(scroller, bubble);

  rerender(markup([MESSAGE]));
  return scrollTo;
}

describe('useGlowPainter', () => {
  it('marks the element a target names', () => {
    const { container } = render(
      <Harness targets={[MESSAGE]}>
        <div data-message-id="message-9">the reply</div>
      </Harness>,
    );

    const bubble = container.querySelector('[data-message-id="message-9"]');
    expect(bubble).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
  });

  it('carries the strength, so a hover and a click can look different', () => {
    const { container } = render(
      <Harness targets={[MESSAGE]} strength="preview">
        <div data-message-id="message-9">the reply</div>
      </Harness>,
    );

    expect(container.querySelector('[data-message-id="message-9"]')).toHaveAttribute(
      GLOW_ATTRIBUTE,
      'preview',
    );
  });

  it('lets go of the previous element when the selection moves', () => {
    const { container, rerender } = render(
      <Harness targets={[MESSAGE]}>
        <div data-message-id="message-9">the reply</div>
        <div data-message-id="message-10">a later reply</div>
      </Harness>,
    );

    rerender(
      <Harness targets={[{ kind: 'message', messageId: 'message-10' }]}>
        <div data-message-id="message-9">the reply</div>
        <div data-message-id="message-10">a later reply</div>
      </Harness>,
    );

    expect(container.querySelector('[data-message-id="message-9"]')).not.toHaveAttribute(
      GLOW_ATTRIBUTE,
    );
    expect(container.querySelector('[data-message-id="message-10"]')).toHaveAttribute(
      GLOW_ATTRIBUTE,
      'pin',
    );
  });

  it('clears everything when the selection is dropped', () => {
    const { container, rerender } = render(
      <Harness targets={[MESSAGE]}>
        <div data-message-id="message-9">the reply</div>
      </Harness>,
    );

    rerender(
      <Harness targets={[]}>
        <div data-message-id="message-9">the reply</div>
      </Harness>,
    );

    expect(container.querySelector('[data-message-id="message-9"]')).not.toHaveAttribute(
      GLOW_ATTRIBUTE,
    );
  });

  it('marks both places a fact appears, from one target', () => {
    const { container } = render(
      <Harness
        targets={[
          {
            kind: 'preference',
            preferenceId: 'pref-1',
            sourceMessageId: 'message-7',
            fieldId: 'food_favourite',
          },
        ]}
      >
        <div data-noted-for="message-7">Noted · Chinese food</div>
        <button data-field-id="food_favourite">Food Chinese food</button>
      </Harness>,
    );

    expect(container.querySelector('[data-noted-for="message-7"]')).toHaveAttribute(GLOW_ATTRIBUTE);
    expect(container.querySelector('[data-field-id="food_favourite"]')).toHaveAttribute(
      GLOW_ATTRIBUTE,
    );
  });

  it('does nothing, and does not throw, when the target is not on screen', () => {
    expect(() =>
      render(
        <Harness targets={[MESSAGE]}>
          <div>a transcript with other messages in it</div>
        </Harness>,
      ),
    ).not.toThrow();
  });

  it('brings a pinned target into view in its own scroller', () => {
    const scrollTo = renderThenSelect('pin');

    expect(scrollTo).toHaveBeenCalledTimes(1);
    // Centred rather than scrolled to the very top: 500 - (300 - 60) / 2 = 380.
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 380 }));
  });

  it('never scrolls for a hover, because the pointer is sweeping a list', () => {
    const scrollTo = renderThenSelect('preview');

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves the scroll alone when the target is already in view', () => {
    const markup = (targets: readonly GlowTarget[]) => (
      <Harness targets={targets}>
        <div style={{ overflowY: 'auto' }} data-testid="scroller">
          <div data-message-id="message-9">the reply</div>
        </div>
      </Harness>
    );

    const { container, rerender } = render(markup([]));
    const scroller = container.querySelector<HTMLElement>('[data-testid="scroller"]');
    const bubble = container.querySelector('[data-message-id="message-9"]');
    if (!scroller || !bubble) throw new Error('harness did not render');

    const scrollTo = stubGeometry(scroller, bubble);
    // Inside the scroller's 0–300 band, so there is nothing to reveal.
    bubble.getBoundingClientRect = () => ({ top: 40, bottom: 100, height: 60 }) as DOMRect;

    rerender(markup([MESSAGE]));

    expect(scrollTo).not.toHaveBeenCalled();
    expect(bubble).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
  });
});
