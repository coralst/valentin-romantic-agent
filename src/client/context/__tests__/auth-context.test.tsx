import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth-context';
import { clearTokenSession, peekAccessToken } from '../../auth/token-store';
import type { RuntimeAuthConfig } from '../../auth/runtime-config';

/**
 * These exercise the gate rather than the OAuth mechanics (those live in
 * auth/__tests__/cognito-oauth.test.ts): who sees the app, who sees the login
 * screen, and what the demo button actually does.
 */

const PROTECTED = 'the-app';

function renderApp() {
  return render(
    <AuthProvider>
      <div data-testid={PROTECTED}>Valentin</div>
    </AuthProvider>,
  );
}

function respondWith(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    const value = handlers[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value } as Response;
  });
}

const cognitoOn: RuntimeAuthConfig = {
  authDisabled: false,
  cognitoDomain: 'https://valentin-dev.auth.us-east-1.amazoncognito.com',
  clientId: 'spa-client',
  demoAvailable: true,
};

beforeEach(() => {
  clearTokenSession();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('when Cognito is configured', () => {
  it('shows the login screen instead of the app', async () => {
    vi.stubGlobal('fetch', respondWith({ '/api/config': cognitoOn }));

    renderApp();

    expect(await screen.findByTestId('login-screen')).toBeTruthy();
    expect(screen.queryByTestId(PROTECTED)).toBeNull();
  });

  it('leads with the demo, since most visitors have no account', async () => {
    vi.stubGlobal('fetch', respondWith({ '/api/config': cognitoOn }));

    renderApp();

    expect(await screen.findByTestId('demo-login-button')).toBeTruthy();
    expect(screen.getByTestId('sign-in-button')).toBeTruthy();
  });

  it('hides the demo button where the demo account is not deployed', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({ '/api/config': { ...cognitoOn, demoAvailable: false } }),
    );

    renderApp();

    await screen.findByTestId('sign-in-button');
    expect(screen.queryByTestId('demo-login-button')).toBeNull();
  });
});

describe('the one-click demo', () => {
  it('reveals the app and holds a real access token', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        '/api/config': cognitoOn,
        '/api/demo/login': {
          accessToken: 'demo-access',
          refreshToken: 'demo-refresh',
          expiresIn: 3600,
          sessionId: 'seeded-session',
        },
      }),
    );
    renderApp();

    await userEvent.click(await screen.findByTestId('demo-login-button'));

    expect(await screen.findByTestId(PROTECTED)).toBeTruthy();
    expect(peekAccessToken()).toBe('demo-access');
  });

  it("does not keep the demo client's refresh token", async () => {
    // It belongs to the server-only demo client, so refreshing it with the SPA's
    // client id would fail — storing it would poison the refresh path.
    vi.stubGlobal(
      'fetch',
      respondWith({
        '/api/config': cognitoOn,
        '/api/demo/login': {
          accessToken: 'demo-access',
          refreshToken: 'demo-refresh',
          expiresIn: 3600,
          sessionId: 'seeded-session',
        },
      }),
    );
    renderApp();

    await userEvent.click(await screen.findByTestId('demo-login-button'));
    await screen.findByTestId(PROTECTED);

    expect(sessionStorage.getItem('valentin.auth.refresh')).toBeNull();
  });

  it('says so calmly when the demo is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/config')) {
          return { ok: true, json: async () => cognitoOn } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }),
    );
    renderApp();

    await userEvent.click(await screen.findByTestId('demo-login-button'));

    expect((await screen.findByTestId('login-error')).textContent).toContain(
      'not configured',
    );
    expect(screen.queryByTestId(PROTECTED)).toBeNull();
  });
});

describe('when the backend runs without Cognito', () => {
  const bypass: RuntimeAuthConfig = {
    authDisabled: true,
    cognitoDomain: null,
    clientId: null,
    demoAvailable: false,
  };

  it('lets the caller straight through as a development user', async () => {
    // What keeps the Playwright specs and rehearsal.mjs running unedited.
    vi.stubGlobal('fetch', respondWith({ '/api/config': bypass }));

    renderApp();

    expect(await screen.findByTestId(PROTECTED)).toBeTruthy();
    expect(peekAccessToken()).toMatch(/^dev:/);
  });

  it('keeps the same development identity across reloads', async () => {
    vi.stubGlobal('fetch', respondWith({ '/api/config': bypass }));

    const first = renderApp();
    await screen.findByTestId(PROTECTED);
    const before = peekAccessToken();
    first.unmount();
    clearTokenSession();

    renderApp();
    await screen.findByTestId(PROTECTED);

    expect(peekAccessToken()).toBe(before);
  });
});

describe('when the server cannot be reached', () => {
  it('says so rather than showing a login page that cannot work', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderApp();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('not reachable'),
    );
    expect(screen.queryByTestId(PROTECTED)).toBeNull();
  });
});
