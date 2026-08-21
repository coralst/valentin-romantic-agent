import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardBoard, spanAllStyle, spanTwoStyle } from '../CardBoard';

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

  it('lays out three equal columns that can shrink below their content', () => {
    render(
      <CardBoard>
        <div>a</div>
      </CardBoard>,
    );
    const board = screen.getByTestId('dossier-board');
    expect(board.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(board).toHaveAttribute('data-columns', '3');
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

  it('exports the mockup’s two span helpers', () => {
    expect(spanTwoStyle.gridColumn).toBe('span 2');
    expect(spanAllStyle.gridColumn).toBe('1 / -1');
  });
});
