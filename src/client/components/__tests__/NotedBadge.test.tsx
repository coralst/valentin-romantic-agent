import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotedBadge } from '../NotedBadge';

describe('NotedBadge', () => {
  it('names what was recorded', () => {
    render(<NotedBadge values={['peonies']} />);

    expect(screen.getByTestId('noted-badge')).toBeInTheDocument();
    expect(screen.getByTestId('noted-badge-values')).toHaveTextContent('peonies');
  });

  it('puts several facts from one message on one line', () => {
    render(<NotedBadge values={['peonies', 'ramen']} />);

    expect(screen.getByTestId('noted-badge-values')).toHaveTextContent('peonies · ramen');
  });

  it('renders nothing when there is nothing on the record', () => {
    const { container } = render(<NotedBadge values={[]} />);

    expect(container.innerHTML).toBe('');
  });

  it('mirrors to the right for a user turn', () => {
    render(<NotedBadge values={['peonies']} align="end" />);

    expect(screen.getByTestId('noted-badge')).toHaveStyle({ justifyContent: 'flex-end' });
  });

  it('says nothing to a screen reader', () => {
    const { container } = render(<NotedBadge values={['peonies']} />);

    /*
     * The whole point of the transient/permanent split: the four-second line
     * announces the fact once, this records it forever. A live region here would
     * re-announce every fact in the dossier on every reload, when nothing has
     * happened.
     */
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
