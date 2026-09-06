import { chromium } from 'playwright';
const OUT = process.argv[3] || '/Users/coralst/.claude/jobs/84959c04/tmp/pv';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto('file://' + process.argv[2]);
await p.waitForTimeout(600);
const n = await p.locator('section').count();
for (let i = 0; i < n; i++) {
  const el = p.locator('section').nth(i);
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${OUT}/p${i}.png` });
  const box = await el.boundingBox();
  console.log(i, Math.round(box.width) + 'x' + Math.round(box.height));
}
await b.close();
