import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from '../config';

/** Who a verified token says the caller is */
export interface AuthContext {
  /** The Cognito `sub`. Becomes part of every DynamoDB partition key. */
  userId: string;
  /**
   * True when the token came from the server-only demo client.
   *
   * Free to derive, because demo tokens necessarily carry a different
   * `client_id` — they are minted by AdminInitiateAuth against a second app
   * client so the public SPA client can stay PKCE-only.
   */
  isDemo: boolean;
  /** Token expiry, epoch **seconds** (the `exp` claim, unconverted). */
  expiresAt: number;
}

/** Turns a bearer token into an {@link AuthContext}, or throws */
export interface TokenVerifier {
  verify(token: string): Promise<AuthContext>;
}

/** Thrown for every rejection reason, so callers never branch on the cause */
export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

/**
 * How long a dev-bypass token is treated as valid. Only used when there is no
 * user pool, so it never gates anything real.
 */
const DEV_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/** The user a dev-bypass caller becomes when it presents no token at all */
export const ANONYMOUS_USER_ID = 'anonymous';

/** Prefix marking a dev-bypass token: `dev:<userId>` */
const DEV_TOKEN_PREFIX = 'dev:';

/**
 * Verifies real Cognito **access** tokens.
 *
 * `aws-jwt-verify` is AWS's own, has no dependencies, and encodes the checks
 * that are easy to leave out by hand: `token_use`, the `client_id` allow-list,
 * the issuer, and JWKS fetching with caching.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(
    private readonly userPoolId: string,
    private readonly spaClientId: string,
    private readonly demoClientId: string,
  ) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId,
      // The *access* token, not the id token. It is what the SPA sends and the
      // only one whose `sub` we want as a storage key.
      tokenUse: 'access',
      // Both clients, not just the SPA one. A single-value clientId here
      // silently 401s every demo user, and does it in a way that reads as a
      // broken endpoint rather than a misconfiguration.
      clientId: [spaClientId, demoClientId],
    });
  }

  async verify(token: string): Promise<AuthContext> {
    let payload;
    try {
      payload = await this.verifier.verify(token);
    } catch (err) {
      throw new TokenVerificationError(
        err instanceof Error ? err.message : 'Token verification failed',
      );
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new TokenVerificationError('Token carries no subject');
    }

    return {
      userId: payload.sub,
      isDemo: payload.client_id === this.demoClientId,
      expiresAt: payload.exp,
    };
  }
}

/**
 * Accepts anything, for local development and tests.
 *
 * This exists so that `npm test`, `e2e/tests/*` and `npm run dev:server` need
 * no Cognito account and no test edits. It is only ever constructed by
 * {@link createTokenVerifier}, which refuses to build it in production.
 *
 * A token of `dev:<id>` becomes that user, which is what lets two browser tabs
 * behave as two different people locally; anything else, including no token at
 * all, becomes `anonymous`.
 */
export class DevBypassTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<AuthContext> {
    const trimmed = token?.trim() ?? '';
    const userId = trimmed.startsWith(DEV_TOKEN_PREFIX)
      ? trimmed.slice(DEV_TOKEN_PREFIX.length) || ANONYMOUS_USER_ID
      : ANONYMOUS_USER_ID;

    return {
      userId,
      isDemo: false,
      expiresAt: Math.floor(Date.now() / 1000) + DEV_TOKEN_LIFETIME_SECONDS,
    };
  }
}

/**
 * Pick a verifier from the environment.
 *
 * The asymmetry is the point: outside production, missing Cognito config means
 * "developer has no AWS account" and degrades to the bypass with a loud warning.
 * In production it means the deployment is broken, and the only safe response is
 * to refuse to start — a server that boots with authentication silently disabled
 * is worse than one that fails its health check.
 */
export function createTokenVerifier(): TokenVerifier {
  const { userPoolId, spaClientId, demoClientId } = config.cognito;
  const isProduction = config.nodeEnv === 'production';

  if (!userPoolId || !spaClientId || !demoClientId) {
    if (isProduction) {
      throw new Error(
        'Cognito is not configured (COGNITO_USER_POOL_ID / COGNITO_SPA_CLIENT_ID / ' +
          'COGNITO_DEMO_CLIENT_ID). Refusing to start in production with ' +
          'authentication disabled.',
      );
    }

    console.warn(
      '[auth] ⚠️  COGNITO_USER_POOL_ID is unset — authentication is DISABLED. ' +
        'Every caller is treated as a development user. This is only permitted ' +
        `outside production (NODE_ENV=${config.nodeEnv}).`,
    );
    return new DevBypassTokenVerifier();
  }

  return new CognitoTokenVerifier(userPoolId, spaClientId, demoClientId);
}

/** True when the process will run without real token verification */
export function isAuthDisabled(): boolean {
  return !config.cognito.userPoolId && config.nodeEnv !== 'production';
}
