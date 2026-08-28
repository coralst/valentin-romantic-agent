import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BOARD_HALF,
  BOARD_QUARTER,
  BOARD_THIRD,
  BOARD_TWO_THIRDS,
  CardBoard,
  span,
  spanAllStyle,
} from '../CardBoard';

describe('CardBoard', () => {
  it('keeps align-items: start, so a short card never stretches to a taller sibling', () => {
    // Load-bearing, and called out as such at full-profile.html:64-65. Grid's
    // default `stretch` makes every card in a row as tall as the tallest one,
    // which leaves dead space inside the short ones.
    render(
      <CardBoard>
        <div>a</div>
      </CardBoard>,
    );
    const board = screen.getByTestId('dossier-board');
    expect(board.style.alignItems).toBe('start');
    expect(board.style.alignContent).toBe('start');
  });

  it('lays out twelve equal columns that can shrink below their content', () => {
    // Twelve, not three: the command-centre board needs a card to be able to take
    // a quarter, a third, a half or two-thirds of the row, which is the density
    // variation the flat three-column board could not express.
    render(
      <CardBoard>
        <div>a</div>
      </CardBoard>,
    );
    const board = screen.getByTestId('dossier-board');
    expect(board.style.gridTemplateColumns).toBe('repeat(12, minmax(0, 1fr))');
    expect(board).toHaveAttribute('data-columns', '12');
  });

  it('collapses to one column on mobile', () => {
    render(
      <CardBoard isMobile>
        <div>a</div>
      </CardBoard>,
    );
    const board = screen.getByTestId('dossier-board');
    expect(board.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(board).toHaveAttribute('data-columns', '1');
  });

  it('scrolls itself rather than growing the window', () => {
    render(
      <CardBoard>
        <div>a</div>
      </CardBoard>,
    );
    const board = screen.getByTestId('dossier-board');
    expect(board.style.overflowY).toBe('auto');
    // React emits a bare `0` for zero-valued lengths, which jsdom keeps verbatim.
    expect(board.style.minHeight).toMatch(/^0(px)?$/);
  });

  it('spans by column count, and the named widths divide twelve exactly', () => {
    expect(span(BOARD_TWO_THIRDS).gridColumn).toBe('span 8');
    expect(span(BOARD_HALF).gridColumn).toBe('span 6');
    expect(span(BOARD_THIRD).gridColumn).toBe('span 4');
    expect(span(BOARD_QUARTER).gridColumn).toBe('span 3');
    expect(spanAllStyle.gridColumn).toBe('1 / -1');

    // If one of these stopped dividing 12, that card would leave a ragged gutter
    // at the end of its row rather than failing visibly.
    for (const width of [BOARD_QUARTER, BOARD_THIRD, BOARD_HALF, BOARD_TWO_THIRDS]) {
      expect(12 % width === 0 || 12 % (12 - width) === 0).toBe(true);
    }
  });
});
