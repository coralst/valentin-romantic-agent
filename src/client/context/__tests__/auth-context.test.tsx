import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuthContext } from '../auth-context';
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

describe('the persona label', () => {
  /**
   * Reads `userLabel`, which no child normally renders.
   *
   * Only reachable once signed in — the provider shows `LoginScreen` until then —
   * so the persona is chosen through that screen's real picker rather than a
   * stand-in button here. That is deliberate: a synthetic
   * `signInAsDemo('fresh')` would pass even if the landing page never wired the
   * id through, which is the half of this that can actually break.
   */
  function Chip() {
    const { userLabel } = useAuthContext();
    return <span data-testid="user-label">{userLabel}</span>;
  }

  /** Choose a persona on the landing page and sign in as it. */
  async function pickPersona(id: string) {
    await userEvent.click(await screen.findByTestId(`persona-${id}`));
    await userEvent.click(screen.getByTestId('demo-login-button'));
  }

  function renderWithChip() {
    return render(
      <AuthProvider>
        <Chip />
      </AuthProvider>,
    );
  }

  const withPersonas: RuntimeAuthConfig = {
    ...cognitoOn,
    demoPersonas: [
      { id: 'samantha', name: 'Samantha', blurb: 'Three years.', fieldCount: 18 },
      { id: 'fresh', name: 'Start fresh', blurb: 'From scratch.', fieldCount: 0 },
    ],
  };

  function demoResponse(persona?: string) {
    return {
      accessToken: 'demo-access',
      refreshToken: 'demo-refresh',
      expiresIn: 3600,
      sessionId: 'seeded-session',
      ...(persona ? { persona } : {}),
    };
  }

  it('names the persona the server seeded', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        '/api/config': withPersonas,
        '/api/demo/login': demoResponse('samantha'),
      }),
    );
    renderWithChip();

    await userEvent.click(await screen.findByTestId('demo-login-button'));

    expect((await screen.findByTestId('user-label')).textContent).toBe(
      'Samantha',
    );
  });

  it('asks for the persona that was clicked', async () => {
    const fetchMock = respondWith({
      '/api/config': withPersonas,
      '/api/demo/login': demoResponse('fresh'),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithChip();

    await pickPersona('fresh');
    await waitFor(() =>
      expect(screen.getByTestId('user-label').textContent).toBe('Start fresh'),
    );

    // The stub only declares the url it reads, so the init argument needs
    // spelling out here.
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const login = calls.find(([url]) => url.includes('/api/demo/login'));
    expect(JSON.parse(login?.[1].body as string)).toEqual({ persona: 'fresh' });
  });

  it('trusts the server over the click, since it may have fallen back', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        '/api/config': withPersonas,
        // Asked for 'fresh', told 'samantha' — an unknown id resolved to the
        // default, and the chip must not claim otherwise.
        '/api/demo/login': demoResponse('samantha'),
      }),
    );
    renderWithChip();

    await pickPersona('fresh');

    expect((await screen.findByTestId('user-label')).textContent).toBe(
      'Samantha',
    );
  });

  it('falls back to the generic label on a deployment with no personas', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        '/api/config': cognitoOn,
        '/api/demo/login': demoResponse(),
      }),
    );
    renderWithChip();

    await userEvent.click(await screen.findByTestId('demo-login-button'));

    expect((await screen.findByTestId('user-label')).textContent).toBe(
      'Demo profile',
    );
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
