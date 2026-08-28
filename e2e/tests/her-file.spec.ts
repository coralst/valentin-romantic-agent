import { test, expect } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

/**
 * Her file, against a real seeded session.
 *
 * This is the spec that proves the board renders the *ingested* profile rather
 * than a fixture: it presses the demo toolbar's own seed button, which calls
 * `POST /api/session/seed` and writes `PREF#`, `PERSON#` and `TASK#` rows into
 * DynamoDB, then reloads the page so nothing on screen can have come from the
 * click's own optimistic state. Everything asserted below is read back from the
 * server.
 */

/** Seed Samantha, then reload so every value on screen has been through the API. */
async function seedAndOpenHerFile(page: import('@playwright/test').Page) {
  const app = new AppPage(page);
  await app.goto();

  // The toolbar lives behind the rail's gear, so it is two clicks even for a
  // presenter — which is deliberate: nothing that rewrites a session should be one
  // stray click away from the conversation.
  await page.getByRole('button', { name: 'Demo controls' }).click();
  await page.getByTestId('load-demo-profile-button').click();
  // The toolbar reports what it did; waiting on her name in the brief is the
  // narrower signal that the seed actually landed.
  await expect(page.getByTestId('brief-who')).toContainText('Samantha', { timeout: 20_000 });

  await page.reload();
  await expect(page.getByTestId('brief-who')).toContainText('Samantha', { timeout: 20_000 });

  await page.getByTestId('her-file-thread').click();
  await expect(page.getByTestId('dossier-view')).toBeVisible();
  return app;
}

test.describe('Her file — the board', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  test('reads as three bands, in order, with the tree last and widest', async ({ page }) => {
    await seedAndOpenHerFile(page);

    const pair = page.getByTestId('dossier-band-pair');
    const everything = page.getByTestId('dossier-everything');
    const tree = page.getByTestId('dossier-family-tree');
    for (const band of [pair, everything, tree]) await expect(band).toBeVisible();

    const boxes = await Promise.all([pair, everything, tree].map((b) => b.boundingBox()));
    // Top to bottom, and the tree really does get the whole measure — that is the
    // reason the board is bands rather than a grid of thirds.
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    expect(boxes[2]!.width).toBeGreaterThan(boxes[0]!.width / 2 + 100);
  });

  test('keeps the conversation list and the brief rail beside the board', async ({ page }) => {
    // Her file opens *in the chat column*. It used to take columns 2–4 with it,
    // which cost the user the list and the rail that says what is coming next.
    await seedAndOpenHerFile(page);
    await expect(page.getByTestId('session-sidebar')).toBeVisible();
    await expect(page.getByTestId('brief-rail')).toBeVisible();
    await expect(page.getByTestId('chat-panel')).not.toBeVisible();
    // And the list says where you are.
    await expect(page.getByTestId('her-file-thread')).toHaveAttribute('aria-current', 'true');
  });

  test('draws four generations, thirteen people and two gaps', async ({ page }) => {
    await seedAndOpenHerFile(page);

    for (const band of ['grandparent', 'elder', 'peer', 'younger']) {
      await expect(page.getByTestId(`family-band-${band}`)).toBeVisible();
    }

    // Her own card is drawn on the peer band but is not a record, so the count of
    // *records* is 13 and the node count is one more than that.
    await expect(page.getByTestId('dossier-family-tree')).toContainText('13 known');
    await expect(page.getByTestId('dossier-family-tree')).toContainText('2 still unnamed');
    const gaps = page.locator('[data-gap="true"]');
    await expect(gaps).toHaveCount(2);
    // A gap is a question, not a blank.
    await expect(gaps.first()).toContainText('Ask her');
  });

  test('keeps her own generation on one line', async ({ page }) => {
    // 134px nodes are chosen for exactly this: a seventh card orphaned onto a
    // second row reads as a descendant, which is a claim about her family the app
    // cannot make. jsdom performs no layout, so only a browser can catch it.
    await seedAndOpenHerFile(page);

    const band = page.getByTestId('family-band-peer');
    const nodes = band.locator('> *');
    const count = await nodes.count();
    const tops = new Set<number>();
    for (let index = 0; index < count; index += 1) {
      const box = await nodes.nth(index).boundingBox();
      if (box) tops.add(Math.round(box.y));
    }
    expect(tops.size).toBe(1);
  });

  test('fills every tile from the seeded profile', async ({ page }) => {
    await seedAndOpenHerFile(page);

    // The measurements card, including the Hebrew row, right-to-left.
    const sizes = page.getByTestId('dossier-her-sizes');
    await expect(sizes).toContainText('34B');
    await expect(sizes.locator('[lang="he"]')).toHaveAttribute('dir', 'rtl');

    // Four named swatches, the first of them the lead.
    await expect(page.getByTestId('palette-swatch')).toHaveCount(4);
    await expect(page.getByTestId('dossier-her-palette')).toContainText('Deep sage');

    // A priced shortlist against his budget.
    await expect(page.getByTestId('shortlist-budget')).toBeVisible();

    // Seven columns of her week, with the evenings she named already busy.
    await expect(page.getByTestId('her-week-column')).toHaveCount(7);
    await expect(page.getByTestId('dossier-her-week')).toContainText('pottery');
  });

  test('shows four weeks of dated cells and lights one of them', async ({ page }) => {
    await seedAndOpenHerFile(page);
    await expect(page.getByTestId('four-week-cell')).toHaveCount(28);
    await expect(page.locator('[data-testid="four-week-cell"][data-today="true"]')).toHaveCount(1);
    await expect(page.getByTestId('four-week-agenda-row')).toHaveCount(3);
  });

  test('ticks a to-do, and the tick survives a reload', async ({ page }) => {
    // The one thing on this board that cannot be derived. A tick that does not
    // survive the reload is worse than no list at all.
    await seedAndOpenHerFile(page);

    const row = page.getByTestId('task-row-demo-task-card-for-yosef');
    await expect(row).toHaveAttribute('data-done', 'false');
    await row.click();
    await expect(row).toHaveAttribute('data-done', 'true');

    await page.reload();
    await page.getByTestId('her-file-thread').click();
    await expect(page.getByTestId('task-row-demo-task-card-for-yosef')).toHaveAttribute(
      'data-done',
      'true',
    );
  });

  test('has no progress meter anywhere in the window', async ({ page }) => {
    // "21 of 21 known" was a score for the app rather than a fact about her, and it
    // was charged twice — in the board's header and in the rail's tally.
    await seedAndOpenHerFile(page);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByTestId('dossier-stat-bar')).toHaveCount(0);
    await expect(page.getByTestId('brief-tally')).toHaveCount(0);
  });

  test('pins the annuals in the rail, Tu B’Av included', async ({ page }) => {
    await seedAndOpenHerFile(page);
    const pinned = page.getByTestId('brief-pinned');
    await expect(pinned).toContainText("Valentine's");
    await expect(pinned).toContainText("Tu B'Av");
    await expect(page.getByTestId('brief-pinned-birthday')).toContainText('12 Jun');
  });
});
