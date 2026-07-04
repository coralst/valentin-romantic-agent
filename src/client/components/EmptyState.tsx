import { colors, spacing, typography, borderRadius } from '../design-system/tokens';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.xxl,
  textAlign: 'center',
  height: '100%',
};

const iconContainerStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: borderRadius.full,
  background: `linear-gradient(135deg, ${colors.blush} 0%, ${colors.champagne} 100%)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: spacing.md,
  fontSize: '1.75rem',
};

const headingStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.lg,
  color: colors.text,
  marginBottom: spacing.xs,
};

const textStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  lineHeight: typography.lineHeights.relaxed,
  maxWidth: 260,
};

export function EmptyState() {
  return (
    <div style={containerStyle} data-testid="empty-state">
      <div style={iconContainerStyle} aria-hidden="true">💕</div>
      <h3 style={headingStyle}>No preferences yet</h3>
      <p style={textStyle}>
        Keep chatting with Valentin to discover your partner's preferences
      </p>
    </div>
  );
}
