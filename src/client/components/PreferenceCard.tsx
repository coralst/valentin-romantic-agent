import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { colors, spacing, borderRadius, typography } from '../design-system/tokens';

interface PreferenceCardProps {
  preference: PreferenceWithHistory;
  isHighlighted: boolean;
}

const cardStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderRadius: borderRadius.md,
  backgroundColor: colors.surface,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 4,
  transition: 'background-color 300ms ease',
};

const highlightedCardStyle: React.CSSProperties = {
  ...cardStyle,
  backgroundColor: colors.highlight,
};

const keyValueStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const keyStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  fontWeight: typography.weights.medium,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
};

const valueStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.text,
  fontWeight: typography.weights.normal,
};

const badgeStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  padding: `2px ${spacing.xs}px`,
  borderRadius: borderRadius.full,
  backgroundColor: colors.background,
  color: colors.softBurgundy,
  whiteSpace: 'nowrap',
};

export function PreferenceCard({ preference, isHighlighted }: PreferenceCardProps) {
  const confidence = Math.round(preference.confidence * 100);

  return (
    <div
      style={isHighlighted ? highlightedCardStyle : cardStyle}
      data-testid="preference-card"
      data-highlighted={isHighlighted ? 'true' : 'false'}
    >
      <div style={keyValueStyle}>
        <span style={keyStyle}>{preference.key}</span>
        <span style={valueStyle}>{preference.value}</span>
      </div>
      <span style={badgeStyle}>{confidence}%</span>
    </div>
  );
}
