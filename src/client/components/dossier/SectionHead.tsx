import { colors, radii, typography } from '../../design-system/tokens';
import { DossierIcon, dossierType, dossierFonts, type DossierIconName } from './dossier-icons';

/**
 * A section heading on the board — the thing the section rail scrolls to.
 *
 * It is a full-row grid item rather than part of a card, for two reasons. It has
 * to break the twelve-column flow so the cards beneath it read as belonging to
 * it; and it has to be the element the `IntersectionObserver` watches, which
 * means it needs its own box in the scroll flow rather than being a line of text
 * inside the first card of the group.
 *
 * `scrollMarginTop` IS LOAD-BEARING. `scrollIntoView({ block: 'start' })` aligns
 * the element's box edge with the scroll container's edge, which parks the
 * heading flush against the top of the board with no breathing room above it —
 * and if the board ever gains a sticky element, underneath it entirely. The
 * margin reserves that space as part of the element's own scroll geometry, so the
 * rail does not have to know the board's padding.
 */

interface SectionHeadProps {
  /** The DOM id the rail jumps to. Must match its `DossierSection.id`. */
  id: string;
  title: string;
  icon: DossierIconName;
  /** Right of the title, as a pill. Omit for sections that count nothing. */
  count?: number | null;
  /** One line under the title, explaining what the section is for. */
  note?: string | null;
  isMobile?: boolean;
}

function wrapperStyle(isMobile: boolean): React.CSSProperties {
  return {
    gridColumn: '1 / -1',
    // Top margin on the heading rather than bottom padding on the group above it,
    // so the gap belongs to the thing that creates the division.
    margin: isMobile ? '14px 0 0' : '22px 2px 0',
    scrollMarginTop: isMobile ? 12 : 18,
    minWidth: 0,
  };
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  minWidth: 0,
};

function titleStyle(isMobile: boolean): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: dossierFonts.heading,
    fontWeight: typography.weights.normal,
    // 24px, against the 17px the old card heads used. The section titles are the
    // board's only real landmarks now that the tab bar is gone, so they have to
    // win against the cards rather than tie with them.
    fontSize: isMobile ? 21 : dossierType.section,
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    color: colors.ink,
    minWidth: 0,
  };
}

const countStyle: React.CSSProperties = {
  flex: 'none',
  padding: '3px 11px',
  borderRadius: radii.pill,
  background: colors.petal,
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  fontVariantNumeric: 'tabular-nums',
  color: colors.claret,
};

const noteStyle: React.CSSProperties = {
  margin: '5px 0 0 35px',
  fontFamily: typography.bodyFontFamily,
  // 15px floor — this is the line that used to be 10.5px `caption` and was the
  // single most-skipped text on the board.
  fontSize: dossierType.small,
  lineHeight: 1.5,
  color: colors.inkMuted,
  maxWidth: '68ch',
};

export function SectionHead({
  id,
  title,
  icon,
  count = null,
  note = null,
  isMobile = false,
}: SectionHeadProps) {
  return (
    <header
      id={id}
      style={wrapperStyle(isMobile)}
      data-testid="dossier-section-head"
      data-section-id={id}
    >
      <div style={rowStyle}>
        <DossierIcon name={icon} size={24} color={colors.claret} />
        <h2 style={titleStyle(isMobile)}>{title}</h2>
        {typeof count === 'number' && <span style={countStyle}>{count}</span>}
      </div>
      {note && <p style={noteStyle}>{note}</p>}
    </header>
  );
}
