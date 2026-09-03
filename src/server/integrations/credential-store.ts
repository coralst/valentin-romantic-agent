import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { config } from '../config';
import { logger } from '../logging';
import type { ConnectableId } from './credentials';

/**
 * Where integration credentials live when the process is not the one they were
 * pasted into.
 *
 * ## The problem this exists for
 *
 * `credentials.ts` writes an accepted credential to `config.integrations` and to
 * `.env`. In-memory is correct and immediate; `.env` survives a local restart.
 * Neither survives a Fargate task being replaced, and neither is visible to a
 * *second* process — which is exactly what the AgentCore Gateway's tool Lambda
 * is. Connect Google in the panel and the Lambda would still see nothing.
 *
 * ## The one rule everything else follows from
 *
 * **`process.env` wins.** {@link loadRemoteCredentials} fills only fields that
 * are currently unset, and never overwrites. That keeps local dev, `npm test`
 * and Playwright working with no AWS account at all, makes this module a total
 * no-op when `INTEGRATION_SECRETS_PREFIX` is unset, and means someone debugging
 * with a key in their shell cannot be silently overridden by what a deployment
 * happens to hold.
 *
 * ## One secret per service, not one blob
 *
 * `valentin/<env>/integrations/<service>`, four of them. A Google reconnect must
 * not rewrite Amadeus, and a JSON blob written by two processes at once loses
 * whichever write landed first.
 *
 * ## Values go in and never come out
 *
 * Same contract as `credentials.ts`: nothing here logs, returns or echoes a
 * credential — not truncated, not masked. The log lines name a service and a
 * count of fields, never a value.
 */

/** The `config.integrations` fields that can arrive from a secret. */
type CredentialField =
  | 'amadeusClientId'
  | 'amadeusClientSecret'
  | 'googleClientId'
  | 'googleClientSecret'
  | 'googleRefreshToken'
  | 'spotifyClientId'
  | 'spotifyClientSecret'
  | 'spotifyRefreshToken'
  | 'whatsappPhoneNumberId'
  | 'whatsappToken';

/**
 * Which JSON keys a service's secret holds, and where each one lands.
 *
 * The JSON keys deliberately match the field names the panel POSTs
 * (`clientId`, `refreshToken`, …) rather than the `config.integrations` names,
 * so a human reading the secret in the console sees the same words the connect
 * form uses.
 *
 * `amadeusHost` is absent on purpose: it has a default in `config.ts`, so it is
 * never "unset" and could never be filled from here — and it is a hostname
 * rather than a credential, which makes a secret the wrong home for it.
 */
const FIELDS: Record<ConnectableId, Readonly<Record<string, CredentialField>>> = {
  amadeus: {
    clientId: 'amadeusClientId',
    clientSecret: 'amadeusClientSecret',
  },
  google: {
    clientId: 'googleClientId',
    clientSecret: 'googleClientSecret',
    refreshToken: 'googleRefreshToken',
  },
  spotify: {
    clientId: 'spotifyClientId',
    clientSecret: 'spotifyClientSecret',
    refreshToken: 'spotifyRefreshToken',
  },
  whatsapp: {
    phoneNumberId: 'whatsappPhoneNumberId',
    token: 'whatsappToken',
  },
};

const SERVICES = Object.keys(FIELDS) as ConnectableId[];

/**
 * Long enough that a cold Lambda is not a Secrets Manager call per invocation,
 * short enough that a reconnect in the panel reaches the tool host without a
 * redeploy. `invalidateRemoteCredentials` is the fast path for the process that
 * did the writing.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Just enough of the client to be stubbed. */
export interface SecretsClientLike {
  send(command: unknown): Promise<unknown>;
}

let client: SecretsClientLike | null = null;
let loadedAt = 0;

/** Overridable so no test reaches a real account. */
export function setSecretsClientForTests(stub: SecretsClientLike | null): void {
  client = stub;
  loadedAt = 0;
}

/** Forget the cache, so the next load re-reads. Called after a write. */
export function invalidateRemoteCredentials(): void {
  loadedAt = 0;
}

/**
 * The prefix, or null when this whole module is switched off.
 *
 * Read at call time rather than at module load: `npm test` and the tool Lambda
 * set it per case, and a value captured at import would freeze the first one.
 */
function secretsPrefix(): string | null {
  const prefix = process.env.INTEGRATION_SECRETS_PREFIX?.trim();
  return prefix ? prefix.replace(/\/+$/, '') : null;
}

function secretId(prefix: string, id: ConnectableId): string {
  return `${prefix}/${id}`;
}

function secretsClient(): SecretsClientLike {
  client ??= new SecretsManagerClient({});
  return client;
}

/** A secret's body, or null for anything this cannot use. Never throws. */
function parseSecret(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Merge one service's secret into `config.integrations`, env-wins.
 *
 * Returns how many fields it filled, for the log line — a count is useful
 * ("Google arrived with two of three fields, so consent never completed") and
 * carries no value.
 */
function mergeSecret(id: ConnectableId, body: Record<string, unknown>): number {
  let filled = 0;
  for (const [jsonKey, field] of Object.entries(FIELDS[id])) {
    // The env-wins rule, in one line. Deliberately a presence check on the
    // *current* value rather than on `process.env`, so a credential pasted into
    // the panel earlier in this process's life is equally protected.
    if (config.integrations[field]) continue;

    const value = body[jsonKey];
    if (typeof value !== 'string' || value.trim().length === 0) continue;

    config.integrations[field] = value.trim();
    filled += 1;
  }
  return filled;
}

/**
 * Fill in whatever `process.env` did not provide, from Secrets Manager.
 *
 * Awaited before the first `buildToolRegistry()` — the registry gates each tool
 * on a `config.integrations` boolean, so a tool whose credential is still in
 * flight would simply not be registered, and the panel would show it dark with
 * nothing failing.
 *
 * **Never throws, and never rejects.** Secrets Manager is now in the boot path,
 * and this layer's stated contract is "absent rather than broken": a blip must
 * cost the integrations that had no env value, not the whole server. A missing
 * secret is the ordinary case before the first connect, so it is logged at debug
 * volume rather than as a failure.
 */
export async function loadRemoteCredentials(): Promise<void> {
  const prefix = secretsPrefix();
  if (!prefix) return;

  if (loadedAt && Date.now() - loadedAt < CACHE_TTL_MS) return;
  loadedAt = Date.now();

  await Promise.all(
    SERVICES.map(async (id) => {
      try {
        const response = (await secretsClient().send(
          new GetSecretValueCommand({ SecretId: secretId(prefix, id) }),
        )) as { SecretString?: string };

        const body = parseSecret(response.SecretString);
        if (!body) {
          logger.warn('integration.secret-unusable', { integration: id });
          return;
        }

        const filled = mergeSecret(id, body);
        if (filled > 0) {
          logger.info('integration.secret-loaded', { integration: id, fields: filled });
        }
      } catch (err) {
        // ResourceNotFoundException is the normal state of a service nobody has
        // connected yet, so it is not worth a warning; anything else might be a
        // permissions problem worth seeing.
        const name = err instanceof Error ? err.name : 'Unknown';
        if (name === 'ResourceNotFoundException') return;
        logger.warn('integration.secret-read-failed', { integration: id, cause: name });
      }
    }),
  );
}

/**
 * Persist one service's credentials so other processes see them.
 *
 * **`PutSecretValue` only — never `CreateSecret`.** A secret created at runtime
 * would carry none of the SpringClean exemption tags the CDK stack applies, and
 * the Isengard janitor deletes untagged resources: the integration would go dark
 * weeks later with no diff to blame it on. So the four secrets are declared in
 * the Data stack, and `ResourceNotFoundException` here means "infra not deployed
 * yet", which is a warning and not an error.
 *
 * Best-effort, exactly like `persistEnv`: the caller has already applied the
 * value to `config.integrations`, so the connect succeeded regardless. A failed
 * write costs cross-process visibility, not the connection.
 *
 * The whole field set is written each time rather than patched, because
 * `PutSecretValue` replaces the version wholesale — a partial body would erase
 * the fields it omitted.
 */
export async function putRemoteCredentials(
  id: ConnectableId,
  values: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const prefix = secretsPrefix();
  if (!prefix) return;

  const body: Record<string, string> = {};
  for (const jsonKey of Object.keys(FIELDS[id])) {
    const value = values[jsonKey];
    if (typeof value === 'string' && value.length > 0) body[jsonKey] = value;
  }

  try {
    await secretsClient().send(
      new PutSecretValueCommand({
        SecretId: secretId(prefix, id),
        SecretString: JSON.stringify(body),
      }),
    );
    // So the next `loadRemoteCredentials` in this process sees its own write.
    invalidateRemoteCredentials();
    logger.info('integration.secret-written', {
      integration: id,
      fields: Object.keys(body).length,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Unknown';
    logger.warn('integration.secret-write-failed', {
      integration: id,
      cause: name,
      // Named rather than left to inference: this is the one failure with an
      // obvious fix, and it is not the reader's first guess.
      hint:
        name === 'ResourceNotFoundException'
          ? `${secretId(prefix, id)} does not exist — deploy the Data stack`
          : undefined,
    });
  }
}

/** The secret ids the stack must declare. Exported for the infra test to assert. */
export function integrationSecretNames(prefix: string): string[] {
  return SERVICES.map((id) => secretId(prefix.replace(/\/+$/, ''), id));
}
