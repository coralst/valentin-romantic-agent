/**
 * Capture the PR 58 review thread for the deck's "agents arguing" slide.
 * The repo is public, so this needs no GitHub auth.
 *
 * Usage: npx tsx scripts/deck-shot-pr.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PR = 'https://github.com/coralst/valentin-romantic-agent/pull/58';
const OUT = 'docs/deck-assets';

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto(PR, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // GitHub has shipped several comment container classes over the years; try each.
  const candidates = ['.js-comment-container', '.timeline-comment', '[data-testid="issue-body"]', '.js-timeline-item'];
  let sel = '';
  for (const c of candidates) {
    const n = await page.locator(c).count();
    console.log(`${c} -> ${n}`);
    if (n && !sel) sel = c;
  }
  if (!sel) throw new Error('no comment container matched');

  const comments = page.locator(sel);
  const total = await comments.count();
  console.log(`using ${sel}, ${total} matches`);

  for (let i = 0; i < total; i++) {
    const el = comments.nth(i);
    const text = ((await el.innerText().catch(() => '')) || '').slice(0, 60).replace(/\s+/g, ' ');
    console.log(`[${i}] ${text}`);
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${OUT}/pr58-comment-${i}.png` }).catch((e) => console.log(`  skip: ${e.message}`));
  }

  // The long comments are unreadable when scaled onto a slide, so also take a
  // top-crop of each beat in the story at a density that projects.
  const CROPS = [
    { i: 1, h: 560, out: 'pr58-review.png' },   // master's review, opening + first issue
    { i: 2, h: 560, out: 'pr58-pushback.png' }, // frontend pushes back with reasoning
    { i: 4, h: 560, out: 'pr58-accepted.png' }, // master accepts the pushback
  ];
  for (const { i, h, out } of CROPS) {
    const el = comments.nth(i);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await el.boundingBox();
    if (!box) { console.log(`no box for ${out}`); continue; }
    await page.screenshot({
      path: `${OUT}/${out}`,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(h, box.height) },
    });
    console.log(`cropped ${out}`);
  }

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
