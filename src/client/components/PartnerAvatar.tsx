import { useRef, useState } from 'react';
import { useProfileStoreContext } from '../context/profile-store-context';
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

const avatarSize = 96;

const circleStyle: React.CSSProperties = {
  width: avatarSize,
  height: avatarSize,
  borderRadius: borderRadius.full,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.blush,
  border: `3px solid ${colors.dustyRose}`,
  boxShadow: shadows.card,
  position: 'relative',
  cursor: 'pointer',
  transition: `box-shadow ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
};

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
}

export function PartnerAvatar({ partnerName }: PartnerAvatarProps) {
  const { state, dispatch } = useProfileStoreContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPhoto = !!state.partnerPhoto;

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

  const altText = partnerName ? `Photo of ${partnerName}` : 'Partner photo';

  const renderPlaceholder = () => {
    if (partnerName) {
      return <span style={initialsStyle} aria-hidden="true">{getInitials(partnerName)}</span>;
    }
    return <span style={heartStyle} aria-hidden="true">{'♥'}</span>;
  };

  return (
    <div style={containerStyle} data-testid="partner-avatar">
      <div
        style={circleStyle}
        onClick={handleUploadClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleUploadClick(); } }}
        role="button"
        tabIndex={0}
        aria-label={hasPhoto ? `Change photo. ${altText}` : 'Upload partner photo'}
      >
        {hasPhoto ? (
          <img src={state.partnerPhoto!} alt={altText} style={photoStyle} />
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

      {hasPhoto && (
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
