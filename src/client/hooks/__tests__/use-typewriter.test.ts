import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from '../use-typewriter';

describe('useTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: reduced motion NOT preferred, so animation runs.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts empty and reveals text incrementally over time', () => {
    const { result } = renderHook(() =>
      useTypewriter('Hello', { speedMs: 10 }),
    );

    expect(result.current.displayedText).toBe('');

    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.displayedText).toBe('H');

    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(result.current.displayedText).toBe('Hel');
  });

  it('reveals the full text and reports isComplete', () => {
    const { result } = renderHook(() =>
      useTypewriter('Hi', { speedMs: 10 }),
    );

    expect(result.current.isComplete).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.displayedText).toBe('Hi');
    expect(result.current.isComplete).toBe(true);
  });

  it('shows full text immediately when disabled', () => {
    const { result } = renderHook(() =>
      useTypewriter('Instant text', { enabled: false }),
    );

    expect(result.current.displayedText).toBe('Instant text');
    expect(result.current.isComplete).toBe(true);
  });

  it('shows full text immediately when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true, // prefers-reduced-motion: reduce
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() =>
      useTypewriter('No animation here', { speedMs: 10 }),
    );

    expect(result.current.displayedText).toBe('No animation here');
    expect(result.current.isComplete).toBe(true);
  });

  it('restarts the reveal when text changes', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTypewriter(text, { speedMs: 10 }),
      { initialProps: { text: 'first' } },
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.displayedText).toBe('first');

    rerender({ text: 'second' });
    // Reveal restarts from empty.
    expect(result.current.displayedText).toBe('');

    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.displayedText).toBe('s');
  });
});
