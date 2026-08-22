import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LearnedStatus, LEARNED_STATUS_DWELL_MS } from '../LearnedStatus';

/** Walks the dwell timer forward inside act, so React flushes the hide. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('LearnedStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('announces the discovery when one arrives', () => {
    render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

    const line = screen.getByTestId('learned-status');
    expect(line.textContent).toContain('Noted');
    expect(line.textContent).toContain('Uses she/her');
  });

  it('says nothing before anything has been learned', () => {
    render(<LearnedStatus announcement={null} />);
    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
  });

  it('is gone once the dwell elapses', () => {
    render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);
    expect(screen.getByTestId('learned-status')).toBeInTheDocument();

    advance(LEARNED_STATUS_DWELL_MS);

    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
  });

  it('stays put for the whole dwell rather than flashing', () => {
    render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

    advance(LEARNED_STATUS_DWELL_MS - 1);

    expect(screen.getByTestId('learned-status')).toBeInTheDocument();
  });

  it('collapses several discoveries from one turn onto a single line', () => {
    render(
      <LearnedStatus
        announcement={{ id: 'p1|p2', values: ['Late-night jazz', 'Hiking at sunrise'] }}
      />,
    );

    // One line, not a stack: two lines saying almost the same thing is the
    // stacked-card defect again in a quieter font.
    expect(screen.getAllByTestId('learned-status')).toHaveLength(1);
    expect(screen.getByTestId('learned-status-values').textContent).toBe(
      'Late-night jazz · Hiking at sunrise',
    );
  });

  it('lights up again when a later batch arrives', () => {
    const { rerender } = render(
      <LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />,
    );
    advance(LEARNED_STATUS_DWELL_MS);
    expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();

    rerender(<LearnedStatus announcement={{ id: 'p2', values: ['Salsa dancing'] }} />);

    expect(screen.getByTestId('learned-status').textContent).toContain('Salsa dancing');
  });

  /**
   * The slot outlives the line it holds. Both halves matter: a transcript whose
   * height changed every four seconds while the user read would be worse than the
   * old permanent card, and an aria-live region has to be mounted before its
   * content changes to be announced at all.
   */
  it('reserves its space whether or not it is saying anything', () => {
    const { rerender } = render(
      <LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />,
    );
    const slot = screen.getByTestId('learned-status-slot');
    const reserved = slot.style.height;
    expect(reserved).not.toBe('');
    expect(slot.getAttribute('aria-live')).toBe('polite');

    advance(LEARNED_STATUS_DWELL_MS);
    rerender(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

    expect(screen.getByTestId('learned-status-slot').style.height).toBe(reserved);
  });

  describe('reduced motion', () => {
    function stubMotionPreference(reduce: boolean) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    }

    it('fades by default', () => {
      stubMotionPreference(false);
      render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

      const line = screen.getByTestId('learned-status');
      expect(line.getAttribute('data-animated')).toBe('true');
      expect(line.style.animation).toContain('learned-status-life');
    });

    it('appears and disappears plainly when the user asked for less motion', () => {
      stubMotionPreference(true);
      render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

      const line = screen.getByTestId('learned-status');
      expect(line.getAttribute('data-animated')).toBe('false');
      expect(line.style.animation).toBe('');
    });

    it('still clears itself on time with motion reduced', () => {
      // The fade is the concession, not the ephemerality: a line that stayed
      // forever for these users would be the original defect again.
      stubMotionPreference(true);
      render(<LearnedStatus announcement={{ id: 'p1', values: ['Uses she/her'] }} />);

      advance(LEARNED_STATUS_DWELL_MS);

      expect(screen.queryByTestId('learned-status')).not.toBeInTheDocument();
    });
  });
});
