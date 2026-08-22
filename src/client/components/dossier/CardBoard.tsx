import { insets } from '../../design-system/tokens';

interface CardBoardProps {
  children?: React.ReactNode;
  /** Collapses to a single column. Driven by `AppLayout`'s `isMobile`. */
  isMobile?: boolean;
}

/**
 * The three-column board the dossier's cards sit on.
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
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 14,
  alignContent: 'start',
  alignItems: 'start',
};

/**
 * One column on mobile.
 *
 * The `span 2` / `span 3` widths below resolve against however many columns
 * exist, and `grid-column: 1 / -1` is still the whole row at one column, so the
 * wide cards need no mobile special-casing.
 */
const mobileBoardStyle: React.CSSProperties = {
  ...boardStyle,
  gridTemplateColumns: 'minmax(0, 1fr)',
  padding: `${insets.tight}px ${insets.tight}px 24px`,
  gap: 12,
};

/** `.w2` — a card two of the three columns wide (`full-profile.html:69`). */
export const spanTwoStyle: React.CSSProperties = { gridColumn: 'span 2' };

/** `.w3` — full width (`:70`). `1 / -1` so it works at any column count. */
export const spanAllStyle: React.CSSProperties = { gridColumn: '1 / -1' };

/**
 * The dossier's scrolling card grid.
 *
 * Scrolling lives here rather than on the shell so the identity header above it
 * can stay pinned.
 */
export function CardBoard({ children, isMobile = false }: CardBoardProps) {
  return (
    <div
      style={isMobile ? mobileBoardStyle : boardStyle}
      data-testid="dossier-board"
      data-columns={isMobile ? 1 : 3}
    >
      {children}
    </div>
  );
}
