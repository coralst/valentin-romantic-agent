import { colors, radii, typography } from '../../design-system/tokens';
import { dossierType } from './dossier-icons';

/**
 * The four tiles inside "Everything I know about her".
 *
 * A tile is not a card: it sits *inside* one, so it has no shadow of its own —
 * two nested drop shadows read as a rendering fault rather than as depth — and it
 * is a shade darker than the card so the nesting is visible without a border.
 *
 * Shared here rather than repeated in each of the four because the tiles are a
 * set, and a set whose padding drifts by 2px between members is the thing people
 * notice without being able to name.
 */

export const tileStyle: React.CSSProperties = {
  background: colors.porcelain,
  borderRadius: radii.kv,
  padding: 15,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

/**
 * The tile's head: icon and label on one row.
 *
 * `h4` rather than a `div`, so the board's headings nest properly — the section
 * is an `h2` and these are two levels of content below it. Claret on the icon
 * only; a claret label at this size would compete with the section head.
 */
export const tileHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  color: colors.claret,
};

export const tileTitleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: dossierType.small,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: colors.inkMuted,
};
