import { test, expect } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

test.describe('Responsive Layout', () => {
  test('dual-panel layout at desktop viewport (≥768px)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const app = new AppPage(page);
    await app.goto();

    await expect(app.appLayout).toHaveAttribute('data-layout', 'desktop');
    await expect(app.mobileNav).not.toBeVisible();
  });

  test('single-panel with tab toggle at mobile viewport (<768px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const app = new AppPage(page);
    await app.goto();

    await expect(app.appLayout).toHaveAttribute('data-layout', 'mobile');
    await expect(app.mobileNav).toBeVisible();
  });

  /**
   * The one breakpoint on her file, and the case a viewport media query gets wrong.
   *
   * Whether the calendar and the to-do list fit side by side depends on the
   * *board's* measure, not the window's: at 1600 the board gets ~908px with the
   * conversation list showing, at 1180 it gets ~734px with the list hidden, and at
   * 1300 — list showing, narrower window — only ~628px. So a 1300px window must
   * stack the pair while an 1180px one does not, which no viewport breakpoint can
   * express. This drives both, in a real browser, because jsdom performs no layout
   * and container queries do not exist there at all.
   */
  test('stacks her file’s top pair on the board’s measure, not the window’s', async ({ page }) => {
    const app = new AppPage(page);

    await page.setViewportSize({ width: 1600, height: 1000 });
    await app.goto();
    await page.getByTestId('her-file-thread').click();
    await expect(page.getByTestId('dossier-band-pair')).toBeVisible();

    const columnsAt = async () => {
      const box = await page.getByTestId('dossier-band-pair').boundingBox();
      const calendar = await page.getByTestId('dossier-four-weeks').boundingBox();
      // Side by side means the calendar takes about half the band; stacked means it
      // takes all of it.
      return calendar!.width < box!.width * 0.75 ? 2 : 1;
    };

    expect(await columnsAt()).toBe(2);

    // Narrower window, list still showing: the board loses more than the window
    // does, because three of the shell's four tracks are fixed.
    await page.setViewportSize({ width: 1300, height: 1000 });
    await expect.poll(columnsAt).toBe(1);

    // Narrower still, but with the list's 226px handed to the board — which is
    // wider than the previous case, and must go back to two.
    await page.setViewportSize({ width: 1180, height: 1000 });
    await page.getByTestId('sidebar-menu-button').click();
    await expect.poll(columnsAt).toBe(2);
  });

  test('tab toggle switches between Chat and Profile panels', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const app = new AppPage(page);
    await app.goto();

    // Chat tab should be active by default
    const chatTab = app.mobileNav.getByRole('tab', { name: 'Chat' });
    const profileTab = app.mobileNav.getByRole('tab', { name: 'Profile' });

    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(profileTab).toHaveAttribute('aria-selected', 'false');

    // Switch to Profile
    await profileTab.click();
    await expect(profileTab).toHaveAttribute('aria-selected', 'true');
    await expect(chatTab).toHaveAttribute('aria-selected', 'false');

    // The empty state should be visible on the Profile panel
    await expect(app.profile.emptyState).toBeVisible();

    // Switch back to Chat
    await chatTab.click();
    await expect(chatTab).toHaveAttribute('aria-selected', 'true');
    await expect(app.chat.messageInput).toBeVisible();
  });
});
