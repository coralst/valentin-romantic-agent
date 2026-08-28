import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../../../config';
import { buildAuthUrl, consumeState, exchangeCode, redirectUri } from '../oauth';
import { GOOGLE_SCOPES } from '../client';

/**
 * The consent flow's state machine.
 *
 * `GET /api/integrations/google/callback` cannot be authenticated — Google
 * performs that navigation and holds no token for our API — so `state` is the
 * entirety of its access control. Single-use and expiring are therefore not
 * niceties: without them, any page on the internet could navigate a visitor's
 * browser at our callback carrying a code for an account of its choosing, and
 * this deployment would bind itself to it.
 */

const original = { ...config.integrations };

beforeEach(() => {
  Object.assign(config.integrations, original);
  config.integrations.googleClientId = 'test-client.apps.googleusercontent.com';
  config.integrations.googleClientSecret = 'test-secret';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.assign(config.integrations, original);
  delete process.env.PUBLIC_ORIGIN;
});

describe('the consent URL', () => {
  it('asks for offline access and forces the prompt', () => {
    const url = new URL(buildAuthUrl().url!);

    // Without `access_type=offline` Google issues no refresh token at all, and
    // without `prompt=consent` a re-authorisation of an already-granted client
    // returns an access token and no refresh token — the flow appears to succeed
    // and produces nothing usable. Both are load-bearing.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('requests exactly the scopes the client is built against', () => {
    const url = new URL(buildAuthUrl().url!);
    // Imported from the client rather than restated, so a widened scope is a
    // visible diff in one place instead of a quiet change of blast radius.
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '));
    // Read the calendar, send mail. Never read the inbox — Valentin has no
    // reason to, so it must not be able to.
    expect(url.searchParams.get('scope')).not.toMatch(/readonly|gmail\.modify/);
  });

  it('refuses to build one before an OAuth client is saved', () => {
    config.integrations.googleClientId = undefined;
    const result = buildAuthUrl();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.url).toBeUndefined();
  });

  it('carries a distinct state each time', () => {
    const first = new URL(buildAuthUrl().url!).searchParams.get('state');
    const second = new URL(buildAuthUrl().url!).searchParams.get('state');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('the redirect URI', () => {
  it('defaults to where the app is actually open locally', () => {
    expect(redirectUri()).toBe('http://localhost:5173/api/integrations/google/callback');
  });

  it('follows PUBLIC_ORIGIN, and tolerates a trailing slash', () => {
    // Google compares this string exactly, so a doubled slash is a hard failure
    // with an unhelpful error — worth normalising rather than documenting.
    process.env.PUBLIC_ORIGIN = 'https://valentin.example.com/';
    expect(redirectUri()).toBe(
      'https://valentin.example.com/api/integrations/google/callback',
    );
  });
});

describe('state consumption', () => {
  it('accepts a state this server minted', () => {
    const state = new URL(buildAuthUrl().url!).searchParams.get('state')!;
    expect(consumeState(state)).toBe(true);
  });

  it('accepts it exactly once, so a replayed code cannot be exchanged twice', () => {
    const state = new URL(buildAuthUrl().url!).searchParams.get('state')!;
    expect(consumeState(state)).toBe(true);
    expect(consumeState(state)).toBe(false);
  });

  it('rejects a state it never issued, and a missing one', () => {
    expect(consumeState('forged')).toBe(false);
    expect(consumeState(undefined)).toBe(false);
  });

  it('rejects one that has expired', () => {
    vi.useFakeTimers();
    const state = new URL(buildAuthUrl().url!).searchParams.get('state')!;
    // The TTL is ten minutes: long enough to read a consent screen, short enough
    // that an abandoned attempt is not left lying around to be replayed.
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(consumeState(state)).toBe(false);
  });
});

describe('exchanging the code', () => {
  it('posts the code with the same redirect URI it authorised against', async () => {
    let sent = new URLSearchParams();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent = new URLSearchParams(init.body);
        return { ok: true, status: 200, json: async () => ({ refresh_token: '1//tok' }) };
      }),
    );

    const result = await exchangeCode('auth-code');
    expect(result.ok).toBe(true);
    expect(result.refreshToken).toBe('1//tok');
    expect(sent.get('grant_type')).toBe('authorization_code');
    // Must match the authorisation request's URI exactly or Google refuses.
    expect(sent.get('redirect_uri')).toBe(redirectUri());
  });

  it('treats a response with no refresh token as a failure, not a success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        // What Google returns when re-authorising an already-granted client.
        json: async () => ({ access_token: 'ya29.short-lived' }),
      })),
    );

    const result = await exchangeCode('auth-code');
    // An access token alone is worthless here: it expires in an hour and this
    // build has no way to renew it. Reporting success would leave Calendar
    // "connected" and broken by lunchtime.
    expect(result.ok).toBe(false);
    expect(result.refreshToken).toBeUndefined();
    expect(result.message).toMatch(/myaccount\.google\.com\/permissions/);
  });

  it('does not leak Google\'s error body into the message it returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_client',
          error_description: 'client 12345-abcde.apps.googleusercontent.com is bad',
        }),
      })),
    );

    const result = await exchangeCode('auth-code');
    expect(result.ok).toBe(false);
    // The body can name the client id, and this text lands on a page a visitor
    // could screenshot. It says what to check instead of what Google said.
    expect(result.message).not.toContain('12345-abcde');
    expect(result.message).toMatch(/redirect URI/i);
  });

  it('reports an unreachable token endpoint as such', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    const result = await exchangeCode('auth-code');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be reached/i);
  });
});
