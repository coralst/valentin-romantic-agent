import { useEffect, useId, useRef, useState } from 'react';
import { colors, insets, radii, typography, animation } from '../design-system/tokens';
import { canSpend, type IntegrationService } from '../utils/integration-catalogue';
import type { IntegrationGrant } from '../hooks/use-integrations-store';
import { IntegrationCredentialsForm } from './IntegrationCredentialsForm';
import { connectableFor, type ConnectableId } from '../utils/integration-connect';
import type { ConnectStatus } from '../hooks/use-integration-connect';
import type { IntegrationReadiness } from '../hooks/use-integration-readiness';

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
  /**
   * What the server holds, so the sheet can offer to fill in what is missing.
   *
   * Optional so the existing component tests, which are about the grant and the
   * spend cap, keep constructing this component with the props they always did.
   * Absent means no credential block at all — the same as a fully configured
   * capability, which is the correct fallback: never invite someone to fix
   * something you cannot tell is broken.
   */
  readiness?: IntegrationReadiness;
  connectStatus?: ConnectStatus;
  onConnectCredentials?: (id: ConnectableId, fields: Record<string, string>) => void;
  onForgetCredentials?: (id: ConnectableId) => void;
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

/**
 * The connect flows this capability still needs, in catalogue order.
 *
 * Deduplicated, because Calendar and Gmail both map to `google` and a capability
 * backed by both would otherwise render two identical sign-in forms. Empty when
 * everything is configured, when nothing is known yet, or when the capability has
 * no real backing at all — a "not built yet" row has no credential to supply, and
 * offering a form for one would be a lie about what connecting achieves.
 */
function missingConnectFlows(
  service: IntegrationService,
  readiness: IntegrationReadiness | undefined,
): ConnectableId[] {
  if (!readiness || readiness.state !== 'loaded') return [];
  const seen = new Set<ConnectableId>();
  for (const id of service.backing ?? []) {
    if (readiness.configured[id] === true) continue;
    const flow = connectableFor(id);
    if (flow) seen.add(flow);
  }
  return [...seen];
}

/**
 * Whether the server already holds this flow's OAuth client, sign-in aside.
 *
 * Folded over the backing ids because a flow can stand for more than one — `google`
 * covers Calendar and Gmail, which share a single OAuth client and so report the
 * same answer. `some` rather than `every` for that reason: they cannot disagree, and
 * if a future provider ever split them, offering the sign-in is the better failure
 * than demanding credentials that are half-loaded.
 */
function oauthClientPresentFor(
  flow: ConnectableId,
  service: IntegrationService,
  readiness: IntegrationReadiness | undefined,
): boolean {
  const present = readiness?.oauthClientPresent;
  if (!present) return false;
  return (service.backing ?? []).some(
    (id) => connectableFor(id) === flow && present[id] === true,
  );
}

/** The connect flows behind this capability that *are* configured. */
function connectedFlows(
  service: IntegrationService,
  readiness: IntegrationReadiness | undefined,
): ConnectableId[] {
  if (!readiness || readiness.state !== 'loaded') return [];
  const seen = new Set<ConnectableId>();
  for (const id of service.backing ?? []) {
    if (readiness.configured[id] !== true) continue;
    const flow = connectableFor(id);
    if (flow) seen.add(flow);
  }
  return [...seen];
}

export function IntegrationConsentSheet({
  service,
  mode,
  grant,
  onConfirm,
  onDisconnect,
  onCancel,
  readiness,
  connectStatus,
  onConnectCredentials,
  onForgetCredentials,
}: IntegrationConsentSheetProps) {
  const spends = canSpend(service);
  const missing = onConnectCredentials ? missingConnectFlows(service, readiness) : [];
  const connected = onConnectCredentials ? connectedFlows(service, readiness) : [];
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

        {/* What the server is still missing, and the form to supply it. Rendered
            above the grant buttons because it is the blocking fact: allowing a
            capability whose provider has no credentials produces a row that says
            "Connected" and can do nothing. */}
        {missing.map((flow) => (
          <IntegrationCredentialsForm
            key={flow}
            id={flow}
            status={connectStatus ?? { phase: 'idle' }}
            clientPresent={oauthClientPresentFor(flow, service, readiness)}
            onSubmit={(fields) => onConnectCredentials?.(flow, fields)}
          />
        ))}

        {/* Already configured: no form, just the means to take it away again.
            Re-showing empty inputs for a working service invites someone to
            overwrite a good credential with a typo. */}
        {connected.map((flow) => (
          <IntegrationCredentialsForm
            key={flow}
            id={flow}
            alreadyConnected
            status={connectStatus ?? { phase: 'idle' }}
            onSubmit={(fields) => onConnectCredentials?.(flow, fields)}
            onDisconnect={() => onForgetCredentials?.(flow)}
          />
        ))}

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

        {/* The old note said flatly that no account is ever contacted and nothing
            is ordered. That was true of every capability when it was written and
            is now true only of the ones with no backing service, so it splits:
            a real integration does reach a provider, and what protects the user
            there is the confirm step, not the absence of a connection. */}
        <p style={noteStyle}>
          {(service.backing?.length ?? 0) > 0
            ? 'Your allowance is recorded in this browser. Credentials you supply stay on the server and are never shown back to you. Valentin still proposes every action and waits for you to press Confirm — nothing is booked or sent on his own authority.'
            : 'This capability is not built yet, so connecting it records your choice in this browser and contacts nobody.'}
        </p>
      </div>
    </div>
  );
}
