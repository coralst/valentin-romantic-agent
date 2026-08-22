import { layout } from '../design-system/tokens';

/**
 * The chat column's measure: capped at `layout.chatColumnMaxWidth` and centred in
 * whatever width the column happens to have.
 *
 * THE FIX FOR "THE CHAT DOESN'T SCALE CONSISTENTLY".
 *
 * The cap is not the problem — 620px is about 80 characters at
 * `typography.px.chat`, and letting a line run the full width of a 1764px column
 * would be worse, not better. The problem was that the cap was applied
 * *left-aligned*, independently, by each of the pieces stacked in the column. So
 * the transcript, the composer and the header all hugged the column's left edge
 * and the leftover width piled up on the right: 26px of it on a 1000px window,
 * 1118px of it on a 2400px one. Same components, same sizes, and yet the shell
 * looked like a different design at each width — which is what "inconsistent
 * scaling" was describing.
 *
 * Centring makes the leftover width symmetric, so it reads as a gutter rather
 * than as a layout that failed to fill. Every piece of the column has to use this
 * same box or they fall out of vertical alignment with each other — the header's
 * name would sit 200px left of the first bubble it labels.
 *
 * `width: 100%` alongside the cap is load-bearing: `marginInline: auto` centres a
 * block by distributing its *unused* width, and a plain `max-width` box with no
 * width shrink-wraps its content, which would centre each bubble row rather than
 * the column they live in.
 */
export const chatMeasureStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: layout.chatColumnMaxWidth,
  marginInline: 'auto',
};
