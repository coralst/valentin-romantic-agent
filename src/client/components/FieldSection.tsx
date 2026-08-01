import { useState, useEffect } from 'react';
import type { ProfileFieldDefinition } from '../utils/profile-field-registry';
import type { ProfileFieldValue } from '../hooks/use-profile-store';
import { ProfileField } from './ProfileField';
import { colors, spacing, borderRadius, typography, animation } from '../design-system/tokens';

interface FieldSectionProps {
  sectionId: string;
  label: string;
  fields: ProfileFieldDefinition[];
  getFieldValue: (fieldId: string) => ProfileFieldValue | null;
  onSaveField: (fieldId: string, value: string) => void;
  onClearField: (fieldId: string) => void;
  highlightedFieldIds: Set<string>;
}

const sectionStyle: React.CSSProperties = {
  marginBottom: spacing.xs,
  borderRadius: borderRadius.lg,
  backgroundColor: colors.surface,
  border: `1px solid ${colors.borderSubtle}`,
  overflow: 'hidden',
  transition: `border-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${spacing.xs + 2}px ${spacing.sm}px`,
  cursor: 'pointer',
  backgroundColor: colors.surface,
  userSelect: 'none',
  border: 'none',
  width: '100%',
  textAlign: 'left',
};

const headingStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  color: colors.text,
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  margin: 0,
};

const chevronStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  transition: `transform ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  display: 'inline-block',
};

const countStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  fontWeight: typography.weights.medium,
  backgroundColor: colors.background,
  padding: `2px ${spacing.xs}px`,
  borderRadius: borderRadius.full,
};

const contentStyle: React.CSSProperties = {
  padding: `0 ${spacing.xs}px ${spacing.xs}px`,
  transition: `max-height ${animation.durations.normal}ms ${animation.easing.easeInOut}`,
  overflow: 'hidden',
};

export function FieldSection({
  sectionId,
  label,
  fields,
  getFieldValue,
  onSaveField,
  onClearField,
  highlightedFieldIds,
}: FieldSectionProps) {
  const filledCount = fields.filter((f) => getFieldValue(f.id) !== null).length;
  const hasAnyFilled = filledCount > 0;

  // Auto-collapse when section has no filled fields (R2.7)
  const [isExpanded, setIsExpanded] = useState(hasAnyFilled);

  // Expand when a field in this section gets populated
  useEffect(() => {
    if (hasAnyFilled && !isExpanded) {
      setIsExpanded(true);
    }
  }, [hasAnyFilled]);

  return (
    <div style={sectionStyle} data-testid="field-section" data-section-id={sectionId}>
      <button
        style={headerStyle}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls={`section-content-${sectionId}`}
        data-testid={`section-header-${sectionId}`}
      >
        <h3 style={headingStyle}>
          <span style={{ ...chevronStyle, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            {'▸'}
          </span>
          {label}
        </h3>
        <span style={countStyle}>{filledCount}/{fields.length}</span>
      </button>

      {isExpanded && (
        <div
          style={contentStyle}
          id={`section-content-${sectionId}`}
          role="region"
          aria-label={`${label} fields`}
        >
          {fields.map((field) => (
            <ProfileField
              key={field.id}
              definition={field}
              value={getFieldValue(field.id)}
              onSave={(value) => onSaveField(field.id, value)}
              onClear={() => onClearField(field.id)}
              isHighlighted={highlightedFieldIds.has(field.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
