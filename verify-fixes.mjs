import { chromium } from '@playwright/test';
const URL = 'https://d26dwovftfq9oe.cloudfront.net';
const OUT = '/Users/coralst/.claude/jobs/8a459775/tmp';
const b = await chromium.launch();
const fail = [];
const ok = (l, c, x='') => { console.log(`  ${c?'PASS':'FAIL'}  ${l}${x?' — '+x:''}`); if(!c) fail.push(l); };

const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
const errs = []; p.on('pageerror', e=>errs.push(e.message));
p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto(URL, { waitUntil:'networkidle' });
await p.getByTestId('demo-login-button').click();
await p.waitForSelector('[data-testid="chat-panel"]', { timeout:60000 });
await p.waitForTimeout(6000);

const rowsL = await p.getByTestId('session-entry').count();
ok('Samantha has her back history', rowsL >= 5, `${rowsL} conversations`);

await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(8000);
ok('reload keeps you signed in', (await p.getByTestId('chat-panel').count()) === 1
   && (await p.getByTestId('login-screen').count()) === 0);
const rowsAfter = await p.getByTestId('session-entry').count();
ok('reload keeps the same conversations', rowsAfter === rowsL, `${rowsL} -> ${rowsAfter}`);
ok('the profile is still there after reload', /21\s+OF\s+21\s+KNOWN/i.test(await p.locator('body').innerText()));
await p.screenshot({ path:`${OUT}/live-01-after-reload.png` });

await p.getByRole('button', { name:'New chat' }).click();
await p.waitForTimeout(10000);
const greet = (await p.locator('[data-testid="message-bubble"]').allInnerTexts()).join(' ');
console.log(`  (greeting) ${greet.replace(/\s+/g,' ').slice(0,160)}`);
ok('a new chat greets by her name, not as a stranger',
   /samantha/i.test(greet) && !/what's something your partner absolutely loves/i.test(greet));

await p.getByPlaceholder(/Tell Valentin about her/i).fill('What should I get her for our anniversary?');
await p.keyboard.press('Enter');
let reply = '';
for (let i=0;i<70;i++){
  await p.waitForTimeout(1000);
  const all = await p.locator('[data-testid="message-bubble"]').allInnerTexts();
  const last = (all[all.length-1] ?? '').trim();
  if (last.length > 60 && !/anniversary\?$/.test(last)) { if (last === reply) break; reply = last; }
}
console.log(`  (reply) ${reply.replace(/\s+/g,' ').slice(0,320)}`);
ok('he answers instead of asking to be told about her',
   reply.length > 0 && !/tell me (more )?about your partner|what's something your partner/i.test(reply));
ok('he uses what he knows about her', /samantha|sam\b|sage|linen|italian|folk|kyoto|fig|pottery/i.test(reply));
await p.screenshot({ path:`${OUT}/live-02-goal2-reply.png` });

await p.getByTestId('rail-demo-button').click();
await p.waitForTimeout(700);
await p.getByTestId('sign-out-button').click();
await p.waitForTimeout(3500);
ok('sign out lands on the login page', (await p.getByTestId('login-screen').count()) === 1);
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(5000);
ok('a reload after sign out does NOT let you back in',
   (await p.getByTestId('login-screen').count()) === 1);

const p2 = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
p2.on('pageerror', e=>errs.push('door2: '+e.message));
await p2.goto(URL, { waitUntil:'networkidle' });
await p2.getByTestId('sign-up-button').click();
await p2.waitForSelector('[data-testid="chat-panel"]', { timeout:60000 });
await p2.waitForTimeout(8000);
ok('new account: exactly ONE conversation', (await p2.getByTestId('session-entry').count()) === 1);
const g2 = (await p2.locator('[data-testid="message-bubble"]').allInnerTexts()).join(' ');
ok('new account is greeted and asked about the partner', /valentin/i.test(g2) && /\?/.test(g2));
ok('new account starts empty', /0\s+OF\s+21\s+KNOWN/i.test(await p2.locator('body').innerText()));

await p2.reload({ waitUntil:'networkidle' });
await p2.waitForTimeout(8000);
ok('new account survives a reload', (await p2.getByTestId('chat-panel').count()) === 1);
const r2 = await p2.getByTestId('session-entry').count();
ok('reload does not multiply conversations', r2 === 1, `${r2} rows`);
ok('new account does NOT see Samantha', !/samantha/i.test(await p2.locator('body').innerText()));
await p2.screenshot({ path:`${OUT}/live-03-fresh-after-reload.png` });

ok('no console errors', errs.length === 0, errs.slice(0,3).join(' | '));
await b.close();
console.log(fail.length ? `\nRESULT: ${fail.length} FAILED -> ${fail.join('; ')}` : '\nRESULT: ALL PASS');
