import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../../config';
import {
  applyIntegrationCredentials,
  applyGoogleRefreshToken,
  clearIntegrationCredentials,
  isConnectable,
  setEnvPathForTests,
} from '../credentials';

/**
 * Credential intake, with `fetch` stubbed so the probe is deterministic.
 *
 * The behaviour worth pinning is **probe before apply**. A candidate that the
 * provider refuses must leave the previous value untouched, because the failure
 * mode otherwise is the nastiest one available here: a typo pasted over a working
 * key silently breaks a live integration, and the panel goes on saying "live" on
 * the strength of a boolean that no longer means anything.
 */

let envFile: string;
let dir: string;
const original = { ...config.integrations };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'valentin-cred-'));
  envFile = join(dir, '.env');
  setEnvPathForTests(envFile);
  Object.assign(config.integrations, original);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  Object.assign(config.integrations, original);
  setEnvPathForTests('.env');
});

/** Stub `fetch` with a fixed verdict, and record that it was called at all. */
function stubFetch(ok: boolean, opts: { throws?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (opts.throws) throw new Error('getaddrinfo ENOTFOUND');
      return { ok, status: ok ? 200 : 401, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

describe('isConnectable', () => {
  it('accepts only the three services that have credentials to give', () => {
    expect(isConnectable('amadeus')).toBe(true);
    expect(isConnectable('whatsapp')).toBe(true);
    expect(isConnectable('google')).toBe(true);
  });

  it('rejects the two that need nothing, so no form is ever offered for them', () => {
    // Hebcal is arithmetic in-process; Ontopo's endpoints need no auth. A
    // credential slot for either would imply one could matter.
    expect(isConnectable('hebcal')).toBe(false);
    expect(isConnectable('ontopo')).toBe(false);
    expect(isConnectable('google-calendar')).toBe(false);
  });
});

describe('applying Amadeus credentials', () => {
  it('probes the token endpoint and keeps values the provider accepts', async () => {
    const calls = stubFetch(true);
    const result = await applyIntegrationCredentials('amadeus', {
      clientId: 'key-1',
      clientSecret: 'secret-1',
    });

    expect(result.ok).toBe(true);
    expect(calls[0]).toContain('/v1/security/oauth2/token');
    // The sandbox host, never production — those endpoints spend real money.
    expect(calls[0]).toContain('test.api.amadeus.com');
    expect(config.integrations.amadeusClientId).toBe('key-1');
  });

  it('leaves a working credential alone when a new one is refused', async () => {
    stubFetch(true);
    await applyIntegrationCredentials('amadeus', { clientId: 'good', clientSecret: 'good' });

    stubFetch(false);
    const result = await applyIntegrationCredentials('amadeus', {
      clientId: 'typo',
      clientSecret: 'typo',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    // The whole point of probing first. Overwriting here would break a live
    // integration while the panel went on reporting it as live.
    expect(config.integrations.amadeusClientId).toBe('good');
    expect(result.message).toMatch(/nothing was changed/i);
  });

  it('distinguishes "cannot be reached" from "refused"', async () => {
    stubFetch(false, { throws: true });
    const result = await applyIntegrationCredentials('amadeus', {
      clientId: 'a',
      clientSecret: 'b',
    });

    // 502, not 400: the credentials may well be fine and the network is not the
    // visitor's fault. Telling them their key is wrong would send them to
    // re-copy a key that already works.
    expect(result.status).toBe(502);
    expect(result.message).toMatch(/could not be reached/i);
    expect(config.integrations.amadeusClientId).toBeUndefined();
  });

  it('refuses an empty or absurd field without any network call', async () => {
    const calls = stubFetch(true);
    expect((await applyIntegrationCredentials('amadeus', { clientId: '  ' })).ok).toBe(false);
    expect(
      (
        await applyIntegrationCredentials('amadeus', {
          clientId: 'a'.repeat(600),
          clientSecret: 'b',
        })
      ).ok,
    ).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('applying Google credentials', () => {
  it('saves the OAuth client without probing, and says a sign-in is still needed', async () => {
    const calls = stubFetch(true);
    const result = await applyIntegrationCredentials('google', {
      clientId: 'client.apps.googleusercontent.com',
      clientSecret: 'shh',
    });

    expect(result.ok).toBe(true);
    // Nothing to probe: an id and secret cannot be verified until a human
    // approves scopes, so the honest thing is to store them and say so.
    expect(calls).toHaveLength(0);
    expect(result.message).toMatch(/sign in with google/i);
    // Crucially NOT configured yet — readiness needs the refresh token too, so
    // the panel must not flip to "live" on the strength of this.
    expect(config.integrations.googleRefreshToken).toBeUndefined();
  });

  it('is only fully configured once a refresh token arrives', () => {
    config.integrations.googleClientId = 'id';
    config.integrations.googleClientSecret = 'secret';
    applyGoogleRefreshToken('1//refresh');
    expect(config.integrations.googleRefreshToken).toBe('1//refresh');
  });
});

describe('the .env file it writes', () => {
  it('replaces an existing line rather than appending a second', async () => {
    writeFileSync(envFile, 'AMADEUS_CLIENT_ID=stale\nOTHER=keep\n');
    stubFetch(true);
    await applyIntegrationCredentials('amadeus', { clientId: 'fresh', clientSecret: 's' });

    const written = readFileSync(envFile, 'utf8');
    // Duplicate keys are not an error in dotenv — the last one silently wins —
    // so an appender leaves a file where the line you can read is not the value
    // in use.
    expect(written.match(/AMADEUS_CLIENT_ID=/g)).toHaveLength(1);
    expect(written).toContain('AMADEUS_CLIENT_ID=fresh');
    expect(written).toContain('OTHER=keep');
  });

  it('uncomments a placeholder line, so that is not a manual step', async () => {
    writeFileSync(envFile, '# AMADEUS_CLIENT_ID=\n# AMADEUS_CLIENT_SECRET=\n');
    stubFetch(true);
    await applyIntegrationCredentials('amadeus', { clientId: 'k', clientSecret: 's' });

    const written = readFileSync(envFile, 'utf8');
    expect(written).toContain('AMADEUS_CLIENT_ID=k');
    expect(written).not.toMatch(/^#\s*AMADEUS_CLIENT_ID=$/m);
  });

  it('removes the keys entirely on disconnect, leaving no value behind', async () => {
    stubFetch(true);
    await applyIntegrationCredentials('amadeus', { clientId: 'k', clientSecret: 's' });
    clearIntegrationCredentials('amadeus');

    const written = readFileSync(envFile, 'utf8');
    expect(written).not.toContain('AMADEUS_CLIENT_ID');
    expect(written).not.toContain('k');
    expect(config.integrations.amadeusClientId).toBeUndefined();
  });

  it('still applies the credential in memory when the file cannot be written', async () => {
    // A directory where the file should be: writeFileSync throws EISDIR.
    setEnvPathForTests(dir);
    stubFetch(true);
    const result = await applyIntegrationCredentials('amadeus', {
      clientId: 'k',
      clientSecret: 's',
    });

    // Persistence is best-effort by design: the connect succeeded, and all a
    // failed write costs is durability across a restart.
    expect(result.ok).toBe(true);
    expect(config.integrations.amadeusClientId).toBe('k');
  });
});
