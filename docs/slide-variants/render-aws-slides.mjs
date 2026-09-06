/* render-aws-slides.mjs — renders picked <section>s of public/deck-v2.html to 16:9
   PNGs, with docs/slide-variants/aws-retint.css injected so they carry the AWS
   presentation palette instead of the Valentin one.
       node docs/slide-variants/render-aws-slides.mjs <outDir>
   1600x900 at dpr 1.5 matches the deck's 12192000x6858000 EMU exactly. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] || '/tmp/aws-slides');
const ROOT = resolve(import.meta.dirname, '../..');
const SECTIONS = ['cost', 'blast', 'team', 'graph'];

mkdirSync(OUT, { recursive: true });
const retint = readFileSync(resolve(ROOT, 'docs/slide-variants/aws-retint.css'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1.5,
});
await page.goto('file://' + resolve(ROOT, 'public/deck-v2.html'));
await page.addStyleTag({ content: '#dots,#counter,.mark,.editbadge{display:none !important}' });
await page.addStyleTag({ content: retint });
// Reserve the template's chrome bands: the badge occupies the top 1.05in (126px)
// and the footer strip starts at 7.05in (846px). Without this the deck's own
// content runs under both.
await page.addStyleTag({ content: 'section{padding:132px 40px 76px !important}' });
// These sections were authored for the old three-part narrative; relabel the
// kicker for the deep-dive structure. Content is untouched.
await page.evaluate((labels) => {
  for (const [id, html] of Object.entries(labels)) {
    const act = document.querySelector('#' + id + ' .act');
    if (act) act.innerHTML = html;
  }
}, {
  cost: '<b>Deep-dive</b> · AgentCore Runtime · cost',
  blast: '<b>Deep-dive</b> · AgentCore Runtime · reliability &amp; security',
  team: '<b>How I built it</b> · the team',
  graph: '<b>How I built it</b> · the work',
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);

// The contribution graph is an external <img>, so page CSS can't reach inside it.
// Point it at the AWS-palette copy instead.
await page.evaluate((src) => {
  for (const img of document.querySelectorAll('img[src*="agent-contribution-graph"]')) {
    img.src = src;
  }
}, 'file://' + resolve(OUT, 'agent-contribution-graph-aws.svg'));
await page.waitForTimeout(500);

const meta = {};
for (const id of SECTIONS) {
  const el = page.locator('#' + id);
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  // Sections are authored to grow with their content; a slide is exactly 16:9.
  // Zoom (not transform — zoom reflows) whatever overflows down to fit.
  const fit = await el.evaluate((node) => {
    node.style.zoom = '';
    const was = node.getBoundingClientRect().height;
    if (was <= 901) return { k: 1, was: Math.round(was) };
    // zoom scales the reported box too, so converge rather than solve once:
    // reflow at a smaller zoom can change the content height.
    let k = 900 / was;
    for (let i = 0; i < 6; i++) {
      node.style.zoom = String(k);
      const h = node.getBoundingClientRect().height;
      if (Math.abs(h - 900) < 0.5) break;
      k *= 900 / h;
    }
    return { k: Number(k.toFixed(4)), was: Math.round(was) };
  });
  await page.waitForTimeout(200);
  await el.screenshot({ path: `${OUT}/${id}.png` });

  // Record every link in section-relative px so the build step can lay invisible
  // hyperlink boxes over the same spots in the pptx.
  meta[id] = await el.evaluate((node) => {
    const b = node.getBoundingClientRect();
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      links: [...node.querySelectorAll('a[href]')].map((a) => {
        const c = a.getBoundingClientRect();
        return {
          href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 40),
          x: Math.round(c.left - b.left), y: Math.round(c.top - b.top),
          w: Math.round(c.width), h: Math.round(c.height),
        };
      }),
    };
  });
  meta[id].fit = fit;
  console.log(id, `zoom=${fit.k} (was ${fit.was}px)`,
    `-> ${meta[id].w}x${meta[id].h}`, `links=${meta[id].links.length}`);
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2));
await browser.close();
console.log('wrote', OUT);
