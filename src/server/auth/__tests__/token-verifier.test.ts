import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../../config';
import {
  ANONYMOUS_USER_ID,
  CognitoTokenVerifier,
  DevBypassTokenVerifier,
  createTokenVerifier,
  isAuthDisabled,
} from '../token-verifier';

/**
 * `config` is read once at module load from the environment, so these tests
 * patch it directly and put it back. Everything under test reads it lazily.
 */
const original = { ...config.cognito, nodeEnv: config.nodeEnv };

function setCognito(values: Partial<typeof config.cognito>): void {
  Object.assign(config.cognito, values);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  Object.assign(config.cognito, {
    userPoolId: original.userPoolId,
    spaClientId: original.spaClientId,
    demoClientId: original.demoClientId,
    demoSecretArn: original.demoSecretArn,
  });
  config.nodeEnv = original.nodeEnv;
  vi.restoreAllMocks();
});

describe('createTokenVerifier', () => {
  it('falls back to the dev bypass outside production, loudly', () => {
    setCognito({ userPoolId: undefined });
    config.nodeEnv = 'development';

    expect(createTokenVerifier()).toBeInstanceOf(DevBypassTokenVerifier);
    expect(console.warn).toHaveBeenCalled();
  });

  it('refuses to start in production without a user pool', () => {
    setCognito({ userPoolId: undefined });
    config.nodeEnv = 'production';

    // A server that boots with authentication silently off is worse than one
    // that fails its health check.
    expect(() => createTokenVerifier()).toThrow(/production/i);
  });

  it('refuses to start in production with a pool but no demo client', () => {
    // A half-configured pool is the failure mode that would 401 every demo
    // user while looking like a working deployment.
    setCognito({
      userPoolId: 'us-east-1_TEST',
      spaClientId: 'spa-client',
      demoClientId: undefined,
    });
    config.nodeEnv = 'production';

    expect(() => createTokenVerifier()).toThrow(/COGNITO_DEMO_CLIENT_ID/);
  });

  it('builds a Cognito verifier when fully configured', () => {
    setCognito({
      userPoolId: 'us-east-1_TEST',
      spaClientId: 'spa-client',
      demoClientId: 'demo-client',
    });
    config.nodeEnv = 'production';

    expect(createTokenVerifier()).toBeInstanceOf(CognitoTokenVerifier);
  });
});

describe('isAuthDisabled', () => {
  it('is true only when a pool is missing outside production', () => {
    setCognito({ userPoolId: undefined });
    config.nodeEnv = 'development';
    expect(isAuthDisabled()).toBe(true);

    config.nodeEnv = 'production';
    expect(isAuthDisabled()).toBe(false);

    setCognito({ userPoolId: 'us-east-1_TEST' });
    config.nodeEnv = 'development';
    expect(isAuthDisabled()).toBe(false);
  });
});

describe('DevBypassTokenVerifier', () => {
  const verifier = new DevBypassTokenVerifier();

  it('maps a dev:<id> token to that user, so two tabs are two people', async () => {
    expect((await verifier.verify('dev:alice')).userId).toBe('alice');
    expect((await verifier.verify('dev:bob')).userId).toBe('bob');
  });

  it('maps a missing token to the anonymous user', async () => {
    expect((await verifier.verify('')).userId).toBe(ANONYMOUS_USER_ID);
    expect((await verifier.verify('   ')).userId).toBe(ANONYMOUS_USER_ID);
    expect((await verifier.verify('dev:')).userId).toBe(ANONYMOUS_USER_ID);
  });

  it('never claims to be the demo account', async () => {
    expect((await verifier.verify('dev:alice')).isDemo).toBe(false);
  });

  it('returns an expiry in epoch seconds, not milliseconds', async () => {
    const { expiresAt } = await verifier.verify('dev:alice');
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Milliseconds here would put expiry ~50,000 years out and disable the
    // gateway's per-event expiry check entirely.
    expect(expiresAt).toBeGreaterThan(nowSeconds);
    expect(expiresAt).toBeLessThan(nowSeconds + 24 * 60 * 60);
  });
});
