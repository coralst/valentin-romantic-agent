import { colors, spacing, typography } from '../design-system/tokens';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.xxl,
  textAlign: 'center',
  height: '100%',
};

const emojiStyle: React.CSSProperties = {
  fontSize: '3rem',
  marginBottom: spacing.md,
};

const headingStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xl,
  color: colors.softBurgundy,
  marginBottom: spacing.sm,
};

const textStyle: React.CSSProperties = {
  fontSize: typography.sizes.base,
  color: colors.textSecondary,
  lineHeight: typography.lineHeights.relaxed,
  maxWidth: 320,
};

export function EmptyState() {
  return (
    <div style={containerStyle} data-testid="empty-state">
      <div style={emojiStyle} aria-hidden="true">💕</div>
      <h3 style={headingStyle}>No preferences yet</h3>
      <p style={textStyle}>
        Keep chatting with Valentin to discover your partner's preferences
      </p>
    </div>
  );
}
