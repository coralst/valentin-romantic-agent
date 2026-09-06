const { chromium } = await import('/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent/node_modules/playwright/index.mjs');
const OUT = '/Users/coralst/.claude/jobs/84959c04/tmp';
const BASE = '/Users/coralst/Desktop/screenshots/projects/valentin-romantic-agent';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
const missing = [];
p.on('requestfailed', r => missing.push(r.url()));
p.on('response', r => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });
await p.goto(`file://${BASE}/public/deck-v2.html`);
await p.waitForTimeout(1500);
// hide presenter chrome so each section screenshots as a clean slide
await p.addStyleTag({ content: '#dots,#counter,.mark,.editbadge{display:none !important}' });
for (const id of ['cost', 'blast', 'team', 'graph']) {
  const s = await p.$(`#${id}`);
  const bx = await s.boundingBox();
  console.log(id, Math.round(bx.width) + 'x' + Math.round(bx.height));
  await s.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  await s.screenshot({ path: `${OUT}/good-${id}.png` });
}
// link audit
const links = await p.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
console.log('LINKS', JSON.stringify([...new Set(links)], null, 0));
console.log('FAILED_REQ', JSON.stringify([...new Set(missing)]));
await b.close();
