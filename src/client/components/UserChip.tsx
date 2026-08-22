import React from 'react';
import { useOptionalAuthContext } from '../context/auth-context';
import {
  borderRadius,
  colors,
  spacing,
  typography,
} from '../design-system/tokens';

const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
  // No `marginLeft: auto` — DemoToolbar already claims the free space to its
  // left, and a second auto margin would split it and pull the toolbar inwards.
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: `4px ${spacing.xs + 2}px`,
  borderRadius: borderRadius.full,
  backgroundColor: colors.blush,
  color: colors.deepPlum,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const signOutStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.full,
  backgroundColor: 'transparent',
  color: colors.textSecondary,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  cursor: 'pointer',
};

/**
 * Who you are, and the way out.
 *
 * Renders nothing outside an AuthProvider — the component tests mount AppLayout
 * on its own, and "no session to sign out of" is the honest rendering rather
 * than a crash.
 */
export function UserChip() {
  const auth = useOptionalAuthContext();
  if (!auth || auth.status !== 'signed-in') return null;

  return (
    <div style={wrapperStyle} data-testid="user-chip">
      <span style={labelStyle} title={auth.userLabel}>
        {auth.isDemo ? '✨' : '·'} {auth.userLabel}
      </span>
      <button
        style={signOutStyle}
        onClick={auth.signOut}
        data-testid="sign-out-button"
      >
        Sign out
      </button>
    </div>
  );
}
