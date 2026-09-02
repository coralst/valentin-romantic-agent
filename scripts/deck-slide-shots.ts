/**
 * Capture one PNG per slide of the HTML deck, plus a manifest of each slide's
 * title and visible text. `scripts/build-pptx.py` turns the pair into a .pptx.
 *
 * The deck is static and every asset it loads is relative, so this opens it over
 * file:// by default — no dev server, and nothing to collide with on a port.
 * Pass a URL to shoot a served copy instead.
 *
 * Usage: npx tsx scripts/deck-slide-shots.ts [url] [--deck=deck-v2.html]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = 'docs/deck-export';

/** 1600×900 at 2× — 16:9, and crisp when PowerPoint renders it full-bleed. */
const VIEWPORT = { width: 1600, height: 900 };
const SCALE = 2;

interface Slide {
  file: string;
  id: string;
  title: string;
  notes: string;
  clipped: string;
}

function parseArgs(argv: string[]) {
  const deckArg = argv.find((a) => a.startsWith('--deck='));
  const deck = deckArg ? deckArg.slice('--deck='.length) : 'deck-v2.html';
  const urlArg = argv.find((a) => !a.startsWith('--'));
  const url = urlArg ?? pathToFileURL(resolve('public', deck)).href;
  return { url, deck };
}

async function main() {
  const { url, deck } = parseArgs(process.argv.slice(2));

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });

  const failures: string[] = [];
  page.on('console', (m) => m.type() === 'error' && failures.push(m.text()));
  page.on('requestfailed', (r) => failures.push(`could not load ${r.url()}`));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900); // let the webfonts settle before the first shot

  const sections = await page.evaluate(() =>
    [...document.querySelectorAll('section')].map((s) => ({
      id: s.id,
      title: (s as HTMLElement).dataset.title ?? s.id,
    })),
  );

  const slides: Slide[] = [];

  for (const [i, { id, title }] of sections.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const file = `${n}-${id}.png`;

    await page.evaluate((x) => document.getElementById(x)!.scrollIntoView(), id);
    await page.waitForTimeout(500); // scroll-snap settles, then shoot
    await page.screenshot({ path: `${OUT}/${file}` });

    const { notes, over } = await page.evaluate((x) => {
      const s = document.getElementById(x)!;
      return {
        notes: (s as HTMLElement).innerText.replace(/\n{2,}/g, '\n').trim(),
        over: {
          w: s.scrollWidth - window.innerWidth,
          h: s.scrollHeight - window.innerHeight,
        },
      };
    }, id);

    // A slide taller or wider than the viewport loses whatever falls outside it,
    // in the PNG and therefore in the pptx. Report it rather than shipping it blind.
    const clipped = [over.w > 2 && `${over.w}px wide`, over.h > 2 && `${over.h}px tall`]
      .filter(Boolean)
      .join(', ');

    slides.push({ file, id, title, notes, clipped });
    console.log(`${n}  ${title}${clipped ? `  ⚠ clipped: ${clipped}` : ''}`);
  }

  writeFileSync(
    `${OUT}/slides.json`,
    `${JSON.stringify({ deck, source: url, viewport: VIEWPORT, scale: SCALE, slides }, null, 2)}\n`,
  );

  await browser.close();

  const anyClipped = slides.filter((s) => s.clipped);
  if (anyClipped.length) {
    console.log(`\n${anyClipped.length} slide(s) overflow 1600×900 and will be cut off in the pptx.`);
  }
  if (failures.length) {
    console.log(`\nload/console errors:\n  ${[...new Set(failures)].join('\n  ')}`);
  }
  console.log(`\n${slides.length} slides → ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
