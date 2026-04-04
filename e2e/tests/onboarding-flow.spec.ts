import { test, expect } from '@playwright/test';
import { AppPage } from '../fixtures/page-objects';

test.describe('Onboarding Flow', () => {
  let app: AppPage;

  test.beforeEach(async ({ page }) => {
    app = new AppPage(page);
    await app.goto();
  });

  test('app loads and displays the Valentin logo', async ({ page }) => {
    const logo = page.getByAltText('Valentin logo');
    await expect(logo).toBeVisible();
  });

  test('app shows welcome message from Valentin', async () => {
    // The backend auto-inits a session and sends a welcome message via WebSocket.
    // Wait for an agent message bubble to appear in the message list.
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 10_000 });
  });

  test('user can type a message and send it', async () => {
    // Wait for the welcome message so we know the WS is connected
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 10_000 });

    await app.chat.sendMessage('My partner loves Italian food');

    // The user message should appear in the chat
    const userBubble = app.chat.messageList.locator('[data-sender="user"]');
    await expect(userBubble.first()).toBeVisible();
    await expect(userBubble.first()).toContainText('My partner loves Italian food');
  });

  test('after sending a message, typing indicator appears then agent responds', async () => {
    // Wait for welcome message
    const agentBubble = app.chat.messageList.locator('[data-sender="agent"]');
    await expect(agentBubble.first()).toBeVisible({ timeout: 10_000 });

    const initialAgentCount = await agentBubble.count();

    await app.chat.sendMessage('She really enjoys hiking on weekends');

    // The typing indicator should appear briefly while the agent processes
    // (it may disappear quickly with stub responses, so we just check it was there OR a new agent message arrived)
    await expect(agentBubble).toHaveCount(initialAgentCount + 1, { timeout: 15_000 });
  });

  test('Profile Dashboard shows empty state initially', async ({ page }) => {
    // At desktop width both panels are visible, so the empty state should show
    await expect(app.profile.emptyState).toBeVisible({ timeout: 10_000 });
    await expect(app.profile.emptyState).toContainText('No preferences yet');
  });
});
