import { useState, useRef, useEffect } from 'react';
import type { ProfileFieldDefinition } from '../utils/profile-field-registry';
import type { ProfileFieldValue } from '../hooks/use-profile-store';
import { colors, spacing, borderRadius, typography, animation } from '../design-system/tokens';

interface ProfileFieldProps {
  definition: ProfileFieldDefinition;
  value: ProfileFieldValue | null;
  onSave: (value: string) => void;
  onClear: () => void;
  isHighlighted?: boolean;
}

const fieldContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderRadius: borderRadius.md,
  transition: `background-color ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  marginBottom: 2,
};

const highlightedStyle: React.CSSProperties = {
  ...fieldContainerStyle,
  backgroundColor: colors.highlight,
};

const labelRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  minHeight: 28,
};

const labelStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const valueRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  marginTop: 2,
};

const valueStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.text,
  fontWeight: typography.weights.normal,
};

const tentativeStyle: React.CSSProperties = {
  ...valueStyle,
  fontStyle: 'italic',
  opacity: 0.7,
};

const placeholderStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  fontStyle: 'italic',
};

const badgeStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: typography.weights.semibold,
  padding: `1px 6px`,
  borderRadius: borderRadius.full,
  whiteSpace: 'nowrap',
};

const discoveredBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  backgroundColor: colors.blush,
  color: colors.softBurgundy,
};

const manualBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  backgroundColor: colors.background,
  color: colors.warmTaupe,
};

const editButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: typography.sizes.xs,
  color: colors.softBurgundy,
  cursor: 'pointer',
  padding: `2px 6px`,
  borderRadius: borderRadius.sm,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
};

const inputContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  marginTop: 4,
  alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: typography.sizes.sm,
  fontFamily: typography.bodyFontFamily,
  padding: `4px ${spacing.xs}px`,
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  outline: 'none',
  color: colors.text,
  backgroundColor: colors.surface,
};

const smallButtonStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  fontFamily: typography.bodyFontFamily,
  fontWeight: typography.weights.medium,
  padding: `3px 8px`,
  borderRadius: borderRadius.sm,
  cursor: 'pointer',
  border: 'none',
};

const saveButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  backgroundColor: colors.softBurgundy,
  color: colors.textOnAccent,
};

const cancelButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  backgroundColor: colors.background,
  color: colors.text,
  border: `1px solid ${colors.border}`,
};

const errorMsgStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.error,
  marginTop: 2,
};

function validateValue(value: string, definition: ProfileFieldDefinition): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Value cannot be empty';

  switch (definition.valueType) {
    case 'date': {
      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) return 'Expected format: YYYY-MM-DD';
      return null;
    }
    case 'enum': {
      if (definition.enumOptions && !definition.enumOptions.includes(trimmed)) {
        return `Must be one of: ${definition.enumOptions.join(', ')}`;
      }
      return null;
    }
    case 'list':
    case 'text':
    default:
      return null;
  }
}

export function ProfileField({ definition, value, onSave, onClear, isHighlighted }: ProfileFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleEdit = () => {
    setEditValue(value?.value ?? '');
    setValidationError(null);
    setIsEditing(true);
  };

  const handleSave = () => {
    const error = validateValue(editValue, definition);
    if (error) {
      setValidationError(error);
      return;
    }
    onSave(editValue.trim());
    setIsEditing(false);
    setValidationError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setValidationError(null);
  };

  const handleClear = () => {
    onClear();
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const isTentative = value?.source === 'discovered' && (value.confidence ?? 1) < 0.5;
  const containerStyleFinal = isHighlighted ? highlightedStyle : fieldContainerStyle;

  const fieldId = `profile-field-${definition.id}`;

  return (
    <div style={containerStyleFinal} data-testid="profile-field" data-field-id={definition.id}>
      <div style={labelRowStyle}>
        <label id={`${fieldId}-label`} style={labelStyle}>{definition.label}</label>
        {!isEditing && (
          <button
            style={editButtonStyle}
            onClick={handleEdit}
            aria-label={`Edit ${definition.label}`}
            data-testid={`edit-btn-${definition.id}`}
          >
            {value ? 'Edit' : 'Add'}
          </button>
        )}
      </div>

      {isEditing ? (
        <>
          <div style={inputContainerStyle}>
            {definition.valueType === 'enum' && definition.enumOptions ? (
              <select
                ref={inputRef as React.RefObject<HTMLSelectElement>}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
                aria-labelledby={`${fieldId}-label`}
                data-testid={`input-${definition.id}`}
              >
                <option value="">Select...</option>
                {definition.enumOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type={definition.valueType === 'date' ? 'date' : 'text'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                style={inputStyle}
                placeholder={definition.valueType === 'list' ? 'Comma-separated values' : `Enter ${definition.label.toLowerCase()}`}
                aria-labelledby={`${fieldId}-label`}
                data-testid={`input-${definition.id}`}
              />
            )}
            <button style={saveButtonStyle} onClick={handleSave} aria-label="Save">Save</button>
            <button style={cancelButtonStyle} onClick={handleCancel} aria-label="Cancel">Cancel</button>
          </div>
          {value?.source === 'manual' && (
            <button
              style={{ ...editButtonStyle, marginTop: 4, alignSelf: 'flex-start' }}
              onClick={handleClear}
              aria-label={`Clear ${definition.label}`}
            >
              Clear manual value
            </button>
          )}
          {validationError && (
            <p style={errorMsgStyle} role="alert" data-testid="field-validation-error">{validationError}</p>
          )}
        </>
      ) : (
        <div style={valueRowStyle}>
          {value ? (
            <>
              <span style={isTentative ? tentativeStyle : valueStyle}>{value.value}</span>
              <span style={value.source === 'discovered' ? discoveredBadgeStyle : manualBadgeStyle}>
                {value.source === 'discovered' ? `${Math.round((value.confidence ?? 1) * 100)}%` : 'manual'}
              </span>
              {isTentative && (
                <span style={{ ...badgeStyle, backgroundColor: colors.champagne, color: colors.warmTaupe }}>
                  tentative
                </span>
              )}
            </>
          ) : (
            <span style={placeholderStyle}>Not yet known</span>
          )}
        </div>
      )}
    </div>
  );
}
