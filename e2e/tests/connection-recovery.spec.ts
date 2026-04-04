import { test, expect } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

test.describe('Connection Recovery', () => {
  test('connection banner is hidden when WebSocket is connected', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    // Wait for the welcome message — proves the WebSocket connected successfully
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 10_000 });

    // The connection banner should NOT be visible when connected.
    // ConnectionBanner renders null when status === 'connected', so the
    // element won't exist in the DOM at all.
    await expect(app.chat.connectionBanner).toHaveCount(0);
  });

  test('connection banner element is absent from DOM when connected', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    // Wait for WebSocket to connect (welcome message is the proof)
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 10_000 });

    // Verify the banner data-testid is not present anywhere in the page
    const bannerCount = await page.locator('[data-testid="connection-banner"]').count();
    expect(bannerCount).toBe(0);
  });
});
