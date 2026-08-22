import { useRef, useState } from 'react';
import { useProfileStoreContext } from '../context/profile-store-context';
import { portraitForPartner } from '../utils/persona-portrait';
import { colors, spacing, borderRadius, typography, animation, shadows } from '../design-system/tokens';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: `${spacing.md}px 0`,
  gap: spacing.xs,
};

/**
 * The size this component used to hardcode, kept as the default so every
 * existing caller renders exactly as before.
 */
export const DEFAULT_AVATAR_SIZE = 96;

/**
 * The compact layout the dossier's identity header needs: the 24px block padding
 * and the column gap are for a standalone panel module, and inside a 50px header
 * cameo they push the name off its row.
 */
const compactContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: 0,
  gap: 0,
};

/** Below this the avatar is a cameo, not a module, and drops its chrome. */
const COMPACT_BELOW = 80;

function getCircleStyle(size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blush,
    // The ring scales with the circle: 3px reads as a frame at 96px and as a
    // heavy outline at 50px.
    border: `${size >= COMPACT_BELOW ? 3 : 1}px solid ${colors.dustyRose}`,
    boxShadow: shadows.card,
    position: 'relative',
    cursor: 'pointer',
    flex: 'none',
    transition: `box-shadow ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  };
}

/** Initials have to shrink with the circle or they overflow it. */
function getInitialsStyle(size: number): React.CSSProperties {
  return {
    ...initialsStyle,
    fontSize: size >= COMPACT_BELOW ? typography.sizes.xl : typography.sizes.md,
  };
}

const photoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const initialsStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xl,
  fontWeight: typography.weights.bold,
  color: colors.softBurgundy,
  userSelect: 'none',
};

const heartStyle: React.CSSProperties = {
  fontSize: '2rem',
  color: colors.softBurgundy,
  userSelect: 'none',
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  gap: spacing.xs,
  marginTop: 4,
};

const buttonStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colors.softBurgundy,
  background: 'none',
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  padding: `4px ${spacing.xs}px`,
  cursor: 'pointer',
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const errorStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.error,
  textAlign: 'center',
  maxWidth: 200,
  marginTop: 4,
};

interface PartnerAvatarProps {
  partnerName: string | null;
  /**
   * Diameter of the circle, in px. Defaults to the 96px this component used to
   * hardcode; the dossier's identity header asks for 50 (`full-profile.html:42`).
   */
  size?: number;
}

export function PartnerAvatar({ partnerName, size = DEFAULT_AVATAR_SIZE }: PartnerAvatarProps) {
  const { state, dispatch } = useProfileStoreContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPhoto = !!state.partnerPhoto;
  /**
   * The portrait shipped for a known partner, used only until a real photo
   * exists. `hasPhoto` stays keyed on the *uploaded* file: Replace/Remove must
   * not be offered for an asset the user never added and cannot delete.
   */
  const image = state.partnerPhoto ?? portraitForPartner(partnerName);

  const getInitials = (name: string): string => {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Accepted formats: PNG, JPEG, or WebP');
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError('Maximum file size is 5 MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      dispatch({ type: 'SET_PHOTO', dataUrl });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = () => {
    dispatch({ type: 'REMOVE_PHOTO' });
    setError(null);
  };

  const altText = hasPhoto
    ? partnerName
      ? `Photo of ${partnerName}`
      : 'Partner photo'
    : partnerName
      ? `Illustrated portrait of ${partnerName}`
      : 'Partner portrait';

  const isCompact = size < COMPACT_BELOW;

  const renderPlaceholder = () => {
    if (partnerName) {
      return (
        <span style={getInitialsStyle(size)} aria-hidden="true">
          {getInitials(partnerName)}
        </span>
      );
    }
    return (
      <span style={isCompact ? { ...heartStyle, fontSize: '1.1rem' } : heartStyle} aria-hidden="true">
        {'♥'}
      </span>
    );
  };

  return (
    <div
      style={isCompact ? compactContainerStyle : containerStyle}
      data-testid="partner-avatar"
    >
      <div
        style={getCircleStyle(size)}
        onClick={handleUploadClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUploadClick(); } }}
        role="button"
        tabIndex={0}
        aria-label={hasPhoto ? `Change photo. ${altText}` : 'Upload partner photo'}
      >
        {image ? (
          <img src={image} alt={altText} style={photoStyle} />
        ) : (
          renderPlaceholder()
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
        data-testid="avatar-file-input"
      />

      {/* At cameo size the Replace/Remove pair is wider than the circle and would
          break the header row it sits in. The circle is already the replace
          affordance, so the buttons are a module-only control. */}
      {hasPhoto && !isCompact && (
        <div style={controlsStyle}>
          <button
            style={buttonStyle}
            onClick={handleUploadClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUploadClick(); } }}
            aria-label="Replace photo"
            data-testid="avatar-replace-btn"
          >
            Replace
          </button>
          <button
            style={buttonStyle}
            onClick={handleRemove}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRemove(); } }}
            aria-label="Remove photo"
            data-testid="avatar-remove-btn"
          >
            Remove
          </button>
        </div>
      )}

      {error && (
        <p style={errorStyle} role="alert" data-testid="avatar-error">
          {error}
        </p>
      )}
    </div>
  );
}
