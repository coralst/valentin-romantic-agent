import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the Chat panel — message input, send, history, indicators.
 */
export class ChatPage {
  readonly messageInput: Locator;
  readonly sendButton: Locator;
  readonly messageList: Locator;
  readonly typingIndicator: Locator;
  readonly connectionBanner: Locator;

  constructor(private readonly page: Page) {
    this.messageInput = page.getByLabel('Type a message');
    this.sendButton = page.getByLabel('Send message');
    this.messageList = page.getByRole('log');
    this.typingIndicator = page.getByTestId('typing-indicator');
    this.connectionBanner = page.getByTestId('connection-banner');
  }

  async sendMessage(text: string) {
    await this.messageInput.fill(text);
    await this.sendButton.click();
  }
}

/**
 * Page object for the Partner Profile Panel — avatar, fields, calendar, empty state.
 */
export class ProfilePage {
  readonly categoryGroups: Locator;
  readonly preferenceCards: Locator;
  readonly emptyState: Locator;
  readonly panel: Locator;
  readonly avatar: Locator;
  readonly completionSummary: Locator;
  readonly occasionCalendar: Locator;

  constructor(private readonly page: Page) {
    this.categoryGroups = page.getByTestId('category-group');
    this.preferenceCards = page.getByTestId('preference-card');
    this.emptyState = page.getByTestId('empty-encouragement');
    this.panel = page.getByTestId('partner-profile-panel');
    this.avatar = page.getByTestId('partner-avatar');
    this.completionSummary = page.getByTestId('completion-summary');
    this.occasionCalendar = page.getByTestId('occasion-calendar');
  }
}

/**
 * Top-level page object composing Chat + Profile with layout controls.
 */
export class AppPage {
  readonly chat: ChatPage;
  readonly profile: ProfilePage;
  readonly mobileNav: Locator;
  readonly appLayout: Locator;

  constructor(private readonly page: Page) {
    this.chat = new ChatPage(page);
    this.profile = new ProfilePage(page);
    this.mobileNav = page.getByTestId('mobile-nav');
    this.appLayout = page.getByTestId('app-layout');
  }

  async goto() {
    await this.page.goto('/');
  }
}
