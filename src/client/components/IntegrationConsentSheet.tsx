import { useEffect, useId, useRef, useState } from 'react';
import { colors, insets, radii, typography, animation } from '../design-system/tokens';
import { canSpend, type IntegrationService } from '../utils/integration-catalogue';
import type { IntegrationGrant } from '../hooks/use-integrations-store';

/**
 * The sheet that stands between "click a service" and "the agent may act through
 * it".
 *
 * It exists because a toggle is the wrong control for a permission: a switch says
 * on/off, and what is actually being granted here is a *list* of scopes plus, for
 * anything that can spend, a ceiling. Reading the scopes back to the visitor at
 * the moment of the grant is the whole point — so the sheet is deliberately not
 * skippable and not remembered ("do not ask again" would defeat it).
 */

interface IntegrationConsentSheetProps {
  service: IntegrationService;
  /**
   * `connect` for a service with no grant yet, `manage` for one that has.
   *
   * The two differ only in their verbs and in the disconnect button; the scope
   * list is identical, because the answer to "what did I agree to?" has to be
   * available after the fact and not only before it.
   */
  mode: 'connect' | 'manage';
  /** The existing grant, when managing one. */
  grant?: IntegrationGrant;
  onConfirm: (capUsd: number | null) => void;
  onDisconnect?: () => void;
  onCancel: () => void;
}

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 20,
  display: 'grid',
  placeItems: 'center',
  padding: insets.snug,
  backgroundColor: 'rgba(42, 34, 38, 0.42)',
};

const sheetStyle: React.CSSProperties = {
  width: 'min(420px, 100%)',
  maxHeight: '100%',
  overflowY: 'auto',
  boxSizing: 'border-box',
  backgroundColor: colors.porcelain,
  borderRadius: radii.panel,
  padding: insets.snug,
  boxShadow: '0 30px 70px rgba(42, 34, 38, 0.4)',
  animation: `integration-sheet-rise ${animation.durations.fast}ms ${animation.easing.easeOut}`,
};

const titleStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingMd,
  color: colors.claret,
  margin: '0 0 4px',
};

const leadStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  color: colors.inkMuted,
  lineHeight: typography.lineHeights.normal,
  margin: `0 0 ${insets.tight}px`,
};

const scopeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  padding: '9px 0',
  borderTop: `1px solid ${colors.linenShade}`,
};

const scopeLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  fontWeight: typography.weights.semibold,
  color: colors.ink,
};

const scopeDetailStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkMuted,
};

/** `spend` scopes are the ones the cap governs, so they are the ones marked. */
function reachTagStyle(reach: IntegrationService['scopes'][number]['reach']): React.CSSProperties {
  const isSpend = reach === 'spend';
  return {
    marginLeft: 'auto',
    flexShrink: 0,
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.micro,
    fontWeight: typography.weights.semibold,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    borderRadius: radii.pill,
    padding: '3px 8px',
    color: isSpend ? colors.claret : colors.inkFaint,
    backgroundColor: isSpend ? colors.petal : colors.sand,
  };
}

const capRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: insets.tight,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  color: colors.ink,
};

const capValueStyle: React.CSSProperties = {
  fontWeight: typography.weights.semibold,
  color: colors.claret,
  minWidth: 52,
  textAlign: 'right',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: insets.snug,
};

function buttonStyle(kind: 'primary' | 'ghost' | 'danger'): React.CSSProperties {
  return {
    flex: 1,
    height: 38,
    border: kind === 'primary' ? 'none' : `1px solid ${colors.linenShade}`,
    borderRadius: radii.chip,
    cursor: 'pointer',
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.small,
    fontWeight: typography.weights.semibold,
    backgroundColor: kind === 'primary' ? colors.claret : colors.porcelain,
    color:
      kind === 'primary' ? colors.onClaret : kind === 'danger' ? colors.error : colors.inkMuted,
  };
}

const noteStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkFaint,
  lineHeight: typography.lineHeights.normal,
  margin: `${insets.tight}px 0 0`,
};

/** The cap slider's range, in whole USD. */
const CAP_MIN = 10;
const CAP_MAX = 500;
const CAP_STEP = 10;

export function IntegrationConsentSheet({
  service,
  mode,
  grant,
  onConfirm,
  onDisconnect,
  onCancel,
}: IntegrationConsentSheetProps) {
  const spends = canSpend(service);
  const [capUsd, setCapUsd] = useState<number>(
    grant?.capUsd ?? service.defaultCapUsd ?? CAP_MIN,
  );

  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  // Land focus inside the sheet so the keyboard is not still driving the panel
  // behind it. The container takes it rather than a button, so nothing is
  // pre-armed: "Allow" must be chosen, never merely confirmed by an Enter that
  // was meant for something else.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Stop the panel's own Escape handler from also firing: one Escape should
        // dismiss one layer.
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onCancel]);

  return (
    <div
      style={backdropStyle}
      data-testid="integration-consent-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={sheetStyle}
        data-testid="integration-consent-sheet"
      >
        <h3 id={titleId} style={titleStyle}>
          {mode === 'connect' ? `Connect ${service.name}` : service.name}
        </h3>
        <p style={leadStyle}>
          {mode === 'connect'
            ? 'Valentin will be able to do exactly this much — nothing else, and nothing silently.'
            : 'What you have already allowed. Change the ceiling, or take the reach away.'}
        </p>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="integration-scopes">
          {service.scopes.map((scope) => (
            <li key={scope.label} style={scopeRowStyle}>
              <span>
                <span style={scopeLabelStyle}>{scope.label}</span>
                <br />
                <span style={scopeDetailStyle}>{scope.detail}</span>
              </span>
              <span style={reachTagStyle(scope.reach)}>{scope.reach}</span>
            </li>
          ))}
        </ul>

        {/* No slider on a service that cannot spend: a ceiling on "create a
            playlist" is decoration, and decoration next to real permissions
            teaches people to click past them. */}
        {spends && (
          <label style={capRowStyle}>
            <span>Spend cap</span>
            <input
              type="range"
              min={CAP_MIN}
              max={CAP_MAX}
              step={CAP_STEP}
              value={capUsd}
              onChange={(event) => setCapUsd(Number(event.target.value))}
              style={{ flex: 1, accentColor: colors.claret }}
              data-testid="integration-cap-slider"
              aria-label={`Spend cap for ${service.name}, in US dollars`}
            />
            <span style={capValueStyle} data-testid="integration-cap-value">
              ${capUsd}
            </span>
          </label>
        )}

        <div style={actionsStyle}>
          <button type="button" style={buttonStyle('ghost')} onClick={onCancel}>
            Cancel
          </button>
          {mode === 'manage' && onDisconnect && (
            <button
              type="button"
              style={buttonStyle('danger')}
              onClick={onDisconnect}
              data-testid="integration-disconnect-button"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            style={buttonStyle('primary')}
            onClick={() => onConfirm(spends ? capUsd : null)}
            data-testid="integration-confirm-button"
          >
            {mode === 'connect' ? 'Allow & connect' : 'Save'}
          </button>
        </div>

        <p style={noteStyle}>
          This build records your choice in this browser only. No account is
          contacted and nothing is ordered — the panel is the permission model, not
          a live billing relationship.
        </p>
      </div>
    </div>
  );
}
