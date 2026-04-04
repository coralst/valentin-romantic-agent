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
