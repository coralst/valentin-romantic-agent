import { typography } from '../../design-system/tokens';

/**
 * The dossier's icon set.
 *
 * Every card on this board used to be headed by a typographic dingbat —
 * `&#9901;`, `&#10022;`, `&#9737;` — pulled from whatever glyph the system font
 * happened to have. Three problems, all of which this fixes: the glyphs render at
 * wildly different optical weights (some are solid, some hairline, one is a
 * different colour on macOS because it is an emoji presentation by default), they
 * carry no meaning a first-time viewer can decode, and they cannot be tinted per
 * tone without also changing the text colour.
 *
 * A single 24-box stroke set at one weight fixes all three. `currentColor` means a
 * section head sets the tint once, on itself, and the icon follows.
 *
 * PATHS ARE DRAWN ON A 24×24 BOX with ~2px of optical padding, so an icon set to
 * `size` renders about `size - 4` of actual ink. That is why the sizes below look
 * larger than the glyphs they replace but sit on the same baseline.
 */

export type DossierIconName =
  | 'heart'
  | 'calendar'
  | 'cake'
  | 'gift'
  | 'people'
  | 'caution'
  | 'sparkle'
  | 'check'
  | 'ask'
  | 'quote'
  | 'book'
  | 'ruler'
  | 'palette'
  | 'clock'
  | 'arrow'
  | 'chat'
  | 'target';

/**
 * One entry per name. Strings rather than JSX so the whole set costs one object
 * and a component can be picked by name from data — which is what the section
 * rail does, driven by its section list.
 */
const PATHS: Record<DossierIconName, string> = {
  heart: 'M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6c0 5.8-8.5 11.3-8.5 11.3Z',
  calendar: 'M3.5 10h17M8.5 3v4M15.5 3v4M6 5h12a2.5 2.5 0 0 1 2.5 2.5V18A2.5 2.5 0 0 1 18 20.5H6A2.5 2.5 0 0 1 3.5 18V7.5A2.5 2.5 0 0 1 6 5Z',
  cake: 'M4 20.5h16M4.5 20.5v-5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v5M4.5 16.5c1.7 1.4 3.2 1.4 4.9 0 1.7 1.4 3.2 1.4 4.9 0 1.5 1.3 2.9 1.4 4.7.3M12 10.5V8',
  gift: 'M3.5 11h17v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8ZM2.5 8.5h19v2.5h-19zM12 8.5v12.5M12 8.5S10.5 4 8 4a2.2 2.2 0 0 0 0 4.5M12 8.5S13.5 4 16 4a2.2 2.2 0 0 1 0 4.5',
  people: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.9c2.1.7 3.5 2.6 3.5 5.6',
  caution: 'M12 3.8 21.2 19a1.4 1.4 0 0 1-1.2 2.1H4a1.4 1.4 0 0 1-1.2-2.1L12 3.8ZM12 9.5v5M12 17.8h.01',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
  check: 'M12 20.7a8.7 8.7 0 1 0 0-17.4 8.7 8.7 0 0 0 0 17.4ZM8.4 12.3l2.6 2.6 4.8-5.4',
  ask: 'M12 20.7a8.7 8.7 0 1 0 0-17.4 8.7 8.7 0 0 0 0 17.4ZM9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6M12 17.3h.01',
  quote: 'M9.5 6.5C6.6 7.8 5 10.2 5 13.5c0 2.4 1.3 4 3.2 4 1.7 0 2.9-1.2 2.9-2.8 0-1.6-1.1-2.7-2.6-2.7h-.4M19 6.5c-2.9 1.3-4.5 3.7-4.5 7 0 2.4 1.3 4 3.2 4 1.7 0 2.9-1.2 2.9-2.8 0-1.6-1.1-2.7-2.6-2.7h-.4',
  book: 'M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a2 2 0 0 0-2-2H4V4.5ZM20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a2 2 0 0 1 2-2h6V4.5Z',
  ruler: 'M2.9 13.4 13.4 2.9a1.8 1.8 0 0 1 2.5 0l5.2 5.2a1.8 1.8 0 0 1 0 2.5L10.6 21.1a1.8 1.8 0 0 1-2.5 0L2.9 15.9a1.8 1.8 0 0 1 0-2.5ZM9.4 7.2l1.8 1.8M12.2 10l1.8 1.8M15 12.8l1.8 1.8',
  palette: 'M12 3.3c-4.8 0-8.7 3.7-8.7 8.4S7 20 11.4 20c1.5 0 2.2-1 2.2-2 0-1.6 1-2.2 2.6-2.2h2.1c1.7 0 3.1-1.3 3.1-3.2 0-5-3.9-9.3-9.4-9.3ZM8 9.5h.01M12 7.5h.01M15.8 9.5h.01',
  clock: 'M12 20.7a8.7 8.7 0 1 0 0-17.4 8.7 8.7 0 0 0 0 17.4ZM12 7.4V12l3.4 2',
  arrow: 'M4.5 12h15M13.5 6l6 6-6 6',
  chat: 'M20.5 12.4c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.2-2.9-.5L4 21l1.2-3.6A7 7 0 0 1 3.5 12.4C3.5 8.3 7.3 5 12 5s8.5 3.3 8.5 7.4Z',
  target: 'M12 20.7a8.7 8.7 0 1 0 0-17.4 8.7 8.7 0 0 0 0 17.4ZM12 16.6a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2ZM12 12.9a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z',
};

interface DossierIconProps {
  name: DossierIconName;
  /** Rendered box, in px. The stroke stays 1.7 at every size on purpose. */
  size?: number;
  /** Inherited from the nearest coloured ancestor unless given. */
  color?: string;
}

/**
 * `aria-hidden` unconditionally, with no `title`.
 *
 * Every icon in this board sits beside its own text label — the section rail's
 * entries, the card heads, the chips. Announcing them would read every heading
 * twice, so they are decoration in the accessibility tree even though they are
 * the primary visual cue.
 */
export function DossierIcon({ name, size = 20, color }: DossierIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', display: 'block' }}
      data-icon={name}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/**
 * The dossier's own type scale.
 *
 * The app's `typography.px` scale tops out at 13px for body text and drops to 9px
 * for eyebrows, which is right for a 306px rail where the brief has to fit a whole
 * profile into a column. The dossier is the opposite surface: it is the full width
 * of the window and it is the thing you read when you have stopped to actually
 * read. At the rail's scale it came out as a wall of 11px labels — legible on a
 * laptop 40cm away and not legible on a projector, in a screenshot, or to anyone
 * over about forty.
 *
 * Scoped here rather than pushed into `tokens.ts` deliberately: raising the global
 * scale would resize the brief rail, the chat, the sidebar and every one of the
 * 109 test files' snapshots along with it. This surface asked to be redesigned;
 * the rest of the app did not.
 *
 * THE FLOOR IS 15. Nothing in this folder should read from `typography.px` for a
 * size below `control` (15) again.
 */
export const dossierType = {
  /** Section headings — "Her people", "Everything I know". */
  section: 24,
  /** Card titles inside a section. */
  card: 19,
  /** The big numerals: countdowns, days together, percentages. */
  figure: 34,
  /** A hero numeral, used once — the next occasion's countdown. */
  figureHero: 52,
  /** Body copy. */
  body: 17,
  /** Secondary body: notes, reasons, captions. Never below this. */
  small: 15,
  /** Uppercase eyebrows and group labels. 15 with letterspacing, not 9. */
  eyebrow: 15,
} as const;

export const dossierFonts = {
  heading: typography.headingFontFamily,
  body: typography.bodyFontFamily,
} as const;
