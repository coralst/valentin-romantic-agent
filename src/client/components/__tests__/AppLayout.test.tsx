import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { AppLayout } from '../AppLayout';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChatProvider>
      <PreferencesProvider>{ui}</PreferencesProvider>
    </ChatProvider>,
  );
}

describe('AppLayout', () => {
  let matchMediaListeners: Array<(e: MediaQueryListEvent) => void>;
  let currentMatches: boolean;

  beforeEach(() => {
    matchMediaListeners = [];
    currentMatches = false;

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: currentMatches,
      media: query,
      addEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners.push(handler);
      },
      removeEventListener: (_: string, handler: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners = matchMediaListeners.filter((h) => h !== handler);
      },
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dual-panel layout at desktop width', () => {
    currentMatches = false; // desktop
    renderWithProviders(<AppLayout />);
    const layout = screen.getByTestId('app-layout');
    expect(layout.getAttribute('data-layout')).toBe('desktop');
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('profile-dashboard')).toBeInTheDocument();
  });

  it('renders MobileNav at mobile width', () => {
    currentMatches = true; // mobile
    renderWithProviders(<AppLayout />);
    const layout = screen.getByTestId('app-layout');
    expect(layout.getAttribute('data-layout')).toBe('mobile');
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('toggles between chat and profile on mobile', async () => {
    currentMatches = true;
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    // Default is chat
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-dashboard')).not.toBeInTheDocument();

    // Switch to profile
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('profile-dashboard')).toBeInTheDocument();

    // Switch back to chat
    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});
