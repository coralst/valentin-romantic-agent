/**
 * Capture the per-stage checkpoint screenshots for the UI rebuild.
 *
 * Uses "Load demo profile" rather than driving a live conversation, so a
 * checkpoint takes ~10s instead of ~60s and produces the same frame every run.
 * A live-conversation shot is scripts/deck-shot-app.ts.
 *
 * Must live in the project directory — run from /tmp and the @playwright/test
 * import fails with ERR_MODULE_NOT_FOUND.
 *
 * Usage: npx tsx scripts/stage-shots.ts <stage-label> [baseUrl]
 *   npx tsx scripts/stage-shots.ts stage3
 *   npx tsx scripts/stage-shots.ts stage3-deployed https://d26dwovftfq9oe.cloudfront.net
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const LABEL = process.argv[2] ?? 'stage';
const BASE = process.argv[3] ?? 'http://localhost:5173';
const OUT = 'docs/design/checkpoints';

/** The plan's verification widths: desktop comp, desktop threshold, phone. */
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'threshold', width: 1024, height: 768 },
  { name: 'mobile', width: 375, height: 667 },
];

async function seed(page: Page): Promise<boolean> {
  const button = page.getByTestId('load-demo-profile-button');
  if ((await button.count()) === 0) {
    console.log('  no load-demo-profile-button found — capturing empty state');
    return false;
  }
  await button.click();
  // The seed round-trips to the server, then the client reloads preferences.
  await page.waitForTimeout(4_000);
  return true;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors: string[] = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${vp.name}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${vp.name}] pageerror: ${e.message}`));

    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Verify the app actually rendered — CloudFront serves index.html with a 200
    // for any path, so a status code proves nothing about a deployed page.
    console.log(`${vp.name}: <title> ${await page.title()}`);
    await page.getByTestId('app-layout').waitFor({ timeout: 30_000 });

    await seed(page);
    await page.screenshot({ path: `${OUT}/${LABEL}-${vp.name}.png` });
    console.log(`  captured ${LABEL}-${vp.name}.png (${vp.width}x${vp.height})`);

    // Full-page too, so a rail that clips its last row is visible in the artifact.
    if (vp.name === 'desktop') {
      await page.screenshot({ path: `${OUT}/${LABEL}-desktop-full.png`, fullPage: true });
      console.log(`  captured ${LABEL}-desktop-full.png`);
    }
    await page.close();
  }

  await browser.close();

  if (errors.length > 0) {
    console.log('\n===== BROWSER ERRORS =====');
    errors.forEach((e) => console.log(e));
    process.exitCode = 1;
  } else {
    console.log('\nno browser errors');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
