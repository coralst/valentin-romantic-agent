import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearTokenSession,
  configureTokenStore,
  getAccessToken,
  invalidateAccessToken,
  isExpiring,
  peekAccessToken,
  setDevSession,
  setTokenSession,
  storedRefreshToken,
} from '../token-store';

const HOUR = 60 * 60 * 1000;

function freshSession(overrides: Partial<Parameters<typeof setTokenSession>[0]> = {}) {
  setTokenSession({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + HOUR,
    ...overrides,
  });
}

beforeEach(() => {
  clearTokenSession();
  configureTokenStore({ refresh: null, onSessionLost: null });
  sessionStorage.clear();
});

describe('the current session', () => {
  it('hands back a token that is still good without refreshing', async () => {
    const refresh = vi.fn();
    configureTokenStore({ refresh, onSessionLost: null });
    freshSession();

    expect(await getAccessToken()).toBe('access-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the refresh token in sessionStorage, not localStorage', async () => {
    // A thirty-day credential in localStorage would outlive the tab on a shared
    // browser. This is the whole reason for the choice.
    freshSession();

    expect(storedRefreshToken()).toBe('refresh-1');
    expect(localStorage.getItem('valentin.auth.refresh')).toBeNull();
  });

  it('forgets everything on sign-out', () => {
    freshSession();

    clearTokenSession();

    expect(peekAccessToken()).toBeNull();
    expect(storedRefreshToken()).toBeNull();
  });

  it('treats a token expiring within the margin as expiring', () => {
    freshSession({ expiresAt: Date.now() + 30_000 });

    expect(isExpiring()).toBe(true);
  });
});

describe('refreshing', () => {
  it('renews a token that is about to expire', async () => {
    configureTokenStore({
      refresh: async () => ({
        accessToken: 'access-2',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + HOUR,
      }),
      onSessionLost: null,
    });
    freshSession({ expiresAt: Date.now() + 1_000 });

    expect(await getAccessToken()).toBe('access-2');
  });

  it('spends the refresh token once for ten concurrent callers', async () => {
    // Cognito accepts the first refresh and rejects the rest, so without
    // single-flight ten simultaneous requests look exactly like a broken login.
    let calls = 0;
    configureTokenStore({
      refresh: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          accessToken: 'access-2',
          refreshToken: 'refresh-1',
          expiresAt: Date.now() + HOUR,
        };
      },
      onSessionLost: null,
    });
    freshSession({ expiresAt: Date.now() + 1_000 });

    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => getAccessToken()),
    );

    expect(calls).toBe(1);
    expect(tokens).toEqual(Array(10).fill('access-2'));
  });

  it('reports the session lost when the refresh is refused', async () => {
    const onSessionLost = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureTokenStore({
      refresh: async () => {
        throw new Error('invalid_grant');
      },
      onSessionLost,
    });
    freshSession({ expiresAt: Date.now() + 1_000 });

    expect(await getAccessToken()).toBeNull();
    expect(onSessionLost).toHaveBeenCalledTimes(1);
    expect(peekAccessToken()).toBeNull();
  });

  it('recovers a session from a refresh token left by an earlier page load', async () => {
    sessionStorage.setItem('valentin.auth.refresh', 'refresh-from-reload');
    configureTokenStore({
      refresh: async (token) => ({
        accessToken: `access-for-${token}`,
        refreshToken: token,
        expiresAt: Date.now() + HOUR,
      }),
      onSessionLost: null,
    });

    expect(await getAccessToken()).toBe('access-for-refresh-from-reload');
  });

  it('refreshes after the server rejects a token we still believed in', async () => {
    configureTokenStore({
      refresh: async () => ({
        accessToken: 'access-2',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + HOUR,
      }),
      onSessionLost: null,
    });
    freshSession();

    // What a WebSocket close 4401 means: our idea of the expiry was wrong.
    invalidateAccessToken();

    expect(await getAccessToken()).toBe('access-2');
  });

  it('returns null rather than hanging when nothing can be recovered', async () => {
    expect(await getAccessToken()).toBeNull();
  });
});

describe('the development session', () => {
  it('encodes the user id the way the bypass verifier reads it', () => {
    setDevSession('alice');

    expect(peekAccessToken()).toBe('dev:alice');
    expect(isExpiring()).toBe(false);
  });
});
