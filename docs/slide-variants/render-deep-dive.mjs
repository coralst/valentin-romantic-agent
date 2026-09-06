const { chromium } = await import('/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/node_modules/playwright/index.mjs');
const OUT = '/Users/coralst/.claude/jobs/84959c04/tmp';
const BASE = '/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/.claude/worktrees/deck-html-deepdive';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
await p.goto(`file://${BASE}/docs/slide-variants/deep-dive-v3.html`);
await p.waitForTimeout(1200);
const secs = await p.$$('section');
console.log('sections:', secs.length);
for (let i = 0; i < secs.length; i++) {
  const bx = await secs[i].boundingBox();
  const id = await secs[i].getAttribute('id');
  console.log(id, Math.round(bx.width) + 'x' + Math.round(bx.height));
  await secs[i].scrollIntoViewIfNeeded();
  await p.waitForTimeout(120);
  await secs[i].screenshot({ path: `${OUT}/v3-${i + 1}-${id}.png` });
}
await b.close();
