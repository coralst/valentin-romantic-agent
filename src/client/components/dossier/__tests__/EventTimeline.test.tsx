import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Outing } from '../../../../shared/interfaces/outing';
import { buildEventTimeline } from '../../../utils/event-timeline';
import type { Occasion } from '../../../utils/occasion-derivation';
import { EventTimeline } from '../EventTimeline';

const NOW = new Date(2026, 8, 5, 12, 0, 0); // Saturday 5 September 2026

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

const anniversary: Occasion = {
  fieldId: 'anniversary',
  label: 'Anniversary',
  date: new Date(2023, 8, 10),
  recurrence: 'annual',
};

/** Render with the derivation the dossier uses, so the two cannot drift apart. */
function renderTimeline({
  occasions = [],
  outings = [],
  onRate = () => {},
}: {
  occasions?: Occasion[];
  outings?: Outing[];
  onRate?: (id: string, patch: { rating?: number | null }) => void;
} = {}) {
  const timeline = buildEventTimeline({ occasions, outings, now: NOW });
  return render(<EventTimeline timeline={timeline} onRate={onRate} />);
}

describe('EventTimeline', () => {
  it('invites the first date rather than drawing an empty spine', () => {
    renderTimeline();

    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-today')).not.toBeInTheDocument();
  });

  it('marks today between the halves', () => {
    renderTimeline({ occasions: [anniversary], outings: [outing()] });

    expect(screen.getByTestId('timeline-today')).toBeInTheDocument();
  });

  it('draws an upcoming occasion above the line and a past evening below it', () => {
    renderTimeline({ occasions: [anniversary], outings: [outing({ id: 'past-one' })] });

    const rows = screen.getAllByTestId(/^timeline-row-/);
    expect(rows.map((row) => row.dataset.side)).toEqual(['upcoming', 'past']);
    expect(rows[0].dataset.kind).toBe('occasion');
    expect(rows[1].dataset.kind).toBe('outing');
  });

  it('says when a row is, in the words someone would use', () => {
    renderTimeline({ occasions: [anniversary] });

    expect(screen.getByText('in 5 days')).toBeInTheDocument();
    expect(screen.getByText('Thursday 10 September')).toBeInTheDocument();
  });

  it('shows the act-by deadline on an occasion', () => {
    renderTimeline({ occasions: [anniversary] });

    expect(screen.getByTestId('timeline-act-by-occasion:anniversary').textContent).toContain(
      'Book by',
    );
  });

  it('asks how it was on a past evening nobody has answered for', () => {
    renderTimeline({ outings: [outing({ id: 'unrated' })] });

    expect(screen.getByTestId('outing-survey-unrated')).toBeInTheDocument();
    expect(screen.getByText('How was it?')).toBeInTheDocument();
  });

  it('never asks about a table booked for a night that has not happened', () => {
    renderTimeline({ outings: [outing({ id: 'future', occursOn: '2026-09-19' })] });

    expect(screen.queryByTestId('outing-survey-future')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-row-outing:future').dataset.kind).toBe('booking');
  });

  it('records the rating against the row it was asked on', async () => {
    const onRate = vi.fn();
    renderTimeline({ outings: [outing({ id: 'unrated' })], onRate });

    await userEvent.click(screen.getByLabelText('4 out of 5'));

    expect(onRate).toHaveBeenCalledWith('unrated', { rating: 4 });
  });

  it('shows her verdict instead of the survey once the row is rated', () => {
    renderTimeline({ outings: [outing({ id: 'rated', rating: 4, verdict: 'again' })] });

    expect(screen.queryByTestId('outing-survey-rated')).not.toBeInTheDocument();
    expect(screen.getByText('4/5 — again')).toBeInTheDocument();
  });

  it('carries the note through, since that is the part worth remembering', () => {
    renderTimeline({ outings: [outing({ note: 'Ask for the corner table.' })] });

    expect(screen.getByText('Ask for the corner table.')).toBeInTheDocument();
  });

  it('counts what is waiting on an answer, not how many places there are', () => {
    renderTimeline({
      outings: [
        outing({ id: 'a' }),
        outing({ id: 'b', rating: 5, verdict: 'again' }),
      ],
    });

    expect(screen.getByText('1 to rate')).toBeInTheDocument();
  });

  it('counts both halves once nothing is waiting', () => {
    renderTimeline({
      occasions: [anniversary],
      outings: [outing({ id: 'b', rating: 5, verdict: 'again' })],
    });

    expect(screen.getByText('1 ahead · 1 behind')).toBeInTheDocument();
  });

  it('says the past half is empty rather than leaving a bare line', () => {
    renderTimeline({ occasions: [anniversary] });

    expect(screen.getByTestId('timeline-no-past')).toBeInTheDocument();
  });
});
