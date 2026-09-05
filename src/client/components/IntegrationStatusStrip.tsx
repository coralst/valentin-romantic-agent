import { INTEGRATION_CATALOGUE, type IntegrationService } from '../utils/integration-catalogue';
import { BrandMark } from '../design-system/brand-marks';
import {
  capabilityReadiness,
  type IntegrationReadiness,
} from '../hooks/use-integration-readiness';
import { colors, radii, typography } from '../design-system/tokens';

/**
 * Which services Valentin can reach, in the conversation header.
 *
 * The integrations panel already answers this, but it is on another screen, so the
 * question it answers — "can he actually book the table I am about to ask for?" —
 * was being asked at the wrong moment, after the ask. This is the same answer, on
 * the surface where the asking happens.
 *
 * **What the dot is derived from, and why it is only that.** The strip reads
 * `readiness.configured`, which is the server's own answer from
 * `GET /api/integrations`, and nothing else. Two things it deliberately does *not*
 * consult, both of which were in an earlier draft:
 *
 * - **The visitor's grants** (`use-integrations-store`). Those live in this
 *   browser's `localStorage` and are never sent anywhere; `buildToolRegistry` on
 *   the server gates the model's tool list on readiness alone. So a tile reading
 *   "you haven't allowed this yet" would be false — the tool is callable the
 *   moment credentials exist. The panel is welcome to show a grant as a grant;
 *   this strip must not dress one up as reach.
 * - **Any claim that a call would succeed.** `configured` means "credentials are
 *   present and the tool is registered", which is weaker than "this works right
 *   now": `ontopo` and `wolt` report `true` unconditionally, and a revoked Google
 *   refresh token keeps reporting `true` because `googleAccessToken()` returns
 *   `null` on `invalid_grant` without clearing the stored token. Only the browser
 *   transport is backed by a real probe. So every sentence here says *credentials
 *   are in place* and none says *working*, and {@link CAVEAT} puts that in the
 *   tooltip rather than leaving the dot to imply more than it knows.
 *
 * When readiness has not arrived — still loading, or the endpoint unreachable,
 * which includes an expired auth token since the route is scoped — every tile
 * reads "can't tell from here" rather than defaulting either way.
 * `capabilityReadiness` returns `unknown` for exactly that, and a hopeful default
 * is what would make this strip a liar the one time it matters.
 */

/** What one service's tile is saying. Each case is provable from the response. */
export type IntegrationStatusKind =
  /** The server holds credentials and the tool is registered. */
  | 'configured'
  /** It does not. The resting state of a fresh deployment. */
  | 'unconfigured'
  /** No backing service exists yet — nothing to configure. */
  | 'unbuilt'
  /** Readiness has not arrived. Never rendered as either good or bad news. */
  | 'unknown';

export interface IntegrationTileStatus {
  service: IntegrationService;
  kind: IntegrationStatusKind;
}

/**
 * The one sentence the strip appends to its tooltip.
 *
 * It exists because the honest gap between `configured` and *working* is invisible
 * in a coloured dot, and the visitor is the person who pays for that gap when a
 * booking fails. Cheaper here than in a failed turn.
 */
export const CAVEAT =
  'A filled dot means this deployment holds credentials. A call can still fail if they have been revoked.';

/**
 * Fold one service's backing into a tile state.
 *
 * Exported for its test: this function *is* the honesty guarantee, so it is
 * asserted directly rather than through a rendered tree.
 */
export function integrationStatus(
  service: IntegrationService,
  readiness: IntegrationReadiness,
): IntegrationStatusKind {
  switch (capabilityReadiness(service.backing, readiness)) {
    case 'aspirational':
      return 'unbuilt';
    case 'unknown':
      return 'unknown';
    // `partial` counts as configured: every current row has one backing service,
    // and where a row ever spans two, the half that has credentials still has
    // them. The panel names which one; a dot cannot.
    case 'ready':
    case 'partial':
      return 'configured';
    case 'unconfigured':
      return 'unconfigured';
  }
}

/** Configured first, so what he can reach survives the overflow cut. */
const ORDER: Record<IntegrationStatusKind, number> = {
  configured: 0,
  unconfigured: 1,
  unbuilt: 2,
  unknown: 3,
};

/**
 * How many tiles the header carries before the rest become a count.
 *
 * Six is what fits beside the partner's name and the share button at
 * `layout.chatColumnMinWidth` without the name having to ellipsise. The catalogue
 * is nine rows, so there is always an overflow chip to design for.
 */
export const MAX_TILES = 6;

/** What each state is willing to say out loud, on hover and to a screen reader. */
export function statusSentence(name: string, kind: IntegrationStatusKind): string {
  switch (kind) {
    case 'configured':
      return `${name} — credentials in place`;
    case 'unconfigured':
      return `${name} — needs credentials`;
    case 'unbuilt':
      return `${name} — not built yet`;
    case 'unknown':
      return `${name} — can't tell from here`;
  }
}

const stripStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: 0,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  flexShrink: 0,
};

/**
 * The tile. Same recipe as the panel's `brandTileStyle` — porcelain ground, and
 * the border rather than the fill carries state, because every mark brings its own
 * brand colour and a tinted tile behind Gmail's white envelope muddies both.
 */
function tileStyle(kind: IntegrationStatusKind): React.CSSProperties {
  const isConfigured = kind === 'configured';
  return {
    position: 'relative',
    width: 26,
    height: 26,
    flexShrink: 0,
    borderRadius: radii.kv,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: colors.porcelain,
    border: `1px solid ${isConfigured ? colors.claretLight : colors.linenShade}`,
    // Greyed rather than dropped: which services exist is stable information, and
    // a strip whose membership moved with every deploy would be unreadable.
    opacity: isConfigured ? 1 : 0.45,
    filter: isConfigured ? 'none' : 'grayscale(0.6)',
  };
}

/**
 * The corner dot: olive when configured, hollow when unknown, absent otherwise.
 *
 * `unknown` gets a hollow dot rather than none, because "no dot" is already how
 * this strip says *not configured* — an absent dot on an unknown service would
 * read as a confident negative.
 */
function dotStyle(hollow: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: hollow ? colors.porcelain : colors.olive,
    border: `${hollow ? 1.5 : 2}px solid ${hollow ? colors.inkFaint : colors.porcelain}`,
    boxSizing: 'border-box',
  };
}

const overflowStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  color: colors.inkMuted,
  backgroundColor: colors.sand,
  border: `1px solid ${colors.linenShade}`,
  borderRadius: radii.chip,
  padding: '3px 7px',
  flexShrink: 0,
};

interface IntegrationStatusStripProps {
  readiness: IntegrationReadiness;
  /** Raises the integrations panel. Absent ⇒ the strip is inert but still true. */
  onOpen?: () => void;
}

export function IntegrationStatusStrip({ readiness, onOpen }: IntegrationStatusStripProps) {
  const statuses: IntegrationTileStatus[] = INTEGRATION_CATALOGUE.map((service) => ({
    service,
    kind: integrationStatus(service, readiness),
  })).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

  const shown = statuses.slice(0, MAX_TILES);
  const hidden = statuses.slice(MAX_TILES);
  const configuredCount = statuses.filter((s) => s.kind === 'configured').length;

  /*
   * The label states only the count the strip can justify, and says something
   * different when it cannot: "0 configured" during a failed fetch would be a
   * fact the client does not have.
   */
  const summary =
    readiness.state === 'loaded'
      ? `${configuredCount} of ${statuses.length} have credentials`
      : 'status unavailable';

  return (
    <button
      type="button"
      style={stripStyle}
      onClick={onOpen}
      aria-label={`What Valentin can reach: ${summary}. Open the integrations panel.`}
      title={`${statuses
        .map(({ service, kind }) => statusSentence(service.name, kind))
        .join('\n')}\n\n${CAVEAT}`}
      data-testid="integration-status-strip"
      data-configured-count={configuredCount}
    >
      {shown.map(({ service, kind }) => (
        <span
          key={service.id}
          style={tileStyle(kind)}
          data-testid={`integration-status-${service.id}`}
          data-status={kind}
        >
          <BrandMark id={service.mark} size={17} />
          {kind === 'configured' ? <span style={dotStyle(false)} aria-hidden="true" /> : null}
          {kind === 'unknown' ? <span style={dotStyle(true)} aria-hidden="true" /> : null}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span style={overflowStyle} aria-hidden="true" data-testid="integration-status-overflow">
          +{hidden.length}
        </span>
      ) : null}
    </button>
  );
}
