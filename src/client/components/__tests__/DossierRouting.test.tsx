import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
 * portal — see `context/view-context.tsx`. These tests pin that: the icon rail
 * survives the swap, the chat shell's columns do not, and focus comes home.
 */
describe('dossier surface routing', () => {
  it('starts on the chat shell, never in the dossier', () => {
    // Not persisted on purpose: reloading into an empty dossier is a poor cold
    // start and would make the Playwright specs' goto('/') non-deterministic.
    renderApp();
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
  });

  it('opens the dossier from the rail’s ♥ and reports it via aria-pressed', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Her profile' }));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'dossier');
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Her profile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('replaces the chat shell’s columns but keeps the icon rail', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Her profile' }));

    // A portal would duplicate the rail and fight the window's overflow/radius.
    expect(screen.getAllByTestId('icon-rail')).toHaveLength(1);
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brief-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-window').style.gridTemplateColumns).toBe(
      '76px minmax(0, 1fr)',
    );
  });

  it('opens from the brief footer’s "Full profile →"', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Full profile/ }));
    expect(screen.getByTestId('dossier-view')).toBeInTheDocument();
  });

  it('returns focus to the ♥ when the back button closes it', async () => {
    const user = userEvent.setup();
    renderApp();
    const heart = screen.getByRole('button', { name: 'Her profile' });
    await user.click(heart);

    await user.click(screen.getByTestId('dossier-back'));
    expect(screen.getByTestId('app-layout')).toHaveAttribute('data-surface', 'chat');
    // Focus must not be stranded on the removed back button.
    expect(screen.getByRole('button', { name: 'Her profile' })).toHaveFocus();
  });

  it('closes on Escape, and returns focus the same way', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Her profile' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Her profile' })).toHaveFocus();
  });

  it('toggles closed on a second ♥ press', async () => {
    const user = userEvent.setup();
    renderApp();
    const heart = screen.getByRole('button', { name: 'Her profile' });
    await user.click(heart);
    await user.click(screen.getByRole('button', { name: 'Her profile' }));
    expect(screen.queryByTestId('dossier-view')).not.toBeInTheDocument();
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
