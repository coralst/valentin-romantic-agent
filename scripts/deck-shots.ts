/**
 * Capture the PNGs used by the PowerPoint deck: the four design mockups plus a
 * screenshot of the running app mid-conversation. Writes into docs/deck-assets/.
 *
 * Usage: npx tsx scripts/deck-shots.ts [baseUrl]
 * Requires the dev servers to be running (see README).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = 'docs/deck-assets';

const MOCKUPS = [
  ['option-2-love-letter', 'love-letter'],
  ['option-4-atelier', 'atelier'],
  ['option-5a-dossier', 'dossier'],
  ['option-5c-card', 'her-card'],
] as const;

const TURNS = [
  'Her name is Coral, she was born June 17th 1988',
  'female',
  'She is very cool, she likes to surf and dance salsa',
  'She loves Thai food and her love language is quality time',
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const [file, name] of MOCKUPS) {
    await page.goto(`${BASE}/mockups/${file}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600); // let the webfonts settle
    await page.screenshot({ path: `${OUT}/mockup-${name}.png` });
    console.log(`captured mockup-${name}.png`);
  }

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const input = page.getByLabel('Type a message');
  await input.waitFor({ timeout: 30_000 });

  for (const turn of TURNS) {
    await input.fill(turn);
    await page.getByLabel('Send message').click();
    // Each turn is a real Bedrock round trip, plus async extraction behind it.
    await page.waitForTimeout(14_000);
    console.log(`sent: ${turn.slice(0, 40)}...`);
  }

  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/app-live.png` });
  console.log('captured app-live.png');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
