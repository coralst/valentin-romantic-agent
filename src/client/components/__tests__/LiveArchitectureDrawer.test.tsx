import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveArchitectureDrawer, DRAWER_COPY } from '../LiveArchitectureDrawer';
import { ArchitectureToggle } from '../ArchitectureToggle';
import { ArchitectureDrawerProvider } from '../../context/architecture-drawer-context';
import { ArchitectureEngineProvider, ENGINE_COPY } from '../../context/architecture-engine-context';
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

    /**
     * The feed lists the whole script, and moves the highlight rather than growing.
     *
     * It used to reveal itself a row at a time, which reads well but leaves nothing
     * to choose from — on a paused flow at step 0 there is exactly one action in the
     * list, so "pick an action and replay it" had nothing to pick.
     */
    it('lists every step of the flow and marks the current one', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(FLOW.steps.length);
      const current = () =>
        screen.getAllByTestId('aws-feed-row').filter((row) => row.dataset.current === 'true');
      expect(current()).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      expect(current()).toHaveLength(1);
    });

    it('walks the traffic to the node the current step lands on', async () => {
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));

      // Not instant: the step is animated hop by hop, so the destination lights once
      // the traffic gets there rather than the moment the step becomes current.
      await waitFor(() =>
        expect(screen.getByTestId(`aws-node-${FLOW.steps[1].to}`)).toHaveAttribute(
          'data-state',
          'lit',
        ),
      );
    });

    it('never highlights more than one node at a time', async () => {
      // The bug: at step 11 of the AgentCore flow eight cards glowed at once, which
      // says which resources exist rather than where the request has got to.
      const user = userEvent.setup();
      renderDrawer();
      await openDrawer(user);

      for (let step = 0; step < 4; step += 1) {
        const highlighted = screen
          .getAllByTestId(/^aws-node-/)
          .filter((node) => ['lit', 'response'].includes(node.dataset.state ?? ''));
        expect(highlighted.length, `step ${step}`).toBeLessThanOrEqual(1);
        await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
      }
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
      // The flow ends with the preference landing back in the browser — and the last
      // step is the long one, climbing from DynamoDB all the way home, so it takes
      // several beats to walk rather than arriving inside `waitFor`'s default second.
      await waitFor(
        () =>
          expect(screen.getByTestId('aws-node-browser')).toHaveAttribute('data-state', 'response'),
        { timeout: 4000 },
      );
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
      // Live traffic is walked hop by hop too, so the resource lights on arrival.
      await waitFor(() =>
        expect(screen.getByTestId('aws-node-dynamodb')).toHaveAttribute('data-state', 'lit'),
      );
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

      expect(screen.getByRole('complementary', { name: DRAWER_COPY.title })).toBeInTheDocument();
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

/**
 * The chip that names the engine actually answering.
 *
 * It exists because the engine switch now moves the chat's socket, and the socket
 * can be accepted by the *wrong* engine: `/ws/agentcore` connects on a deployment
 * with no AgentCore wiring, which then answers as engine A rather than failing. On a
 * laptop that is the only possible outcome — one process, one `AGENT_ENGINE`. So the
 * panel has to be able to say "you asked for AgentCore, engine A answered", or every
 * duration under it is filed under the wrong architecture.
 */
describe('the serving-engine chip', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /** Make `/api/config` answer as a given engine. */
  function servedBy(engine: string) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ authDisabled: true, engine }),
    });
  }

  /** The drawer with a real engine provider, which is what does the asking. */
  function renderWithEngine(initialEngine: 'valentin' | 'agentcore' = 'valentin') {
    return render(
      <ArchitectureDrawerProvider>
        <ArchitectureEngineProvider initialEngine={initialEngine}>
          <ArchitectureToggle />
          <LiveArchitectureDrawer />
        </ArchitectureEngineProvider>
      </ArchitectureDrawerProvider>,
    );
  }

  /** Open it and switch to live, which is the only mode an engine answers in. */
  async function openLive(user: ReturnType<typeof userEvent.setup>) {
    await openDrawer(user);
    await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    servedBy('valentin');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the engine that answered', async () => {
    const user = userEvent.setup();
    renderWithEngine();
    await openLive(user);

    const chip = await screen.findByTestId('architecture-serving-chip');
    expect(chip).toHaveTextContent(ENGINE_COPY.valentin);
    expect(chip).toHaveAttribute('data-serving', 'valentin');
    expect(chip).toHaveAttribute('data-downgraded', 'false');
  });

  it('names AgentCore when AgentCore is what answered', async () => {
    servedBy('agentcore');
    const user = userEvent.setup();
    renderWithEngine('agentcore');
    await openLive(user);

    const chip = await screen.findByTestId('architecture-serving-chip');
    expect(chip).toHaveTextContent(ENGINE_COPY.agentcore);
    expect(chip).toHaveAttribute('data-downgraded', 'false');
  });

  it('flags the engine selected not being the engine serving', async () => {
    // Asked for AgentCore, answered by engine A — the local case, and the
    // missing-AgentCore-wiring case. The chip is the only thing on screen that
    // contradicts the diagram, so it says so and names what really ran.
    const user = userEvent.setup();
    renderWithEngine('agentcore');
    await openLive(user);

    const chip = await screen.findByTestId('architecture-serving-chip');
    await waitFor(() => expect(chip).toHaveAttribute('data-downgraded', 'true'));
    expect(chip).toHaveTextContent(ENGINE_COPY.valentin);
  });

  it('confirms nothing while the question is still open', async () => {
    // A request that never lands must not read as a downgrade: unreachable and
    // refused are different faults, and only one of them is the deployment's.
    fetchMock.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithEngine('agentcore');
    await openLive(user);

    const chip = await screen.findByTestId('architecture-serving-chip');
    expect(chip).toHaveTextContent(DRAWER_COPY.servingUnknown);
    expect(chip).toHaveAttribute('data-downgraded', 'false');
  });

  /**
   * Withheld in demo mode: a scripted walkthrough is not being answered by any
   * engine, so naming one would be a claim about nothing.
   */
  it('says nothing while the walkthrough is scripted', async () => {
    const user = userEvent.setup();
    renderWithEngine();
    await openDrawer(user);
    expect(screen.queryByTestId('architecture-serving-chip')).not.toBeInTheDocument();
  });
});

/**
 * Replaying one user action.
 *
 * The ask this satisfies: pick an action out of the log and watch just that action
 * again. It is a third source alongside live and demo rather than a mode you switch
 * into, because the action worth replaying is usually one that just happened for
 * real — so it has to be reachable from live mode without discarding the live feed.
 */
describe('replaying a chosen action', () => {
  afterEach(() => {
    resetWsObservers();
  });

  /** The newest group's header — the control that starts a replay. */
  function topGroupHeader() {
    return screen.getAllByTestId('aws-feed-group-header')[0];
  }

  it('replays the chosen action and names it', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    await user.click(topGroupHeader());

    const chip = screen.getByTestId('architecture-replay-chip');
    expect(chip).toHaveTextContent(FLOW.steps[FLOW.steps.length - 1].action);
  });

  it('narrows what plays to the action, not the whole flow', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    const groups = screen.getAllByTestId('aws-feed-group').length;
    await user.click(topGroupHeader());

    // Only the chosen action's steps are listed…
    const rows = screen.getAllByTestId('aws-feed-row').length;
    expect(rows).toBeLessThan(FLOW.steps.length);
    expect(screen.getByTestId('architecture-step-count')).toHaveTextContent(`of ${rows}`);
    // …but every action is still on screen to be chosen. Folding the rest away is
    // not the same as removing them: without their captions, switching to another
    // action would mean leaving the replay first.
    expect(screen.getAllByTestId('aws-feed-group')).toHaveLength(groups);
  });

  it('lets a different action be chosen without leaving the replay first', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    await user.click(topGroupHeader());
    const first = screen.getByTestId('architecture-replay-chip').textContent;

    await user.click(screen.getAllByTestId('aws-feed-group-header')[1]);
    expect(screen.getByTestId('architecture-replay-chip').textContent).not.toBe(first);
    expect(screen.getByTestId('architecture-step-count')).toHaveTextContent('Step 1');
  });

  it('starts the replay from the top of the action rather than mid-way', async () => {
    // Choosing "replay" and then having to press Next would not be a replay.
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: DRAWER_COPY.next }));
    }
    await user.click(topGroupHeader());

    expect(screen.getByTestId('architecture-step-count')).toHaveTextContent('Step 1');
  });

  it('hands the drawer back when the same action is chosen again', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    await user.click(topGroupHeader());
    expect(screen.getByTestId('architecture-replay-chip')).toBeInTheDocument();

    await user.click(topGroupHeader());
    expect(screen.queryByTestId('architecture-replay-chip')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('aws-feed-row')).toHaveLength(FLOW.steps.length);
  });

  it('leaves the replay by the chip', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);

    await user.click(topGroupHeader());
    await user.click(screen.getByRole('button', { name: DRAWER_COPY.exitReplay }));

    expect(screen.queryByTestId('architecture-replay-chip')).not.toBeInTheDocument();
  });

  /**
   * The case that makes this worth building: replaying traffic that really happened.
   * Live mode has no step controls because live traffic cannot be rewound — but a
   * recording of it can be, which is exactly what a replay is.
   */
  it('replays real traffic from live mode, step controls and all', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);
    await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

    act(() => {
      publishInboundWsEvent(makeSpan());
    });
    expect(screen.queryByTestId('architecture-step-count')).not.toBeInTheDocument();

    await user.click(topGroupHeader());

    expect(screen.getByTestId('architecture-replay-chip')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-step-count')).toHaveTextContent('Step 1 of 1');
    expect(screen.getByRole('button', { name: DRAWER_COPY.next })).toBeInTheDocument();
  });

  it('drops the serving chip while replaying, since nothing is being answered', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await openDrawer(user);
    await user.click(screen.getByRole('button', { name: DRAWER_COPY.liveMode }));

    act(() => {
      publishInboundWsEvent(makeSpan());
    });
    await user.click(topGroupHeader());

    expect(screen.queryByTestId('architecture-serving-chip')).not.toBeInTheDocument();
  });
});
