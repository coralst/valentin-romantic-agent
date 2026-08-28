import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionRail, type DossierSection } from '../SectionRail';

const SECTIONS: DossierSection[] = [
  { id: 'right-now', label: 'Right now', icon: 'heart', count: null },
  { id: 'sizes', label: 'Her sizes', icon: 'ruler', count: 2 },
  { id: 'file', label: 'Everything I know', icon: 'book', count: 21 },
];

/**
 * The rail beside a stand-in board holding the headings it jumps to.
 *
 * The real board is `CardBoard`, but the rail only needs a scroll container with
 * elements carrying the section ids — which is exactly the contract worth testing.
 */
function Harness({ sections = SECTIONS }: { sections?: DossierSection[] }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  return (
    <div style={{ display: 'flex' }}>
      <SectionRail sections={sections} scrollRef={boardRef} />
      <div ref={boardRef} data-testid="board">
        {sections.map((section) => (
          <div key={section.id} id={section.id}>
            {section.label}
          </div>
        ))}
      </div>
    </div>
  );
}

describe('SectionRail', () => {
  it('is a nav, not a tablist', () => {
    render(<Harness />);
    // ARIA tabs promise exactly one visible panel at a time, which is now false:
    // every section stays mounted. Announcing these as tabs would tell a screen
    // reader user that pressing one reveals a panel, when it moves the viewport.
    expect(screen.getByRole('navigation', { name: 'Sections of her dossier' })).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
  });

  it('scrolls to a section and marks itself current without unmounting anything', async () => {
    render(<Harness />);
    const target = document.getElementById('file')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    await userEvent.click(screen.getByTestId('dossier-section-link-file'));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(screen.getByTestId('dossier-section-link-file')).toHaveAttribute(
      'aria-current',
      'true',
    );
    // Every other section is still on the page — the whole difference from tabs.
    expect(document.getElementById('right-now')).toBeInTheDocument();
    expect(document.getElementById('sizes')).toBeInTheDocument();
  });

  it('moves the highlight rather than adding a second one', async () => {
    render(<Harness />);
    document.getElementById('sizes')!.scrollIntoView = () => {};
    document.getElementById('file')!.scrollIntoView = () => {};

    await userEvent.click(screen.getByTestId('dossier-section-link-sizes'));
    await userEvent.click(screen.getByTestId('dossier-section-link-file'));

    const current = screen
      .getAllByTestId(/^dossier-section-link-/)
      .filter((entry) => entry.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('data-testid', 'dossier-section-link-file');
  });

  it('highlights the first section before anything has been scrolled', () => {
    // jsdom performs no layout, so there is no observer verdict to fall back on.
    // The honest static rendering is "you are at the top", not "nowhere".
    render(<Harness />);
    expect(screen.getByTestId('dossier-section-link-right-now')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('shows a count only for the sections that are a count of something', () => {
    render(<Harness />);
    // "Right now" is a moment, not a quantity; a 0 beside it would be a lie and a
    // "—" would be furniture.
    expect(screen.getByTestId('dossier-section-link-right-now').textContent).toBe('Right now');
    expect(screen.getByTestId('dossier-section-link-sizes').textContent).toContain('2');
  });

  it('renders only the sections it is handed', () => {
    // `DossierView` filters the empty ones out of this list and off the board with
    // the same predicate, so a rail entry can never point at a missing heading.
    render(<Harness sections={SECTIONS.filter((section) => section.id !== 'sizes')} />);
    expect(screen.queryByTestId('dossier-section-link-sizes')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^dossier-section-link-/)).toHaveLength(2);
  });
});
