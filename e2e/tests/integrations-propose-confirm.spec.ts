import { test, expect, type Page } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

/**
 * The integration layer's two user-visible promises, end to end in a browser.
 *
 * 1. The integrations are listed, and say plainly which ones are actually wired up.
 * 2. **Nothing happens until a human clicks Confirm** — and the click really does
 *    reach the wire as a `confirm_action` frame.
 *
 * The second one is the whole authority model, so it is asserted against the
 * WebSocket rather than against a spy inside the app. A unit test can only show
 * that a handler was called; this shows that the frame leaves the browser.
 *
 * ### Why the socket is intercepted
 *
 * A real proposal needs Bedrock to choose a tool and Ontopo to hold a table.
 * Neither exists in CI — there are no credentials, and there should not be, since a
 * test suite that books restaurants is a bad test suite. So the socket is proxied:
 * every frame passes through to the real server untouched, and one extra
 * `action_proposal` frame is injected inbound. That keeps the app, the reducer, the
 * card and the outbound envelope all real; the only fiction is *who* proposed.
 *
 * The `expiresAt` is deliberately generous. The card counts down and disables
 * Confirm at zero, which is correct behaviour and would otherwise make this test
 * fail on a slow CI runner for the wrong reason.
 *
 * ### Why both engines
 *
 * Since the Gateway carries the integration tools, engine B raises proposals of its
 * own — and the client is deliberately unchanged between the two, which is the claim
 * worth pinning: the same card, the same `confirm_action` envelope, the same
 * one-shot resolution, whichever engine is answering. What differs is only who
 * executes the confirm, and that is below the socket. Locally engine B downgrades to
 * engine A (no AgentCore wiring on a laptop), so what the second run really asserts
 * is that nothing in the card path is coupled to the socket path or to the served
 * engine — the failure it would have caught is a proposal frame arriving on
 * `/ws/agentcore` and being dropped.
 */

const PROPOSAL_ID = 'e2e-proposal-1';

/** The two routes the app can open, one per engine. */
type Engine = 'valentin' | 'agentcore';

/** Frames the page sent, in order, so the outbound contract can be asserted. */
interface Wire {
  sent: string[];
  /** Frames the server sent, needed because `session_init` only travels inbound. */
  received: string[];
  /** Inject one server → client frame once the session id is known. */
  proposeOnce: (sessionId: string) => void;
}

/**
 * Proxy both socket routes, forwarding both directions, and hand back a handle on
 * the traffic.
 *
 * Must be installed before `goto` — the app opens its socket on mount, and a route
 * registered afterwards would miss it. Both patterns are registered because
 * switching engine closes one socket and opens the other, and `**​/ws` does not match
 * `/ws/agentcore` (a glob segment stops at the slash). The proposal is always
 * injected into whichever socket is currently open, so a test can switch engine and
 * then propose without knowing which route it ended up on.
 */
async function interceptSocket(page: Page): Promise<Wire> {
  const sent: string[] = [];
  const received: string[] = [];
  let inject: ((sessionId: string) => void) | null = null;

  for (const pattern of ['**/ws', '**/ws/agentcore']) {
    await page.routeWebSocket(pattern, (ws) => {
      const server = ws.connectToServer();

      ws.onMessage((frame) => {
        const text = typeof frame === 'string' ? frame : frame.toString();
        sent.push(text);
        server.send(frame);
      });

      server.onMessage((frame) => {
        received.push(typeof frame === 'string' ? frame : frame.toString());
        ws.send(frame);
      });

      inject = (sessionId: string) => {
        ws.send(
          JSON.stringify({
            type: 'action_proposal',
            timestamp: new Date().toISOString(),
            payload: {
              sessionId,
              proposalId: PROPOSAL_ID,
              service: 'ontopo',
              title: 'Saturday, 21:00 at Hotel Montefiore',
              summary: 'A table for two after Havdalah. Nothing is booked until you confirm.',
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            },
          }),
        );
      };
    });
  }

  return {
    sent,
    received,
    proposeOnce: (sessionId) => {
      if (!inject) throw new Error('socket was never opened — did goto run?');
      inject(sessionId);
    },
  };
}

/**
 * Put the app on `engine`, and wait until a session exists on that engine's socket.
 *
 * Engine A needs no click — it is where the app starts. Engine B reconnects, so the
 * session id minted before the switch is stale and a proposal addressed to it would
 * be filtered out by the reducer, which is a real behaviour and not what these tests
 * are about. Hence: switch first, then read the id.
 */
async function settleOn(page: Page, app: AppPage, engine: Engine, wire: Wire): Promise<string> {
  // The welcome message means the socket is up and the server has minted a session.
  const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
  await expect(agentBubble.first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => boundSessionId(wire), { timeout: 15_000 }).not.toBeNull();
  const before = boundSessionId(wire)!;

  if (engine === 'valentin') return before;

  const authFramesBefore = authFrameCount(wire);
  const option = page.getByTestId('rail-engine-agentcore');
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');

  // A second `auth` frame is the reconnect having actually happened — the socket the
  // proposal will be injected into is the new one, so waiting on the click alone
  // would race it.
  await expect
    .poll(() => authFrameCount(wire), { timeout: 15_000 })
    .toBeGreaterThan(authFramesBefore);

  // The reconnect *resumes*: the auth frame carries the id the app already holds, so
  // the same session normally survives onto the new socket. Read the id again anyway
  // rather than reusing `before` — if a future change made the switch mint a fresh
  // session, injecting the stale id would give a card the reducer drops, and this
  // test would then be asserting nothing while still passing on engine A.
  await expect.poll(() => boundSessionId(wire), { timeout: 15_000 }).not.toBeNull();

  return boundSessionId(wire)!;
}

/** How many times the client has authenticated, i.e. how many sockets it has opened. */
function authFrameCount(wire: Wire): number {
  return wire.sent.filter((frame) => frame.includes('"type":"auth"')).length;
}

/**
 * The session the connection is bound to right now.
 *
 * Prefers the newest inbound `session_init`, because that is the only place a
 * server-minted id appears — the outbound `auth` frame omits `sessionId` entirely on
 * a first connection, which is what "mint one and tell me" looks like on the wire.
 */
function boundSessionId(wire: Wire): string | null {
  for (const raw of [...wire.received].reverse()) {
    try {
      const parsed = JSON.parse(raw) as { type?: string; payload?: { sessionId?: string } };
      if (parsed.type === 'session_init' && parsed.payload?.sessionId) {
        return parsed.payload.sessionId;
      }
    } catch {
      // Not a frame carrying a session id.
    }
  }
  return sessionIdFrom(wire.sent);
}

/** The session id the server minted, read off the frames it sent us. */
function sessionIdFrom(sent: string[]): string | null {
  for (const raw of sent) {
    try {
      const parsed = JSON.parse(raw) as { payload?: { sessionId?: string } };
      if (parsed.payload?.sessionId) return parsed.payload.sessionId;
    } catch {
      // A frame we cannot parse is not a frame carrying a session id.
    }
  }
  return null;
}

test.describe('Integrations — propose and confirm', () => {
  test('the integrations panel lists every integration and its readiness', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await page.getByTestId('rail-integrations-button').click();

    const panel = page.getByTestId('integrations-panel');
    await expect(panel).toBeVisible();

    /*
     * The fan-out is organised by *provider*, one row per account Valentin actually
     * touches, with the capability written underneath — a visitor in front of a
     * consent sheet is asking whose account this is about to reach.
     *
     * It used to be organised by capability ("Restaurant booking", "Flower
     * delivery"), which hid two things: that "Messages" was two unrelated accounts,
     * and that flowers and groceries were one Wolt client wearing two hats. Both are
     * fixed here — the ids below are `IntegrationId`s now.
     */
    for (const id of [
      'ontopo',
      'google-calendar',
      'amadeus',
      'gmail',
      'whatsapp',
      'hebcal',
      'wolt',
      'spotify',
    ]) {
      await expect(panel.getByTestId(`integration-node-${id}`)).toBeVisible();
    }

    // Ride booking is gone rather than dark: no provider, no tool, nothing to grant.
    await expect(panel.getByTestId('integration-node-rides')).toHaveCount(0);

    // Hebcal is arithmetic in-process, so it is live with no credential at all — the
    // one row whose readiness is not a deployment question.
    await expect(panel.getByTestId('integration-readiness-hebcal').first()).toContainText(
      'live',
    );

    // Wolt needs no credential either, so its row is live for the same reason Hebcal
    // is. This assertion used to expect "not built yet" here, which made the spec
    // agree with the bug it should have caught.
    await expect(panel.getByTestId('integration-readiness-wolt').first()).toContainText(
      'live',
    );

    /*
     * Spotify's badge depends on the deployment rather than on the catalogue:
     * `spotifyTools` register on any process holding a client id and secret, so a
     * machine with them set reads "live" and one without reads "needs credentials".
     * Both are correct and the spec must not pin whichever this runner happens to
     * have — what it pins is that the row is no longer called a drawing, because
     * the code exists either way.
     */
    await expect(panel.getByTestId('integration-readiness-spotify').first()).toContainText(
      /live|needs credentials/,
    );
    await expect(panel.getByTestId('integration-readiness-spotify').first()).not.toContainText(
      'not built yet',
    );

    /*
     * And the honest half, which no longer has a subject: every row now reaches a
     * real service, so no *badge* on this page may say "not built yet". The rides row
     * was deleted rather than kept as a dark promise, and Spotify was the last row
     * to stop being a drawing.
     *
     * Scoped to the readiness badges rather than the whole panel, which is what an
     * earlier version of this line did and why it failed: `getByText` matches
     * substrings, and the desktop footer explains the three readiness states in
     * prose that necessarily names all three. Asserting over the panel made the
     * explainer indistinguishable from a badge on a row.
     */
    await expect(
      panel.locator('[data-testid^="integration-readiness-"]', { hasText: 'not built yet' }),
    ).toHaveCount(0);
  });

  test('on engine A the hub is named Valentin, not AgentCore', async ({ page }) => {
    // Scoped to engine A deliberately. The hub copy describes whichever engine is
    // selected, so with the toggle on it *should* name AgentCore; asserting the
    // absence globally would have made this test forbid the thing engine B exists to
    // show. The app starts on engine A, so no click is needed — the assertion below
    // pins that it really is the default rather than assuming it.
    const app = new AppPage(page);
    await app.goto();

    await expect(page.getByTestId('rail-engine-valentin')).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 15_000 },
    );

    await page.getByTestId('rail-integrations-button').click();

    const hub = page.getByTestId('integrations-hub');
    await expect(hub).toBeVisible();
    await expect(hub).toContainText('Valentin');
    // Version A has no AgentCore in it. Naming it on a projector would claim
    // something untrue about the control arm of the demo.
    await expect(hub).not.toContainText(/agent.?core/i);
  });

  for (const engine of ['valentin', 'agentcore'] as const) {
    test(`a proposal renders as a card and Confirm sends confirm_action (engine ${engine})`, async ({
      page,
    }) => {
      const wire = await interceptSocket(page);
      const app = new AppPage(page);
      await app.goto();

      const sessionId = await settleOn(page, app, engine, wire);
      wire.proposeOnce(sessionId);

      const card = page.getByTestId(`proposal-${PROPOSAL_ID}`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toContainText('Hotel Montefiore');
      await expect(card).toContainText('Nothing is booked until you confirm');
      await expect(card.getByTestId('proposal-countdown')).toContainText(/expires in/);

      // Nothing has gone out yet. This is the assertion that says the card is an
      // offer and not a receipt.
      expect(wire.sent.some((frame) => frame.includes('confirm_action'))).toBe(false);

      await card.getByRole('button', { name: 'Confirm' }).click();

      await expect
        .poll(() => wire.sent.filter((frame) => frame.includes('confirm_action')), {
          timeout: 10_000,
        })
        .toHaveLength(1);

      const confirm = JSON.parse(
        wire.sent.find((frame) => frame.includes('confirm_action'))!,
      ) as { type: string; payload: { proposalId: string; sessionId: string } };
      expect(confirm.type).toBe('confirm_action');
      expect(confirm.payload.proposalId).toBe(PROPOSAL_ID);
      // Addressed to the session on *this* engine's socket. On engine B that is a
      // different socket than the one the page opened on mount.
      expect(confirm.payload.sessionId).toBe(sessionId);

      // The card stops offering once it has been acted on, so a second click cannot
      // send a second confirmation for the same hold.
      await expect(card.getByTestId('proposal-resolved')).toBeVisible();
      await expect(card.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    });

    test(`declining sends nothing at all (engine ${engine})`, async ({ page }) => {
      const wire = await interceptSocket(page);
      const app = new AppPage(page);
      await app.goto();

      const sessionId = await settleOn(page, app, engine, wire);
      wire.proposeOnce(sessionId);

      const card = page.getByTestId(`proposal-${PROPOSAL_ID}`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.getByRole('button', { name: 'Not now' }).click();

      await expect(card.getByTestId('proposal-resolved')).toBeVisible();
      // Dismissal is local by design: the hold lapses on the provider's own clock,
      // and telling them "no" is not something the user asked us to do.
      expect(wire.sent.some((frame) => frame.includes('confirm_action'))).toBe(false);
    });
  }
});
