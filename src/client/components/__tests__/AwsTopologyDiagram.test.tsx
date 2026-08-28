import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AwsTopologyDiagram } from '../AwsTopologyDiagram';
import {
  ARCHITECTURE_ENGINES,
  AWS_NODES,
  AWS_SEGMENTS,
  isNodeInEngine,
  isSegmentInEngine,
  routeBetween,
} from '../../utils/aws-architecture';
import { ELBOWED_SEGMENTS } from '../../utils/aws-diagram-layout';

/**
 * Stub `matchMedia` so `prefersReducedMotion()` can be steered. jsdom's own
 * implementation always reports `matches: false`, so without this the
 * reduced-motion branch is unreachable.
 */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

describe('AwsTopologyDiagram', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('aws-topology-marching-ants')?.remove();
  });

  describe('the whole topology, always', () => {
    it('renders every AWS node', () => {
      render(<AwsTopologyDiagram />);
      for (const node of AWS_NODES) {
        expect(screen.getByTestId(`aws-node-${node.id}`)).toBeInTheDocument();
      }
    });

    it('renders every segment', () => {
      render(<AwsTopologyDiagram />);
      for (const segment of AWS_SEGMENTS) {
        expect(screen.getByTestId(`aws-segment-${segment.id}`)).toBeInTheDocument();
      }
    });

    it('names the real deployed resources, not service names alone', () => {
      render(<AwsTopologyDiagram />);
      // The whole argument for the AWS model over the old module model: a room of
      // builders reads `ValentinTable-dev` instantly. It appears twice, once per
      // engine, and that is the point — it is genuinely the same table on both.
      expect(screen.getAllByText('ValentinTable-dev')).toHaveLength(2);
      expect(screen.getByText('valentin-alb-dev')).toBeInTheDocument();
      expect(screen.getByText('valentin-ac-proxy-dev')).toBeInTheDocument();
      expect(screen.getByText('valentin_agent_dev')).toBeInTheDocument();
    });

    it('draws the VPC boundary', () => {
      render(<AwsTopologyDiagram />);
      expect(screen.getByTestId('aws-vpc-box')).toBeInTheDocument();
    });

    it('describes itself for assistive tech, since the diagram is imagery', () => {
      render(<AwsTopologyDiagram />);
      expect(screen.getByRole('img', { name: /CloudFront/ })).toBeInTheDocument();
    });
  });

  describe('node state', () => {
    it('idles every node on the selected engine when nothing is happening', () => {
      render(<AwsTopologyDiagram />);
      for (const node of AWS_NODES) {
        // The other engine shades instead of idling — see the engine suite below.
        const expected = isNodeInEngine(node.id, 'valentin') ? 'idle' : 'muted';
        expect(screen.getByTestId(`aws-node-${node.id}`), node.id).toHaveAttribute(
          'data-state',
          expected,
        );
      }
    });

    it('lights the current node', () => {
      render(<AwsTopologyDiagram litNode="bedrock" />);
      expect(screen.getByTestId('aws-node-bedrock')).toHaveAttribute('data-state', 'lit');
    });

    it('lights a response node differently from a request node', () => {
      render(<AwsTopologyDiagram litNode="browser" litIsResponse />);
      expect(screen.getByTestId('aws-node-browser')).toHaveAttribute('data-state', 'response');
    });

    it('marks transited nodes as passed and earlier ones as done', () => {
      render(<AwsTopologyDiagram litNode="bedrock" passNodes={['alb']} doneNodes={['browser']} />);
      expect(screen.getByTestId('aws-node-alb')).toHaveAttribute('data-state', 'pass');
      expect(screen.getByTestId('aws-node-browser')).toHaveAttribute('data-state', 'done');
    });

    it('leaves S3 idle on a chat flow, so its dimness is explained rather than hidden', () => {
      render(<AwsTopologyDiagram litNode="bedrock" passNodes={['alb', 'fargate']} />);
      expect(screen.getByTestId('aws-node-s3')).toHaveAttribute('data-state', 'idle');
    });
  });

  /**
   * How much of the diagram is faded, and when.
   *
   * The regression these guard: idle used to carry `opacity: 0.4` against muted's
   * 0.34, so every card was faded all the time and picking an engine barely
   * changed the picture. Fade now means one of exactly two things — the engine you
   * are not looking at, and S3, which takes no part in a chat turn.
   */
  describe('fade', () => {
    /** The card itself, which is the element the state styles land on. */
    function card(id: string): HTMLElement {
      return screen.getByTestId(`aws-node-${id}`).firstElementChild as HTMLElement;
    }

    it('does not fade an idle node on the selected engine', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);
      for (const node of AWS_NODES) {
        if (!isNodeInEngine(node.id, 'agentcore') || node.dimmed) continue;
        expect(card(node.id).style.opacity, node.id).toBe('');
      }
    });

    it('fades the other engine hard enough to be unmistakable', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);
      const other = AWS_NODES.filter((node) => node.engine === 'valentin');
      expect(other.length).toBeGreaterThan(0);
      for (const node of other) {
        expect(Number(card(node.id).style.opacity), node.id).toBeLessThan(0.3);
        expect(card(node.id).style.filter, node.id).toBe('grayscale(1)');
      }
    });

    it('fades only the node the model marks dimmed, and never greys it', () => {
      // Grey is spoken for: it means "the other engine". S3 keeps its colour.
      render(<AwsTopologyDiagram />);
      const dimmed = AWS_NODES.filter((node) => node.dimmed);
      expect(dimmed.map((node) => node.id)).toEqual(['s3']);
      expect(Number(card('s3').style.opacity)).toBeLessThan(1);
      expect(card('s3').style.filter).toBe('');
    });

    it('stops dimming S3 the moment traffic actually reaches it', () => {
      // A page-load flow does route through S3, and a card that stayed half-faded
      // while carrying a request would be reporting the wrong thing.
      render(<AwsTopologyDiagram litNode="s3" />);
      expect(card('s3').style.opacity).toBe('');
    });

    it("draws the selected engine's idle connectors at full strength", () => {
      // They are already stroked in the pale idle colour; a second fade on top is
      // what made the wiring on the half you asked for nearly invisible.
      render(<AwsTopologyDiagram engine="agentcore" />);
      for (const segment of AWS_SEGMENTS) {
        if (!isSegmentInEngine(segment, 'agentcore')) continue;
        const path = screen.getByTestId(`aws-segment-${segment.id}`);
        expect(path.getAttribute('opacity'), segment.id).toBe('1');
      }
    });
  });

  describe('durations', () => {
    it('shows a measured duration on its node', () => {
      render(
        <AwsTopologyDiagram
          litNode="dynamodb"
          durations={{ dynamodb: { label: '18 ms', ok: true, current: true } }}
        />,
      );
      expect(screen.getByTestId('aws-duration-dynamodb')).toHaveTextContent('18 ms');
    });

    it('shows no pill for a node that had no measured call', () => {
      render(<AwsTopologyDiagram litNode="browser" />);
      expect(screen.queryByTestId('aws-duration-browser')).not.toBeInTheDocument();
    });
  });

  describe('flow direction', () => {
    it('marks an active segment with the direction traffic is travelling', () => {
      const hops = routeBetween('browser', 'fargate');
      render(<AwsTopologyDiagram litNode="fargate" activeHops={hops} />);

      expect(screen.getByTestId('aws-segment-browser-cloudfront')).toHaveAttribute(
        'data-direction',
        'downstream',
      );
    });

    it('marks a return leg upstream', () => {
      const hops = routeBetween('dynamodb', 'browser');
      render(<AwsTopologyDiagram litNode="browser" litIsResponse activeHops={hops} />);

      expect(screen.getByTestId('aws-segment-fargate-dynamodb')).toHaveAttribute(
        'data-direction',
        'upstream',
      );
    });

    it('leaves segments outside the route idle', () => {
      const hops = routeBetween('browser', 'fargate');
      render(<AwsTopologyDiagram litNode="fargate" activeHops={hops} />);

      expect(screen.getByTestId('aws-segment-cloudfront-s3')).toHaveAttribute(
        'data-direction',
        'idle',
      );
    });

    /**
     * The bug this guards is the one that survived three geometric probes and was
     * only caught on a projector: with both arrowheads always drawn, a return leg
     * still showed an outward arrow, so the eye read the traffic backwards.
     */
    it('shows only the downstream arrowhead on a request', () => {
      const hops = routeBetween('browser', 'fargate');
      render(<AwsTopologyDiagram litNode="fargate" activeHops={hops} />);

      expect(screen.getByTestId('aws-head-browser-cloudfront-downstream')).toHaveAttribute(
        'data-active',
        'true',
      );
      expect(screen.getByTestId('aws-head-browser-cloudfront-upstream')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    it('shows only the upstream arrowhead on a response', () => {
      const hops = routeBetween('bedrock', 'browser');
      render(<AwsTopologyDiagram litNode="browser" litIsResponse activeHops={hops} />);

      expect(screen.getByTestId('aws-head-fargate-bedrock-upstream')).toHaveAttribute(
        'data-active',
        'true',
      );
      expect(screen.getByTestId('aws-head-fargate-bedrock-downstream')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    /**
     * On an elbowed link the longest visible run is the vertical leg, so direction
     * has to be stated where the eye actually travels. An arrowhead only at the
     * spine end left that whole run unlabelled.
     */
    it('puts a mid-leg chevron on the elbowed links', () => {
      const hops = routeBetween('fargate', 'dynamodb');
      render(<AwsTopologyDiagram litNode="dynamodb" activeHops={hops} />);

      expect(screen.getByTestId('aws-head-fargate-dynamodb-mid-downstream')).toHaveAttribute(
        'data-active',
        'true',
      );
      expect(screen.getByTestId('aws-head-fargate-dynamodb-mid-upstream')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    it('draws no mid-leg chevron on a straight link, which needs none', () => {
      render(<AwsTopologyDiagram />);
      const straight = AWS_SEGMENTS.filter((segment) => !ELBOWED_SEGMENTS.includes(segment.id));
      expect(straight.length).toBeGreaterThan(0);

      for (const segment of straight) {
        expect(
          screen.queryByTestId(`aws-head-${segment.id}-mid-downstream`),
        ).not.toBeInTheDocument();
      }
    });
  });

  describe('motion', () => {
    it('animates the active segment', () => {
      stubReducedMotion(false);
      const hops = routeBetween('browser', 'fargate');
      render(<AwsTopologyDiagram litNode="fargate" activeHops={hops} />);

      expect(screen.getByTestId('aws-segment-browser-cloudfront').style.animation).toContain(
        'aws-ants-downstream',
      );
    });

    it('drops the animation under reduced motion but keeps the direction', () => {
      stubReducedMotion(true);
      const hops = routeBetween('browser', 'fargate');
      render(<AwsTopologyDiagram litNode="fargate" activeHops={hops} />);

      const segment = screen.getByTestId('aws-segment-browser-cloudfront');
      expect(segment.style.animation).toBe('');
      // The objection is to things moving, not to knowing which way traffic went.
      expect(segment).toHaveAttribute('data-direction', 'downstream');
    });

    it('injects the keyframes exactly once across renders', () => {
      render(<AwsTopologyDiagram />);
      render(<AwsTopologyDiagram />);
      expect(document.querySelectorAll('#aws-topology-marching-ants')).toHaveLength(1);
    });
  });

  describe('engine shading', () => {
    it('keeps both engines on the canvas, whichever one is selected', () => {
      // Removing half would hide the comparison, which is the drawer's subject.
      for (const engine of ARCHITECTURE_ENGINES) {
        const { unmount } = render(<AwsTopologyDiagram engine={engine} />);
        for (const node of AWS_NODES) {
          expect(screen.getByTestId(`aws-node-${node.id}`), node.id).toBeInTheDocument();
        }
        unmount();
      }
    });

    it('shades every node the selected engine does not use', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);

      for (const node of AWS_NODES) {
        const expected = isNodeInEngine(node.id, 'agentcore') ? 'idle' : 'muted';
        expect(screen.getByTestId(`aws-node-${node.id}`), node.id).toHaveAttribute(
          'data-state',
          expected,
        );
      }
    });

    it('leaves the shared spine unshaded on both engines', () => {
      // Browser through ALB is genuinely shared; dimming it when you switch would
      // claim a difference the deployment does not have.
      for (const engine of ARCHITECTURE_ENGINES) {
        const { unmount } = render(<AwsTopologyDiagram engine={engine} />);
        for (const id of ['browser', 'cloudfront', 's3', 'alb']) {
          expect(screen.getByTestId(`aws-node-${id}`), `${id}/${engine}`).not.toHaveAttribute(
            'data-state',
            'muted',
          );
        }
        unmount();
      }
    });

    it('marks the other engine’s connectors as shaded', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);

      for (const segment of AWS_SEGMENTS) {
        const expected = isSegmentInEngine(segment, 'agentcore') ? 'active-engine' : 'muted';
        expect(screen.getByTestId(`aws-segment-${segment.id}`), segment.id).toHaveAttribute(
          'data-engine-state',
          expected,
        );
      }
    });

    it('refuses to light a node left over from the engine just switched away from', () => {
      // The failure this prevents: flipping to AgentCore while engine A's Bedrock
      // node is still lit, leaving a shaded card glowing.
      render(<AwsTopologyDiagram engine="agentcore" litNode="bedrock" />);
      expect(screen.getByTestId('aws-node-bedrock')).toHaveAttribute('data-state', 'muted');
    });

    it('refuses to animate a connector on the shaded half', () => {
      const hops = routeBetween('fargate', 'bedrock');
      render(<AwsTopologyDiagram engine="agentcore" activeHops={hops} />);

      expect(screen.getByTestId('aws-segment-fargate-bedrock')).toHaveAttribute(
        'data-direction',
        'idle',
      );
    });

    it('withholds the duration pill from a shaded node', () => {
      // A measured latency belongs to one engine's turn. Showing engine A's 412 ms
      // while engine B is on screen would be the most quietly wrong thing here.
      render(
        <AwsTopologyDiagram engine="agentcore" durations={{ bedrock: { label: '412 ms' } }} />,
      );
      expect(screen.queryByTestId('aws-duration-bedrock')).not.toBeInTheDocument();
    });

    it('animates engine B’s own hops', () => {
      const hops = routeBetween('ac-proxy', 'ac-memory');
      render(<AwsTopologyDiagram engine="agentcore" litNode="ac-memory" activeHops={hops} />);

      expect(screen.getByTestId('aws-node-ac-memory')).toHaveAttribute('data-state', 'lit');
      expect(screen.getByTestId('aws-segment-ac-runtime-ac-memory')).toHaveAttribute(
        'data-direction',
        'downstream',
      );
    });

    it('shades the AgentCore boundary until the AgentCore engine is selected', () => {
      const { unmount } = render(<AwsTopologyDiagram engine="valentin" />);
      expect(screen.getByTestId('aws-agentcore-box')).toHaveAttribute('data-state', 'muted');
      unmount();

      render(<AwsTopologyDiagram engine="agentcore" />);
      expect(screen.getByTestId('aws-agentcore-box')).toHaveAttribute(
        'data-state',
        'active-engine',
      );
    });

    it('captions each band and highlights the selected one', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);
      expect(screen.getByTestId('aws-engine-band-agentcore')).toHaveAttribute(
        'data-state',
        'active-engine',
      );
      expect(screen.getByTestId('aws-engine-band-valentin')).toHaveAttribute('data-state', 'muted');
    });

    it('says which engine it is showing in its label, for anyone not looking at it', () => {
      render(<AwsTopologyDiagram engine="agentcore" />);
      expect(screen.getByTestId('aws-topology-diagram')).toHaveAttribute(
        'data-engine',
        'agentcore',
      );
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain('AgentCore');
    });
  });
});
