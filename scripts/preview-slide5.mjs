/**
 * Approximate slide 5 of docs/Valentin-Presentation-v2.pptx as a 13.333x7.5in
 * page so the new diagram can be checked at slide scale without PowerPoint or
 * LibreOffice (neither is available here). Geometry mirrors what build put in
 * the pptx: picture 12.23x4.22in at (0.55, 2.34).
 *
 * Usage: npx tsx scripts/preview-slide5.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const IN = 96; // css px per inch at 1x
/* Relative, and the page is written into public/ — Chromium refuses to load a
   file:// image into a setContent()/about:blank document. */
const img = 'deck-assets/diagram-two-engines-lr.png';

const html = `<body style="margin:0;font-family:Inter,Helvetica,Arial,sans-serif">
<div style="position:relative;width:${13.333 * IN}px;height:${7.5 * IN}px;background:#fff">
  <div style="position:absolute;left:${0.55 * IN}px;top:${0.4 * IN}px;width:${0.62 * IN}px;height:${0.62 * IN}px;border-radius:50%;background:#232F3E;color:#F5A623;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:26px">4</div>
  <div style="position:absolute;left:${1.4 * IN}px;top:${0.44 * IN}px;font-size:34px;font-weight:700;color:#16283C">Architecture — Two Engines, One Product</div>
  <div style="position:absolute;left:${0.55 * IN}px;top:${1.18 * IN}px;width:${1.5 * IN}px;height:4px;background:#F5A623"></div>
  <div style="position:absolute;left:${0.55 * IN}px;top:${1.45 * IN}px;font-size:19px;color:#3B4A5A">The front door and the middle strip are shared. Only the two dashed bands differ.</div>
  <img src="${img}" style="position:absolute;left:${0.55 * IN}px;top:${2.34 * IN}px;width:${12.23 * IN}px;height:${4.22 * IN}px">
  <div style="position:absolute;left:${0.55 * IN}px;top:${7.02 * IN}px;font-size:13px;font-weight:700;color:#16283C">VALENTIN &nbsp;·&nbsp; GenAI TFC Capstone Deep-Dive</div>
  <div style="position:absolute;left:${11.95 * IN}px;top:${7.02 * IN}px;font-size:13px;color:#8A94A0">5 / 12</div>
</div></body>`;

mkdirSync('screenshots/verify', { recursive: true });
const scratch = resolve('public/_slide5-preview.html');
writeFileSync(scratch, html);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Math.round(13.333 * IN), height: Math.round(7.5 * IN) },
  deviceScaleFactor: 2,
});
try {
  await page.goto(pathToFileURL(scratch).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/verify/slide-5-arch-lr.png' });
} finally {
  await browser.close();
  rmSync(scratch, { force: true });
}
console.log('screenshots/verify/slide-5-arch-lr.png');
