import { colors, radii, typography } from '../../design-system/tokens';
import type { Caution } from '../brief/KeepInMind';
import {
  cardCountStyle,
  cardHeadStyle,
  cardStyle,
  cardTitleStyle,
  goldWash,
  insetRing,
  WARN_GROUND,
  WARN_HEADING_INK,
} from './board-tones';
import { dossierType } from './dossier-icons';

interface KeepInMindCardProps {
  cautions: Caution[];
}

/**
 * `.mind` — the board's one warning surface (`full-profile.html:111-112`).
 *
 * A light-ground restatement of the rail's `KeepInMind`, not a second source of
 * truth: `deriveCautions` is imported by both, so the rail and the board can
 * never disagree about what is dangerous. Only the palette changes — gold tinted
 * over claret in the rail, gold over cream here.
 */
const mindCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: WARN_GROUND,
  boxShadow: insetRing(goldWash(0.28)),
};

/** The heading is the only one on the board that is not inkFaint (`:112`). */
const mindTitleStyle: React.CSSProperties = {
  ...cardTitleStyle,
  color: WARN_HEADING_INK,
};

const mindCountStyle: React.CSSProperties = {
  ...cardCountStyle,
  background: goldWash(0.18),
  color: WARN_HEADING_INK,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '9px 0',
};

const dividedRowStyle: React.CSSProperties = {
  ...rowStyle,
  borderTop: `1px solid ${goldWash(0.22)}`,
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: radii.pill,
  background: colors.gold,
  flex: 'none',
  // On the first line's centre rather than its ascender.
  marginTop: 7,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.medium,
  color: colors.ink,
};

const consequenceStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  lineHeight: 1.4,
  color: colors.inkMuted,
};

/**
 * The constraints, on the board.
 *
 * Renders nothing when there is nothing to warn about, for the same reason the
 * rail's version does: an empty gold card trains the eye to skip the gold tint,
 * which is the one signal on either surface that has to stay expensive.
 */
export function KeepInMindCard({ cautions }: KeepInMindCardProps) {
  if (cautions.length === 0) return null;

  return (
    <section style={mindCardStyle} data-testid="dossier-keep-in-mind">
      <div style={cardHeadStyle}>
        <h2 style={mindTitleStyle}>Keep in mind</h2>
        <span style={mindCountStyle}>{cautions.length}</span>
      </div>
      {cautions.map((caution, index) => (
        <div
          key={caution.id}
          style={index === 0 ? rowStyle : dividedRowStyle}
          data-testid="dossier-caution"
        >
          <div style={dotStyle} aria-hidden="true" />
          <div style={bodyStyle}>
            <b style={titleStyle}>{caution.title}</b>
            <p style={consequenceStyle}>{caution.consequence}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
