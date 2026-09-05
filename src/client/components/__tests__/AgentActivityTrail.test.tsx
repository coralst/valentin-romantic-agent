import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentActivityTrail, formatDuration } from '../AgentActivityTrail';
import type { AgentActivityEntry } from '../../hooks/use-chat-state';

const inFlight: AgentActivityEntry = {
  kind: 'tool',
  id: 'use-0',
  iteration: 1,
  tool: 'search_tracks',
  service: 'spotify',
  inputSummary: 'query: heavy metal',
};

const finished: AgentActivityEntry = {
  ...inFlight,
  durationMs: 820,
  ok: true,
  outcome: 'Found 12 tracks.',
};

const thinking: AgentActivityEntry = {
  kind: 'thinking',
  id: 'thinking:1',
  iteration: 1,
  text: 'She mentioned peonies, so a florist matters more here than the restaurant.',
};

describe('AgentActivityTrail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing between turns', () => {
    const { container } = render(<AgentActivityTrail activity={[]} showThinking={false} />);

    // The default case — toggle off, no tools called — must be byte-for-byte
    // today's UI, with `TypingIndicator`'s dots showing in this slot instead.
    expect(container).toBeEmptyDOMElement();
  });

  it('names the partner, the tool and the redacted inputs', () => {
    render(<AgentActivityTrail activity={[inFlight]} showThinking={false} />);

    const row = screen.getByTestId('activity-tool');
    expect(row).toHaveTextContent('spotify');
    expect(row).toHaveTextContent('search_tracks');
    expect(row).toHaveTextContent('query: heavy metal');
  });

  it('says it is working until the call returns, then says what happened', () => {
    const { rerender } = render(
      <AgentActivityTrail activity={[inFlight]} showThinking={false} />,
    );
    expect(screen.getByTestId('activity-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-outcome')).not.toBeInTheDocument();

    rerender(<AgentActivityTrail activity={[finished]} showThinking={false} />);

    expect(screen.queryByTestId('activity-pending')).not.toBeInTheDocument();
    // The duration is the one number in the trail nobody could estimate.
    expect(screen.getByTestId('activity-outcome')).toHaveTextContent('Found 12 tracks.');
    expect(screen.getByTestId('activity-outcome')).toHaveTextContent('820ms');
  });

  it('hides reasoning until it is asked for', () => {
    const { rerender } = render(
      <AgentActivityTrail activity={[thinking, finished]} showThinking={false} />,
    );
    // No empty region and no placeholder implying missing content — just the tools.
    expect(screen.queryByTestId('activity-thinking')).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-tool')).toBeInTheDocument();

    rerender(<AgentActivityTrail activity={[thinking, finished]} showThinking />);

    expect(screen.getByTestId('activity-thinking')).toHaveTextContent('peonies');
  });

  it('never announces itself to a screen reader', () => {
    const { container } = render(
      <AgentActivityTrail
        activity={[thinking, { ...inFlight, id: 'use-1' }, finished]}
        showThinking
      />,
    );

    // Several frames arrive per turn, so a live region here would talk over the
    // reply the user is waiting for. The chat column keeps the two it already has.
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'What Valentin is doing' })).toBeInTheDocument();
  });

  it('marks a failure without hiding it', () => {
    render(
      <AgentActivityTrail
        activity={[{ ...finished, ok: false, outcome: 'no such tool' }]}
        showThinking={false}
      />,
    );

    expect(screen.getByTestId('activity-outcome')).toHaveTextContent('no such tool');
  });

  it('drops the pulse for a reader who asked for less motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );

    render(<AgentActivityTrail activity={[inFlight]} showThinking={false} />);

    // The word stays; only the animation goes.
    const pending = screen.getByTestId('activity-pending');
    expect(pending).toHaveTextContent('working');
    expect(pending.style.animation).toBe('');
  });
});

describe('formatDuration', () => {
  it('reads in seconds once a call takes one', () => {
    expect(formatDuration(2400)).toBe('2.4s');
    expect(formatDuration(1000)).toBe('1.0s');
  });

  it('reads in milliseconds below that', () => {
    expect(formatDuration(820)).toBe('820ms');
    expect(formatDuration(0)).toBe('0ms');
  });
});
