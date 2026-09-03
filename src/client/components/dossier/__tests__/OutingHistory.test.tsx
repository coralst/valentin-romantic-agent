import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Outing } from '../../../../shared/interfaces/outing';
import { hasHappened, OutingHistory } from '../OutingHistory';

const NOW = new Date(2026, 7, 28, 9, 0, 0);

function outing(overrides: Partial<Outing> = {}): Outing {
  return {
    id: 'claro',
    venueSlug: 'claro-tlv',
    venueName: 'Claro',
    city: 'Tel Aviv',
    occursOn: '2026-08-14',
    confirmedAt: '2026-08-01T18:00:00.000Z',
    rating: null,
    verdict: null,
    note: null,
    ratedAt: null,
    ...overrides,
  };
}

describe('OutingHistory', () => {
  it('reads newest first, the order "have we been anywhere lately?" is asked in', () => {
    render(
      <OutingHistory
        outings={[
          outing({ id: 'older', confirmedAt: '2026-05-01T18:00:00.000Z', occursOn: '2026-05-04' }),
          outing({ id: 'newer', confirmedAt: '2026-08-20T18:00:00.000Z', occursOn: '2026-08-22' }),
        ]}
        onRate={() => {}}
        now={NOW}
      />,
    );

    const ids = screen.getAllByTestId(/^outing-row-/).map((row) => row.dataset.testid);
    expect(ids).toEqual(['outing-row-newer', 'outing-row-older']);
  });

  it('says he has been nowhere rather than showing an empty card', () => {
    render(<OutingHistory outings={[]} onRate={() => {}} now={NOW} />);
    expect(screen.getByTestId('dossier-outing-history')).toHaveTextContent(/Nowhere yet/);
    expect(screen.queryByTestId(/^outing-row-/)).not.toBeInTheDocument();
  });

  it('shows the answer he gave and stops asking for it', () => {
    render(
      <OutingHistory
        outings={[outing({ rating: 5, verdict: 'again', ratedAt: '2026-08-15T20:00:00.000Z' })]}
        onRate={() => {}}
        now={NOW}
      />,
    );

    expect(screen.getByTestId('outing-row-claro')).toHaveTextContent('5/5 — again');
    // A survey still on screen next to its own answer invites a second, contradictory one.
    expect(screen.queryByTestId('outing-survey-claro')).not.toBeInTheDocument();
    expect(screen.getByTestId('outing-row-claro')).toHaveAttribute('data-rated', 'true');
  });

  it('asks about an evening that has happened and has no verdict yet', () => {
    render(<OutingHistory outings={[outing()]} onRate={() => {}} now={NOW} />);
    expect(screen.getByTestId('outing-survey-claro')).toBeInTheDocument();
    expect(screen.getByTestId('dossier-outing-history')).toHaveTextContent('1 to rate');
  });

  it('does not ask how a table booked for next week went', () => {
    // Stars against a future booking would collect an opinion about the booking,
    // not about the evening — and would mark the row rated before it happened.
    render(
      <OutingHistory
        outings={[outing({ id: 'friday', occursOn: '2026-09-04' })]}
        onRate={() => {}}
        now={NOW}
      />,
    );

    expect(screen.getByTestId('outing-row-friday')).toBeInTheDocument();
    expect(screen.queryByTestId('outing-survey-friday')).not.toBeInTheDocument();
  });

  it('records the number of hearts he pressed', async () => {
    const onRate = vi.fn();
    render(<OutingHistory outings={[outing()]} onRate={onRate} now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: '4 out of 5' }));
    expect(onRate).toHaveBeenCalledWith('claro', { rating: 4 });
  });

  it('records the verdict on its own, because "never again" is the part that acts', async () => {
    const onRate = vi.fn();
    render(<OutingHistory outings={[outing()]} onRate={onRate} now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: 'never again' }));
    expect(onRate).toHaveBeenCalledWith('claro', { verdict: 'never again' });
  });
});

describe('hasHappened', () => {
  it('treats a row with no date as past, since only a real booking made it', () => {
    expect(hasHappened(outing({ occursOn: null }), NOW)).toBe(true);
  });

  it('counts tonight as rateable rather than hiding the survey until tomorrow', () => {
    // Compared as day strings on purpose: midnight-UTC instants put an Israeli
    // evening a day out for the first hours of every morning.
    expect(hasHappened(outing({ occursOn: '2026-08-28' }), NOW)).toBe(true);
  });

  it('says a future evening has not happened', () => {
    expect(hasHappened(outing({ occursOn: '2026-08-29' }), NOW)).toBe(false);
  });
});
