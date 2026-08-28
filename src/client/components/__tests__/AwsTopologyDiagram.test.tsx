import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AwsTopologyDiagram } from '../AwsTopologyDiagram';
import { AWS_NODES, AWS_SEGMENTS, routeBetween } from '../../utils/aws-architecture';
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
      // builders reads `ValentinTable-dev` instantly.
      expect(screen.getByText('ValentinTable-dev')).toBeInTheDocument();
      expect(screen.getByText('valentin-alb-dev')).toBeInTheDocument();
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
    it('idles every node when nothing is happening', () => {
      render(<AwsTopologyDiagram />);
      for (const node of AWS_NODES) {
        expect(screen.getByTestId(`aws-node-${node.id}`)).toHaveAttribute('data-state', 'idle');
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
      render(
        <AwsTopologyDiagram litNode="bedrock" passNodes={['alb']} doneNodes={['browser']} />,
      );
      expect(screen.getByTestId('aws-node-alb')).toHaveAttribute('data-state', 'pass');
      expect(screen.getByTestId('aws-node-browser')).toHaveAttribute('data-state', 'done');
    });

    it('leaves S3 idle on a chat flow, so its dimness is explained rather than hidden', () => {
      render(<AwsTopologyDiagram litNode="bedrock" passNodes={['alb', 'fargate']} />);
      expect(screen.getByTestId('aws-node-s3')).toHaveAttribute('data-state', 'idle');
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
      const hops = routeBetween('fargate', 'integrations');
      render(<AwsTopologyDiagram litNode="integrations" activeHops={hops} />);

      expect(screen.getByTestId('aws-head-fargate-integrations-mid-downstream')).toHaveAttribute(
        'data-active',
        'true',
      );
      expect(screen.getByTestId('aws-head-fargate-integrations-mid-upstream')).toHaveAttribute(
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
});
