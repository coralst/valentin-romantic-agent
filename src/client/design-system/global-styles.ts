import { colors, radii, typography } from './tokens';

/**
 * CSS reset and base styles using design tokens.
 * Inject this as a <style> tag or use with a CSS-in-JS solution.
 *
 * NOTE: the `@import` below must stay the very first thing in this string —
 * a CSS `@import` that follows any other rule is ignored by browsers. main.tsx
 * appends this as the first <style> in <head>, so the import is legal there and
 * the webfont change stays inside the design-system boundary instead of needing
 * an edit to index.html.
 */
export const globalStyles = `@import url('https://fonts.googleapis.com/css2?family=Gloock&family=Outfit:wght@300;400;500;600&display=swap');

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    font-family: ${typography.bodyFontFamily};
    font-size: ${typography.sizes.base};
    line-height: ${typography.lineHeights.normal};
    color: ${colors.ink};
    background-color: ${colors.linen};
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: ${typography.headingFontFamily};
    /* Gloock ships a single weight; asking for bold triggers a synthetic
       smear, so headings sit at normal and rely on size for hierarchy. */
    font-weight: ${typography.weights.normal};
    line-height: ${typography.lineHeights.tight};
    color: ${colors.ink};
    letter-spacing: -0.01em;
  }

  h1 { font-size: ${typography.sizes.xxl}; }
  h2 { font-size: ${typography.sizes.xl}; }
  h3 { font-size: ${typography.sizes.lg}; }
  h4 { font-size: ${typography.sizes.md}; }

  a {
    color: ${colors.claret};
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  button {
    font-family: ${typography.bodyFontFamily};
    cursor: pointer;
    border: none;
    background: none;
  }

  input, textarea {
    font-family: ${typography.bodyFontFamily};
    font-size: ${typography.sizes.base};
  }

  ::selection {
    background-color: ${colors.petal};
    color: ${colors.claret};
  }

  ::-webkit-scrollbar {
    width: 6px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: ${colors.linenShade};
    border-radius: ${radii.pill}px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: ${colors.inkFaint};
  }

  /*
   * The integrations surface. Keyframes rather than transitions because these
   * animate elements as they mount — a panel that slides in, a sheet that rises,
   * and the dash offset that makes a connected edge read as carrying something.
   *
   * They live here rather than in the components because inline styles cannot
   * declare keyframes at all. The reduced-motion block below is the reason they
   * are all named with the same prefix: it switches every one of them off in a
   * single rule, so a new one cannot quietly escape the preference.
   */
  @keyframes integration-panel-in {
    from { opacity: 0; transform: translateX(-18px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  @keyframes integration-sheet-rise {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes integration-edge-flow {
    to { stroke-dashoffset: -32; }
  }

  /*
   * Her file's top band: two halves that become one column when the *board* is
   * narrow, not when the window is.
   *
   * A container query rather than a media query, and that is the whole reason
   * these two rules cannot be inline styles. Whether the calendar and the to-do
   * list fit side by side depends on the board's own measure, which is not a
   * function of window width. Measured in a real browser, at this shell's widths:
   *
   *   1600 window, list showing  ->  796px of board
   *   1440 window, list showing  ->  768px
   *   1300 window, list showing  ->  628px
   *   1180 window, list showing  ->  508px
   *   1180 window, list hidden   ->  734px
   *
   * Note the third and the last: a *narrower* window gives the board *more* room
   * once the conversation list gives up its 226px, so a viewport breakpoint gets
   * that pair backwards every time — stacking the wide board and splitting the
   * narrow one. e2e/tests/responsive-layout.spec.ts drives exactly those two.
   *
   * 720px is the threshold, and it is chosen from those measurements rather than
   * from taste: it is the largest number that still splits the 734px case, and 734
   * is the widest the board gets on a laptop screen. Below 720 each half is under
   * 350px, which puts a four-week calendar's day cells near 45px — about as narrow
   * as a two-digit date and its markers can be set.
   *
   * The mockup's own comment said 830. 830 is wrong here: the mockup's shell was
   * wider than the real one, so it stacked the pair at every window this app can
   * actually be opened at, which is not the approved layout.
   */
  .dossier-board { container-type: inline-size; }

  .dossier-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    /* stretch, not the board's usual start: these two are a deliberate pair, and
       a ragged step at the top of the board is what the bands replaced. */
    align-items: stretch;
  }

  @container (max-width: 720px) {
    .dossier-pair { grid-template-columns: 1fr; }
  }

  @media (prefers-reduced-motion: reduce) {
    [style*="integration-panel-in"],
    [style*="integration-sheet-rise"],
    [style*="integration-edge-flow"] {
      animation: none !important;
    }
  }
`;
