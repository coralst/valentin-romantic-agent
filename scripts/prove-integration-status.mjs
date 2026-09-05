/**
 * Prove the header's integration strip is telling the truth.
 *
 * The unit tests pin the mapping from a readiness object to a tile state, but they
 * supply that object themselves. This asks the running server what it actually
 * holds and then checks the rendered DOM against that answer, service by service —
 * which is the only way to catch the strip reading the wrong field, the fetch never
 * firing, or a stale copy of readiness in a second subtree.
 *
 * It also unplugs the endpoint mid-run: a status surface has to degrade to "can't
 * tell" rather than to a confident zero, and that path has no unit-test equivalent.
 *
 * Usage: node scripts/prove-integration-status.mjs [appUrl] [apiUrl] [outDir]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = process.argv[2] ?? `http://localhost:${process.env.VITE_PORT ?? 5173}`;
const API = process.argv[3] ?? `http://localhost:${process.env.PORT ?? 3001}`;
const OUT = process.argv[4] ?? 'screenshots/verify';

// Catalogue row -> the backing service id the server reports on.
const BACKING = {
  ontopo: 'ontopo',
  'google-places': 'google-places',
  'google-calendar': 'google-calendar',
  wolt: 'wolt',
  spotify: 'spotify',
  amadeus: 'amadeus',
  gmail: 'gmail',
  whatsapp: 'whatsapp',
  hebcal: 'hebcal',
};

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

const truth = await (await fetch(`${API}/api/integrations`)).json();
const configured = new Map(truth.integrations.map((i) => [i.id, i.configured]));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(APP, { waitUntil: 'networkidle' });

const strip = page.getByTestId('integration-status-strip');
await strip.waitFor({ timeout: 15000 });
check(true, 'the strip is in the conversation header');

// Every rendered tile must match the server, service by service.
const tiles = await page.locator('[data-testid^="integration-status-"]').all();
let compared = 0;
for (const tile of tiles) {
  const id = (await tile.getAttribute('data-testid')).replace('integration-status-', '');
  if (!(id in BACKING)) continue;
  const status = await tile.getAttribute('data-status');
  const expected = configured.get(BACKING[id]) ? 'configured' : 'unconfigured';
  check(status === expected, `${id}: rendered "${status}", server says "${expected}"`);
  compared += 1;
}
check(compared > 0, `compared ${compared} tiles against the server`);

// The count in the accessible name must be the server's count, not a guess.
const serverCount = Object.keys(BACKING).filter((id) => configured.get(BACKING[id])).length;
const domCount = Number(await strip.getAttribute('data-configured-count'));
check(domCount === serverCount, `count: strip says ${domCount}, server implies ${serverCount}`);

const label = await strip.getAttribute('aria-label');
check(
  label.includes(`${serverCount} of 9 have credentials`),
  `accessible name states the real count: "${label}"`,
);
const title = await strip.getAttribute('title');
check(
  title.includes('can still fail if they have been revoked'),
  'the tooltip carries the revocation caveat',
);
check(!/\b(live|working|connected|active)\b/i.test(title), 'the tooltip never claims live/working');

// Now the part a unit test cannot prove: when the endpoint is down, the strip
// must degrade to "can't tell" rather than to a confident zero.
await page.route('**/api/integrations', (r) => r.abort());
await page.reload({ waitUntil: 'networkidle' });
const down = page.getByTestId('integration-status-strip');
await down.waitFor({ timeout: 15000 });
const downLabel = await down.getAttribute('aria-label');
check(/status unavailable/i.test(downLabel), `endpoint down reads "${downLabel}"`);
const unknowns = await page.locator('[data-status="unknown"]').count();
check(unknowns > 0, `endpoint down renders ${unknowns} hollow "unknown" tiles`);
await page.unroute('**/api/integrations');

// Screenshot the honest state, zoomed on the header. The console check below
// covers this healthy load only — the aborted fetch above logs a network error
// by construction, which is the test's doing and not the app's.
errors.length = 0;
await page.reload({ waitUntil: 'networkidle' });
await page.getByTestId('integration-status-strip').waitFor({ timeout: 15000 });
fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}/integration-status-app.png` });
const box = await page.getByTestId('integration-status-strip').boundingBox();
await page.screenshot({
  path: `${OUT}/integration-status-header.png`,
  clip: { x: Math.max(0, box.x - 380), y: Math.max(0, box.y - 26), width: 760, height: 80 },
});

check(errors.length === 0, `no console errors (${errors.slice(0, 3).join(' | ')})`);
await browser.close();

console.log(fails.length ? `\nRESULT: ${fails.length} FAILED` : '\nRESULT: ALL PASS');
process.exit(fails.length ? 1 : 0);
