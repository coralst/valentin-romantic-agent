import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatBar, type Stat } from '../StatBar';

const STATS: Stat[] = [
  { label: 'Days together', value: '2,003', tone: 'date' },
  { label: 'Next occasion', value: '18d', tone: 'date', note: 'Her birthday' },
  { label: 'Known', value: '57%', tone: 'grow', note: '12 of 21' },
  { label: 'Her people', value: '7', tone: 'kin', note: '2 gaps' },
];

describe('StatBar', () => {
  it('renders one figure per stat, with its label and note', () => {
    render(<StatBar stats={STATS} />);
    expect(screen.getAllByTestId('dossier-stat')).toHaveLength(4);
    const bar = screen.getByTestId('dossier-stat-bar');
    expect(bar).toHaveTextContent('2,003');
    expect(bar).toHaveTextContent('Days together');
    expect(bar).toHaveTextContent('Her birthday');
  });

  it('omits the note line when there is nothing to qualify', () => {
    render(<StatBar stats={[STATS[0]]} />);
    expect(screen.getByTestId('dossier-stat').childElementCount).toBe(2);
  });

  it('keeps the figures light and carries the family on a dot instead', () => {
    // The families are tuned for the light board; at 22px on plum the gold and
    // the olive would be the two hardest figures to read.
    render(<StatBar stats={STATS} />);
    const bar = screen.getByTestId('dossier-stat-bar');
    expect(bar.style.color).toBeTruthy();
    expect(bar.querySelectorAll('i[aria-hidden="true"]')).toHaveLength(4);
  });

  it('parks a trailing action at the end of the bar', () => {
    render(
      <StatBar stats={STATS}>
        <button type="button">Ask</button>
      </StatBar>,
    );
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
  });

  it('wraps rather than overflowing on mobile', () => {
    render(<StatBar stats={STATS} isMobile />);
    expect(screen.getByTestId('dossier-stat-bar').style.flexWrap).toBe('wrap');
  });
});
