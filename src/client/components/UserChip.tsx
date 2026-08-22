import React from 'react';
import { useOptionalAuthContext } from '../context/auth-context';
import { colors, insets, layout, radii, typography } from '../design-system/tokens';

/*
 * This renders inside the rail's ⚙ menu and nowhere else, so it matches that
 * menu: one column, `alignItems: stretch`, and the same control height as the
 * demo buttons. The previous horizontal pill pair was sized for the deleted app
 * header and wrapped inside the 268px popover.
 */
const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8,
  minWidth: 0,
};

/**
 * The identity row is a tile, not a button.
 *
 * Same height and radius as the controls below it so the group lines up, but no
 * border and no pointer: it is a statement of fact, and giving it a control's
 * outline is what made the old menu read as four buttons in a ragged grid.
 */
const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: layout.menuControlHeight,
  padding: `0 ${insets.tight}px`,
  borderRadius: radii.chip,
  backgroundColor: colors.sand,
  color: colors.ink,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.medium,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** The quietest control in the menu — a way out, not something to invite. */
const signOutStyle: React.CSSProperties = {
  height: layout.menuControlHeight,
  padding: `0 ${insets.tight}px`,
  border: `1px solid ${colors.linenShade}`,
  borderRadius: radii.chip,
  backgroundColor: 'transparent',
  color: colors.inkMuted,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.medium,
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
        type="button"
        style={signOutStyle}
        onClick={auth.signOut}
        data-testid="sign-out-button"
      >
        Sign out
      </button>
    </div>
  );
}
