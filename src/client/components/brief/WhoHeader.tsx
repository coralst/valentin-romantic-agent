import { colors, layout, radii, typography } from '../../design-system/tokens';
import { onClaret } from './rail-tones';

interface WhoHeaderProps {
  /** Her name, or null before it is known. */
  name: string | null;
  /** The line under it — birthday, age bucket, pronouns — already joined. */
  subtitle: string | null;
  /** A data-URL photo the user uploaded, or null. */
  photo: string | null;
  /**
   * A portrait shipped with the app for this partner, used when no photo has
   * been uploaded. Separate from `photo` rather than pre-merged by the caller so
   * the alt text can say "illustrated portrait" instead of claiming a drawing is
   * a photograph, and so "Change her photo" is never offered for a file that
   * does not exist.
   */
  portrait?: string | null;
  /** Opens the file picker behind the cameo. */
  onEditPhoto?: () => void;
}

const whoStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

/**
 * The portrait, demoted to a cameo.
 *
 * It was a 96px circle above a progress bar, which made the rail a mirror of the
 * profile. At 56px on the name's row it is an identifier, and the headline slot
 * below it belongs to the deadline instead (option-5d-brief.html:78-81).
 */
const cameoStyle: React.CSSProperties = {
  width: layout.cameoSize,
  height: layout.cameoSize,
  borderRadius: radii.pill,
  overflow: 'hidden',
  flex: 'none',
  position: 'relative',
  background: colors.petal,
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
  // A hairline gold ring plus a wider, fainter halo — a frame, not a border.
  boxShadow: '0 0 0 1px rgba(224, 186, 124, 0.5), 0 0 0 4px rgba(224, 186, 124, 0.12)',
};

const photoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  // Faces sit high in a portrait crop, so bias the framing upward.
  objectPosition: '50% 16%',
};

const initialStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingXl,
  fontWeight: typography.weights.normal,
  color: colors.claret,
  userSelect: 'none',
};

const nameStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingXl,
  fontWeight: typography.weights.normal,
  lineHeight: 1.1,
  color: colors.onClaret,
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: onClaret(0.6),
  marginTop: 2,
};

/** The rail's compact header: cameo and name on one row. */
export function WhoHeader({ name, subtitle, photo, portrait, onEditPhoto }: WhoHeaderProps) {
  const displayName = name ?? 'Her brief';
  const image = photo ?? portrait ?? null;
  const alt = photo
    ? name
      ? `Photo of ${name}`
      : 'Her photo'
    : name
      ? `Illustrated portrait of ${name}`
      : 'Illustrated portrait';

  return (
    <div style={whoStyle} data-testid="brief-who">
      <button
        type="button"
        style={cameoStyle}
        onClick={onEditPhoto}
        aria-label={photo ? 'Change her photo' : 'Add her photo'}
        data-testid="brief-cameo"
      >
        {image ? (
          <img src={image} alt={alt} style={photoStyle} />
        ) : (
          <span style={initialStyle} aria-hidden="true">
            {name ? name.trim().charAt(0).toUpperCase() : '♥'}
          </span>
        )}
      </button>
      <div>
        <div style={nameStyle}>{displayName}</div>
        {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
      </div>
    </div>
  );
}
