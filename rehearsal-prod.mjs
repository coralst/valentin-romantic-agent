import { chromium } from '@playwright/test';
const URL = process.argv[2];
const RUN = process.argv[3];
// Parallel background jobs share /tmp and clobber each other's files.
const SHOTS = process.env.SHOT_DIR ?? '/tmp';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const fail = [];
const ok = (label, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fail.push(label); };

await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);

// 0. The landing page now stands in front of the app, so the way to the toolbar
// is through it. Local runs with auth disabled show "Continue" instead.
const demo = p.locator('[data-testid="demo-login-button"]');
const signIn = p.locator('[data-testid="sign-in-button"]');
if (await demo.count()) await demo.click();
else if (await signIn.count()) await signIn.click();
await p.waitForSelector('[data-testid="chat-panel"]', { timeout: 45000 });
await p.waitForTimeout(3000);

// The demo controls are no longer always on screen: they live in a popover
// behind the rail's gear, and any outside click closes it. So open it before
// every toolbar interaction rather than once.
const openDemo = async () => {
  if (!(await p.getByTestId('rail-demo-popover').count())) {
    await p.getByTestId('rail-demo-button').click();
    await p.waitForTimeout(700);
  }
};

// 1. seed
await openDemo();
const seed = p.getByRole('button', { name: /load demo profile/i });
await seed.click();
await p.waitForTimeout(6000);
let body = await p.locator('body').innerText();
// The rail restyle spells the counter "18 OF 18 KNOWN"; the old "18/18" form is
// gone from the UI, so the slash regex could only ever fail.
ok('18 of 18 after seed', /18\s+OF\s+18\s+KNOWN/i.test(body));
// The fixture's partner is Samantha now, not Mira — the rename this integration
// carries. "pottery" is dropped from the assertion because the chip strip
// truncates values ("Dreams of Kyoto during cherry…"); it lives in the dossier.
ok('persona rendered (Samantha + Kyoto)', body.includes('Samantha') && body.includes('Kyoto'));
ok('announced "Demo profile loaded"', /demo profile loaded/i.test(body));

// 2. architecture drawer + live message
// By testid rather than by name: the drawer's own Hide control also matches
// /architecture/i, and a name-based .first() depends on DOM order to disambiguate.
await p.getByTestId('architecture-toggle').first().click();
await p.waitForTimeout(2000);
// Scoped to the drawer: the toolbar's "Load demo profile" also matches /Demo/,
// so an unscoped name query is ambiguous in the assembled app even though it is
// unique in the drawer's own unit tests.
const drawer = p.getByTestId('architecture-drawer');
body = await p.locator('body').innerText();
ok('drawer open', body.includes('Live Architecture'));
ok('real resource names drawn', body.includes('ValentinTable-dev') && body.includes('valentin-alb-dev'));
// A socket exists here, so `useArchitectureMode` should have flipped to Live on
// the first event rather than sitting on the scripted flow.
ok('followed real traffic into live mode', !/Scripted walkthrough/.test(body));

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
await p.waitForTimeout(16000);
body = await p.locator('body').innerText();
ok('reply travelled through the diagram', /agent_message/.test(body));
ok('preference learned in feed', /preference_update/.test(body));
// Never a preference value on a projected screen — only its category and key.
ok('no raw preference value in the feed', !/late-night jazz/i.test(
  await p.getByTestId('aws-flow-feed').innerText().catch(() => ''),
));

// 2b. demo mode has to work as a standalone instrument
await drawer.getByRole('button', { name: 'Demo' }).click();
await p.waitForTimeout(500);
const stepCount = p.getByTestId('architecture-step-count');
ok('demo mode offers step controls', await stepCount.isVisible().catch(() => false));
for (let i = 0; i < 8; i += 1) {
  await drawer.getByRole('button', { name: 'Next step' }).click();
  await p.waitForTimeout(250);
}
ok('stepped to the end of the flow', /Step 9 of 9/.test(await stepCount.innerText()));
await p.screenshot({ path: `${SHOTS}/rehearsal-${RUN}-drawer.png` });

// The drawer collapses rather than unmounting, so it must keep its place.
await p.getByRole('button', { name: 'Hide the architecture drawer' }).click();
await p.waitForTimeout(600);
ok('reopen bar keeps the step', /Step 9 of 9/.test(
  await p.getByTestId('architecture-reopen-bar').innerText(),
));
await p.getByTestId('architecture-reopen-bar').click();
await p.waitForTimeout(600);

// 3. reset
await openDemo();
const reset = p.getByRole('button', { name: /^reset$/i }).first();
await reset.click();
await p.waitForTimeout(5000);
body = await p.locator('body').innerText();
ok('counter cleared after reset', /0\s+OF\s+18\s+KNOWN/i.test(body));

// 4. re-seed (the recovery path)
await openDemo();
await seed.click();
await p.waitForTimeout(6000);
body = await p.locator('body').innerText();
ok('re-seed restores 18 of 18', /18\s+OF\s+18\s+KNOWN/i.test(body));

ok('no console errors', errs.length === 0);
if (errs.length) console.log('  errors:', errs.slice(0, 4));
await p.screenshot({ path: `${SHOTS}/rehearsal-${RUN}.png` });
await b.close();
console.log(fail.length ? `RESULT ${RUN}: ${fail.length} FAILED -> ${fail.join('; ')}` : `RESULT ${RUN}: ALL PASS`);
process.exit(fail.length ? 1 : 0);
