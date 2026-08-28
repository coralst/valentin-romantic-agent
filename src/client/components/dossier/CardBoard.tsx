import { insets } from '../../design-system/tokens';

interface CardBoardProps {
  children?: React.ReactNode;
  /** Collapses to a single column. Driven by `AppLayout`'s `isMobile`. */
  isMobile?: boolean;
  /**
   * The scrolling element itself, handed back to the caller.
   *
   * `SectionRail`'s scroll-spy needs this exact node as its `IntersectionObserver`
   * root: the board scrolls, not the window, so an observer with the default
   * viewport root would report every section as visible forever and the rail's
   * highlight would never move. Exposed as a ref rather than by having the rail
   * search the DOM for `[data-testid="dossier-board"]`, which would make a test id
   * load-bearing for behaviour.
   */
  scrollRef?: React.Ref<HTMLDivElement>;
}

/**
 * The twelve-column board the dossier's cards sit on.
 *
 * Twelve rather than the original three, because the command-centre redesign
 * needs *density variation*: three equal columns can only say "everything here
 * is equally important", which is the flatness the redesign exists to fix. On
 * twelve, a card can be a third (4), a half (6), two-thirds (8), a quarter (3)
 * or the whole row, so the board can put one hero figure next to three small
 * readouts and mean it. Twelve is the smallest count divisible by 2, 3 and 4,
 * so every one of those widths lands on a whole column.
 *
 * `alignItems: 'start'` IS LOAD-BEARING — this is the point the mockup stops to
 * comment on (`full-profile.html:64-65`). A grid item's default `align-self` is
 * `stretch`, so every card in a row is sized to the *tallest* card in that row:
 * "Good to know" with four chips would grow to match "Worth asking next" with a
 * ranked list of three, leaving a tall sand rectangle two-thirds empty. With
 * `start` each card keeps its own height and the board reads as a pinboard
 * rather than as a table.
 *
 * `alignContent: 'start'` is the row-track counterpart: without it, short boards
 * distribute their rows down the full scroll height instead of stacking from the
 * top.
 */
const boardStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: 'auto',
  padding: `${insets.snug}px ${insets.roomy}px 30px`,
  display: 'grid',
  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
  gap: 14,
  alignContent: 'start',
  alignItems: 'start',
};

/**
 * One column on mobile.
 *
 * `span(n)` would overflow a single-column track, so `span()` clamps to the
 * whole row on mobile via `spanAllStyle` at the call site — see `DossierView`,
 * which passes `undefined` for every width when `isMobile`. `grid-column: 1 / -1`
 * is still the whole row at one column, so the full-width cards need no
 * special-casing.
 */
const mobileBoardStyle: React.CSSProperties = {
  ...boardStyle,
  gridTemplateColumns: 'minmax(0, 1fr)',
  padding: `${insets.tight}px ${insets.tight}px 24px`,
  gap: 12,
};

/**
 * A card `columns` of the board's twelve wide.
 *
 * A function rather than a `spanTwoStyle`-per-width set: seven named constants
 * for 3/4/5/6/7/8/9 is worse than one call that reads as its own measurement,
 * and the old `spanTwoStyle` name would now lie (two of twelve is a sliver, not
 * the two-thirds it meant on a three-column board).
 */
export function span(columns: number): React.CSSProperties {
  return { gridColumn: `span ${columns}` };
}

/** A third of the board — the board's default card width. */
export const BOARD_THIRD = 4;

/** Half. */
export const BOARD_HALF = 6;

/** Two thirds — what `spanTwoStyle` used to mean. */
export const BOARD_TWO_THIRDS = 8;

/** A quarter, for the small numeric readouts that sit in a row of four. */
export const BOARD_QUARTER = 3;

/** `.w3` — full width (`full-profile.html:70`). `1 / -1` at any column count. */
export const spanAllStyle: React.CSSProperties = { gridColumn: '1 / -1' };

/**
 * The dossier's scrolling card grid.
 *
 * Scrolling lives here rather than on the shell so the identity header above it
 * can stay pinned.
 */
export function CardBoard({ children, isMobile = false, scrollRef }: CardBoardProps) {
  return (
    <div
      ref={scrollRef}
      style={isMobile ? mobileBoardStyle : boardStyle}
      data-testid="dossier-board"
      data-columns={isMobile ? 1 : 12}
    >
      {children}
    </div>
  );
}
