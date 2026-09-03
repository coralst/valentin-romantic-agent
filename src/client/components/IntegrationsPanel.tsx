import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { colors, insets, layout, radii, typography, animation } from '../design-system/tokens';
import { MOBILE_STRIP_HEIGHT } from './AppWindow';
import { reservedDrawerSpace } from './LiveArchitectureDrawer';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { INTEGRATION_CATALOGUE, type IntegrationService } from '../utils/integration-catalogue';
import { BrandMark, brandTileStyle } from '../design-system/brand-marks';
import { useIntegrations } from '../context/integrations-context';
import {
  capabilityReadiness,
  liveServices,
  useIntegrationReadiness,
  type CapabilityReadiness,
  type IntegrationReadiness,
} from '../hooks/use-integration-readiness';
import { INTEGRATION_LABELS } from '../../shared/interfaces/integrations';
import { IntegrationConsentSheet } from './IntegrationConsentSheet';
import { useIntegrationConnect } from '../hooks/use-integration-connect';

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
 *
 * Each node is one *provider* — Gmail, Wolt, Amadeus — rather than one capability,
 * and carries that provider's mark. See the header of
 * `utils/integration-catalogue.ts` for why that swap was worth making and what it
 * cost.
 *
 * Each node now also carries what the *server* says about it, fetched once from
 * `GET /api/integrations`. Half this catalogue is now real code against a real
 * provider and half is still a drawing, and the visitor cannot tell those apart by
 * looking. So the badge says which: "live", "live via Gmail", "needs credentials",
 * "not built yet". A grant the visitor gave and a credential the deployment has are
 * two different facts, and the panel's whole job is to not conflate them.
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
/**
 * The least vertical distance between two card centres.
 *
 * A card is about 52px tall, so anything under this overlaps its neighbour. The
 * spacing used to be purely proportional — `(height - padding*2) / (count - 1)` —
 * which is correct only while the canvas is tall enough for the catalogue. Once the
 * panel started ending above the architecture drawer instead of behind it, the canvas
 * lost ~200px and nine cards stacked on top of each other. Below this the column
 * keeps its spacing and the canvas scrolls instead.
 */
const MIN_NODE_GAP = 62;
/**
 * How far across the canvas the card column sits, as a fraction of its width.
 *
 * `hubX` is `width * 0.24`, so putting the column at `width * 0.42` keeps roughly
 * the same proportion between the hub, the spoke and the trailing margin at every
 * size — which a fixed 300px spoke did not: it left 40% of a 1440px panel empty.
 */
const SPOKE_LENGTH_RATIO = 0.42;
/** Below this the ratio would fold the cards back onto the hub. */
const SPOKE_MIN_LENGTH = 260;

function panelStyle(isMobile: boolean, bottomInset: number): React.CSSProperties {
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
    /*
     * Stops where the architecture drawer starts.
     *
     * This was `bottom: 0`, and an absolutely positioned element resolves against
     * its ancestor's *padding box* — so `0` was the outer bottom edge of the window
     * frame, underneath the drawer rather than above it. With the drawer open the
     * fan's lower cards were simply behind it: "Travel" and "Occasions" were cut
     * off mid-row with no scrollbar and no way to reach them.
     *
     * The frame's own `paddingBottom` cannot help here, for the same reason: the
     * padding is inside the containing block this offset is measured from.
     */
    bottom: bottomInset,
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
  // Scrolls vertically rather than clipping. The fan keeps `MIN_NODE_GAP` between
  // cards, so on a panel too short for the whole catalogue the column is taller than
  // the viewport — the alternative, which shipped briefly, was nine cards overlapping.
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** Holds the fan at its full height, so the canvas above has something to scroll. */
const fanStyle = (contentHeight: number): React.CSSProperties => ({
  position: 'relative',
  height: contentHeight,
});

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

/** The footer sits at the foot of the panel, which is itself above the drawer. */
function footerStyle(isMobile: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    borderTop: `1px solid ${colors.linenShade}`,
    boxSizing: 'border-box',
    padding: `${insets.tight}px ${isMobile ? insets.snug : insets.roomy}px`,
    // No drawer allowance any more: the panel itself now ends above the drawer, so
    // adding the bar's height here would leave a second, empty gap below the footer.
    paddingBottom: insets.tight,
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
 * What the server's readiness answer means for one capability, in words.
 *
 * Four phrases, because there are genuinely four situations and flattening them
 * loses the one a visitor most needs: "not built yet" and "needs credentials" look
 * identical on screen and are completely different claims. `unknown` returns null
 * rather than a hedge — no badge at all is quieter than a badge saying nothing, and
 * this is the state that exists only for the moment before the fetch lands.
 *
 * `partial` names the service that does work — "live via Gmail" for a row backed by
 * a configured Gmail and an unconfigured WhatsApp. No row reaches it today, because
 * every row now has exactly one backing service; it is kept because the readiness
 * fold it renders still returns the state, and a row spanning two providers is a
 * catalogue edit rather than a code change away.
 *
 * `aspirational` is in the same position since Spotify landed: nothing in the
 * catalogue is unbacked, so no row can reach it through the panel. Exported for that
 * reason — these two branches are the ones a visitor is most damaged by if they go
 * wrong, and with no row exercising them the only honest place left to test them is
 * directly.
 */
export function readinessLabel(
  reach: CapabilityReadiness,
  service: IntegrationService,
  readiness: IntegrationReadiness,
): string | null {
  switch (reach) {
    case 'ready':
      return 'live';
    case 'partial':
      return `live via ${liveServices(service.backing, readiness)
        .map((id) => INTEGRATION_LABELS[id])
        .join(' & ')}`;
    case 'unconfigured':
      return 'needs credentials';
    case 'aspirational':
      return 'not built yet';
    default:
      return null;
  }
}

function badgeStyle(reach: CapabilityReadiness): React.CSSProperties {
  return {
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.caption,
    // Only a genuinely live capability gets the confident colour. "Needs
    // credentials" is a real state and not an error, so it stays quiet rather than
    // red — nothing is broken, something is simply absent.
    color: reach === 'ready' || reach === 'partial' ? colors.olive : colors.inkFaint,
    whiteSpace: 'nowrap',
  };
}

/**
 * What a row's state line says.
 *
 * A grant and a credential are different things — the header comment on this file
 * says so — and this line used to report only the first: any service the visitor had
 * ever pressed Connect on read "Connected", including one whose credentials the
 * deployment has never had. So a card read "Connected" on one line and "needs
 * credentials" on the next, and a grant left in `localStorage` by a previous session
 * claimed a live connection to a service this deployment cannot reach at all.
 *
 * "Connected" is now reserved for the case where both are true. Otherwise the line
 * says "Allowed", which is exactly what a grant is.
 *
 * It deliberately does *not* say why reach is missing: the readiness badge sits
 * directly beneath it already saying "needs credentials" or "not built yet", and an
 * earlier version of this that spelled the reason out here produced rows reading
 * "Allowed · not built yet" above a badge reading "not built yet".
 *
 * The cap comes along in both cases, because it is the visitor's own setting and they
 * should see it read back whatever the deployment can currently do with it.
 */
export function connectionLabel(
  connected: boolean,
  reach: CapabilityReadiness,
  capUsd?: number | null,
): string {
  if (!connected) return 'Not connected';
  const cap = capUsd ? ` · up to $${capUsd}` : '';
  // "Connected" only when the deployment can actually reach it. Otherwise the row
  // reports the grant, and the readiness badge beside it reports the reason — which
  // is also why the reason is not repeated here.
  return reach === 'ready' ? `Connected${cap}` : `Allowed${cap}`;
}

/**
 * Where a node sits, and the curve that reaches it.
 *
 * One evenly spaced column, bowed out in the middle. Even spacing is what keeps
 * the cards from colliding at any catalogue size — the first draft placed them on
 * an ellipse, which reads beautifully at five services and overlaps at eight.
 */
/**
 * How tall the fan needs to be for `count` cards, at minimum spacing.
 *
 * The canvas scrolls to this when the panel is shorter — see `MIN_NODE_GAP`.
 */
export function fanContentHeight(count: number, height: number): number {
  if (count <= 1) return height;
  const gap = Math.max(MIN_NODE_GAP, (height - CANVAS_PADDING * 2) / (count - 1));
  return Math.max(height, CANVAS_PADDING * 2 + gap * (count - 1));
}

export function nodeLayout(index: number, count: number, width: number, height: number) {
  const hubX = Math.max(width * 0.24, HUB_SIZE / 2 + insets.roomy);
  const hubY = height / 2;

  const gap =
    count > 1 ? Math.max(MIN_NODE_GAP, (height - CANVAS_PADDING * 2) / (count - 1)) : 0;
  const t = count > 1 ? (index / (count - 1)) * 2 - 1 : 0;
  /*
   * The spoke scales with the canvas instead of being a flat 300px.
   *
   * `hubX` is proportional to the width but the column was not, so past roughly
   * 1100px of canvas the `Math.min` clamp stopped binding and the cards simply
   * stopped moving: on a 1440px window the whole fan ended at x≈862 and the right
   * ~40% of the panel was empty. Placing the column a fixed fraction of the way
   * across keeps the composition centred at any width, and the clamp still protects
   * a narrow window by pulling the column back off the right edge.
   */
  const columnX = Math.min(
    hubX + Math.max(SPOKE_MIN_LENGTH, width * SPOKE_LENGTH_RATIO),
    width - NODE_WIDTH / 2 - insets.tight,
  );
  const x = columnX + (1 - Math.abs(t)) * COLUMN_BULGE;
  const y = CANVAS_PADDING + index * gap;

  const startX = hubX + HUB_SIZE / 2;
  const endX = x - NODE_WIDTH / 2;
  const edge = `M ${startX} ${hubY} C ${startX + 130} ${hubY}, ${endX - 110} ${y}, ${endX} ${y}`;

  return { hubX, hubY, x, y, edge };
}

export function IntegrationsPanel({ isMobile, onClose }: IntegrationsPanelProps) {
  // The same reservation the window frame makes, so the panel and the drawer agree
  // on where one ends and the other begins.
  const { isOpen: isDrawerOpen, height: drawerHeight } = useArchitectureDrawer();
  const drawerInset = reservedDrawerSpace(isDrawerOpen, drawerHeight);

  const { state, connectedCount, isConnected, connect, disconnect, setCap, dismissStorageError } =
    useIntegrations();
  const readiness = useIntegrationReadiness();
  const [pending, setPending] = useState<PendingGrant | null>(null);
  // `readiness.refresh` is stable (a useCallback over a setState), so this does
  // not re-subscribe on every render.
  const credentials = useIntegrationConnect(readiness.refresh);

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
    // Clear any status left from the last capability's attempt: an error about
    // WhatsApp has no business appearing when someone opens Travel.
    credentials.reset();
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
  /*
   * Geometry is measured against the *content* height, not the visible one, so the
   * hub stays centred in the fan it belongs to and the spacing stays legible when the
   * canvas is scrolling.
   */
  const fanHeight = fanContentHeight(total, size.height);
  const { hubX, hubY } = nodeLayout(0, total, size.width, fanHeight);

  return (
    <section
      style={panelStyle(isMobile, drawerInset)}
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
            const reach = capabilityReadiness(service.backing, readiness);
            const badge = readinessLabel(reach, service, readiness);
            return (
              <li key={service.id}>
                <button
                  type="button"
                  style={cardStyle(connected)}
                  onClick={() => open(service)}
                  data-testid={`integration-card-${service.id}`}
                  data-reach={reach}
                  aria-label={`${service.name}, ${connectionLabel(
                    connected,
                    reach,
                    state.grants[service.id]?.capUsd,
                  ).toLowerCase()}`}
                >
                  <span style={brandTileStyle(connected)} aria-hidden="true">
                    <BrandMark id={service.mark} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={nodeNameStyle}>{service.name}</span>
                    <span style={cardBlurbStyle}>{service.blurb}</span>
                    <br />
                    <span style={nodeStateStyle(connected)}>
                      {connected
                        ? connectionLabel(connected, reach, state.grants[service.id]?.capUsd)
                        : `Not connected · ${service.capability}`}
                    </span>
                    {badge && (
                      <>
                        {' · '}
                        <span
                          style={badgeStyle(reach)}
                          data-testid={`integration-readiness-${service.id}`}
                          data-readiness={reach}
                        >
                          {badge}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div style={canvasStyle} ref={canvasRef} data-testid="integrations-canvas">
          <div style={fanStyle(fanHeight)} data-testid="integrations-fan">
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            aria-hidden="true"
          >
            {INTEGRATION_CATALOGUE.map((service, index) => {
              const connected = isConnected(service.id);
              const { edge } = nodeLayout(index, total, size.width, fanHeight);
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
            const reach = capabilityReadiness(service.backing, readiness);
            const badge = readinessLabel(reach, service, readiness);
            const { x, y } = nodeLayout(index, total, size.width, fanHeight);
            return (
              <button
                key={service.id}
                type="button"
                style={{ ...nodeStyle(connected), left: x, top: y }}
                onClick={() => open(service)}
                data-testid={`integration-node-${service.id}`}
                data-connected={connected}
                data-reach={reach}
                aria-label={`${service.name}, ${connectionLabel(
                  connected,
                  reach,
                  state.grants[service.id]?.capUsd,
                ).toLowerCase()}`}
              >
                <span style={brandTileStyle(connected)} aria-hidden="true">
                  <BrandMark id={service.mark} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={nodeNameStyle}>{service.name}</span>
                  <span style={nodeStateStyle(connected)}>
                    {connected
                      ? connectionLabel(connected, reach, state.grants[service.id]?.capUsd)
                      : service.capability}
                  </span>
                  {badge && (
                    <span
                      style={{ ...badgeStyle(reach), display: 'block' }}
                      data-testid={`integration-readiness-${service.id}`}
                      data-readiness={reach}
                    >
                      {badge}
                    </span>
                  )}
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
        </div>
      )}

      <footer style={footerStyle(isMobile)}>
        <span style={pillStyle} data-testid="integrations-connected-count">
          {connectedCount} connected
        </span>
        <span style={pillStyle}>{total - connectedCount} available</span>
        {/* The short form on mobile: the same admission, in the one line a
            390px footer has room for without pushing the pills off screen. */}
        {/* There are THREE states here, not two, and collapsing the middle one is
            what made this note wrong. "live" is built and credentialled; "needs
            credentials" is built and waiting for a key — connecting one posts real
            credentials to this server, which then really does reach the provider;
            "not built yet" is the only row where a grant is just a note to self.
            The note used to say the whole non-live remainder "contacts nobody",
            which was a promise it could not keep for Calendar, Travel or Messages
            — printed directly above a form that asks for Google's OAuth secret. */}
        <span style={footerNoteStyle}>
          {isMobile
            ? 'Anything marked live or credentialled reaches a real provider — and still asks you to confirm before it acts.'
            : 'A capability marked live is real code against a real provider, and the Live Architecture view traces the same calls. "Needs credentials" is the same real code waiting for a key — supply one and it reaches the provider too. Nothing is ever booked or sent unattended: Valentin proposes, and you press Confirm. Only the rows marked not built yet contact nobody at all; connecting one records a grant in this browser and nothing more.'}
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
          readiness={readiness}
          connectStatus={credentials.status}
          onConnectCredentials={(id, fields) => {
            void credentials.connect(id, fields);
          }}
          onForgetCredentials={(id) => {
            void credentials.disconnect(id);
          }}
        />
      )}
    </section>
  );
}
