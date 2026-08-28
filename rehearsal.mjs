// End-to-end rehearsal: drives the assembled app and asserts on what a person
// would actually see. Runs against localhost by default, so it is the fast way
// to catch display defects WITHOUT a deploy.
//
// Usage:
//   node rehearsal.mjs [url] [runLabel] [--no-live-resources]
//     url        default http://localhost:5173 (vite dev server)
//     runLabel   suffix for the screenshot filenames, default "local"
//     --no-live-resources
//                skip the two assertions that require the backend to report real
//                AWS resource names (use when the local backend is not wired to
//                the dev account)
//
// Every wait here is a CONDITION, not a sleep. It used to spend ~43s in
// unconditional waitForTimeout calls — that made the loop slow AND made failures
// slow, because a broken build still burned the full budget before reporting.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const URL = positional[0] ?? 'http://localhost:5173';
const RUN = positional[1] ?? 'local';
const CHECK_LIVE = !flags.has('--no-live-resources');

if (!/^https?:\/\//.test(URL)) {
  console.error(`ERROR: '${URL}' is not an http(s) URL.`);
  console.error('Usage: node rehearsal.mjs [url] [runLabel] [--no-live-resources]');
  process.exit(2);
}

const SHOT_DIR = 'screenshots/verify';
mkdirSync(SHOT_DIR, { recursive: true });

const started = Date.now();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const fail = [];
const ok = (label, cond) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) fail.push(label);
};
const skip = label => console.log(`  SKIP  ${label}`);

/** Poll until `fn()` is truthy. Returns false on timeout instead of throwing, so
 *  a missed condition becomes a readable FAIL rather than a stack trace. */
const waitFor = async (fn, { timeout = 20000, label = '' } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      // element not attached yet — keep polling
    }
    if (Date.now() > deadline) {
      if (label) console.log(`  (timed out after ${timeout}ms waiting for ${label})`);
      return false;
    }
    await p.waitForTimeout(150);
  }
};
const bodyText = () => p.locator('body').innerText();
const bodyMatches = re => waitFor(async () => re.test(await bodyText()), { label: String(re) });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

// The demo controls live inside the rail's gear popover (IconRail.tsx), not on a
// visible toolbar, so the popover has to be open before the seed and reset buttons
// exist at all. The gear *toggles*, so this checks first — clicking it while the
// popover is already open is what closes it, and then the button is unmounted.
const seed = p.getByRole('button', { name: /load demo profile/i });
const openDemoMenu = async () => {
  if (await seed.isVisible().catch(() => false)) return;
  await p.getByTestId('rail-demo-button').click();
};

// 1. seed
await openDemoMenu();
ok('seed control present', await waitFor(() => seed.isVisible(), { label: 'seed button' }));
await seed.click();
// Was a flat 6s sleep; the counter filling up is the actual signal.
// 21/21, not 18/18: the default persona is `samantha` (demo-personas.ts), and
// her fixture carries 21 preferences. The old numbers and the old name were from
// a persona that no longer seeds by default.
ok('21/21 after seed', await bodyMatches(/21\s*of\s*21/i));
let body = await bodyText();
ok('persona rendered (Samantha + Kyoto + sage)',
  body.includes('Samantha') && body.includes('Kyoto') && body.includes('sage'));
ok('announced "Demo profile loaded"', /demo profile loaded/i.test(body));

// 2. architecture drawer + live message
// By testid rather than by name: the drawer's own Hide control also matches
// /architecture/i, and a name-based .first() depends on DOM order to disambiguate.
await p.getByTestId('architecture-toggle').first().click();
// Scoped to the drawer: the toolbar's "Load demo profile" also matches /Demo/,
// so an unscoped name query is ambiguous in the assembled app even though it is
// unique in the drawer's own unit tests.
const drawer = p.getByTestId('architecture-drawer');
ok('drawer open', await bodyMatches(/Live Architecture/));
body = await bodyText();
if (CHECK_LIVE) {
  ok('real resource names drawn',
    body.includes('ValentinTable-dev') && body.includes('valentin-alb-dev'));
  // A socket exists here, so `useArchitectureMode` should have flipped to Live on
  // the first event rather than sitting on the scripted flow.
  ok('followed real traffic into live mode', !/Scripted walkthrough/.test(body));
} else {
  skip('real resource names drawn (--no-live-resources)');
  skip('followed real traffic into live mode (--no-live-resources)');
}

const composer = p.locator('textarea, input[type="text"]').first();
ok('composer usable with drawer open', await composer.isVisible().catch(() => false));
// Visibility is not enough: the drawer is an absolute overlay pinned to the
// bottom of the content area, and it used to sit on top of the composer — which
// jsdom cannot see, because it performs no layout. Assert the geometry.
const composerBox = await composer.boundingBox();
const drawerBox = await drawer.boundingBox();
ok('composer not covered by the drawer',
  !!composerBox && !!drawerBox && composerBox.y + composerBox.height <= drawerBox.y + 1);
await composer.click();
await composer.fill('She loves late-night jazz and hiking at sunrise.');
await p.keyboard.press('Enter');
// One real Bedrock round trip. Was a flat 16s sleep; it typically lands in ~5s,
// so poll with a ceiling well above the slow case.
ok('reply travelled through the diagram', await bodyMatches(/agent_message/));
ok('preference learned in feed', await bodyMatches(/preference_update/));
// Never a preference value on a projected screen — only its category and key.
ok('no raw preference value in the feed', !/late-night jazz/i.test(
  await p.getByTestId('aws-flow-feed').innerText().catch(() => ''),
));

// 2b. demo mode has to work as a standalone instrument
await drawer.getByRole('button', { name: 'Demo' }).click();
const stepCount = p.getByTestId('architecture-step-count');
ok('demo mode offers step controls',
  await waitFor(() => stepCount.isVisible(), { label: 'step count' }));
for (let i = 0; i < 8; i += 1) {
  await drawer.getByRole('button', { name: 'Next step' }).click();
}
ok('stepped to the end of the flow',
  await waitFor(async () => /Step 9 of 9/.test(await stepCount.innerText()),
    { label: 'step 9 of 9' }));
await p.screenshot({ path: `${SHOT_DIR}/rehearsal-${RUN}-drawer.png` });

// The drawer collapses rather than unmounting, so it must keep its place.
await p.getByRole('button', { name: 'Hide the architecture drawer' }).click();
ok('reopen bar keeps the step', await waitFor(async () =>
  /Step 9 of 9/.test(await p.getByTestId('architecture-reopen-bar').innerText()),
{ label: 'reopen bar' }));
await p.getByTestId('architecture-reopen-bar').click();
await waitFor(() => drawer.isVisible(), { label: 'drawer reopen' });

// 3. reset
// Back into the gear popover: it closes on outside click, and both Reset and the
// seed button live inside it.
await openDemoMenu();
const reset = p.getByRole('button', { name: /^reset$/i }).first();
await reset.click();
ok('counter cleared after reset', await bodyMatches(/0\s*of\s*21/i));

// 4. re-seed (the recovery path)
await openDemoMenu();
await seed.click();
ok('re-seed restores 21/21', await bodyMatches(/21\s*of\s*21/i));

ok('no console errors', errs.length === 0);
if (errs.length) console.log('  errors:', errs.slice(0, 4));
await p.screenshot({ path: `${SHOT_DIR}/rehearsal-${RUN}.png` });
await b.close();

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`  screenshots: ${SHOT_DIR}/rehearsal-${RUN}.png, ${SHOT_DIR}/rehearsal-${RUN}-drawer.png`);
console.log(fail.length
  ? `RESULT ${RUN}: ${fail.length} FAILED in ${secs}s -> ${fail.join('; ')}`
  : `RESULT ${RUN}: ALL PASS in ${secs}s`);
process.exit(fail.length ? 1 : 0);
