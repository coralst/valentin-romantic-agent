import React from 'react';
import { useAuthContext } from '../context/auth-context';
import {
  borderRadius,
  colors,
  shadows,
  spacing,
  typography,
} from '../design-system/tokens';

const pageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: spacing.md,
  backgroundColor: colors.background,
  backgroundImage:
    'radial-gradient(120% 90% at 50% -20%, rgba(242,212,216,0.55) 0%, rgba(248,245,242,0) 70%)',
  fontFamily: typography.bodyFontFamily,
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  padding: `${spacing.xl}px ${spacing.lg}px`,
  backgroundColor: colors.surface,
  borderRadius: borderRadius.xxl,
  boxShadow: shadows.cardHover,
  textAlign: 'center',
};

const logoStyle: React.CSSProperties = {
  height: 64,
  objectFit: 'contain',
  marginBottom: spacing.xs,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xxl,
  fontWeight: typography.weights.bold,
  color: colors.softBurgundy,
  letterSpacing: '-0.02em',
};

const taglineStyle: React.CSSProperties = {
  margin: `${spacing.xs}px 0 ${spacing.lg}px`,
  fontSize: typography.sizes.base,
  lineHeight: typography.lineHeights.relaxed,
  color: colors.textSecondary,
};

const buttonBase: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: `${spacing.xs + 4}px ${spacing.md}px`,
  border: 'none',
  borderRadius: borderRadius.full,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.md,
  fontWeight: typography.weights.semibold,
  cursor: 'pointer',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: colors.accentGradient,
  color: colors.textOnAccent,
  boxShadow: shadows.card,
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  marginTop: spacing.xs,
  backgroundColor: 'transparent',
  color: colors.softBurgundy,
  border: `1px solid ${colors.dustyRose}`,
};

const hintStyle: React.CSSProperties = {
  marginTop: spacing.md,
  marginBottom: 0,
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
};

const errorStyle: React.CSSProperties = {
  marginTop: spacing.sm,
  marginBottom: 0,
  fontSize: typography.sizes.sm,
  color: colors.error,
};

const spinnerStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.base,
  color: colors.textSecondary,
};

/**
 * The front door.
 *
 * Two ways in, and the demo comes first: the common case is someone who wants to
 * see what this is, not someone who has an account. It is the primary button for
 * that reason, and it needs no credentials at all — the server signs the shared
 * demo account in behind it.
 */
export function LoginScreen() {
  const {
    status,
    error,
    busy,
    demoAvailable,
    hostedAvailable,
    authDisabled,
    signIn,
    signInAsDemo,
  } = useAuthContext();

  if (status === 'loading') {
    return (
      <div style={pageStyle} data-testid="auth-loading">
        <p style={spinnerStyle}>Just a moment…</p>
      </div>
    );
  }

  if (status === 'error') {
    // The server is unreachable, so no button here could do anything. Offering
    // one would just invite a second failure.
    return (
      <div style={pageStyle} data-testid="auth-error">
        <div style={cardStyle}>
          <img src="/logo.png" alt="" style={logoStyle} />
          <h1 style={titleStyle}>Valentin</h1>
          <p style={errorStyle} role="alert">
            {error ?? 'Something went wrong. Refresh to try again.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle} data-testid="login-screen">
      <div style={cardStyle}>
        <img src="/logo.png" alt="" style={logoStyle} />
        <h1 style={titleStyle}>Valentin</h1>
        <p style={taglineStyle}>
          A quiet companion who remembers what matters to the person you love.
        </p>

        {demoAvailable && (
          <button
            style={primaryButtonStyle}
            onClick={signInAsDemo}
            disabled={busy}
            data-testid="demo-login-button"
          >
            {busy ? 'Opening the demo…' : 'Try the demo'}
          </button>
        )}

        {(hostedAvailable || authDisabled) && (
          <button
            style={demoAvailable ? secondaryButtonStyle : primaryButtonStyle}
            onClick={signIn}
            disabled={busy}
            data-testid="sign-in-button"
          >
            {authDisabled ? 'Continue' : 'Sign in'}
          </button>
        )}

        {error && (
          <p style={errorStyle} role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        {!demoAvailable && !hostedAvailable && !authDisabled && (
          <p style={errorStyle} role="alert">
            No sign-in method is configured on this deployment yet.
          </p>
        )}

        {demoAvailable && (
          <p style={hintStyle}>
            The demo profile is shared and clears itself out after half an hour.
          </p>
        )}
      </div>
    </div>
  );
}
