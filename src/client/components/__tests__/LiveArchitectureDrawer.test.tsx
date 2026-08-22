import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveArchitectureDrawer, DRAWER_COPY } from '../LiveArchitectureDrawer';
import { ArchitectureToggle } from '../ArchitectureToggle';
import { ArchitectureDrawerProvider } from '../../context/architecture-drawer-context';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import { demoFlow, DEFAULT_DEMO_FLOW_ID } from '../../utils/aws-demo-flows';
import type { AwsSpan, ServerEvent } from '../../../shared/interfaces/ws-events';

const FLOW = demoFlow(DEFAULT_DEMO_FLOW_ID);

function makeSpan(overrides: Partial<AwsSpan> = {}): ServerEvent {
  return {
    type: 'aws_span',
    payload: {
      sessionId: 'sess-1',
      resourceId: 'dynamodb',
      service: 'Amazon DynamoDB',
      resourceName: 'ValentinTable-dev',
      operation: 'PutItem',
      durationMs: 18,
      ok: true,
      detail: 'PREF#music',
      ...overrides,
    },
    timestamp: '2026-08-21T00:00:00.000Z',
  };
}

/** Render the drawer with its toggle, which is the only way a user opens it. */
function renderDrawer(extra?: React.ReactNode) {
  return render(
    <ArchitectureDrawerProvider>
      <ArchitectureToggle />
      <LiveArchitectureDrawer />
      {extra}
    </ArchitectureDrawerProvider>,
  );
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('architecture-toggle'));
}

describe('LiveArchitectureDrawer', () => {
  afterEach(() => {
    resetWsObservers();
  });

  describe('closed', () => {
    it('does not render the drawer body', () => {
      renderDrawer();
      expect(screen.queryByTestId('architecture-drawer')).not.toBeInTheDocument();
    });

    /** The affordance that says the drawer can come back. Its absence was a real bug. */
    it('leaves a reopen bar on screen', () => {
      renderDrawer();
      expect(screen.getByTestId('architecture-reopen-bar')).toBeInTheDocument();
    });

    it('reopens from the bar', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByTestId('architecture-reopen-bar'));
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'true');
    });
  });

  /**
   * The bar is the drawer's one fixture: same place, same colour, both states.
   *
   * It used to slide away when the panel came up, which handed its strip to a
   * cream panel and changed the colour of the foot of the window every time the
   * drawer moved — a flicker exactly where the eye was already going. It also left
   * the small `Hide ▾` in the panel's far corner as the only way back down.
   */
  describe('the bar, in both states', () => {
    it('stays on screen with the panel up, and closes it again', async () => {
      const user = userEvent.setup();
      renderDrawer();
      const bar = screen.getByTestId('architecture-reopen-bar');

      await user.click(bar);
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'true');
      expect(bar).toBeInTheDocument();

      await user.click(bar);
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'false');
    });

    it('keeps one background across open and closed', async () => {
      const user = userEvent.setup();
      renderDrawer();
      const bar = screen.getByTestId('architecture-reopen-bar');
      const closedBackground = bar.style.background;

      await user.click(bar);

      expect(bar.style.background).toBe(closedBackground);
      expect(closedBackground).not.toBe('');
    });

    /** The lens carries the state, since nothing else about the bar changes. */
    it('shows a ⊕ lens when closed and a ⊖ lens when open', async () => {
      const user = userEvent.setup();
      renderDrawer();

      expect(screen.getByTestId('architecture-bar-sign')).toHaveAttribute('data-sign', 'plus');

      await user.click(screen.getByTestId('architecture-reopen-bar'));

      expect(screen.getByTestId('architecture-bar-sign')).toHaveAttribute('data-sign', 'minus');
    });

    /**
     * Two buttons with one accessible name is an ambiguous query for a screen
     * reader user and for `getByRole` alike, and the panel keeps its own `Hide ▾`.
     */
    it('does not take the panel Hide button’s name when open', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByTestId('architecture-reopen-bar'));

      expect(screen.getByRole('button', { name: DRAWER_COPY.hide })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: DRAWER_COPY.collapse })).toBe(
        screen.getByTestId('architecture-reopen-bar'),
      );
    });
  });

  describe('open', () => {
    it('shows the diagram and the feed', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByTestId('aws-topology-diagram')).toBeInTheDocument();
      expect(screen.getByTestId('aws-flow-feed')).toBeInTheDocument();
    });

    it('says the resources are real and where they live', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByText(DRAWER_COPY.subtitle)).toBeInTheDocument();
    });

    it('offers a live/demo switch instead of the stale logical tabs', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByRole('group', { name: 'Data source' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: DRAWER_COPY.liveMode })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: DRAWER_COPY.demoMode })).toBeInTheDocument();
      // The model this replaced named code modules, not AWS resources.
      expect(screen.queryByRole('button', { name: /logical/i })).not.toBeInTheDocument();
    });
  });

  describe('demo mode', () => {
    it('opens in demo mode, so the drawer is never blank', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByRole('button', { name: DRAWER_COPY.demoMode })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('starts on the first step', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step 1 of ${FLOW.steps.length}`,
      );
    });

    it('advances a step', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step 2 of ${FLOW.steps.length}`,
      );
    });

    it('steps back', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.previous }));

      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step 1 of ${FLOW.steps.length}`,
      );
    });

    it('cannot step back past the first step', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByRole('button', { name: DRAWER_COPY.previous })).toBeDisabled();
    });

    it('restarts to the beginning', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.restart }));

      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step 1 of ${FLOW.steps.length}`,
      );
    });

    it('grows the feed as it steps', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(2);
    });

    it('lights the node the current step lands on', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      expect(screen.getByTestId(`aws-node-${FLOW.steps[1].to}`)).toHaveAttribute(
        'data-state',
        'lit',
      );
    });

    /** Authored durations must not be mistaken for measurements. */
    it('says out loud that the durations are representative', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByText(DRAWER_COPY.demoNote)).toBeInTheDocument();
    });

    it('walks the whole flow to its end', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      for (let i = 1; i < FLOW.steps.length; i += 1) {
        await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      }

      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step ${FLOW.steps.length} of ${FLOW.steps.length}`,
      );
      expect(screen.getByRole('button', { name: DRAWER_COPY.next })).toBeDisabled();
      // The flow ends with the preference landing back in the browser.
      expect(screen.getByTestId('aws-node-browser')).toHaveAttribute('data-state', 'response');
    });
  });

  describe('live mode', () => {
    it('switches to live on request', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));
      expect(screen.getByRole('button', { name: DRAWER_COPY.liveMode })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    /**
     * Live traffic cannot be rewound, and a disabled ◀ beside real events only
     * invites the question of why it does nothing.
     */
    it('hides the step controls, which mean nothing for live traffic', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      expect(screen.queryByRole('button', { name: DRAWER_COPY.next })).not.toBeInTheDocument();
      expect(screen.queryByTestId('architecture-step-count')).not.toBeInTheDocument();
    });

    it('explains the emptiness before any traffic arrives', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      expect(screen.getByText(DRAWER_COPY.liveEmpty)).toBeInTheDocument();
    });

    it('shows an arriving span with its real resource and measured duration', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(1);
      expect(screen.getByTestId('aws-duration-dynamodb')).toHaveTextContent('18 ms');
      expect(screen.getByTestId('aws-node-dynamodb')).toHaveAttribute('data-state', 'lit');
    });

    it('counts spans and model calls honestly', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      act(() => {
        publishInboundWsEvent(
          makeSpan({ resourceId: 'bedrock', service: 'Amazon Bedrock', operation: 'Converse' }),
        );
        publishInboundWsEvent(makeSpan());
      });

      expect(screen.getByText('2 spans · 1 model call')).toBeInTheDocument();
    });

    it('flips to live by itself when traffic arrives before the user chooses', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(screen.getByRole('button', { name: DRAWER_COPY.liveMode })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    /** An arriving heartbeat must not yank the view out from under a presenter. */
    it('stays in demo once the user has chosen it, whatever arrives', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.demoMode }));

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(screen.getByRole('button', { name: DRAWER_COPY.demoMode })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('collapsing', () => {
    it('hides on request without unmounting, so the exit can animate', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.hide }));
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'false');
    });

    /**
     * The reason for collapse-not-unmount: hiding the drawer to talk over the chat
     * and bringing it back must not restart the walkthrough.
     */
    it('keeps its step across a hide and a reopen', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.hide }));
      await user.click(screen.getByTestId('architecture-reopen-bar'));

      expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(
        `Step 3 of ${FLOW.steps.length}`,
      );
    });

    /** The mockup interpolated this once and it never updated again. */
    it('keeps the reopen bar readout current', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.hide }));

      expect(screen.getByTestId('architecture-reopen-bar')).toHaveTextContent(
        `Step 2 of ${FLOW.steps.length}`,
      );
    });

    it('shows the live event count on the bar in live mode', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      expect(screen.getByTestId('architecture-reopen-bar')).toHaveTextContent('1 event');
    });
  });

  /**
   * The heart of the demo: Coral types into the composer while the drawer is up.
   * These guard the non-modal contract — the whole point on stage is to send a
   * message and watch it travel, so nothing here may block, trap, or steal focus.
   */
  describe('non-modal coexistence with the page', () => {
    const composer = <input aria-label="Type a message" />;

    it('is a labelled complementary region, not a dialog', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(
        screen.getByRole('complementary', { name: DRAWER_COPY.title }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is not modal', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getByTestId('architecture-drawer')).not.toHaveAttribute('aria-modal');
    });

    it('renders no backdrop that could block the page', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);
      await openDrawer(user);

      expect(screen.queryByTestId('architecture-overlay')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Type a message')).toBeInTheDocument();
    });

    it('does not steal focus when it opens', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);

      screen.getByLabelText('Type a message').focus();
      await user.click(screen.getByTestId('architecture-toggle'));

      // Focus lands on the toggle the user pressed; nothing inside the drawer
      // grabs it out from under them.
      expect(screen.getByTestId('architecture-toggle')).toHaveFocus();
    });

    it('leaves the composer typable while it is up', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);
      await openDrawer(user);

      const input = screen.getByLabelText('Type a message');
      await user.click(input);
      await user.type(input, 'She loves peonies');

      expect(input).toHaveValue('She loves peonies');
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'true');
    });

    it('does not trap focus inside the drawer', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);
      await openDrawer(user);

      const drawer = screen.getByTestId('architecture-drawer');
      let escaped = false;
      for (let i = 0; i < 12 && !escaped; i += 1) {
        await user.tab();
        const active = document.activeElement;
        if (active && !drawer.contains(active) && active !== document.body) escaped = true;
      }

      expect(escaped).toBe(true);
      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'true');
    });

    it('keeps composer focus when a live event arrives', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);
      await openDrawer(user);
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

      const input = screen.getByLabelText('Type a message');
      await user.click(input);

      act(() => {
        publishInboundWsEvent(makeSpan());
      });

      // A live event must never yank focus away mid-sentence.
      expect(input).toHaveFocus();
      expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(1);
    });

    /** Bound on the document, because focus is deliberately left in the composer. */
    it('closes on Escape even while the composer has focus', async () => {
      const user = userEvent.setup();
      renderDrawer(composer);
      await openDrawer(user);

      await user.click(screen.getByLabelText('Type a message'));
      await user.keyboard('{Escape}');

      expect(screen.getByTestId('architecture-drawer')).toHaveAttribute('data-open', 'false');
    });
  });
});
