import { colors, spacing, borderRadius, typography } from '../design-system/tokens';

interface CompletionSummaryProps {
  filled: number;
  total: number;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  padding: `${spacing.xs}px ${spacing.md}px`,
};

const textStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  fontWeight: typography.weights.medium,
};

const barContainerStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  backgroundColor: colors.background,
  borderRadius: borderRadius.full,
  overflow: 'hidden',
};

const barFillBaseStyle: React.CSSProperties = {
  height: '100%',
  background: colors.accentGradient,
  borderRadius: borderRadius.full,
  transition: 'width 300ms ease',
};

export function CompletionSummary({ filled, total }: CompletionSummaryProps) {
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div style={containerStyle} data-testid="completion-summary" aria-label={`${filled} of ${total} fields filled`}>
      <span style={textStyle}>{filled}/{total} filled</span>
      <div style={barContainerStyle} role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
        <div style={{ ...barFillBaseStyle, width: `${percent}%` }} />
      </div>
    </div>
  );
}
