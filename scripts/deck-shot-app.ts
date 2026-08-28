/**
 * Drive a short conversation, then dump the profile panel's text and capture the
 * app screenshot used on the demo slide. Split out from deck-shots.ts so the app
 * shot can be retaken without re-capturing the static mockups.
 *
 * Usage: npx tsx scripts/deck-shot-app.ts [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = 'docs/deck-assets';

const TURNS = [
  'Her name is Coral, she was born June 17th 1988',
  'female',
  'She is very cool, she likes to surf and dance salsa',
  'She loves Thai food and her love language is quality time',
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[browser error]', m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const input = page.getByLabel('Type a message');
  await input.waitFor({ timeout: 30_000 });

  for (const turn of TURNS) {
    await input.fill(turn);
    await page.getByLabel('Send message').click();
    await page.waitForTimeout(15_000);
    console.log(`sent: ${turn.slice(0, 40)}`);
  }

  // Extraction is async and lands after the reply, so give it extra room.
  await page.waitForTimeout(12_000);

  console.log('\n===== PROFILE PANEL TEXT =====');
  console.log(await page.locator('aside, [class*="profile"]').last().innerText());
  console.log('===== END =====\n');

  await page.screenshot({ path: `${OUT}/app-live.png` });
  console.log('captured app-live.png');
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
