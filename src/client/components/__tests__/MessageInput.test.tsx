import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageInput } from '../MessageInput';

/**
 * jsdom lays nothing out, so every element's `scrollHeight` is 0 and the autosize
 * would measure a one-line box for a ten-line draft. Standing in a fake that reports
 * a height proportional to the number of lines in `value` is the only way to test the
 * behaviour at all — and it is the *relationship* being asserted here (more lines ⇒
 * taller, capped, and shrinking again), which does not depend on real font metrics.
 */
const LINE = 22;
let restore: (() => void) | null = null;

beforeAll(() => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight',
  );
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const lines = this.value === '' ? 1 : this.value.split('\n').length;
      return lines * LINE + 3;
    },
  });
  restore = () => {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)
      .scrollHeight;
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
  };
});

afterAll(() => restore?.());

const noop = () => {};

function heightOf(): number {
  const el = screen.getByLabelText('Type a message') as HTMLTextAreaElement;
  return parseFloat(el.style.height);
}

describe('MessageInput', () => {
  it('is one line tall for an empty draft', () => {
    render(<MessageInput value="" onChange={noop} onSubmit={noop} />);
    expect(heightOf()).toBe(25);
  });

  /**
   * The reported bug: a fixed `height: 24` meant a multi-line draft scrolled its own
   * first line out of sight and you could not see what you had written.
   */
  it('grows as the draft gains lines', () => {
    const { rerender } = render(
      <MessageInput value="one" onChange={noop} onSubmit={noop} />,
    );
    const single = heightOf();

    rerender(<MessageInput value={'one\ntwo\nthree'} onChange={noop} onSubmit={noop} />);
    expect(heightOf()).toBeGreaterThan(single);
    expect(heightOf()).toBe(3 * LINE + 3);
  });

  it('shrinks again when lines are removed', () => {
    const { rerender } = render(
      <MessageInput value={'one\ntwo\nthree'} onChange={noop} onSubmit={noop} />,
    );
    const tall = heightOf();

    rerender(<MessageInput value="one" onChange={noop} onSubmit={noop} />);
    expect(heightOf()).toBeLessThan(tall);
  });

  /**
   * The composer does not scroll away, so unbounded growth would push the transcript
   * off the top of the window — losing the conversation to see the draft.
   */
  it('stops growing at the cap and scrolls inside itself instead', () => {
    const draft = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    render(<MessageInput value={draft} onChange={noop} onSubmit={noop} />);
    expect(heightOf()).toBe(132);
    const el = screen.getByLabelText('Type a message') as HTMLTextAreaElement;
    expect(el.style.overflowY || getComputedStyle(el).overflowY).toBe('auto');
  });

  it('disables the send button for a draft that is not sendable', () => {
    render(<MessageInput value="   " onChange={noop} onSubmit={noop} />);
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });
});
