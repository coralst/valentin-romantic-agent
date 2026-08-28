import {
  AWS_NODES,
  AWS_SEGMENTS,
  isNodeInEngine,
  isSegmentInEngine,
  type ArchitectureEngine,
  type AwsHop,
  type AwsNodeId,
} from '../utils/aws-architecture';
import {
  AGENTCORE_BOX,
  AWS_DIAGRAM_CANVAS,
  AWS_DIAGRAM_SCALE,
  AWS_ENGINE_BANDS,
  AWS_NODE_BOXES,
  AWS_NODE_CARD,
  AWS_NODE_VISUALS,
  AWS_TIER_LABELS,
  AWS_VPC_BOX,
  FLOW_COLORS,
  MARCHING_ANTS,
  WAF_CHIP_LABEL,
  awsSegmentGeometry,
} from '../utils/aws-diagram-layout';
import { prefersReducedMotion } from '../utils/motion-preference';
import { colors, typography } from '../design-system/tokens';

/**
 * The AWS topology, drawn.
 *
 * Deliberately free of hooks and data sources: everything it needs arrives as
 * props. That is what lets live mode and demo mode share one renderer — the two
 * differ only in where their steps come from, so a demo cannot drift into
 * drawing something live mode wouldn't.
 */

/** A duration pill pinned to a node. */
export interface NodeDuration {
  label: string;
  /** A successful write — green rather than claret. */
  ok?: boolean;
  /** False for a pill left over from an earlier step, which renders muted. */
  current?: boolean;
}

export interface AwsTopologyDiagramProps {
  /** The node the traffic is sitting in, if it is not currently in flight. */
  litNode?: AwsNodeId;
  /** True when the traffic is travelling back toward the browser. */
  litIsResponse?: boolean;
  /** Nodes already visited — a trail, rendered quietly. */
  doneNodes?: readonly AwsNodeId[];
  /**
   * The hop currently in flight, which colours and animates its connector.
   *
   * One hop, in practice. It stays a list because the type mirrors `routeBetween`'s
   * return, but a caller handing over a whole route would light the whole route at
   * once, which is the thing the leg-by-leg traversal exists to stop.
   */
  activeHops?: readonly AwsHop[];
  durations?: Readonly<Partial<Record<AwsNodeId, NodeDuration>>>;
  /**
   * Which engine is being shown. The other engine's resources stay on the canvas,
   * shaded — the comparison is the subject, so removing half of it would hide the
   * very thing the drawer is for.
   */
  engine?: ArchitectureEngine;
}

const KEYFRAMES_ID = 'aws-topology-marching-ants';

/**
 * Inject the marching-ants keyframes once.
 *
 * This codebase has no stylesheets — every style is an inline
 * `React.CSSProperties` object — so an animation has to arrive through a
 * `<style>` tag. Same pattern as `TypingIndicator.tsx`, which is the precedent.
 */
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;

  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes aws-ants-downstream { to { stroke-dashoffset: ${MARCHING_ANTS.downstreamOffset}; } }
    @keyframes aws-ants-upstream { to { stroke-dashoffset: ${MARCHING_ANTS.upstreamOffset}; } }
  `;
  document.head.appendChild(style);
}

/** How a node is currently rendered. Mirrors the mockup's card states. */
type NodeState = 'idle' | 'done' | 'lit' | 'response' | 'muted';

const NODE_STATE_STYLES: Record<NodeState, React.CSSProperties> = {
  // The other engine. Greyscaled rather than just faded, so a shaded Bedrock card
  // cannot be mistaken for an idle one at the back of a room — colour is the cue
  // that says "this half is not the one you are looking at".
  muted: {
    borderColor: '#E2DCD8',
    background: '#F4EFEC',
    opacity: 0.26,
    filter: 'grayscale(1)',
  },
  /*
   * On the selected engine, with nothing flowing through it yet.
   *
   * FULL OPACITY, and that is the fix for the thing this looked like: idle used to
   * be `opacity: 0.4` against muted's 0.34, so selecting an engine barely changed
   * anything — the whole diagram read as faded all the time, and the half you had
   * just asked for was as ghostly as the half you had not. A resource that exists
   * and is wired up is *there*; that it happens not to be carrying a request this
   * second is said by its border and background, which is what `done` and `lit`
   * also vary. Fade is reserved for the two things fade should mean here:
   * the other engine, and a resource this flow genuinely does not touch.
   */
  idle: { borderColor: '#E5D9D2', background: colors.surface },
  /*
   * Already visited: a trail the eye can follow back, deliberately the quietest
   * non-idle state there is. Border-only, no fill and no shadow, because by the end
   * of a flow eleven boxes are in this state at once and anything brighter competes
   * with the one box that is actually lit.
   */
  done: { borderColor: '#DFC4CB', background: colors.surface },
  lit: {
    borderColor: '#8C2F45',
    background: '#F6DEE2',
    boxShadow: '0 5px 16px rgba(140, 47, 69, 0.2)',
  },
  response: {
    borderColor: FLOW_COLORS.response,
    background: '#DFF5F0',
    boxShadow: '0 5px 16px rgba(14, 155, 132, 0.18)',
  },
};

/**
 * The extra fade for a node the model marks `dimmed` — S3, and only S3.
 *
 * This is what the old blanket `idle: { opacity: 0.4 }` was reaching for and got
 * wrong: `dimmed` is a property of one *node* (S3 serves the page load and takes
 * no part in a chat turn), not of the idle *state* that twelve others share.
 * Drawing it faint is more honest than omitting it, and it lets the room see why
 * it stays dark while everything around it lights up.
 *
 * Not greyscaled, because grey is already spoken for: grey means "the other
 * engine". S3 keeps its colour and merely recedes.
 */
const DIMMED_NODE_STYLE: React.CSSProperties = { opacity: 0.5 };

/**
 * The service tile's size.
 *
 * Down from 26px: the canvas now carries thirteen cards instead of seven, and the
 * icon is the part that can shrink without costing legibility — the resource name
 * underneath it is what a builder in the room actually reads.
 */
const ICON_SIZE = 21;

/**
 * Height of the strip at the foot of every card.
 *
 * Reserved on all thirteen whether or not they have anything to put in it, which
 * is the point: the WAF chip and the duration pill both live here, and a pill that
 * arrived mid-turn used to make its card taller than its neighbours — the grid
 * moved while someone was pointing at it.
 */
const CARD_FOOTER_HEIGHT = 16;

/**
 * The card itself, at exactly `AWS_NODE_CARD`.
 *
 * `boxSizing: 'border-box'` and `overflow: 'hidden'` are load-bearing rather than
 * defensive: the size is fixed, so the only two possible failures are a border
 * pushing the card 3px wider than its siblings, and content escaping the bottom
 * edge. Both were visible in the review screenshot.
 */
const cardStyle: React.CSSProperties = {
  background: colors.surface,
  border: '1.5px solid #E5D9D2',
  borderRadius: 10,
  boxSizing: 'border-box',
  width: AWS_NODE_CARD.width,
  height: AWS_NODE_CARD.height,
  overflow: 'hidden',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '7px 9px 6px',
  transition:
    'border-color 280ms cubic-bezier(0.4, 0, 0.2, 1), background 280ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 280ms cubic-bezier(0.4, 0, 0.2, 1), filter 280ms cubic-bezier(0.4, 0, 0.2, 1)',
  fontFamily: typography.bodyFontFamily,
};

/** One line, truncated with an ellipsis rather than allowed to wrap or spill. */
const oneLineStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * Up to two lines, then truncated.
 *
 * Two because 'Application Load Balancer' and 'Amazon ECS · AWS Fargate' do not
 * fit on one at this width, and shortening them would mean writing service names
 * AWS does not use.
 */
const twoLineStyle: React.CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
};

const tierLabelStyle: React.CSSProperties = {
  position: 'absolute',
  top: -16,
  fontSize: 8.5,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#A3959C',
};

function NodeCard({
  id,
  state,
  duration,
}: {
  id: AwsNodeId;
  state: NodeState;
  duration?: NodeDuration;
}) {
  const node = AWS_NODES.find((candidate) => candidate.id === id);
  if (!node) return null;

  const visual = AWS_NODE_VISUALS[id];
  const box = AWS_NODE_BOXES[id];

  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.top,
        width: AWS_NODE_CARD.width,
        height: AWS_NODE_CARD.height,
      }}
      data-testid={`aws-node-${id}`}
      data-state={state}
    >
      <div
        style={{
          ...cardStyle,
          ...NODE_STATE_STYLES[state],
          // Only while it is genuinely doing nothing: the moment a page-load flow
          // routes through S3 it lights like anything else, and a card that stayed
          // half-faded while carrying traffic would be reporting the wrong thing.
          ...(node.dimmed && state === 'idle' ? DIMMED_NODE_STYLE : null),
          // The two Fargate services are what sit inside the VPC; the dashed
          // border says so on the card as well as via the surrounding box.
          borderStyle: node.inVpc ? 'dashed' : 'solid',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            borderRadius: 6,
            flexShrink: 0,
            background: visual.tile,
          }}
          // The glyphs are our own constants, not user or network input.
          dangerouslySetInnerHTML={{
            __html: `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8">${visual.glyph}</svg>`,
          }}
        />
        {/* A column, so the footer can be pinned to the bottom of a card whose
            service name took one line as readily as one where it took two. */}
        <div
          style={{
            minWidth: 0,
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* `title` on all three rows: truncation is the guard, not the plan, and
              a caption that does get clipped should still be readable on hover. */}
          <div
            title={node.service}
            style={{
              ...twoLineStyle,
              fontSize: 11.5,
              fontWeight: 700,
              color: '#2A2226',
              lineHeight: 1.15,
            }}
          >
            {node.service}
          </div>
          <div
            title={node.resourceName}
            style={{
              ...oneLineStyle,
              fontSize: 10.5,
              fontWeight: 600,
              color: '#8C2F45',
              lineHeight: 1.3,
              marginTop: 2,
            }}
          >
            {node.resourceName}
          </div>
          <div
            title={node.caption}
            style={{
              ...oneLineStyle,
              fontSize: 9.5,
              color: '#A3959C',
              lineHeight: 1.4,
              marginTop: 2,
            }}
          >
            {node.caption}
          </div>

          {/* The reserved strip. `marginTop: auto` pins it to the bottom edge and
              `flexShrink: 0` keeps it there when the rows above are at their
              tallest — the two facts that make every card the same height. */}
          <div
            style={{
              marginTop: 'auto',
              flexShrink: 0,
              height: CARD_FOOTER_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            {id === 'cloudfront' && (
              <span
                style={{
                  ...oneLineStyle,
                  fontSize: 8.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#DD344C',
                  border: '1px solid #F3C0C6',
                  borderRadius: 3,
                  padding: '0 4px',
                  lineHeight: 1.5,
                }}
              >
                {WAF_CHIP_LABEL}
              </span>
            )}
            {duration && (
              <div
                data-testid={`aws-duration-${id}`}
                style={{
                  // In the footer rather than absolutely in the corner: over the
                  // top-right it lands on long service names ("Amazon ECS · AWS
                  // Fargate") and clips them.
                  flexShrink: 0,
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1.6,
                  background:
                    duration.current === false
                      ? '#C9A7B0'
                      : duration.ok
                        ? colors.success
                        : '#8C2F45',
                  color: colors.textOnAccent,
                  padding: '0 7px',
                  borderRadius: 20,
                }}
              >
                {duration.label}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AwsTopologyDiagram({
  litNode,
  litIsResponse = false,
  doneNodes = [],
  activeHops = [],
  durations = {},
  engine = 'valentin',
}: AwsTopologyDiagramProps) {
  ensureKeyframes();
  const reduceMotion = prefersReducedMotion();

  /** Direction of the active hop on a segment, if it is active at all. */
  const hopFor = (segmentId: string): AwsHop | undefined =>
    activeHops.find((hop) => hop.segment === segmentId);

  const stateFor = (id: AwsNodeId): NodeState => {
    // Checked first, and it wins: a stale `litNode` left over from the engine you
    // just switched away from must not keep a shaded card lit.
    if (!isNodeInEngine(id, engine)) return 'muted';
    if (id === litNode) return litIsResponse ? 'response' : 'lit';
    if (doneNodes.includes(id)) return 'done';
    return 'idle';
  };

  return (
    // The scale wrapper. Sized to the *scaled* box so the flex row beside the feed
    // reserves what is actually painted, not the logical canvas.
    <div
      style={{
        width: AWS_DIAGRAM_CANVAS.width * AWS_DIAGRAM_SCALE,
        height: AWS_DIAGRAM_CANVAS.height * AWS_DIAGRAM_SCALE,
        flexShrink: 0,
        marginTop: 14,
      }}
      data-testid="aws-topology-scale"
    >
      <div
        style={{
          position: 'relative',
          width: AWS_DIAGRAM_CANVAS.width,
          height: AWS_DIAGRAM_CANVAS.height,
          transform: `scale(${AWS_DIAGRAM_SCALE})`,
          transformOrigin: 'top left',
        }}
        data-testid="aws-topology-diagram"
        data-engine={engine}
        role="img"
        aria-label={
          engine === 'agentcore'
            ? 'AWS architecture, AgentCore engine: browser through CloudFront and the ALB to the proxy task, then AgentCore Runtime, Memory and Gateway'
            : 'AWS architecture, hand-built engine: browser through CloudFront, ALB and Fargate to Bedrock and DynamoDB'
        }
      >
        <svg
          width={AWS_DIAGRAM_CANVAS.width}
          height={AWS_DIAGRAM_CANVAS.height}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
          aria-hidden="true"
        >
          {AWS_SEGMENTS.map((segment) => {
            const geometry = awsSegmentGeometry(segment.id);
            const inEngine = isSegmentInEngine(segment, engine);
            // A connector on the other engine is never active, even if a stale hop
            // still names it: the shaded half must not animate behind the live one.
            const hop = inEngine ? hopFor(segment.id) : undefined;
            const active = hop !== undefined;
            const downstream = hop?.downstream === true;
            const stroke = active
              ? downstream
                ? FLOW_COLORS.request
                : FLOW_COLORS.response
              : FLOW_COLORS.idle;

            /** An arrowhead is drawn only when traffic is going that way. */
            const head = (points: string | undefined, forDownstream: boolean, key: string) => {
              if (!points) return null;
              const on = active && downstream === forDownstream;
              return (
                <polygon
                  key={key}
                  data-testid={`aws-head-${key}`}
                  data-active={on ? 'true' : 'false'}
                  points={points}
                  fill={on ? stroke : FLOW_COLORS.idle}
                  opacity={on ? 1 : 0}
                />
              );
            };

            return (
              <g key={segment.id} opacity={inEngine ? 1 : 0.3}>
                <path
                  data-testid={`aws-segment-${segment.id}`}
                  data-direction={active ? (downstream ? 'downstream' : 'upstream') : 'idle'}
                  data-engine-state={inEngine ? 'active-engine' : 'muted'}
                  d={geometry.path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={active ? 3.5 : 2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  // Not faded when idle. An idle connector is already drawn in
                  // `FLOW_COLORS.idle`, the same porcelain as a card's border, so
                  // the 0.45 that used to sit on top of that was a second fade over
                  // a colour that had already said "quiet" — and on the selected
                  // engine it left the wiring almost invisible. The `<g>` above
                  // still fades the other engine's links as a whole.
                  opacity={1}
                  strokeDasharray={active ? MARCHING_ANTS.dashArray : undefined}
                  style={
                    // Reduced motion drops the movement and keeps the colour: the
                    // objection is to things moving, not to knowing the direction.
                    active && !reduceMotion
                      ? {
                          animation: `aws-ants-${downstream ? 'downstream' : 'upstream'} ${MARCHING_ANTS.durationMs}ms linear infinite`,
                        }
                      : undefined
                  }
                />
                {head(geometry.downstreamHead, true, `${segment.id}-downstream`)}
                {head(geometry.upstreamHead, false, `${segment.id}-upstream`)}
                {head(geometry.midDownstreamHead, true, `${segment.id}-mid-downstream`)}
                {head(geometry.midUpstreamHead, false, `${segment.id}-mid-upstream`)}
              </g>
            );
          })}
        </svg>

        <div
          data-testid="aws-vpc-box"
          style={{
            position: 'absolute',
            left: AWS_VPC_BOX.left,
            top: AWS_VPC_BOX.top,
            width: AWS_VPC_BOX.width,
            height: AWS_VPC_BOX.height,
            border: '2px dashed #8C4FFF',
            borderRadius: 12,
            background: 'rgba(140, 79, 255, 0.045)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: -9,
              left: 12,
              background: '#FAF4F0',
              padding: '0 6px',
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#8C4FFF',
              whiteSpace: 'nowrap',
            }}
          >
            {AWS_VPC_BOX.label}
          </span>
        </div>

        <div
          data-testid="aws-agentcore-box"
          data-state={engine === 'agentcore' ? 'active-engine' : 'muted'}
          style={{
            position: 'absolute',
            left: AGENTCORE_BOX.left,
            top: AGENTCORE_BOX.top,
            width: AGENTCORE_BOX.width,
            height: AGENTCORE_BOX.height,
            border: '2px dashed #01A88D',
            borderRadius: 12,
            background: 'rgba(1, 168, 141, 0.05)',
            opacity: engine === 'agentcore' ? 1 : 0.28,
            filter: engine === 'agentcore' ? undefined : 'grayscale(1)',
            transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: -9,
              left: 12,
              background: '#FAF4F0',
              padding: '0 6px',
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#01A88D',
              whiteSpace: 'nowrap',
            }}
          >
            {AGENTCORE_BOX.label}
          </span>
        </div>

        {AWS_TIER_LABELS.map((tier) => (
          <div key={tier.label} style={{ ...tierLabelStyle, left: tier.x }}>
            {tier.label}
          </div>
        ))}

        {AWS_ENGINE_BANDS.map((band) => {
          const selected = band.engine === engine;
          return (
            <div
              key={band.engine}
              data-testid={`aws-engine-band-${band.engine}`}
              data-state={selected ? 'active-engine' : 'muted'}
              style={{
                position: 'absolute',
                left: band.x,
                top: band.top,
                width: band.width,
                fontFamily: typography.bodyFontFamily,
                opacity: selected ? 1 : 0.4,
                transition: 'opacity 280ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: selected ? '#8C2F45' : '#A3959C',
                }}
              >
                {band.label}
              </div>
              <div
                style={{
                  fontSize: 9,
                  // The env var, set in monospace because that is what it is.
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: '#A3959C',
                  marginTop: 2,
                }}
              >
                {band.sub}
              </div>
            </div>
          );
        })}

        {AWS_NODES.map((node) => {
          const state = stateFor(node.id);
          return (
            <NodeCard
              key={node.id}
              id={node.id}
              state={state}
              // A pill on a shaded card would be a latency reading for a turn that
              // isn't the one on screen.
              duration={state === 'muted' ? undefined : durations[node.id]}
            />
          );
        })}
      </div>
    </div>
  );
}
