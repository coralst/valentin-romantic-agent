/**
 * Drives the three session-lifecycle defects in a real browser.
 *
 * jsdom does no layout and has no WebSocket, so the whole class of bug this
 * covers — a socket that mints a session before the conversation list has
 * arrived, and a transcript that re-animates on return — is invisible to
 * vitest. This walks the app the way a presenter does and prints what it sees.
 *
 * Usage: npx tsx scripts/drive-session-lifecycle.mts [baseURL]
 * Expects the dev pair from vite.config.session.mts (backend :3411, web :5411).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5411';
const SHOTS = '/tmp/vm-shots';

mkdirSync(SHOTS, { recursive: true });

function log(...args: unknown[]) {
  console.log('[drive]', ...args);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') log('page error:', msg.text());
  });

  // A brand-new browser profile is a brand-new dev user: `devUserId()` mints a
  // uuid into localStorage, and the server keys storage on it.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 15_000 });
  await page.waitForTimeout(2500);

  const rows = async () => page.locator('[data-testid="session-entry"]').count();
  const transcript = async () =>
    page.locator('[data-testid="message-bubble"]').allInnerTexts();

  log('--- defect 1: how many conversations does a fresh account land in?');
  log('sidebar rows:', await rows());
  log('server sessions:', await serverSessionCount(page));
  await page.screenshot({ path: `${SHOTS}/01-fresh.png` });

  log('--- defect 2: is there an opening greeting?');
  log('transcript:', JSON.stringify(await transcript(), null, 1));

  log('--- sending two messages');
  for (const text of ['She loves Italian food', 'Her birthday is in June']) {
    await page.getByLabel('Type a message').fill(text);
    await page.getByLabel('Send message').click();
    await page.waitForTimeout(9000);
  }
  const before = await transcript();
  log('transcript after two turns:', JSON.stringify(before, null, 1));
  await page.screenshot({ path: `${SHOTS}/02-after-two-turns.png` });

  log('--- defect 3: switch away and back');
  await page.getByLabel('New chat').click();
  await page.waitForTimeout(2500);
  log('rows after New chat:', await rows());
  await page.screenshot({ path: `${SHOTS}/03-second-conversation.png` });

  // Back to the first conversation: it is the older row, so the last one.
  const entries = page.locator('[data-testid="session-entry"]');
  await entries.nth((await entries.count()) - 1).click();
  await page.waitForTimeout(600);
  const afterImmediate = await transcript();
  // A restored conversation must not re-announce what it already knew.
  const notedOnReturn = await page.locator('[data-testid="learned-status"]').count();
  await page.waitForTimeout(4000);
  const after = await transcript();
  await page.screenshot({ path: `${SHOTS}/04-switched-back.png` });

  log('transcript on return (immediately):', JSON.stringify(afterImmediate, null, 1));
  log('transcript on return (settled):', JSON.stringify(after, null, 1));
  log('identical to before:', JSON.stringify(before) === JSON.stringify(after));
  log(
    'partially-typed on arrival (typewriter re-run):',
    JSON.stringify(afterImmediate) !== JSON.stringify(after),
  );
  log('NOTED lines flashed on return (want 0):', notedOnReturn);
  log('server sessions at end:', await serverSessionCount(page));

  // The original repro for the empty rows: every reload used to leave an orphan.
  log('--- reload probe');
  for (let i = 1; i <= 3; i += 1) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="chat-panel"]', { timeout: 15_000 });
    await page.waitForTimeout(2500);
    log(`reload ${i}: rows=${await rows()} serverSessions=${await serverSessionCount(page)}`);
  }
  await page.screenshot({ path: `${SHOTS}/05-after-reloads.png` });

  await browser.close();
}

/** Ask the API directly, with the page's own credentials. */
async function serverSessionCount(page: import('@playwright/test').Page) {
  // Same origin, through the dev proxy: an absolute backend URL trips CORS.
  return page.evaluate(async () => {
    const dev = localStorage.getItem('valentin.devUser');
    const res = await fetch('/api/sessions', {
      headers: dev ? { Authorization: `Bearer dev:${dev}` } : {},
    });
    const body = (await res.json()) as { sessions?: unknown[] };
    return body.sessions?.length ?? `error ${res.status}`;
  });
}

void main();
