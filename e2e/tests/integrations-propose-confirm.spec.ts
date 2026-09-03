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
     * have — what it pins is that the row is not called a drawing, because the code
     * exists either way.
     *
     * This assertion read "not built yet" for one release, written against a `main`
     * that did not yet have the Spotify server tier. The code was there on a branch;
     * the spec agreed with the catalogue instead of with the server, which is how a
     * built capability came to be badged unbuilt.
     */
    const spotify = panel.getByTestId('integration-readiness-spotify').first();
    await expect(spotify).toContainText(/live|needs credentials/);
    await expect(spotify).not.toContainText('not built yet');

    /*
     * And nothing is badged unbuilt any more, which is worth asserting positively
     * rather than leaving as the absence of a row: every catalogue row is backed, so
     * a "not built yet" appearing anywhere means a row lost its `backing` or gained
     * one it should not have.
     */
    await expect(panel.getByText('not built yet')).toHaveCount(0);
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
