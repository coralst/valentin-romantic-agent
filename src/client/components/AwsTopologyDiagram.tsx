import { AWS_NODES, AWS_SEGMENTS, type AwsHop, type AwsNodeId } from '../utils/aws-architecture';
import {
  AWS_DIAGRAM_CANVAS,
  AWS_NODE_BOXES,
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
  /** The node the current step lands on. */
  litNode?: AwsNodeId;
  /** True when the current step arrived travelling back toward the browser. */
  litIsResponse?: boolean;
  /** Nodes the current traffic transits without stopping. */
  passNodes?: readonly AwsNodeId[];
  /** Nodes an earlier step already lit. */
  doneNodes?: readonly AwsNodeId[];
  /** The current step's hops, which colour and animate their connectors. */
  activeHops?: readonly AwsHop[];
  durations?: Readonly<Partial<Record<AwsNodeId, NodeDuration>>>;
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
type NodeState = 'idle' | 'done' | 'pass' | 'lit' | 'response';

const NODE_STATE_STYLES: Record<NodeState, React.CSSProperties> = {
  // S3 is `dimmed` in the model and idles here: drawing it faint is more honest
  // than omitting it, and it lets the room see *why* it stays dark.
  idle: { borderColor: '#E5D9D2', background: colors.surface, opacity: 0.4 },
  done: { borderColor: '#DFC4CB', background: '#FEF7F8' },
  pass: { borderColor: '#9FD9CE', background: '#F1FBF8' },
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

const cardStyle: React.CSSProperties = {
  background: colors.surface,
  border: '1.5px solid #E5D9D2',
  borderRadius: 11,
  display: 'flex',
  gap: 9,
  alignItems: 'flex-start',
  padding: '9px 10px',
  transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
  fontFamily: typography.bodyFontFamily,
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
      style={{ position: 'absolute', left: box.x, top: box.top, width: box.width }}
      data-testid={`aws-node-${id}`}
      data-state={state}
    >
      <div
        style={{
          ...cardStyle,
          ...NODE_STATE_STYLES[state],
          // Fargate is the only resource inside the VPC; the dashed border says so
          // on the card as well as via the surrounding box.
          borderStyle: node.inVpc ? 'dashed' : 'solid',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            flexShrink: 0,
            background: visual.tile,
          }}
          // The glyphs are our own constants, not user or network input.
          dangerouslySetInnerHTML={{
            __html: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7">${visual.glyph}</svg>`,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#2A2226', lineHeight: 1.25 }}>
            {node.service}
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: '#8C2F45',
              lineHeight: 1.3,
              marginTop: 2,
              overflowWrap: 'break-word',
            }}
          >
            {node.resourceName}
          </div>
          <div style={{ fontSize: 9.5, color: '#A3959C', lineHeight: 1.4, marginTop: 2 }}>
            {node.caption}
          </div>
          {id === 'cloudfront' && (
            <span
              style={{
                display: 'inline-block',
                fontSize: 8.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#DD344C',
                border: '1px solid #F3C0C6',
                borderRadius: 3,
                padding: '1px 5px',
                marginTop: 4,
              }}
            >
              {WAF_CHIP_LABEL}
            </span>
          )}
          {duration && (
            <div
              data-testid={`aws-duration-${id}`}
              style={{
                // On its own line rather than absolutely in the corner: over the
                // top-right it lands on long service names ("Amazon ECS · AWS
                // Fargate") and clips them.
                display: 'inline-block',
                fontSize: 9.5,
                fontWeight: 700,
                background: duration.current === false
                  ? '#C9A7B0'
                  : duration.ok
                    ? colors.success
                    : '#8C2F45',
                color: colors.textOnAccent,
                padding: '2px 8px',
                borderRadius: 20,
                marginTop: 5,
              }}
            >
              {duration.label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AwsTopologyDiagram({
  litNode,
  litIsResponse = false,
  passNodes = [],
  doneNodes = [],
  activeHops = [],
  durations = {},
}: AwsTopologyDiagramProps) {
  ensureKeyframes();
  const reduceMotion = prefersReducedMotion();

  /** Direction of the active hop on a segment, if it is active at all. */
  const hopFor = (segmentId: string): AwsHop | undefined =>
    activeHops.find((hop) => hop.segment === segmentId);

  const stateFor = (id: AwsNodeId): NodeState => {
    if (id === litNode) return litIsResponse ? 'response' : 'lit';
    if (passNodes.includes(id)) return 'pass';
    if (doneNodes.includes(id)) return 'done';
    return 'idle';
  };

  return (
    <div
      style={{
        position: 'relative',
        width: AWS_DIAGRAM_CANVAS.width,
        height: AWS_DIAGRAM_CANVAS.height,
        flexShrink: 0,
        marginTop: 18,
      }}
      data-testid="aws-topology-diagram"
      role="img"
      aria-label="AWS architecture: browser through CloudFront, ALB and Fargate to Bedrock, DynamoDB and the external integration APIs"
    >
      <svg
        width={AWS_DIAGRAM_CANVAS.width}
        height={AWS_DIAGRAM_CANVAS.height}
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        {AWS_SEGMENTS.map((segment) => {
          const geometry = awsSegmentGeometry(segment.id);
          const hop = hopFor(segment.id);
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
            <g key={segment.id}>
              <path
                data-testid={`aws-segment-${segment.id}`}
                data-direction={active ? (downstream ? 'downstream' : 'upstream') : 'idle'}
                d={geometry.path}
                fill="none"
                stroke={stroke}
                strokeWidth={active ? 3.5 : 2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={active ? 1 : 0.45}
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

      {AWS_TIER_LABELS.map((tier) => (
        <div key={tier.label} style={{ ...tierLabelStyle, left: tier.x }}>
          {tier.label}
        </div>
      ))}

      {AWS_NODES.map((node) => (
        <NodeCard
          key={node.id}
          id={node.id}
          state={stateFor(node.id)}
          duration={durations[node.id]}
        />
      ))}
    </div>
  );
}
