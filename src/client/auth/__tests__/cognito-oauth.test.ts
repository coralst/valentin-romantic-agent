import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  beginLogin,
  exchangeCode,
  hostedLogoutUrl,
  OAuthError,
  readCallback,
  revokeRefreshToken,
} from '../cognito-oauth';
import type { RuntimeAuthConfig } from '../runtime-config';

const config: RuntimeAuthConfig = {
  authDisabled: false,
  cognitoDomain: 'https://valentin-dev.auth.us-east-1.amazoncognito.com',
  clientId: 'spa-client-id',
  demoAvailable: true,
};

let assigned: string | null;
let replaced: string | null;

beforeEach(() => {
  sessionStorage.clear();
  assigned = null;
  replaced = null;

  // jsdom refuses a real navigation, and window.location is read-only, so both
  // the redirect and the URL cleanup are observed through stubs.
  vi.stubGlobal('location', {
    origin: 'http://localhost:5173',
    pathname: '/',
    search: '',
    assign: (url: string) => {
      assigned = url;
    },
  });
  vi.stubGlobal('history', {
    replaceState: (_s: unknown, _t: string, url: string) => {
      replaced = url;
    },
  });
  // jsdom has getRandomValues but no SubtleCrypto.
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => {
      array.fill(7);
      return array;
    },
    subtle: {
      digest: async () => new Uint8Array(32).fill(9).buffer,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('beginLogin', () => {
  it('redirects to the Hosted UI with an S256 challenge', async () => {
    await beginLogin(config);

    const url = new URL(assigned as string);
    expect(url.origin + url.pathname).toBe(`${config.cognitoDomain}/oauth2/authorize`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('spa-client-id');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('redirects back to the site root, not a /callback path', async () => {
    // S3 behind an OAC answers 403 for a missing key and cdn-stack only remaps
    // 404 to index.html, so a /callback path would render AccessDenied XML.
    await beginLogin(config);

    expect(new URL(assigned as string).searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/',
    );
  });

  it('does not request the scope that can change a password', async () => {
    await beginLogin(config);

    const scope = new URL(assigned as string).searchParams.get('scope');
    expect(scope).not.toContain('aws.cognito.signin.user.admin');
  });

  it('keeps the state and verifier for the return trip', async () => {
    await beginLogin(config);

    expect(sessionStorage.getItem('valentin.oauth.state')).toBeTruthy();
    expect(sessionStorage.getItem('valentin.oauth.verifier')).toBeTruthy();
  });

  it('refuses when the deployment has no Cognito configured', async () => {
    await expect(
      beginLogin({ ...config, clientId: null }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('readCallback', () => {
  it('reports nothing on an ordinary page load', () => {
    expect(readCallback()).toBeNull();
  });

  it('reads the code and scrubs it out of the URL', () => {
    (globalThis.location as unknown as { search: string }).search =
      '?code=abc123&state=xyz';

    const callback = readCallback();

    expect(callback).toEqual({ code: 'abc123', state: 'xyz' });
    // replaceState, not pushState: a used code must not be reachable with the
    // back button.
    expect(replaced).toBe('/');
  });

  it('raises the error Cognito reported, and still cleans the URL', () => {
    (globalThis.location as unknown as { search: string }).search =
      '?error=redirect_mismatch&error_description=Bad+redirect';

    expect(() => readCallback()).toThrow('Bad redirect');
    expect(replaced).toBe('/');
  });
});

describe('exchangeCode', () => {
  it('posts the verifier and returns the tokens', async () => {
    sessionStorage.setItem('valentin.oauth.state', 'the-state');
    sessionStorage.setItem('valentin.oauth.verifier', 'the-verifier');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeCode(config, { code: 'c', state: 'the-state' });

    expect(tokens.access_token).toBe('at');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('code_verifier')).toBe('the-verifier');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('aborts on a state mismatch without exchanging the code', async () => {
    // A mismatch is the signature of a forged login response; exchanging first
    // and checking after would defeat the point of `state` entirely.
    sessionStorage.setItem('valentin.oauth.state', 'mine');
    sessionStorage.setItem('valentin.oauth.verifier', 'v');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeCode(config, { code: 'c', state: 'theirs' }),
    ).rejects.toBeInstanceOf(OAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the verifier once, so a double effect cannot replay it', async () => {
    sessionStorage.setItem('valentin.oauth.state', 's');
    sessionStorage.setItem('valentin.oauth.verifier', 'v');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'at', expires_in: 3600, token_type: 'Bearer' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await exchangeCode(config, { code: 'c', state: 's' });

    await expect(exchangeCode(config, { code: 'c', state: 's' })).rejects.toThrow(
      /already been used/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal without leaking Cognito’s wording', async () => {
    sessionStorage.setItem('valentin.oauth.state', 's');
    sessionStorage.setItem('valentin.oauth.verifier', 'v');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"error":"invalid_grant"}',
      }),
    );

    await expect(exchangeCode(config, { code: 'c', state: 's' })).rejects.toThrow(
      'The sign-in could not be completed',
    );
  });
});

describe('signing out', () => {
  it('revokes the refresh token server-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await revokeRefreshToken(config, 'rt');

    expect(fetchMock.mock.calls[0][0]).toBe(`${config.cognitoDomain}/oauth2/revoke`);
    expect(
      new URLSearchParams(fetchMock.mock.calls[0][1].body as string).get('token'),
    ).toBe('rt');
  });

  it('still signs out locally when the revoke call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(revokeRefreshToken(config, 'rt')).resolves.toBeUndefined();
  });

  it('sends the browser back to the root after clearing the Hosted UI cookie', () => {
    const url = new URL(hostedLogoutUrl(config) as string);

    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('logout_uri')).toBe('http://localhost:5173/');
  });
});
