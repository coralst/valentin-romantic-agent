/**
 * Takes desktop/tablet/mobile screenshots of a running app, seeding a demo
 * profile first so the shells are shot with real content rather than empty
 * states. Fails on any browser console error, so a screenshot run doubles as a
 * smoke test of the page it captures.
 *
 * Usage: npx tsx scripts/stage-shots.ts <label> [baseUrl]
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'fs/promises';
import path from 'path';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 375, height: 667 },
] as const;

const label = process.argv[2];
const baseUrl = process.argv[3] ?? 'http://localhost:5173';

if (!label) {
  console.error('usage: npx tsx scripts/stage-shots.ts <label> [baseUrl]');
  process.exit(1);
}

const outDir = path.resolve('screenshots', label);

/** Console errors seen across the whole run, tagged with the viewport. */
const consoleErrors: string[] = [];

function watchForErrors(page: Page, viewport: string) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`[${viewport}] console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(`[${viewport}] pageerror: ${error.message}`);
  });
}

/**
 * Click the demo seed button so the shot has content. The button lives behind
 * the icon rail's gear popover, so open that first. Best-effort: if the backend
 * is not up the shot is still taken, just with an empty state.
 */
async function seedDemoProfile(page: Page): Promise<boolean> {
  const gear = page.getByRole('button', { name: 'Demo controls' });
  if (!(await gear.isVisible().catch(() => false))) return false;
  await gear.click();

  const seed = page.getByTestId('load-demo-profile-button');
  if (!(await seed.isVisible().catch(() => false))) return false;
  await seed.click();

  // The button reads "Loading…" while in flight; wait for it to settle.
  await page
    .getByTestId('demo-toolbar-status')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});

  // Dismiss the popover so it does not cover the shell in the screenshot.
  await page.keyboard.press('Escape');
  return true;
}

async function shoot(browser: Browser, viewport: (typeof VIEWPORTS)[number]) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });
  watchForErrors(page, viewport.name);

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByTestId('app-layout').waitFor({ timeout: 15_000 });

  const seeded = await seedDemoProfile(page);
  // Let the seeded transcript settle and any transition finish.
  await page.waitForTimeout(900);

  const file = path.join(outDir, `${viewport.name}.png`);
  await page.screenshot({ path: file });
  console.log(
    `[stage-shots] ${viewport.name} ${viewport.width}x${viewport.height} -> ${file}` +
      (seeded ? ' (seeded)' : ' (not seeded)'),
  );

  await page.close();
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      await shoot(browser, viewport);
    }
  } finally {
    await browser.close();
  }

  if (consoleErrors.length > 0) {
    console.error(`\n[stage-shots] ${consoleErrors.length} browser error(s):`);
    for (const error of consoleErrors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log('\n[stage-shots] no browser errors');
}

main().catch((error) => {
  console.error('[stage-shots] failed:', error);
  process.exit(1);
});
