/**
 * Rasterise the two-engine architecture board from `public/agentcore-compare.html`
 * into `public/deck-assets/`, so the deck can show it without an iframe.
 *
 * Only the `.board` element is captured — the page's own header, legend and the
 * tables below it are page furniture that the slide re-states in its own voice.
 * PowerPoint cannot place SVG reliably, which is why this is a PNG (same reason
 * `render-deck-diagrams.mts` rasters its Mermaid output).
 *
 * Writes into public/deck-assets/ rather than docs/deck-assets/ because that is
 * the one the deck's relative `deck-assets/...` URLs actually resolve to.
 *
 * Usage: npx tsx scripts/render-arch-diagram.mts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'public/agentcore-compare.html';
const OUT = 'public/deck-assets';
const FILE = 'diagram-two-engines.png';

/** Wide and tall enough that the board lays out at full width before clipping. */
const VIEWPORT = { width: 1600, height: 2000 };

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  const failures: string[] = [];
  page.on('console', (m) => m.type() === 'error' && failures.push(m.text()));
  page.on('requestfailed', (r) => failures.push(`could not load ${r.url()}`));

  await page.goto(pathToFileURL(resolve(SOURCE)).href, { waitUntil: 'networkidle' });
  // The board is laid out by script (lanes, node positions, connector paths), so
  // wait for it to have real height rather than a fixed sleep.
  await page.waitForFunction(() => {
    const b = document.querySelector('.board');
    return !!b && b.getBoundingClientRect().height > 400;
  }, { timeout: 15_000 });
  await page.waitForTimeout(600); // webfonts + connector strokes settle

  const board = page.locator('.board');
  await board.screenshot({ path: `${OUT}/${FILE}` });

  const box = await board.boundingBox();
  await browser.close();

  console.log(`${OUT}/${FILE} — ${Math.round(box!.width)}x${Math.round(box!.height)} css px @2x`);
  if (failures.length) {
    console.log(`load/console errors:\n  ${[...new Set(failures)].join('\n  ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
