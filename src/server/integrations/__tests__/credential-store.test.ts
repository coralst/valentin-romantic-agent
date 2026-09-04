import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../../config';
import { logger } from '../../logging';
import {
  integrationSecretNames,
  invalidateRemoteCredentials,
  loadRemoteCredentials,
  putRemoteCredentials,
  setSecretsClientForTests,
} from '../credential-store';

/**
 * The remote half of credential storage, with Secrets Manager stubbed.
 *
 * Two behaviours carry all the weight:
 *
 * 1. **`process.env` wins.** A field already set must never be overwritten from
 *    a secret. This is what keeps `npm test`, Playwright and local dev working
 *    with no AWS account, and what stops a deployment silently overriding a key
 *    somebody put in their shell to debug with.
 * 2. **No credential is ever logged.** Not truncated, not masked. Asserted by
 *    scanning every log record for the literal values, because the failure here
 *    is a real secret in CloudWatch and a reviewer cannot eyeball every call.
 */

const original = { ...config.integrations };
const PREFIX = 'valentin/test/integrations';

/** Every `SecretId` asked for, and a canned body per service. */
function stubSecrets(bodies: Record<string, unknown>) {
  const reads: string[] = [];
  const writes: { id: string; body: unknown }[] = [];

  setSecretsClientForTests({
    send: (command: unknown) => {
      const input = (command as { input: Record<string, string> }).input;
      const id = input.SecretId;

      // Distinguished by which fields the input carries rather than by the
      // command's class name: the stub never constructs a real command object,
      // and matching on a minified constructor name would be fragile.
      if (typeof input.SecretString === 'string') {
        writes.push({ id, body: JSON.parse(input.SecretString) });
        return Promise.resolve({});
      }

      reads.push(id);
      const service = id.split('/').pop() ?? '';
      if (!(service in bodies)) {
        const err = new Error('Secrets Manager can’t find the specified secret.');
        err.name = 'ResourceNotFoundException';
        return Promise.reject(err);
      }
      const body = bodies[service];
      return Promise.resolve({
        SecretString: typeof body === 'string' ? body : JSON.stringify(body),
      });
    },
  });

  return { reads, writes };
}

/** Every field of every log record written during the test, flattened to text. */
function captureLogs() {
  const lines: string[] = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(logger, level).mockImplementation((event: string, fields?: unknown) => {
      lines.push(`${event} ${JSON.stringify(fields ?? {})}`);
    });
  }
  return lines;
}

beforeEach(() => {
  Object.assign(config.integrations, original);
  process.env.INTEGRATION_SECRETS_PREFIX = PREFIX;
  invalidateRemoteCredentials();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(config.integrations, original);
  delete process.env.INTEGRATION_SECRETS_PREFIX;
  setSecretsClientForTests(null);
});

describe('loadRemoteCredentials', () => {
  it('fills a field that nothing else provided', async () => {
    config.integrations.whatsappPhoneNumberId = undefined;
    config.integrations.whatsappToken = undefined;
    stubSecrets({ whatsapp: { phoneNumberId: '1234567890', token: 'graph-token' } });

    await loadRemoteCredentials();

    expect(config.integrations.whatsappPhoneNumberId).toBe('1234567890');
    expect(config.integrations.whatsappToken).toBe('graph-token');
  });

  it('never overwrites a field the environment already set', async () => {
    // The whole reason this module is safe to have in the boot path. If a secret
    // could win, a developer debugging with a key in their shell would be
    // silently talking to whatever the deployment happens to hold.
    config.integrations.amadeusClientId = 'from-env';
    config.integrations.amadeusClientSecret = undefined;
    stubSecrets({ amadeus: { clientId: 'from-secret', clientSecret: 'secret-only' } });

    await loadRemoteCredentials();

    expect(config.integrations.amadeusClientId).toBe('from-env');
    // The unset sibling is still filled — precedence is per field, not per
    // service, or a half-connected Google would stay half-connected forever.
    expect(config.integrations.amadeusClientSecret).toBe('secret-only');
  });

  it('is a total no-op when no prefix is configured', async () => {
    delete process.env.INTEGRATION_SECRETS_PREFIX;
    config.integrations.whatsappToken = undefined;
    const { reads } = stubSecrets({ whatsapp: { token: 'never-read' } });

    await loadRemoteCredentials();

    expect(reads).toEqual([]);
    expect(config.integrations.whatsappToken).toBeUndefined();
  });

  it('reads every service, so one connect does not require knowing the others', async () => {
    const { reads } = stubSecrets({});
    await loadRemoteCredentials();

    expect(reads.sort()).toEqual(
      ['amadeus', 'google', 'spotify', 'whatsapp'].map((s) => `${PREFIX}/${s}`),
    );
  });

  it('treats a missing secret as the ordinary pre-connect state, not a failure', async () => {
    const lines = captureLogs();
    stubSecrets({});

    await expect(loadRemoteCredentials()).resolves.toBeUndefined();
    expect(lines.filter((l) => l.includes('secret-read-failed'))).toEqual([]);
  });

  it('survives a secret that is not an object, and says so once', async () => {
    const lines = captureLogs();
    // A hand-edited secret holding a bare string is the realistic version of
    // this. It must cost that one integration, not the boot.
    stubSecrets({ google: 'not json at all', whatsapp: JSON.stringify(['a', 'list']) });

    await expect(loadRemoteCredentials()).resolves.toBeUndefined();
    expect(lines.filter((l) => l.includes('secret-unusable'))).toHaveLength(2);
  });

  it('never rejects when Secrets Manager itself fails', async () => {
    // The contract that lets `createServer` fire this without awaiting it: a
    // Secrets Manager blip must cost the integrations that had no env value,
    // not the health check the load balancer is waiting for.
    const lines = captureLogs();
    setSecretsClientForTests({
      send: () => {
        const err = new Error('denied');
        err.name = 'AccessDeniedException';
        return Promise.reject(err);
      },
    });

    await expect(loadRemoteCredentials()).resolves.toBeUndefined();
    expect(lines.filter((l) => l.includes('secret-read-failed'))).toHaveLength(4);
  });

  it('ignores blank and non-string values rather than storing them', async () => {
    config.integrations.googleClientId = undefined;
    config.integrations.googleClientSecret = undefined;
    config.integrations.googleRefreshToken = undefined;
    stubSecrets({ google: { clientId: '   ', clientSecret: 42, refreshToken: 'real' } });

    await loadRemoteCredentials();

    expect(config.integrations.googleClientId).toBeUndefined();
    expect(config.integrations.googleClientSecret).toBeUndefined();
    expect(config.integrations.googleRefreshToken).toBe('real');
  });

  it('caches, so a per-request caller is not a per-request API call', async () => {
    const { reads } = stubSecrets({});

    await loadRemoteCredentials();
    await loadRemoteCredentials();

    expect(reads).toHaveLength(4);
  });

  it('re-reads after an invalidate, so a process sees its own write', async () => {
    const { reads } = stubSecrets({});

    await loadRemoteCredentials();
    invalidateRemoteCredentials();
    await loadRemoteCredentials();

    expect(reads).toHaveLength(8);
  });
});

describe('putRemoteCredentials', () => {
  it('writes the whole field set under the service’s own secret', async () => {
    const { writes } = stubSecrets({});

    await putRemoteCredentials('google', {
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rt',
    });

    expect(writes).toEqual([
      {
        id: `${PREFIX}/google`,
        body: { clientId: 'cid', clientSecret: 'csec', refreshToken: 'rt' },
      },
    ]);
  });

  it('drops fields the service does not own, so a caller cannot smuggle one in', async () => {
    const { writes } = stubSecrets({});

    await putRemoteCredentials('whatsapp', {
      phoneNumberId: '123',
      token: 'tok',
      clientSecret: 'not-a-whatsapp-field',
    } as Record<string, string>);

    expect(writes[0].body).toEqual({ phoneNumberId: '123', token: 'tok' });
  });

  it('writes an empty body on disconnect rather than deleting the secret', async () => {
    // Deleting would orphan a resource CloudFormation declares — the same trap
    // `valentin/<env>/google-oauth` fell into. Emptying it is what makes the
    // tool Lambda stop seeing a credential the panel says is disconnected.
    const { writes } = stubSecrets({});

    await putRemoteCredentials('amadeus', {});

    expect(writes).toEqual([{ id: `${PREFIX}/amadeus`, body: {} }]);
  });

  it('is a no-op with no prefix, so a local connect writes nothing remote', async () => {
    delete process.env.INTEGRATION_SECRETS_PREFIX;
    const { writes } = stubSecrets({});

    await putRemoteCredentials('google', { clientId: 'cid' });

    expect(writes).toEqual([]);
  });

  it('names the fix when the secret does not exist yet', async () => {
    const lines = captureLogs();
    setSecretsClientForTests({
      send: () => {
        const err = new Error('not found');
        err.name = 'ResourceNotFoundException';
        return Promise.reject(err);
      },
    });

    await expect(putRemoteCredentials('google', { clientId: 'c' })).resolves.toBeUndefined();

    const failure = lines.find((l) => l.includes('secret-write-failed'));
    expect(failure).toContain('deploy the Data stack');
  });
});

describe('no credential is ever logged', () => {
  it('holds across a load, a write and both failure paths', async () => {
    const SECRETS = ['load-secret-value', 'written-secret-value'];
    const lines = captureLogs();

    config.integrations.whatsappToken = undefined;
    stubSecrets({ whatsapp: { token: SECRETS[0] }, google: 'unparseable' });
    await loadRemoteCredentials();
    await putRemoteCredentials('google', { clientId: SECRETS[1] });

    // It did land where it belongs — otherwise this test would pass on a module
    // that reads nothing at all.
    expect(config.integrations.whatsappToken).toBe(SECRETS[0]);
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      for (const secret of SECRETS) {
        expect(line).not.toContain(secret);
      }
    }
  });
});

describe('integrationSecretNames', () => {
  it('names the four secrets the stack has to declare', () => {
    expect(integrationSecretNames('valentin/dev/integrations')).toEqual([
      'valentin/dev/integrations/amadeus',
      'valentin/dev/integrations/google',
      'valentin/dev/integrations/spotify',
      'valentin/dev/integrations/whatsapp',
    ]);
  });

  it('tolerates a trailing slash, so the CDK prop and the env var can differ', () => {
    expect(integrationSecretNames('valentin/dev/integrations/')).toContain(
      'valentin/dev/integrations/google',
    );
  });
});
