/**
 * Visual check for the transient "Noted" status line.
 *
 * jsdom does no layout, so vitest cannot say whether the line reads as
 * subordinate to the messages, nor whether its departure moves anything. This
 * drives the real app: state a fact, screenshot while the line is up, screenshot
 * again once it has cleared, and confirm the fact reached the profile panel.
 *
 * Usage: npx tsx scripts/drive-learned-status.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import path from 'path';

const baseUrl = process.argv[2] ?? 'http://localhost:5247';
const outDir = path.resolve('docs/design/checkpoints/learned-status');

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
  await input.fill(
    "Her name's Samantha, she uses she/her, and she's badly allergic to shellfish.",
  );
  await input.press('Enter');

  // The line is up for four seconds, so the shot has to be taken the moment it
  // appears rather than after a fixed sleep.
  const line = page.getByTestId('learned-status');
  await line.waitFor({ timeout: 60_000 });
  const box = await line.boundingBox();
  await page.screenshot({ path: path.join(outDir, 'while-visible.png') });
  console.log(`[learned-status] visible: ${JSON.stringify(await line.textContent())}`);
  console.log(`[learned-status] box: ${JSON.stringify(box)}`);

  // The transcript must not move when the line goes: measure the last bubble
  // before and after.
  const bubbles = page.getByTestId('message-bubble');
  const lastBefore = await bubbles.last().boundingBox();

  await line.waitFor({ state: 'detached', timeout: 30_000 });
  const lastAfter = await bubbles.last().boundingBox();
  await page.screenshot({ path: path.join(outDir, 'after-cleared.png') });
  console.log(`[learned-status] last bubble y before=${lastBefore?.y} after=${lastAfter?.y}`);
  console.log(
    `[learned-status] slot still reserved: ${await page.getByTestId('learned-status-slot').count()}`,
  );

  const profileText = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  console.log(`[learned-status] shellfish in panel: ${/shellfish/i.test(profileText)}`);

  // A second turn that teaches two unrelated things: the server emits two
  // events, and they must still land as one line.
  await input.fill('She loves late-night jazz and hiking at sunrise.');
  await input.press('Enter');
  await line.waitFor({ timeout: 60_000 });
  await page.screenshot({ path: path.join(outDir, 'two-facts-one-line.png') });
  console.log(`[learned-status] lines on screen: ${await line.count()}`);
  console.log(`[learned-status] second line: ${JSON.stringify(await line.textContent())}`);

  if (errors.length) {
    console.error(`[learned-status] ${errors.length} browser error(s):`);
    for (const e of errors) console.error(`  ${e}`);
  } else {
    console.log('[learned-status] no browser errors');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[learned-status] failed:', e);
  process.exit(1);
});
