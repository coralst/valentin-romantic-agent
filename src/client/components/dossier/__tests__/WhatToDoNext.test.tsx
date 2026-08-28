import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../../../../shared/interfaces/task';
import { dueLabel, WhatToDoNext } from '../WhatToDoNext';

const NOW = new Date(2026, 7, 28, 9, 0, 0);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'book',
    title: 'Book whatever she picks',
    due: '2026-09-04',
    note: 'Northern Italian, if it is her choosing',
    done: false,
    source: 'manual',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WhatToDoNext', () => {
  it('counts what is open, not what is on the list', () => {
    render(
      <WhatToDoNext
        tasks={[task(), task({ id: 'done', done: true })]}
        onToggle={() => {}}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('dossier-what-to-do')).toHaveTextContent('1 open');
  });

  it('keeps finished rows on screen, under the open ones', () => {
    // A list that swallows completed work gives you nothing back for doing it —
    // and the ticked rows are what make the tick look reliable.
    render(
      <WhatToDoNext
        tasks={[task({ id: 'done', done: true }), task()]}
        onToggle={() => {}}
        now={NOW}
      />,
    );
    const open = screen.getByTestId('task-row-book');
    const done = screen.getByTestId('task-row-done');
    expect(done).toHaveAttribute('data-done', 'true');
    expect(open.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders open rows by deadline and puts the undated one last', () => {
    render(
      <WhatToDoNext
        tasks={[
          task({ id: 'someday', due: null }),
          task({ id: 'later', due: '2026-09-11' }),
          task({ id: 'now', due: '2026-08-28' }),
        ]}
        onToggle={() => {}}
        now={NOW}
      />,
    );
    const ids = screen.getAllByTestId(/^task-row-/).map((row) => row.dataset.testid);
    expect(ids).toEqual(['task-row-now', 'task-row-later', 'task-row-someday']);
  });

  it('ticks a row by pressing it, and says so to a screen reader', async () => {
    const onToggle = vi.fn();
    render(<WhatToDoNext tasks={[task()]} onToggle={onToggle} now={NOW} />);

    const row = screen.getByTestId('task-row-book');
    expect(row).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith('book');
  });

  it('says the list is empty rather than showing a card with nothing in it', () => {
    render(<WhatToDoNext tasks={[]} onToggle={() => {}} now={NOW} />);
    expect(screen.getByTestId('dossier-what-to-do')).toHaveTextContent(/Nothing on the list/);
    expect(screen.queryByTestId('what-to-do-from-me')).not.toBeInTheDocument();
  });

  it('drops Valentin’s note when he has not been given one', () => {
    render(<WhatToDoNext tasks={[task()]} onToggle={() => {}} now={NOW} />);
    expect(screen.queryByTestId('what-to-do-from-me')).not.toBeInTheDocument();

    render(<WhatToDoNext tasks={[task()]} onToggle={() => {}} note="Do the first one." now={NOW} />);
    expect(screen.getAllByTestId('what-to-do-from-me')[0]).toHaveTextContent('Do the first one.');
  });
});

describe('dueLabel', () => {
  it('is relative inside a fortnight, which is how a person plans', () => {
    expect(dueLabel('2026-08-28', NOW)).toBe('Today');
    expect(dueLabel('2026-08-29', NOW)).toBe('Tomorrow');
    expect(dueLabel('2026-09-04', NOW)).toMatch(/^By Fri 4$/);
  });

  it('brings the date back once a weekday is no longer enough to place it', () => {
    expect(dueLabel('2026-10-20', NOW)).toMatch(/^By 20 Oct$/);
  });

  it('says a slipped deadline has slipped', () => {
    expect(dueLabel('2026-08-01', NOW)).toBe('Overdue');
  });

  it('says "No date" rather than inventing one', () => {
    // "Ask her sometime" is a real to-do; forcing a deadline onto it would either
    // invent one or lose the item.
    expect(dueLabel(null, NOW)).toBe('No date');
    expect(dueLabel('not a date', NOW)).toBe('No date');
  });
});
