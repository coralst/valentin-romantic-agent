import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { SessionProvider } from '../../context/session-context';
import { resetDiscoveryMountCount } from '../../context/discovery-context';
import { AppLayout } from '../AppLayout';

vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage: () => {},
    connectionStatus: 'connected' as const,
    lastError: null,
  }),
}));

function renderApp() {
  return render(
    <SessionProvider>
      <ChatProvider>
        <PreferencesProvider>
          <AppLayout />
        </PreferencesProvider>
      </ChatProvider>
    </SessionProvider>,
  );
}

let currentMatches = false;

beforeEach(() => {
  localStorage.clear();
  resetDiscoveryMountCount();
  currentMatches = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: currentMatches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * The dossier is a surface swap inside the same window, not a route and not a
 * portal — see `context/view-context.tsx`. These tests pin that: the swap changes
 * what the *chat column* shows and nothing else, the list and the brief stay put,
 * both controls that reach it are two-way, and focus comes home.
 */
describe('dossier surface routing', () => {
  it('starts on the chat shell, never in the dossier', () => {
    // Not persisted on purpose: reloading into an empty dossier is a poor cold
    // start and would make the Playwright specs' goto('/') non-deterministic.
    renderApp();
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
  });

  it('opens the dossier from her portrait in the brief', async () => {
    // The rail has no ♥ any more: you get to her profile by clicking *her*.
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('brief-cameo'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'dossier');
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
    // The portrait is still there beside the board it opened, and says so — so it
    // is a two-way control, pressed while her file is up.
    expect(screen.getByTestId('brief-cameo')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('dossier-back')).toBeInTheDocument();

    await user.click(screen.getByTestId('brief-cameo'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
  });

  /*
   * Her file opens *in the chat column*. It used to take columns 2–4 with it,
   * which cost the user the conversation list and the rail that says what is
   * coming next — the two things most worth reading beside the board.
   */
  it('takes only the chat column, leaving the list and the brief mounted', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('brief-cameo'));

    // A portal would duplicate the rail and fight the window's overflow/radius.
    expect(screen.getAllByTestId('icon-rail')).toHaveLength(1);
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('brief-rail')).toBeInTheDocument();
    expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    // The window keeps its shape across the swap: nothing under the cursor moves.
    expect(screen.getByTestId('app-window').style.gridTemplateColumns).toBe(
      '76px 226px minmax(0, 1fr) 306px',
    );
  });

  it('shows her file as the selected thread in the conversation list', async () => {
    const user = userEvent.setup();
    renderApp();
    const thread = screen.getByTestId('her-file-thread');
    expect(thread).not.toHaveAttribute('aria-current');

    await user.click(thread);
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
    expect(screen.getByTestId('her-file-thread')).toHaveAttribute('aria-current', 'true');

    // And it is the way back out, like every other row in the list.
    await user.click(screen.getByTestId('her-file-thread'));
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
  });

  it('opens from the brief footer’s "Full profile →"', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Full profile/ }));
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
  });

  /*
   * Focus comes home to her portrait, which — unlike the ♥ it replaced — is part
   * of the chat shell and so is not mounted at the moment the dossier closes.
   * `applyClose` waits a frame for it, hence `waitFor` rather than a bare
   * assertion; see `view-context.tsx`.
   */
  it('returns focus to her portrait when the back button closes it', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('brief-cameo'));

    await user.click(screen.getByTestId('dossier-back'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
    // Focus must not be stranded on the removed back button.
    await waitFor(() => expect(screen.getByTestId('brief-cameo')).toHaveFocus());
  });

  it('closes on Escape, and returns focus the same way', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('brief-cameo'));

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('brief-cameo')).toHaveFocus());
  });

  /*
   * Three ways out of the dossier, all of which a user tried and one of which —
   * the browser's own Back button — really did nothing, because the surface swap
   * is not a route and pushed no history entry to pop.
   */
  it('closes when the browser goes back, rather than leaving the app', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('brief-cameo'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'dossier');

    window.history.back();

    await waitFor(() =>
      expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat'),
    );
    await waitFor(() => expect(screen.getByTestId('brief-cameo')).toHaveFocus());
  });

  it('closes from the crest, which is home from every surface', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByTestId('brief-cameo'));

    await user.click(screen.getByTestId('rail-home-button'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
  });

  it('does nothing but stay put when the crest is pressed on the chat shell', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('rail-home-button'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  /*
   * The ◆ and the ☰ were both inert on desktop: the desktop rail was rendered
   * without `onViewChange`, so the ◆ called an undefined prop, and the ☰ opened a
   * sidebar that was already permanently open.
   */
  describe('the desktop rail’s ◆ and ☰', () => {
    it('◆ leaves the dossier and puts the caret in the composer', async () => {
      const user = userEvent.setup();
      renderApp();
      await user.click(screen.getByTestId('brief-cameo'));

      await user.click(screen.getByTestId('rail-chat-button'));

      expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
      await waitFor(() =>
        expect(screen.getByLabelText('Type a message')).toHaveFocus(),
      );
    });

    it('◆ is still observable on the chat shell, where the surface cannot change', async () => {
      // Both surfaces are already on screen here, so the caret *is* the effect.
      const user = userEvent.setup();
      renderApp();

      await user.click(screen.getByTestId('rail-chat-button'));

      await waitFor(() =>
        expect(screen.getByLabelText('Type a message')).toHaveFocus(),
      );
    });

    it('☰ hands the conversation list’s column to the chat, and gives it back', async () => {
      const user = userEvent.setup();
      renderApp();
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();

      await user.click(screen.getByTestId('sidebar-menu-button'));

      // Not merely hidden: the 226px track goes too, or the chat would gain a
      // hole rather than the room.
      expect(screen.queryByTestId('session-sidebar')).not.toBeInTheDocument();
      expect(screen.getByTestId('app-window').style.gridTemplateColumns).toBe(
        '76px minmax(0, 1fr) 306px',
      );

      await user.click(screen.getByTestId('sidebar-menu-button'));
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('app-window').style.gridTemplateColumns).toBe(
        '76px 226px minmax(0, 1fr) 306px',
      );
    });

    it('keeps the chat and brief on screen with the list collapsed', async () => {
      const user = userEvent.setup();
      renderApp();
      await user.click(screen.getByTestId('sidebar-menu-button'));

      expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
      expect(screen.getByTestId('brief-rail')).toBeInTheDocument();
    });
  });

  it('replaces both panels full-bleed on mobile, keeping Chat and Profile verbatim', async () => {
    currentMatches = true;
    const user = userEvent.setup();
    renderApp();

    // These two accessible names are queried by e2e/ and AppLayout.test.tsx.
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Dossier' }));
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brief-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('dossier-board')).toHaveAttribute('data-columns', '1');

    // Tapping a panel tab leaves the dossier rather than hiding behind it.
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});
