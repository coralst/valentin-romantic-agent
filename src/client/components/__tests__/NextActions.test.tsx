import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextActions } from '../brief/NextActions';
import type { Task } from '../../../shared/interfaces/task';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'book',
    title: 'Book whatever she picks',
    due: '2026-09-04',
    note: null,
    done: false,
    source: 'manual',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Four open tasks, which is one more than the rail will list. */
const FOUR_OPEN = [
  task({ id: 'a', title: 'Ask her how she wants to mark the 18th', due: '2026-08-29' }),
  task({ id: 'b', title: 'Book whatever she picks', due: '2026-09-05' }),
  task({ id: 'c', title: 'Card in the post for Yosef', due: '2026-09-06' }),
  task({ id: 'd', title: 'Order the ceramic glaze set', due: null }),
];

/*
 * The rail's badge and the dossier's "N open" describe the same tasks and used to
 * disagree on screen at the same time — "3" here against "4 open" there. The cause
 * was one expression doing two jobs: `openTasks(tasks).slice(0, limit)`, whose
 * length the badge read, so the count silently stopped at the limit.
 */
describe('NextActions — the badge counts every open task, not the visible ones', () => {
  it('shows the true open count when the list is truncated', () => {
    render(<NextActions tasks={FOUR_OPEN} onAct={vi.fn()} />);
    expect(screen.getByTestId('brief-section-what-to-do-next').textContent).toContain('4');
  });

  it('still lists only three rows', () => {
    render(<NextActions tasks={FOUR_OPEN} onAct={vi.fn()} />);
    expect(screen.getByTestId('brief-next-actions').querySelectorAll('[data-testid^="brief-action-"]'))
      .toHaveLength(3);
  });

  it('says where the rest are, rather than hiding them silently', () => {
    render(<NextActions tasks={FOUR_OPEN} onAct={vi.fn()} />);
    expect(screen.getByTestId('brief-next-actions-more').textContent).toContain('1 more');
  });

  it('carries no overflow line when everything open is on screen', () => {
    render(<NextActions tasks={FOUR_OPEN.slice(0, 2)} onAct={vi.fn()} />);
    expect(screen.queryByTestId('brief-next-actions-more')).not.toBeInTheDocument();
    expect(screen.getByTestId('brief-section-what-to-do-next').textContent).toContain('2');
  });

  it('ignores ticked tasks in the count as well as the list', () => {
    render(
      <NextActions
        tasks={[...FOUR_OPEN.slice(0, 2), task({ id: 'done-1', done: true })]}
        onAct={vi.fn()}
      />,
    );
    expect(screen.getByTestId('brief-section-what-to-do-next').textContent).toContain('2');
    expect(screen.queryByTestId('brief-next-actions-more')).not.toBeInTheDocument();
  });

  it('renders nothing at all when there is nothing open', () => {
    render(<NextActions tasks={[task({ done: true })]} onAct={vi.fn()} />);
    expect(screen.queryByTestId('brief-next-actions')).not.toBeInTheDocument();
  });
});
