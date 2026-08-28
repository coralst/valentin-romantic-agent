import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { colors, insets, layout, radii, typography, animation } from '../design-system/tokens';
import { MOBILE_STRIP_HEIGHT } from './AppWindow';
import { REOPEN_BAR_HEIGHT } from './LiveArchitectureDrawer';
import { INTEGRATION_CATALOGUE, type IntegrationService } from '../utils/integration-catalogue';
import { useIntegrations } from '../context/integrations-context';
import { IntegrationConsentSheet } from './IntegrationConsentSheet';

/**
 * "What Valentin can reach": the agent at the hub, every capability fanning out
 * around it, connected edges lit and the rest dotted.
 *
 * The picture is the argument. A list of switches would carry the same state, but
 * the thing worth showing is that these are *his* reach — one agent, many hands —
 * and a hub-and-spoke drawing says that in one glance where a settings list says
 * only "seven rows".
 *
 * On mobile the fan collapses to cards. A 375px canvas cannot hold a hub, eight
 * labelled nodes and their edges without becoming illegible, and an illegible
 * diagram is worse than the list it replaced.
 */

interface IntegrationsPanelProps {
  isMobile: boolean;
  onClose: () => void;
}

/** What the visitor is currently being asked to grant, if anything. */
interface PendingGrant {
  service: IntegrationService;
  mode: 'connect' | 'manage';
}

/**
 * Canvas geometry, in px.
 *
 * `FALLBACK_*` are used until the ResizeObserver reports real numbers — and for
 * the whole of a jsdom test run, where nothing is ever laid out. Without them
 * every node would sit at 0,0 and the tests would be asserting against a pile.
 */
const FALLBACK_WIDTH = 860;
const FALLBACK_HEIGHT = 560;
const HUB_SIZE = 118;
const NODE_WIDTH = 190;
/** Breathing room above the first node and below the last. */
const CANVAS_PADDING = 40;
/** How far the middle of the column bows away from the hub. */
const COLUMN_BULGE = 56;

function panelStyle(isMobile: boolean): React.CSSProperties {
  return {
    /*
     * Everything but the rail: the rail stays live behind — or above, on mobile —
     * so pressing the same button again closes the panel, which is the one
     * interaction a full-window overlay would break.
     *
     * Absolute rather than a grid item spanning tracks 2–4. The grid version
     * reads more honestly and is wrong: an explicitly placed item makes grid
     * auto-placement skip the cells it claims, so the conversation list and the
     * mobile content region got bumped into an implicit row below the window and
     * the panel collapsed to its content height. `AppWindow`'s frame is the
     * positioning context.
     */
    position: 'absolute',
    top: isMobile ? MOBILE_STRIP_HEIGHT : 0,
    left: isMobile ? 0 : layout.iconRailWidth,
    right: 0,
    bottom: 0,
    zIndex: 5,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: colors.porcelain,
    animation: `integration-panel-in ${animation.durations.normal}ms ${animation.easing.easeOut}`,
  };
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: insets.tight,
  padding: `${insets.snug}px ${insets.roomy}px ${insets.tight}px`,
  flexShrink: 0,
};

const headingStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingXl,
  color: colors.claret,
  margin: '0 0 3px',
};

const subheadingStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  color: colors.inkMuted,
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: radii.pill,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  color: colors.inkMuted,
  cursor: 'pointer',
  fontSize: typography.px.control,
  lineHeight: 1,
};

const canvasStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const hubStyle: React.CSSProperties = {
  position: 'absolute',
  width: HUB_SIZE,
  height: HUB_SIZE,
  borderRadius: radii.pill,
  background: `linear-gradient(135deg, ${colors.claret} 0%, ${colors.claretLight} 100%)`,
  color: colors.onClaret,
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  boxShadow: '0 14px 34px rgba(140, 47, 69, 0.34)',
  zIndex: 2,
};

const hubNameStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingSm,
  display: 'block',
};

function nodeStyle(isConnected: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    width: NODE_WIDTH,
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    padding: '9px 12px',
    borderRadius: radii.kv,
    border: `1px solid ${isConnected ? colors.claretLight : colors.linenShade}`,
    backgroundColor: colors.porcelain,
    boxShadow: isConnected
      ? '0 6px 18px rgba(140, 47, 69, 0.16)'
      : '0 3px 10px rgba(42, 34, 38, 0.06)',
    cursor: 'pointer',
    zIndex: 2,
    transition: `box-shadow ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  };
}

function glyphStyle(isConnected: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    flexShrink: 0,
    borderRadius: radii.kv,
    display: 'grid',
    placeItems: 'center',
    fontSize: typography.px.bodyLarge,
    backgroundColor: isConnected ? colors.petal : colors.sand,
  };
}

const nodeNameStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.semibold,
  color: colors.ink,
  display: 'block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function nodeStateStyle(isConnected: boolean): React.CSSProperties {
  return {
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.caption,
    fontWeight: isConnected ? typography.weights.semibold : typography.weights.normal,
    color: isConnected ? colors.olive : colors.inkFaint,
    whiteSpace: 'nowrap',
  };
}

/**
 * `paddingBottom` clears the architecture drawer's reopen bar, which is pinned to
 * the foot of the window and would otherwise sit on top of the footer's last line.
 * The amount comes from the drawer's own constant so the two cannot drift.
 */
function footerStyle(isMobile: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    borderTop: `1px solid ${colors.linenShade}`,
    boxSizing: 'border-box',
    padding: `${insets.tight}px ${isMobile ? insets.snug : insets.roomy}px`,
    paddingBottom: insets.tight + REOPEN_BAR_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: insets.tight,
    flexWrap: 'wrap',
  };
}

const pillStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkMuted,
  backgroundColor: colors.sand,
  border: `1px solid ${colors.linenShade}`,
  borderRadius: radii.pill,
  padding: '4px 11px',
};

const footerNoteStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkFaint,
  lineHeight: typography.lineHeights.normal,
  flex: 1,
  minWidth: 220,
};

const errorStripStyle: React.CSSProperties = {
  margin: `0 ${insets.roomy}px ${insets.tight}px`,
  padding: `8px ${insets.tight}px`,
  borderRadius: radii.chip,
  backgroundColor: colors.petal,
  color: colors.claret,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
};

/* ---------------------------------- mobile --------------------------------- */

const listStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  listStyle: 'none',
  margin: 0,
  padding: `0 ${insets.snug}px ${insets.snug}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

function cardStyle(isConnected: boolean): React.CSSProperties {
  return {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    padding: insets.tight,
    borderRadius: radii.chip,
    border: `1px solid ${isConnected ? colors.claretLight : colors.linenShade}`,
    backgroundColor: colors.porcelain,
    cursor: 'pointer',
  };
}

const cardBlurbStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkMuted,
  lineHeight: typography.lineHeights.normal,
};

/**
 * Where a node sits, and the curve that reaches it.
 *
 * One evenly spaced column, bowed out in the middle. Even spacing is what keeps
 * the cards from colliding at any catalogue size — the first draft placed them on
 * an ellipse, which reads beautifully at five services and overlaps at eight.
 */
function nodeLayout(index: number, count: number, width: number, height: number) {
  const hubX = Math.max(width * 0.24, HUB_SIZE / 2 + insets.roomy);
  const hubY = height / 2;

  const gap = count > 1 ? (height - CANVAS_PADDING * 2) / (count - 1) : 0;
  const t = count > 1 ? (index / (count - 1)) * 2 - 1 : 0;
  const columnX = Math.min(hubX + 300, width - NODE_WIDTH / 2 - insets.tight);
  const x = columnX + (1 - Math.abs(t)) * COLUMN_BULGE;
  const y = CANVAS_PADDING + index * gap;

  const startX = hubX + HUB_SIZE / 2;
  const endX = x - NODE_WIDTH / 2;
  const edge = `M ${startX} ${hubY} C ${startX + 130} ${hubY}, ${endX - 110} ${y}, ${endX} ${y}`;

  return { hubX, hubY, x, y, edge };
}

export function IntegrationsPanel({ isMobile, onClose }: IntegrationsPanelProps) {
  const { state, connectedCount, isConnected, connect, disconnect, setCap, dismissStorageError } =
    useIntegrations();
  const [pending, setPending] = useState<PendingGrant | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT });

  const measure = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    // Zero means "not laid out yet" (or jsdom), and laying the fan out against
    // zero would stack every node on the hub. Keep the fallback in that case.
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    }
  }, []);

  useLayoutEffect(() => {
    if (isMobile) return;
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [isMobile, measure]);

  // Escape closes the panel. The consent sheet installs its own capturing
  // handler, so while the sheet is up this one never sees the key.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const open = (service: IntegrationService) => {
    setPending({ service, mode: isConnected(service.id) ? 'manage' : 'connect' });
  };

  const confirm = (capUsd: number | null) => {
    if (!pending) return;
    const { service, mode } = pending;
    if (mode === 'connect') connect(service.id, capUsd);
    else if (capUsd !== null) setCap(service.id, capUsd);
    setPending(null);
  };

  const total = INTEGRATION_CATALOGUE.length;
  const { hubX, hubY } = nodeLayout(0, total, size.width, size.height);

  return (
    <section
      style={panelStyle(isMobile)}
      role="dialog"
      aria-label="Integrations"
      data-testid="integrations-panel"
    >
      <header style={headerStyle}>
        <div>
          <h2 style={headingStyle}>What Valentin can reach</h2>
          <p style={subheadingStyle}>
            Connect a service and he can act on it — inside limits you set, and never
            without telling you.
          </p>
        </div>
        <button
          type="button"
          style={closeButtonStyle}
          onClick={onClose}
          aria-label="Close integrations"
          data-testid="integrations-close-button"
        >
          &times;
        </button>
      </header>

      {state.storageError && (
        <div style={errorStripStyle} role="status" data-testid="integrations-storage-error">
          Your choices could not be saved in this browser, so they will not survive a
          reload. ({state.storageError}){' '}
          <button
            type="button"
            onClick={dismissStorageError}
            style={{ color: colors.claret, textDecoration: 'underline' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {isMobile ? (
        <ul style={listStyle} data-testid="integrations-list">
          {INTEGRATION_CATALOGUE.map((service) => {
            const connected = isConnected(service.id);
            return (
              <li key={service.id}>
                <button
                  type="button"
                  style={cardStyle(connected)}
                  onClick={() => open(service)}
                  data-testid={`integration-card-${service.id}`}
                  aria-label={`${service.name}, ${connected ? 'connected' : 'not connected'}`}
                >
                  <span style={glyphStyle(connected)} aria-hidden="true">
                    {service.glyph}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={nodeNameStyle}>{service.name}</span>
                    <span style={cardBlurbStyle}>{service.blurb}</span>
                    <br />
                    <span style={nodeStateStyle(connected)}>
                      {connected ? 'Connected' : `Not connected · ${service.category}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div style={canvasStyle} ref={canvasRef} data-testid="integrations-canvas">
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            aria-hidden="true"
          >
            {INTEGRATION_CATALOGUE.map((service, index) => {
              const connected = isConnected(service.id);
              const { edge } = nodeLayout(index, total, size.width, size.height);
              return (
                <path
                  key={service.id}
                  d={edge}
                  fill="none"
                  stroke={connected ? colors.claretLight : colors.linenShade}
                  strokeWidth={connected ? 2.4 : 1.6}
                  strokeDasharray={connected ? '7 9' : '4 5'}
                  // Only a live connection flows; a dotted edge that also crawls
                  // would say "in progress", which is not what "available" means.
                  style={
                    connected
                      ? { animation: 'integration-edge-flow 1.1s linear infinite' }
                      : undefined
                  }
                  data-testid={`integration-edge-${service.id}`}
                  data-connected={connected}
                />
              );
            })}
          </svg>

          <div
            style={{ ...hubStyle, left: hubX - HUB_SIZE / 2, top: hubY - HUB_SIZE / 2 }}
            data-testid="integrations-hub"
          >
            {/* Just his name. The eyebrow used to read "agent core", which named
                a piece of AWS infrastructure this build does not use and told the
                visitor nothing about what the circle is. */}
            <span style={hubNameStyle}>Valentin</span>
          </div>

          {INTEGRATION_CATALOGUE.map((service, index) => {
            const connected = isConnected(service.id);
            const { x, y } = nodeLayout(index, total, size.width, size.height);
            return (
              <button
                key={service.id}
                type="button"
                style={{ ...nodeStyle(connected), left: x, top: y }}
                onClick={() => open(service)}
                data-testid={`integration-node-${service.id}`}
                data-connected={connected}
                aria-label={`${service.name}, ${connected ? 'connected' : 'not connected'}`}
              >
                <span style={glyphStyle(connected)} aria-hidden="true">
                  {service.glyph}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={nodeNameStyle}>{service.name}</span>
                  <span style={nodeStateStyle(connected)}>
                    {connected
                      ? state.grants[service.id]?.capUsd
                        ? `Connected · up to $${state.grants[service.id]?.capUsd}`
                        : 'Connected'
                      : service.category}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    marginLeft: 'auto',
                    color: connected ? colors.olive : colors.claretLight,
                    fontSize: typography.px.bodyLarge,
                  }}
                >
                  {connected ? '✓' : '+'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <footer style={footerStyle(isMobile)}>
        <span style={pillStyle} data-testid="integrations-connected-count">
          {connectedCount} connected
        </span>
        <span style={pillStyle}>{total - connectedCount} available</span>
        {/* The short form on mobile: the same admission, in the one line a
            390px footer has room for without pushing the pills off screen. */}
        <span style={footerNoteStyle}>
          {isMobile
            ? 'Recorded in this browser only — no provider is contacted, and nothing is ordered.'
            : 'Every connection is a tool the agent may call, and the Live Architecture view traces the same list. Grants are recorded in this browser only — no provider is contacted, and nothing is ordered.'}
        </span>
      </footer>

      {pending && (
        <IntegrationConsentSheet
          service={pending.service}
          mode={pending.mode}
          grant={state.grants[pending.service.id]}
          onConfirm={confirm}
          onDisconnect={
            pending.mode === 'manage'
              ? () => {
                  disconnect(pending.service.id);
                  setPending(null);
                }
              : undefined
          }
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}
