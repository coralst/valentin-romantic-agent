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

// The deployed app opens on a login gate; localhost does not. Without this the
// script could only ever verify localhost — and the two things it most needs to
// check are things ONLY the deployed app can show, because `resolveEngine` is
// resolved per process rather than per request and it is the ALB that routes a
// request to the second Fargate service.
//
// Raced rather than polled: an `isVisible()` straight after `domcontentloaded`
// answers "no" on both surfaces, because React has rendered neither of them yet
// — which is how a guarded login click can look like it ran and did nothing.
// Waiting for whichever lands first costs the local run nothing and tells us
// which surface we are standing on.
const login = p.getByTestId('demo-login-button');
const railGear = p.getByTestId('rail-demo-button');
await Promise.race([
  login.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {}),
  railGear.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {}),
]);
if (await login.isVisible().catch(() => false)) {
  await login.click();
  await railGear.waitFor({ state: 'visible', timeout: 45000 });
}

// The demo controls live inside the rail's gear popover (IconRail.tsx), not on a
// visible toolbar, so the popover has to be open before the seed and reset buttons
// exist at all. The gear *toggles*, so this checks first — clicking it while the
// popover is already open is what closes it, and then the button is unmounted.
const seed = p.getByRole('button', { name: /load demo profile/i });
const openDemoMenu = async () => {
  if (await seed.isVisible().catch(() => false)) return;
  await p.getByTestId('rail-demo-button').click();
};
// And put it away again before touching the app underneath it. The menu is a
// ~360px floating panel over the shell, so leaving it up means the next click can
// land on the menu instead of its target — which is exactly what happened here,
// silently, until the ⚙ moved and the menu started covering a button this script
// presses. A presenter closes the menu after seeding; so does this.
const closeDemoMenu = async () => {
  if (!(await seed.isVisible().catch(() => false))) return;
  await p.keyboard.press('Escape');
  await p.getByTestId('rail-demo-popover').waitFor({ state: 'hidden' });
};

// The rail's empty state, which is the seed/reset signal now.
//
// It used to be the "N of 21" tally in the rail's footer. #84 rebuilt her brief
// and moved that counter onto her file, so the tally is no longer on the surface
// this driver is standing on — the assertion went on passing a regex against a
// number that had left the page. This asks the question the tally was standing in
// for, on the surface that answers it: is anything known about her at all.
const emptyRail = p.getByTestId('empty-encouragement');
const railIsEmpty = () => emptyRail.isVisible().catch(() => false);
const railIsPopulated = async () => !(await railIsEmpty());

// 1. seed
await openDemoMenu();
ok('seed control present', await waitFor(() => seed.isVisible(), { label: 'seed button' }));
await seed.click();
// Polled from the moment of the click rather than read off a snapshot taken after
// the rail fills, because the announcement is a toast that dismisses itself: by
// the time the rail is populated it may already have gone, which reads as "never
// announced" on a slower round trip.
const announced = await bodyMatches(/demo profile loaded/i);
// Was a flat 6s sleep; the rail filling up is the actual signal. The persona's
// own details are asserted on the next line, which is what proves *which* profile
// landed — this one only proves that one did.
ok('rail populated after seed', await waitFor(railIsPopulated, { label: 'rail populated' }));
let body = await bodyText();
ok('persona rendered (Samantha + Kyoto + sage)',
  body.includes('Samantha') && body.includes('Kyoto') && body.includes('sage'));
ok('announced "Demo profile loaded"', announced);
await closeDemoMenu();

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
} else {
  skip('real resource names drawn (--no-live-resources)');
}
// `followed real traffic into live mode` and `still says which engine is
// answering` used to be asserted here, which is before this script has caused any
// traffic — the drawer is correctly still on the script at this point, so the
// first read either failed for the wrong reason or (spelled in sentence case
// against uppercase-rendered text) could not fail at all. Both moved below the
// chat turn, where there is real traffic to have followed.

// The diagram itself now carries the comparison that a separate "Why AgentCore" sheet
// used to make in prose, and the two controls in front of it are gone: the sheet was a
// second surface arguing what the picture is for, and the Live/Demo pair only offered
// a presenter the chance to be in the wrong mode mid-sentence. Both absences are
// asserted, because a control that comes back in a later refactor comes back on a
// projector.
const drawerText = await drawer.innerText();
ok('no scoreboard sheet competing with the diagram',
  !(await p.getByTestId('engine-scoreboard').isVisible().catch(() => false))
  && !(await p.getByTestId('scoreboard-toggle').isVisible().catch(() => false)));
ok('no data-source switch to get stuck in the wrong half of',
  !/\bLive\b\s*\/?\s*\bDemo\b/.test(drawerText) && !/Data source/i.test(drawerText));

// One table and one set of provider APIs, drawn once and shared. This is the
// duplication the room kept tripping over: two cards bearing `ValentinTable-dev` read
// as two tables, and the question it prompted was which one her preferences were in.
ok('one shared table, not one per engine',
  await p.getByTestId('aws-node-dynamodb').count() === 1);
ok('one shared provider card, with one strip of logos',
  await p.getByTestId('aws-node-integrations').count() === 1
  && await p.getByTestId('aws-provider-strip').count() === 1);

// And the Gateway's registry, which is the thing an architecture diagram usually
// cannot show: not that a Gateway exists but what is registered on it. Greyed on
// engine A, where the same schemas are rebuilt in-process every turn — so the panel is
// present and captioned rather than blank.
const toolPanel = p.getByTestId('aws-tool-panel');
ok('the Gateway’s registered entry points are on the diagram',
  await waitFor(() => toolPanel.isVisible(), { label: 'tool panel' }));
const toolPanelText = await toolPanel.innerText();
ok('the registry names the Lambdas behind it',
  toolPanelText.includes('valentin-profile-tools-dev')
  && toolPanelText.includes('valentin-integration-tools-dev'));
// Case-insensitive on purpose: the heading is `text-transform: uppercase`, and
// `innerText` reports text as rendered rather than as written.
ok('the registry is greyed while engine A is selected, and says why',
  await toolPanel.getAttribute('data-state') === 'muted'
  && /no tool registry/i.test(toolPanelText));
await p.screenshot({ path: `${SHOT_DIR}/rehearsal-${RUN}-topology.png` });

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
//
// Asserted on the beats the feed RENDERS, not on wire event names. These used to
// look for `agent_message` and `preference_update`, which are websocket `type`
// values that never reach the DOM — the feed groups spans into readable beats
// ("writes a reply", "learns something new"). Both assertions were therefore
// unfalsifiable-in-reverse: they could only ever fail, and locally they did, for
// the unrelated reason that this IAM user cannot call Bedrock. That masked the
// question they are here to answer.
ok('reply travelled through the diagram', await bodyMatches(/writes a reply/i));
ok('preference learned in feed', await bodyMatches(/learns something new/i));

// Now that this script has caused traffic, the two things that could not be
// asked before it did.
ok('followed real traffic into live mode',
  await waitFor(async () => !/scripted walkthrough/i.test(await drawer.innerText()),
    { label: 'live mode' }));
// The chip stayed, because unlike the deleted switch it reports something only the
// running system knows: which engine actually answered, and whether it was
// downgraded to get there.
const servingChip = p.getByTestId('architecture-serving-chip');
ok('still says which engine is answering',
  await waitFor(() => servingChip.isVisible(), { label: 'serving chip' }));

// The DIY engine calls Converse twice on every turn — once for the reply with
// tools, once to extract preferences — and the count on the feed header is where
// that stops being a claim and becomes a number a room can read. Polled rather
// than read once: the extraction call is the second of the two, so the count is
// legitimately 1 for a few seconds before it is 2.
const countedBoth = await bodyMatches(/2 model calls/i);
ok('the feed counts both of engine A’s model calls', countedBoth);
if (!countedBoth) {
  const summary = (await drawer.innerText()).match(/\d+ spans? · \d+ model calls?/i);
  console.log(`  (feed header said: ${summary ? summary[0] : 'no span/model summary on screen'})`);
}
// Never a preference value on a projected screen — only its category and key.
ok('no raw preference value in the feed', !/late-night jazz/i.test(
  await p.getByTestId('aws-flow-feed').innerText().catch(() => ''),
));

// 2b. the scripted walkthrough has to work as a standalone instrument
//
// Reached by a verb now, not by a data-source switch — and reachable at all is the
// point of the test. The socket pings every thirty seconds, so by this line the drawer
// has been in live mode for a while; without this door the walkthrough would be gone
// for the rest of the session, which is the one thing the drawer is for when there is
// no traffic to point at yet.
await drawer.getByRole('button', { name: 'Walk the flow' }).click();
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
ok('rail emptied after reset', await waitFor(railIsEmpty, { label: 'rail empty' }));

// 4. re-seed (the recovery path)
await openDemoMenu();
await seed.click();
ok('re-seed refills the rail', await waitFor(railIsPopulated, { label: 'rail repopulated' }));

ok('no console errors', errs.length === 0);
if (errs.length) console.log('  errors:', errs.slice(0, 4));
// The headline screenshot is the artefact a reviewer actually opens, so it should
// show the app rather than the demo menu parked on top of the shell.
await closeDemoMenu();
await p.screenshot({ path: `${SHOT_DIR}/rehearsal-${RUN}.png` });
await b.close();

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`  screenshots: ${SHOT_DIR}/rehearsal-${RUN}.png, ${SHOT_DIR}/rehearsal-${RUN}-drawer.png, ${SHOT_DIR}/rehearsal-${RUN}-topology.png`);
console.log(fail.length
  ? `RESULT ${RUN}: ${fail.length} FAILED in ${secs}s -> ${fail.join('; ')}`
  : `RESULT ${RUN}: ALL PASS in ${secs}s`);
process.exit(fail.length ? 1 : 0);
