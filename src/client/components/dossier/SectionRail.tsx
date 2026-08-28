import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, radii, typography } from '../../design-system/tokens';
import { DossierIcon, dossierType, type DossierIconName } from './dossier-icons';

/**
 * The dossier's section rail — what replaced `DossierTabs`.
 *
 * THE DIFFERENCE FROM TABS IS THE WHOLE POINT, so it is worth being explicit.
 * `DossierTabs` filtered: five buttons, one `activeTab`, and `shows(...)` gating
 * every card. Four fifths of the board was unreachable at any moment. That cost:
 *
 *   - Her sizes and her next anniversary could not be seen together, which is the
 *     single most common pair of things anyone opens this panel for.
 *   - ⌘F found nothing on four tabs out of five. Neither did print, nor
 *     screenshot, nor "scroll up and check".
 *   - The tab bar showed which tab you had *pressed* but never where you were, so
 *     with a long board you lost your place on every scroll.
 *
 * This rail jumps instead of filtering. Every section stays mounted and in the
 * flow; pressing an entry scrolls to it, and an `IntersectionObserver` on the
 * scroll container drives the highlight back the other way, so the rail is also a
 * you-are-here map. Nothing is hidden, and nothing needs a second click.
 *
 * `<nav>` with plain buttons rather than `role="tablist"`: ARIA tabs promise that
 * exactly one panel is visible at a time, which is now false. Announcing it as
 * tabs would tell a screen reader user that pressing an entry reveals a panel,
 * when it moves the viewport instead.
 */

export interface DossierSection {
  id: string;
  label: string;
  icon: DossierIconName;
  /** Shown right-aligned. `null` for sections that are not a count of anything. */
  count?: number | null;
}

interface SectionRailProps {
  sections: readonly DossierSection[];
  /** The element the sections scroll inside — the observer's root. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Stacks horizontally and drops the labels' width cap. */
  isMobile?: boolean;
}

/*
 * Wide enough for the longest label at 17px, and no wider.
 *
 * 214 was the first guess and it ellipsised three of the seven entries — "Worth
 * aski…", "Everything I…", "Also mentio…" — which is the one thing a you-are-here
 * map may not do, since a truncated label is exactly as unhelpful as the tab bar
 * that reported which button you had pressed. The labels were shortened at the
 * same time (see `DossierView`'s `sections`), so this is the belt to that braces:
 * 238 fits "Also mentioned" plus its count with room to spare, and still leaves
 * the board more than a thousand pixels at this window width.
 */
const RAIL_WIDTH = 238;

const railStyle: React.CSSProperties = {
  flex: 'none',
  width: RAIL_WIDTH,
  /*
   * Sticky rather than a second scroll container.
   *
   * The rail is short and the board is long, so a rail with its own overflow
   * would be a 700px column with 400px of content and a scrollbar that never
   * moves. `alignSelf: start` plus `top: 0` inside the flex row pins it against
   * the board's own scroll, which is what a map should do.
   */
  position: 'sticky',
  top: 0,
  alignSelf: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '18px 12px 18px 20px',
  minWidth: 0,
};

/** A row on mobile: no width to give a column, and thumbs scroll sideways. */
const mobileRailStyle: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'row',
  gap: 6,
  padding: '10px 14px',
  overflowX: 'auto',
  // The rail must not be the thing that grows the board's own scroll width.
  minWidth: 0,
  scrollbarWidth: 'none',
};

const eyebrowStyle: React.CSSProperties = {
  padding: '0 10px 8px',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

function entryStyle(isActive: boolean, isMobile: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    // `flex: none` on the mobile strip IS LOAD-BEARING. In a row of seven, flex's
    // default `shrink: 1` squeezed every button until the labels — which are
    // `overflow: hidden` — collapsed to nothing, leaving a strip of icons and bare
    // numbers. The strip scrolls sideways instead; that is what `overflowX` is for.
    flex: isMobile ? 'none' : undefined,
    padding: isMobile ? '11px 15px' : '12px 14px',
    borderRadius: radii.kv,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    minWidth: 0,
    fontFamily: typography.bodyFontFamily,
    fontSize: dossierType.body,
    fontWeight: isActive ? typography.weights.semibold : typography.weights.medium,
    // The active entry is a raised card on porcelain, not a claret fill: this rail
    // sits 76px from the app's claret icon rail, and two claret columns side by
    // side read as one wide sidebar with a gap cut out of it.
    background: isActive ? colors.porcelain : 'transparent',
    color: isActive ? colors.claret : colors.inkMuted,
    boxShadow: isActive
      ? '0 1px 2px rgba(42, 34, 38, 0.05), 0 6px 18px rgba(42, 34, 38, 0.07)'
      : 'none',
  };
}

const labelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** On the strip the label sizes itself; there is no column to fill and none to cap. */
const mobileLabelStyle: React.CSSProperties = { flex: 'none' };

function countStyle(isActive: boolean): React.CSSProperties {
  return {
    flex: 'none',
    fontFamily: typography.bodyFontFamily,
    fontSize: dossierType.small,
    fontWeight: typography.weights.semibold,
    fontVariantNumeric: 'tabular-nums',
    color: isActive ? colors.claretLight : colors.inkFaint,
  };
}

/**
 * Which section is in view, from the scroll container rather than from clicks.
 *
 * `rootMargin: '0px 0px -62% 0px'` shrinks the observer's viewport to the top
 * ~38% of the board, so "current" means "the section whose heading you are
 * reading" rather than "the section that happens to be tallest on screen". With a
 * full-height root, a 900px `Everything I know` stays intersecting while you read
 * three shorter sections below it and the highlight sticks on the wrong entry.
 *
 * On tie — two headings inside the band — the last one wins, which is the one you
 * scrolled *to*.
 */
function useSectionInView(
  sectionIds: readonly string[],
  scrollRef: React.RefObject<HTMLElement | null>,
): [string | null, (id: string) => void] {
  const [current, setCurrent] = useState<string | null>(sectionIds[0] ?? null);

  /*
   * Set on a jump and cleared on the next real scroll.
   *
   * A smooth scroll fires dozens of intersection callbacks on the way past every
   * section between here and the target, so without this the highlight flickers
   * through four entries and lands wherever the animation happened to end. The
   * lock means a press highlights its own target immediately and the observer is
   * ignored until the user scrolls again themselves.
   */
  const lockedTo = useRef<string | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    // jsdom performs no layout and does not implement IntersectionObserver by
    // default, so tests get the first section highlighted and working buttons —
    // which is the honest static rendering, not a crash.
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (lockedTo.current !== null) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.id);
        if (visible.length === 0) return;
        // Document order, so "last one in the band" is deterministic rather than
        // dependent on callback ordering.
        const last = sectionIds.filter((id) => visible.includes(id)).pop();
        if (last) setCurrent(last);
      },
      { root, rootMargin: '0px 0px -62% 0px', threshold: 0 },
    );

    for (const id of sectionIds) {
      const element = root.querySelector(`#${CSS.escape(id)}`);
      if (element) observer.observe(element);
    }

    const release = () => {
      lockedTo.current = null;
    };
    // `wheel`/`touchstart` rather than `scroll`: the smooth scroll a jump starts
    // fires `scroll` itself, which would release the lock on the first frame.
    root.addEventListener('wheel', release, { passive: true });
    root.addEventListener('touchstart', release, { passive: true });

    return () => {
      observer.disconnect();
      root.removeEventListener('wheel', release);
      root.removeEventListener('touchstart', release);
    };
  }, [sectionIds, scrollRef]);

  const jumpTo = useCallback(
    (id: string) => {
      lockedTo.current = id;
      setCurrent(id);
      const root = scrollRef.current;
      const target = root?.querySelector(`#${CSS.escape(id)}`);
      // `block: 'start'` with the section's own `scrollMarginTop` doing the
      // offsetting, so the heading clears the board's top padding.
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [scrollRef],
  );

  return [current, jumpTo];
}

export function SectionRail({ sections, scrollRef, isMobile = false }: SectionRailProps) {
  /*
   * The id list, keyed on its *contents* rather than its identity.
   *
   * `sections.map(...)` returns a fresh array every render, and the observer's
   * effect depends on that array — so without this it disconnects and rebuilds the
   * observer on every parent render, and every rebuild fires an initial batch of
   * callbacks that can move the highlight while you are mid-scroll. The join is the
   * cheap structural key: the array only changes identity when a section actually
   * appears or disappears.
   */
  const idKey = sections.map((section) => section.id).join('|');
  const ids = useMemo(() => (idKey === '' ? [] : idKey.split('|')), [idKey]);
  const [current, jumpTo] = useSectionInView(ids, scrollRef);

  return (
    <nav
      style={isMobile ? mobileRailStyle : railStyle}
      aria-label="Sections of her dossier"
      data-testid="dossier-section-rail"
    >
      {!isMobile && <span style={eyebrowStyle}>On this page</span>}
      {sections.map((section) => {
        const isActive = section.id === current;
        return (
          <button
            key={section.id}
            type="button"
            style={entryStyle(isActive, isMobile)}
            onClick={() => jumpTo(section.id)}
            aria-current={isActive ? 'true' : undefined}
            data-testid={`dossier-section-link-${section.id}`}
          >
            <DossierIcon
              name={section.icon}
              size={20}
              color={isActive ? colors.claret : colors.inkFaint}
            />
            <span style={isMobile ? mobileLabelStyle : labelStyle}>{section.label}</span>
            {typeof section.count === 'number' && (
              <span style={countStyle(isActive)}>{section.count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
