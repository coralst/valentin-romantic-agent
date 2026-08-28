import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHead } from '../SectionHead';

describe('SectionHead', () => {
  it('carries the id the rail jumps to', () => {
    render(<SectionHead id="sizes" title="Her sizes" icon="ruler" />);
    const head = screen.getByTestId('dossier-section-head');
    // The rail resolves its target with `querySelector('#id')`, so this is the
    // handshake between the two components.
    expect(head).toHaveAttribute('id', 'sizes');
    expect(head).toHaveAttribute('data-section-id', 'sizes');
  });

  it('reserves the space a scroll-to would otherwise eat', () => {
    render(<SectionHead id="sizes" title="Her sizes" icon="ruler" />);
    // `scrollIntoView({ block: 'start' })` aligns the box edge with the container's
    // edge, parking the heading flush against the top of the board. The margin is
    // part of the element's own scroll geometry, so the rail need not know the
    // board's padding.
    expect(screen.getByTestId('dossier-section-head').style.scrollMarginTop).toBe('18px');
  });

  it('is a heading at the board level, so it wins against the card titles', () => {
    render(<SectionHead id="file" title="Everything I know" icon="book" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Everything I know' });
    // The section titles are the board's only landmarks now that the tab bar is
    // gone, so 24px against the cards' eyebrow rather than tying with it.
    expect(heading.style.fontSize).toBe('24px');
  });

  it('spans the whole row so the cards beneath read as belonging to it', () => {
    render(<SectionHead id="people" title="Her people" icon="people" />);
    expect(screen.getByTestId('dossier-section-head').style.gridColumn).toBe('1 / -1');
  });

  it('omits the count pill entirely for a section that counts nothing', () => {
    const { rerender } = render(
      <SectionHead id="right-now" title="Right now" icon="heart" count={null} />,
    );
    expect(screen.getByTestId('dossier-section-head').textContent).toBe('Right now');

    // Zero is a real answer and prints as one; `null` means "not a quantity".
    rerender(<SectionHead id="right-now" title="Right now" icon="heart" count={0} />);
    expect(screen.getByTestId('dossier-section-head').textContent).toContain('0');
  });

  it('sets the note at the body size rather than as fine print', () => {
    render(
      <SectionHead id="sizes" title="Her sizes" icon="ruler" note="The three you want in a shop." />,
    );
    const note = screen.getByText('The three you want in a shop.');
    // This line used to be 10.5px `caption` and was the most-skipped text on the
    // board — the floor is 15.
    expect(note.style.fontSize).toBe('15px');
  });
});
