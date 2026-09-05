import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { resolvePersona, type DemoPersonaId } from '../fixtures/demo-personas';
import type { HttpResponse } from '../api/http-routes';
import type { StorageInterface } from '../persistence/storage-interface';
import type { TokenVerifier } from './token-verifier';

/**
 * How long a demo conversation survives before the next demo click reaps it.
 *
 * Not "delete everything on each login": two people clicking "Try the demo"
 * seconds apart would then wipe each other mid-conversation, at the worst
 * possible moment. Thirty minutes is longer than any demo and shorter than the
 * gap between them.
 */
const DEMO_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** Requests allowed per window, and the window. */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * A single shared bucket, in process memory.
 *
 * The risk this guards is Bedrock spend, not privacy — the demo account holds
 * nothing but fixture data. So a per-task approximation is enough; a precise
 * distributed limiter would cost a round trip per click to protect a synthetic
 * profile. The blanket WAF rate rule sits in front of this as a second layer.
 */
export class TokenBucket {
  private timestamps: number[] = [];

  constructor(
    private readonly max = RATE_LIMIT_MAX,
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
  ) {}

  /** True when the caller may proceed; records the attempt when it does */
  tryConsume(now = Date.now()): boolean {
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.max) return false;
    this.timestamps.push(now);
    return true;
  }
}

/** What the browser needs after a demo login */
export interface DemoLoginBody {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** A freshly seeded session, so the profile panel is populated on arrival */
  sessionId: string;
  /** The persona actually seeded — the fallback makes this differ from the ask */
  persona: string;
  /**
   * This visitor's private corner of the shared demo account.
   *
   * Every demo visitor authenticates as the same Cognito user, so the `sub` in
   * the token is identical for all of them and cannot separate their data. This
   * id can: the browser echoes it back on every request, and the server appends
   * it to the storage user id, which puts each visitor on their own DynamoDB
   * partition prefix. Two people clicking Login and Create an Account at the
   * same time then see their own conversations and nobody else's.
   *
   * Not a secret and not an authorisation boundary — it only separates rows
   * inside an account the caller already proved they hold a token for.
   */
  visitorId: string;
}

/**
 * Scope a storage user id to one demo visitor.
 *
 * `#` because the DynamoDB key builders already use it as their separator, so a
 * scoped id composes into `USER#<sub>#<visitor>#SESSION#<sid>` and needs no
 * change to `keys.ts`.
 */
export function scopeToVisitor(userId: string, visitorId: string): string {
  return `${userId}#${visitorId}`;
}

/**
 * A visitor id the server minted, and not something else.
 *
 * The value arrives from a request header, and it is concatenated into a
 * DynamoDB partition key -- so it is validated rather than trusted. A UUID
 * shape means a caller cannot craft a suffix that collides with the key
 * grammar's `#SESSION#` / `#MSG#` segments and read across the separator.
 */
export function isValidVisitorId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

/**
 * Which storage id a caller's data lives under.
 *
 * For anyone with their own Cognito account this is just their `sub`. Demo
 * visitors all share one account, so the `sub` alone pools every visitor's
 * conversations into one sidebar and someone clicking "Create an Account" opens
 * onto a stranger's partner. `POST /api/demo/login` hands each visitor a
 * `visitorId` for exactly this; the browser echoes it back on every request and
 * in the WebSocket `auth` frame, and both entry points come through here.
 *
 * Honoured only for demo tokens, and only in the server-minted UUID shape.
 * Anything else falls back to the unscoped id rather than erroring, so a client
 * that predates the field still works — it just sees the shared pile.
 */
export function storageUserId(auth: { userId: string; isDemo: boolean }, claimed: unknown): string {
  if (!auth.isDemo) return auth.userId;
  const visitorId = Array.isArray(claimed) ? claimed[0] : claimed;
  return isValidVisitorId(visitorId)
    ? scopeToVisitor(auth.userId, visitorId)
    : auth.userId;
}

/** Injectable collaborators, so tests never reach a real AWS account */
export interface DemoLoginDeps {
  cognito?: Pick<CognitoIdentityProviderClient, 'send'>;
  secrets?: Pick<SecretsManagerClient, 'send'>;
  /** Verifies the token we just minted, which is also how we learn the `sub` */
  verifier: TokenVerifier;
  /** Builds the demo user's scoped store once their `sub` is known */
  storeFor: (userId: string) => StorageInterface;
  /** Seeds the persona's profile into a fresh session, returning its id */
  seedSession: (
    storage: StorageInterface,
    persona: DemoPersonaId,
  ) => Promise<string>;
  bucket?: TokenBucket;
}

interface DemoCredentials {
  username: string;
  password: string;
}

/**
 * The one unauthenticated write endpoint: `POST /api/demo/login`.
 *
 * Cognito's Hosted UI password form cannot be prefilled, and shipping the demo
 * password in the SPA bundle would make it public forever. So the server signs
 * the shared demo account in on the caller's behalf, using a second app client
 * that only it can reach, and hands back **real Cognito tokens**. They are
 * indistinguishable from Hosted UI tokens, which is what keeps one code path
 * downstream of login.
 */
export class DemoLoginService {
  private readonly cognito: Pick<CognitoIdentityProviderClient, 'send'>;
  private readonly secrets: Pick<SecretsManagerClient, 'send'>;
  private readonly bucket: TokenBucket;
  /** Cached for the process lifetime — the secret does not rotate mid-demo */
  private credentials: DemoCredentials | null = null;

  constructor(private readonly deps: DemoLoginDeps) {
    this.cognito =
      deps.cognito ??
      new CognitoIdentityProviderClient({ region: config.awsRegion });
    this.secrets =
      deps.secrets ?? new SecretsManagerClient({ region: config.awsRegion });
    this.bucket = deps.bucket ?? new TokenBucket();
  }

  /** True when the deployment has everything the demo button needs */
  get isConfigured(): boolean {
    return Boolean(config.cognito.userPoolId && config.cognito.demoClientId && config.cognito.demoSecretArn);
  }

  /**
   * @param persona Which demo profile to seed. Unknown ids fall back to the
   *   default rather than erroring — see `resolvePersona`.
   */
  async login(persona?: unknown): Promise<HttpResponse> {
    const issued = await this.issueVisitorCredentials();
    if ('error' in issued) return issued.error;

    // Resolved here rather than inside `seedSession` so the id we report back is
    // the one that was actually seeded.
    const resolved = resolvePersona(persona);

    const storage = this.deps.storeFor(issued.storageUserId);
    // Only ever this visitor's own store, which is now always empty — kept
    // because a returning visitor may reuse an id, and it costs one query.
    await this.reapStaleSessions(storage);
    const sessionId = await this.deps.seedSession(storage, resolved.id);

    return {
      status: 200,
      body: {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresIn: issued.expiresIn,
        sessionId,
        persona: resolved.id,
        visitorId: issued.visitorId,
      } satisfies DemoLoginBody,
    };
  }

  /**
   * Sign the shared account in and carve out a fresh corner of it, seeding nothing.
   *
   * Extracted from {@link login} so a share link can be continued in the app: that
   * flow needs exactly the credential half — a real token and a private storage
   * scope — and none of the persona half, because it seeds the *shared
   * conversation* into the new session instead of a fixture profile. Duplicating
   * the Cognito call there would have meant two places to keep the rate limit, the
   * challenge handling and the `sub` lookup correct.
   *
   * Returns `{ error }` rather than throwing for the same reason `login` does: both
   * callers are HTTP routes and the failures are answers, not faults.
   */
  async issueVisitorCredentials(): Promise<
    | {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        visitorId: string;
        /** Already scoped — pass straight to `storeFor`. */
        storageUserId: string;
      }
    | { error: HttpResponse }
  > {
    if (!this.isConfigured) {
      return {
        error: {
          status: 503,
          body: { error: 'The demo account is not configured on this deployment' },
        },
      };
    }

    if (!this.bucket.tryConsume()) {
      return {
        error: { status: 429, body: { error: 'Too many demo logins, try again shortly' } },
      };
    }

    const { username, password } = await this.readCredentials();

    const auth = await this.cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId: config.cognito.userPoolId,
        ClientId: config.cognito.demoClientId,
        // Reachable only through the IAM-signed admin API, which only the task
        // role may call. The browser-callable USER_PASSWORD_AUTH is not enabled
        // on this client at all.
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }) as never,
    );

    const result = (auth as { AuthenticationResult?: {
      AccessToken?: string;
      RefreshToken?: string;
      ExpiresIn?: number;
    } }).AuthenticationResult;

    if (!result?.AccessToken || !result.RefreshToken) {
      // A challenge (NEW_PASSWORD_REQUIRED, MFA) means the seed script did not
      // set the password as permanent. Nothing the caller can do about it.
      return {
        error: {
          status: 502,
          body: { error: 'The demo account could not be signed in' },
        },
      };
    }

    // Verifying our own token is not ceremony: it is how we learn the `sub`,
    // and it fails loudly if the verifier's client allow-list is missing the
    // demo client — the misconfiguration that would otherwise 401 every demo
    // user later, looking like a broken endpoint.
    const { userId } = await this.deps.verifier.verify(result.AccessToken);

    // A fresh corner of the shared account per login. This is what makes Login
    // and Create an Account two separate users rather than two views of one
    // pile: without it `listSessions` returns every demo visitor's
    // conversations, so a brand-new account opens with a stranger's partner in
    // the sidebar.
    const visitorId = randomUUID();

    return {
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn ?? 3600,
      visitorId,
      storageUserId: scopeToVisitor(userId, visitorId),
    };
  }

  /** Drop demo conversations old enough that nobody is still in them */
  private async reapStaleSessions(storage: StorageInterface): Promise<void> {
    const now = Date.now();
    const sessions = await storage.listSessions();

    const stale = sessions.filter((session) => {
      const touched = Date.parse(session.lastActivity ?? session.createdAt);
      return Number.isFinite(touched) && now - touched > DEMO_SESSION_MAX_AGE_MS;
    });

    // Best-effort: a failed reap must not cost someone their demo.
    await Promise.all(
      stale.map((session) =>
        storage.deleteSession(session.id).catch(() => undefined),
      ),
    );
  }

  private async readCredentials(): Promise<DemoCredentials> {
    if (this.credentials) return this.credentials;

    const response = await this.secrets.send(
      new GetSecretValueCommand({
        SecretId: config.cognito.demoSecretArn,
      }) as never,
    );

    const raw = (response as { SecretString?: string }).SecretString;
    if (!raw) {
      throw new Error('The demo credentials secret has no string value');
    }

    // Never logged, never returned — the only thing that leaves this method is
    // a token.
    const parsed = JSON.parse(raw) as Partial<DemoCredentials>;
    if (!parsed.username || !parsed.password) {
      throw new Error('The demo credentials secret is missing username or password');
    }

    this.credentials = { username: parsed.username, password: parsed.password };
    return this.credentials;
  }
}
