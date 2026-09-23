import { test, expect, type Page } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

/**
 * The A/B switch, asserted where it actually has to hold: in the browser.
 *
 * Three separate claims, each of which has been wrong at some point:
 *
 * 1. Selecting AgentCore really points the socket at `/ws/agentcore` and really
 *    stamps `X-Valentin-Engine` on `/api/config`. Both are routing rules the ALB
 *    enforces, so a header that never leaves the browser is a switch that silently
 *    does nothing while the whole panel claims otherwise.
 * 2. The chip reports **who answered**, not what was picked — including the
 *    downgrade, when a deployment missing its AgentCore wiring answers as engine A.
 *    That is the one state where the panel would otherwise lie on a projector.
 * 3. The Gateway and its tool Lambda are **live on the diagram only** with the toggle
 *    on, and greyed out otherwise. They are engine B's benefit; showing them as part
 *    of engine A's path would credit the control arm with the thing being
 *    demonstrated.
 *
 * Nothing here needs AgentCore to be deployed. The local server accepts both socket
 * paths on purpose (`WS_PATHS` in `src/server/agent/engine.ts`), so the frames, the
 * headers and the rendering are all real even though one engine is answering.
 */

/** Socket URLs the page tried to open, in order. */
async function recordSocketPaths(page: Page): Promise<string[]> {
  const opened: string[] = [];

  // Both patterns, and `**/ws` does not match `/ws/agentcore` — a glob segment
  // stops at the slash — so the two handlers stay distinct and the order the app
  // reconnected in is preserved.
  for (const pattern of ['**/ws', '**/ws/agentcore']) {
    await page.routeWebSocket(pattern, (ws) => {
      opened.push(new URL(ws.url()).pathname);
      const server = ws.connectToServer();
      ws.onMessage((frame) => server.send(frame));
      server.onMessage((frame) => ws.send(frame));
    });
  }

  return opened;
}

/** Every `X-Valentin-Engine` value `/api/config` was asked with, in order. */
async function recordConfigHeaders(page: Page): Promise<(string | undefined)[]> {
  const asked: (string | undefined)[] = [];

  await page.route('**/api/config', async (route) => {
    asked.push(route.request().headers()['x-valentin-engine']);
    await route.continue();
  });

  return asked;
}

/** Open the architecture drawer, whichever state it starts in. */
async function openDrawer(page: Page): Promise<void> {
  const bar = page.getByTestId('architecture-reopen-bar');
  await expect(bar).toBeVisible({ timeout: 15_000 });
  if ((await bar.getAttribute('aria-expanded')) !== 'true') await bar.click();
  await expect(page.getByTestId('architecture-drawer')).toBeVisible();
}

async function selectEngine(page: Page, engine: 'valentin' | 'agentcore'): Promise<void> {
  const option = page.getByTestId(`rail-engine-${engine}`);
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
}

test.describe('The engine toggle', () => {
  test('points the socket at /ws/agentcore and stamps the routing header', async ({ page }) => {
    const opened = await recordSocketPaths(page);
    const asked = await recordConfigHeaders(page);
    const app = new AppPage(page);
    await app.goto();

    // Engine A first, which is where the app starts: no header at all, rather than
    // an explicit `valentin`. The baseline route has to keep working on a
    // deployment that has never heard of a second engine.
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(asked[0]).toBeUndefined();
    await expect.poll(() => opened, { timeout: 15_000 }).toContain('/ws');
    expect(opened).not.toContain('/ws/agentcore');

    await selectEngine(page, 'agentcore');

    // The socket is torn down and reopened on the other path — the switch is a
    // reconnection, not a flag on the same connection.
    await expect.poll(() => opened, { timeout: 15_000 }).toContain('/ws/agentcore');
    await expect.poll(() => asked, { timeout: 15_000 }).toContain('agentcore');
  });

  test('the chip reports who answered, and says so when the answer is a downgrade', async ({
    page,
  }) => {
    // A deployment whose AgentCore wiring is absent answers `engine: 'valentin'`
    // even when asked for AgentCore. Faked here rather than deployed twice: the
    // behaviour under test is the client's honesty about the answer, and the answer
    // is one field.
    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ json: { ...body, engine: 'valentin' } });
    });

    const app = new AppPage(page);
    await app.goto();
    await openDrawer(page);

    const chip = page.getByTestId('architecture-serving-chip');
    await expect(chip).toHaveAttribute('data-serving', 'valentin', { timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-downgraded', 'false');

    await selectEngine(page, 'agentcore');

    // Selected AgentCore, served Valentin: the chip still names who answered, and
    // now says the two disagree.
    await expect(chip).toHaveAttribute('data-serving', 'valentin', { timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-downgraded', 'true');
  });

  test('activates the Gateway and its tool Lambda only when AgentCore is selected', async ({
    page,
  }) => {
    // Both halves of the topology are always in the DOM — the diagram is one map of
    // the account, and a card that vanished would make the two engines look like two
    // systems. What the toggle changes is `data-state`: `muted` for a node the
    // selected engine does not use. So the claim is *inactive*, not *absent*, and
    // this test says so in those terms rather than pretending nodes appear.
    const app = new AppPage(page);
    await app.goto();
    await openDrawer(page);

    const gateway = page.getByTestId('aws-node-ac-gateway');
    // The Lambda that holds the provider keys — its own card now, rather than a tool
    // count in the Gateway's caption.
    const toolLambda = page.getByTestId('aws-node-ac-lambda-tools');
    const bedrock = page.getByTestId('aws-node-bedrock');

    // Engine A: the Gateway branch is greyed out. Nothing on engine A's path reaches
    // it, so lighting it would credit the control arm with the Gateway.
    await expect(gateway).toHaveAttribute('data-state', 'muted', { timeout: 15_000 });
    await expect(toolLambda).toHaveAttribute('data-state', 'muted');
    await expect(bedrock).not.toHaveAttribute('data-state', 'muted');

    await selectEngine(page, 'agentcore');

    await expect(gateway).not.toHaveAttribute('data-state', 'muted', { timeout: 15_000 });
    await expect(toolLambda).not.toHaveAttribute('data-state', 'muted');
    // Bedrock stays lit on both engines, because both call the model. It used to
    // grey out here, on the reasoning that the greyed half is "what this engine
    // does not use" — but 56b79c4 marked Bedrock shared and added the
    // ac-runtime → bedrock edge precisely because dimming it told the audience
    // engine B has no model call. The proxy cannot *observe* that call; that is a
    // limit of the instrumentation, not of the architecture, and the diagram
    // should not turn it into a missing component.
    await expect(bedrock).not.toHaveAttribute('data-state', 'muted');

    // Back again, because the interesting failure is the sticky one: a branch that
    // lights on the first switch and never goes dark.
    await selectEngine(page, 'valentin');
    await expect(gateway).toHaveAttribute('data-state', 'muted', { timeout: 15_000 });
    await expect(toolLambda).toHaveAttribute('data-state', 'muted');
    await expect(bedrock).not.toHaveAttribute('data-state', 'muted');
  });

  test('the Gateway names its endpoint and the two Lambdas name their tools', async ({ page }) => {
    // The Gateway's caption used to carry the tool count for both targets behind it.
    // The targets are cards of their own now, so the claim splits: the Gateway says
    // what it is, and each Lambda says how many tools it answers for. Unit tests pin
    // those counts against the generated schemas; this pins that they reach the screen.
    const app = new AppPage(page);
    await app.goto();
    await openDrawer(page);
    await selectEngine(page, 'agentcore');

    const gateway = page.getByTestId('aws-node-ac-gateway');
    await expect(gateway).toBeVisible({ timeout: 15_000 });
    await expect(gateway).toContainText('MCP');

    await expect(page.getByTestId('aws-node-ac-lambda-profile')).toContainText(/\d+ tools/);
    await expect(page.getByTestId('aws-node-ac-lambda-tools')).toContainText(/\d+ tools/);
  });

  test('lists the registered tool entry points, and only on the engine that has them', async ({
    page,
  }) => {
    // "Show the entry points themselves that are registered as tools." The panel is
    // the one place the diagram states what is *on* the Gateway rather than that a
    // Gateway exists — and it greys out on engine A, where the same schemas are
    // rebuilt in-process and described to Bedrock inside every Converse request.
    const app = new AppPage(page);
    await app.goto();
    await openDrawer(page);

    const panel = page.getByTestId('aws-tool-panel');
    await expect(panel).toHaveAttribute('data-state', 'muted', { timeout: 15_000 });
    await expect(panel).toContainText('No tool registry');

    await selectEngine(page, 'agentcore');

    await expect(panel).toHaveAttribute('data-state', 'active-engine', { timeout: 15_000 });
    await expect(panel).toContainText('Registered on the Gateway');
    // Two names a room can look up: one from each Lambda, so the panel is shown to be
    // reading the model rather than printing a hard-coded sample.
    await expect(page.getByTestId('aws-tool-entry-save_preference')).toBeVisible();
    await expect(page.getByTestId('aws-tool-entry-find_music')).toBeVisible();
    // And a confirm half, which is the pair the Gateway's registry makes visible:
    // proposing and sending are two entry points because they are two authorities.
    await expect(page.getByTestId('aws-tool-entry-confirm_email')).toBeVisible();
  });

  test('keeps one shared table, one shared provider card and one set of logos', async ({ page }) => {
    // The duplication this replaced: a second DynamoDB card and a second External APIs
    // card drawn inside engine B's band, which read as two tables and left the room
    // asking which one her preferences were in. One card each now, on both engines —
    // what differs is the route drawn into them.
    const app = new AppPage(page);
    await app.goto();
    await openDrawer(page);

    await expect(page.getByTestId('aws-node-dynamodb')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('aws-node-integrations')).toHaveCount(1);
    await expect(page.getByTestId('aws-provider-strip')).toHaveCount(1);

    await selectEngine(page, 'agentcore');

    await expect(page.getByTestId('aws-node-dynamodb')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('aws-node-integrations')).toHaveCount(1);
    await expect(page.getByTestId('aws-provider-strip')).toHaveCount(1);
    // Shared means unshaded on both halves: greying the table when you switch would
    // claim engine B keeps her preferences somewhere else.
    await expect(page.getByTestId('aws-node-dynamodb')).not.toHaveAttribute('data-state', 'muted');
  });
});
