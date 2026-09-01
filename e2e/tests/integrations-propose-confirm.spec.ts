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
 */

const PROPOSAL_ID = 'e2e-proposal-1';

/** Frames the page sent, in order, so the outbound contract can be asserted. */
interface Wire {
  sent: string[];
  /** Inject one server → client frame once the session id is known. */
  proposeOnce: (sessionId: string) => void;
}

/**
 * Proxy `/ws`, forwarding both directions, and hand back a handle on the traffic.
 *
 * Must be installed before `goto` — the app opens its socket on mount, and a route
 * registered afterwards would miss it.
 */
async function interceptSocket(page: Page): Promise<Wire> {
  const sent: string[] = [];
  let inject: ((sessionId: string) => void) | null = null;

  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((frame) => {
      const text = typeof frame === 'string' ? frame : frame.toString();
      sent.push(text);
      server.send(frame);
    });

    server.onMessage((frame) => {
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

  return {
    sent,
    proposeOnce: (sessionId) => {
      if (!inject) throw new Error('socket was never opened — did goto run?');
      inject(sessionId);
    },
  };
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
     * The fan-out is organised by *capability*, not by vendor — the visitor cares
     * that Valentin can book dinner, not that Ontopo exists. So these are the
     * capabilities the integration layer backs, and `music` and `rides` are
     * deliberately present-but-unbuilt alongside them.
     *
     * `flowers` and `grocery` moved out of that unbuilt list: both are Wolt, whose
     * catalogue endpoint needs no credential, and the server has been registering
     * `woltTools` on every boot since the browser tier landed.
     */
    for (const id of ['dining', 'calendar', 'travel', 'messages', 'occasions', 'flowers']) {
      await expect(panel.getByTestId(`integration-node-${id}`)).toBeVisible();
    }

    // Hebcal is arithmetic in-process, so `occasions` is live with no credential at
    // all — the one capability whose readiness is not a deployment question.
    await expect(panel.getByTestId('integration-readiness-occasions').first()).toContainText(
      'live',
    );

    // Wolt needs no credential either, so the florist row is live for the same
    // reason `occasions` is. This assertion used to expect "not built yet" here,
    // which made the spec agree with the bug it should have caught.
    await expect(panel.getByTestId('integration-readiness-flowers').first()).toContainText(
      'live',
    );

    // And the honest half: a capability with nothing behind it says so, rather than
    // showing a dot that implies it is merely unconfigured. `music` has no provider
    // anywhere in src/server/integrations.
    await expect(panel.getByTestId('integration-readiness-music').first()).toContainText(
      'not built yet',
    );
  });

  test('the hub is named Valentin, not AgentCore', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    await page.getByTestId('rail-integrations-button').click();

    const hub = page.getByTestId('integrations-hub');
    await expect(hub).toBeVisible();
    await expect(hub).toContainText('Valentin');
    // Version A has no AgentCore in it. Naming it on a projector would claim
    // something untrue about the control arm of the demo.
    await expect(hub).not.toContainText(/agent.?core/i);
  });

  test('a proposal renders as a card and Confirm sends confirm_action', async ({ page }) => {
    const wire = await interceptSocket(page);
    const app = new AppPage(page);
    await app.goto();

    // Wait for the welcome message: it means the socket is up and the server has
    // minted a session, which is the id the proposal has to be addressed to.
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(() => sessionIdFrom(wire.sent), { timeout: 10_000 })
      .not.toBeNull();
    wire.proposeOnce(sessionIdFrom(wire.sent)!);

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
    expect(confirm.payload.sessionId).toBe(sessionIdFrom(wire.sent));

    // The card stops offering once it has been acted on, so a second click cannot
    // send a second confirmation for the same hold.
    await expect(card.getByTestId('proposal-resolved')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  });

  test('declining sends nothing at all', async ({ page }) => {
    const wire = await interceptSocket(page);
    const app = new AppPage(page);
    await app.goto();

    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(() => sessionIdFrom(wire.sent), { timeout: 10_000 })
      .not.toBeNull();
    wire.proposeOnce(sessionIdFrom(wire.sent)!);

    const card = page.getByTestId(`proposal-${PROPOSAL_ID}`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole('button', { name: 'Not now' }).click();

    await expect(card.getByTestId('proposal-resolved')).toBeVisible();
    // Dismissal is local by design: the hold lapses on the provider's own clock,
    // and telling them "no" is not something the user asked us to do.
    expect(wire.sent.some((frame) => frame.includes('confirm_action'))).toBe(false);
  });
});
