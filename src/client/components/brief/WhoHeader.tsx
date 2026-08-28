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
  /**
   * Opens her full profile — and closes it again. The cameo is the control.
   *
   * It used to open a file picker, which is not what a portrait in a header
   * looks like it does: people click a face to go to the person. Uploading a
   * photo lives on the dossier's own avatar (`PartnerAvatar`), which is one
   * click further in and is the only place the upload logic has ever lived.
   *
   * Two-way now that her file opens in the chat column rather than replacing the
   * rail: the cameo stays on screen beside the board it opened, and a control
   * that is still there, still lit, and does nothing on a second press is the
   * kind of thing people click three times.
   */
  onOpenProfile?: () => void;
  /**
   * Whether her file is the surface on screen, so the cameo can say so.
   *
   * `aria-pressed` rather than `aria-current`: this is a toggle for a panel, not
   * a location in a set of them — the conversation list's pinned row is what
   * carries `aria-current`.
   */
  isProfileOpen?: boolean;
  /**
   * Focus comes back here when the profile closes — see `view-context`'s
   * `applyClose`. The cameo is what opened it, so it is what must not be left
   * stranded on a removed element.
   */
  cameoRef?: React.RefObject<HTMLButtonElement | null>;
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

/**
 * The cameo while her file is the surface on screen: the gold frame goes solid.
 *
 * Same geometry, only the ring changes — a portrait that grew or moved when you
 * opened it would shift the name beside it for no reason.
 */
const openCameoStyle: React.CSSProperties = {
  ...cameoStyle,
  boxShadow: '0 0 0 2px rgba(224, 186, 124, 0.95), 0 0 0 6px rgba(224, 186, 124, 0.22)',
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
export function WhoHeader({
  name,
  subtitle,
  photo,
  portrait,
  onOpenProfile,
  isProfileOpen = false,
  cameoRef,
}: WhoHeaderProps) {
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
        ref={cameoRef}
        type="button"
        style={isProfileOpen ? openCameoStyle : cameoStyle}
        onClick={onOpenProfile}
        aria-pressed={isProfileOpen}
        aria-label={
          isProfileOpen
            ? name
              ? `Close ${name}'s full profile`
              : 'Close her full profile'
            : name
              ? `Open ${name}'s full profile`
              : 'Open her full profile'
        }
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
