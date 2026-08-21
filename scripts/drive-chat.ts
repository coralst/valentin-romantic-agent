/**
 * Drives a real conversation against a running app so screenshots show actual
 * bubbles, typing states and learned chips rather than an empty transcript.
 *
 * Usage: npx tsx scripts/drive-chat.ts <label> [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import path from 'path';

const label = process.argv[2] ?? 'drive';
const baseUrl = process.argv[3] ?? 'http://localhost:5199';
const outDir = path.resolve('docs/design/checkpoints', label);

const TURNS = [
  "Her name's Mirabel and she uses she/her. She's turning 32 in June.",
  'She loves salsa dancing and she is badly allergic to shellfish.',
];

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('app-layout').waitFor({ timeout: 15_000 });

  const input = page.getByRole('textbox');
  for (const turn of TURNS) {
    await input.fill(turn);
    await input.press('Enter');
    // Wait for the agent's reply to land rather than a fixed sleep.
    await page.waitForTimeout(14_000);
  }

  await page.screenshot({ path: path.join(outDir, 'conversation.png') });
  console.log(`[drive-chat] -> ${path.join(outDir, 'conversation.png')}`);

  const bubbles = await page.getByTestId('message-bubble').count();
  console.log(`[drive-chat] message bubbles: ${bubbles}`);
  if (errors.length) {
    console.error(`[drive-chat] ${errors.length} browser error(s):`);
    for (const e of errors) console.error(`  ${e}`);
  } else {
    console.log('[drive-chat] no browser errors');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('[drive-chat] failed:', e);
  process.exit(1);
});
