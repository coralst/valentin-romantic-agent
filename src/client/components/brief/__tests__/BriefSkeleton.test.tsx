import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BriefSkeleton } from '../BriefSkeleton';
import { getFieldById } from '../../../utils/profile-field-registry';

/**
 * The zero state's content.
 *
 * These tests care about two things and nothing else: that the rows are real
 * registry fields (so a relabelled or removed field cannot leave a lie on
 * screen), and that a row is never mistaken for knowledge.
 */
describe('BriefSkeleton', () => {
  it('renders a labelled row per curated field', () => {
    render(<BriefSkeleton />);

    const rows = screen.getAllByTestId('brief-skeleton-row');
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('asks for no size, measurement or love language', () => {
    render(<BriefSkeleton />);

    const ids = screen
      .getAllByTestId('brief-skeleton-row')
      .map((row) => row.getAttribute('data-field-id'));

    for (const id of ['clothing_size', 'shoe_size', 'ring_size', 'shoulder_width', 'love_language']) {
      expect(ids).not.toContain(id);
    }
  });

  it('leads with her name, then the facts every plan depends on', () => {
    render(<BriefSkeleton />);

    const ids = screen
      .getAllByTestId('brief-skeleton-row')
      .map((row) => row.getAttribute('data-field-id'));

    // First row, not merely present: the zero state is read top-down and the name
    // is the one thing Valentin asks for before anything else.
    expect(ids[0]).toBe('partner_name');
    for (const id of ['birthday', 'anniversary', 'favorite_cuisine']) {
      expect(ids).toContain(id);
    }
  });

  it('names every row with the registry label, not a second copy of it', () => {
    render(<BriefSkeleton />);

    for (const row of screen.getAllByTestId('brief-skeleton-row')) {
      const field = getFieldById(row.getAttribute('data-field-id') ?? '');
      expect(field, `row ${row.getAttribute('data-field-id')} is not a registry field`).toBeDefined();
      expect(row.textContent).toContain(field!.label);
    }
  });

  it('marks every row as not known, so nothing here can be counted', () => {
    render(<BriefSkeleton />);

    for (const row of screen.getAllByTestId('brief-skeleton-row')) {
      expect(row.getAttribute('data-known')).toBe('false');
    }
  });

  it('renders no value text at all — a label and a dash, not a guess', () => {
    render(<BriefSkeleton />);

    // "Not yet known" is the dossier's phrasing for a single row. Repeated down
    // ten rows in a 306px column it reads as ten failures, so the rail uses a
    // dash and the absence of one is a regression worth catching.
    expect(screen.queryByText('Not yet known')).not.toBeInTheDocument();
    for (const row of screen.getAllByTestId('brief-skeleton-row')) {
      expect(row.textContent).toMatch(/–$/);
    }
  });

  it('is a curated set rather than the whole registry', () => {
    render(<BriefSkeleton />);

    // The point of curating: a wall of dashes pushes the pinned nudge and the
    // tally off the fold, which is the bug pinning them was meant to fix.
    expect(screen.getAllByTestId('brief-skeleton-row').length).toBeLessThanOrEqual(12);
  });
});
