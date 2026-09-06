/**
 * Rasterise the left-to-right two-engine board from `public/deck-arch-lr.html`
 * into `public/deck-assets/diagram-two-engines-lr.png`.
 *
 * Companion to render-arch-diagram.mts, which shoots the tall reference board on
 * public/agentcore-compare.html. That one is for reading on a page; this one is
 * for a 16:9 slide, where a tall board has to shrink to ~7in wide and its type
 * stops being legible from the back of a room.
 *
 * Usage: npx tsx scripts/render-arch-lr.mts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'public/deck-arch-lr.html';
const OUT = 'public/deck-assets';
const FILE = 'diagram-two-engines-lr.png';

/** The board's own fixed size, plus slack so nothing reflows before clipping. */
const VIEWPORT = { width: 2900, height: 1160 };

async function main() {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  const failures: string[] = [];
  page.on('console', (m) => m.type() === 'error' && failures.push(m.text()));
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => failures.push(`could not load ${r.url()}`));

  await page.goto(pathToFileURL(resolve(SOURCE)).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const b = document.querySelector('.board');
    return !!b && b.querySelectorAll('.card').length > 10;
  }, { timeout: 15_000 });
  await page.waitForTimeout(600); // webfonts + dashed strokes settle

  const board = page.locator('.board');
  await board.screenshot({ path: `${OUT}/${FILE}` });

  /* Cards that overflow their fixed height would have connectors emerging from
     inside them, which is the exact bug this layout's fixed heights exist to
     prevent — so report it rather than shipping a quietly wrong board. */
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('.card')]
      .map((c) => {
        const body = c.querySelector('.body') as HTMLElement;
        const pad = 30; // 15px top + 15px bottom
        const over = body.scrollHeight + pad - (c as HTMLElement).offsetHeight;
        return { name: c.querySelector('.service')!.textContent, over };
      })
      .filter((r) => r.over > 0)
  );

  const box = await board.boundingBox();
  await browser.close();

  console.log(`${OUT}/${FILE} — ${Math.round(box!.width)}x${Math.round(box!.height)} css px @2x`);
  if (overflow.length) {
    console.log('cards taller than their fixed height (connectors will be wrong):');
    for (const o of overflow) console.log(`  ${o.name}: +${o.over}px`);
  }
  if (failures.length) {
    console.log(`load/console errors:\n  ${[...new Set(failures)].join('\n  ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
