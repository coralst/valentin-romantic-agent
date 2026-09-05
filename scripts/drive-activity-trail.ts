/**
 * Visual check for the activity trail, the reasoning toggle and the permanent
 * "Noted" badge.
 *
 * The three claims vitest cannot make, because jsdom does no layout and holds no
 * clock the server can be late against:
 *
 *  1. The trail completes a tool row *while you are still waiting* — a real
 *     duration replacing `working…` before the reply arrives. That is the
 *     liveness claim, and a fake timer cannot test it.
 *  2. Turning the toggle on changes the next turn only, and reasoning appears
 *     without the reply ceasing to sound like Valentin.
 *  3. The badge survives a hard reload, with the transient staying silent.
 *
 * Sibling of `drive-learned-status.ts`, which covers the transient line.
 *
 * Needs a backend that can actually reach Bedrock — see the `dev-devops-agent`
 * profile in CLAUDE.md. Without it the agent returns its error fallback, no tool
 * runs, and only claim 3 is meaningful.
 *
 * Usage: npx tsx scripts/drive-activity-trail.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import path from 'path';

const baseUrl = process.argv[2] ?? 'http://localhost:5173';
const outDir = path.resolve('docs/design/checkpoints/activity-trail');

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('app-layout').waitFor({ timeout: 20_000 });

  const input = page.getByRole('textbox');
  const trail = page.getByTestId('agent-activity-trail');
  const toggle = page.getByTestId('show-thinking-toggle');

  // 1. The default case must be byte-for-byte today's UI: dots, no empty region.
  console.log(`[trail] toggle starts pressed: ${await toggle.getAttribute('aria-pressed')}`);
  console.log(`[trail] trail regions before any turn: ${await trail.count()}`);
  await page.screenshot({ path: path.join(outDir, '1-before-any-turn.png') });

  // 2. A turn that needs a tool. The row should appear, say `working…`, then carry
  //    an outcome and a measured duration — all before the reply lands.
  await input.fill('Find me a nice spotify playlist — heavy metal and eighties.');
  await input.press('Enter');

  try {
    await trail.waitFor({ timeout: 60_000 });
    await page.screenshot({ path: path.join(outDir, '2-tool-in-flight.png') });
    console.log(`[trail] in flight: ${JSON.stringify(await trail.innerText())}`);

    // Completion while still waiting is the whole claim. Poll for a duration
    // rather than sleeping, and say so plainly if it never arrives.
    const completed = await page
      .locator('[data-testid="agent-activity-trail"]')
      .filter({ hasText: /\d+(\.\d+)?s|\d+ms/ })
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[trail] a row completed with a real duration: ${completed}`);
    await page.screenshot({ path: path.join(outDir, '3-tool-completed.png') });
  } catch {
    console.log('[trail] no trail appeared — no tool ran (credentials?), skipping claim 1');
  }

  // 3. Reasoning, on demand only.
  await toggle.click();
  console.log(`[trail] toggle now pressed: ${await toggle.getAttribute('aria-pressed')}`);
  console.log(`[trail] hint: ${JSON.stringify(await page.getByTestId('show-thinking-hint').innerText())}`);
  await input.fill('What should I plan for her birthday?');
  await input.press('Enter');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(outDir, '4-reasoning-on.png') });
  console.log(`[trail] with reasoning on: ${JSON.stringify(await trail.innerText().catch(() => null))}`);

  // 4. The badge. A fact-bearing turn, then a hard reload.
  await input.fill("She's obsessed with peonies.");
  await input.press('Enter');
  const badge = page.getByTestId('noted-badge');
  const appeared = await badge
    .first()
    .waitFor({ timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  console.log(`[trail] badge appeared after the reply: ${appeared}`);
  await page.screenshot({ path: path.join(outDir, '5-badge-live.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('app-layout').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  console.log(`[trail] badges after a hard reload: ${await badge.count()}`);
  // The transient must NOT fire on a reload: the facts are loaded, not learned.
  console.log(`[trail] transient after reload: ${await page.getByTestId('learned-status').count()}`);
  console.log(`[trail] toggle persisted: ${await toggle.getAttribute('aria-pressed')}`);
  await page.screenshot({ path: path.join(outDir, '6-badge-after-reload.png') });

  if (errors.length) {
    console.error(`[trail] ${errors.length} browser error(s):`);
    for (const e of errors) console.error(`  ${e}`);
  } else {
    console.log('[trail] no browser errors');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[trail] failed:', e);
  process.exit(1);
});
