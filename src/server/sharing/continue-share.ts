import { randomUUID } from 'node:crypto';
import type { ShareContinueResponse } from '../../shared/constants/share-link';
import type { HttpResponse } from '../api/http-routes';
import type { StorageInterface } from '../persistence/storage-interface';
import { branchSharedConversation } from './branch-conversation';
import { sharedAtSeconds, verifyShareToken } from './share-token';

/**
 * `POST /api/share/:token/continue` — turn a link into a conversation of the
 * visitor's own.
 *
 * ## Why this is its own module and not another inline route
 *
 * It is the second unauthenticated *write* endpoint this server has, after the demo
 * login, and the only one that writes on behalf of a caller who has no account. That
 * is worth being able to read in one place and test without an Express instance —
 * `express-app.ts` is a route table, and burying the branching rules in it is how
 * they stop getting reviewed.
 *
 * ## The two identities involved, which must not be confused
 *
 * - The **owner**, read out of the token's signed payload. Their store is opened
 *   read-only, exactly as `GET /api/share/:token` opens it, and is never passed as
 *   the branch target.
 * - The **visitor**, minted here. They get an ordinary credential — the same kind
 *   `POST /api/demo/login` hands out — and the fork is written into their own scoped
 *   store. Nothing downstream of this route learns that a share link was involved.
 *
 * Every failure to resolve the link is **404 with one body**, for the reason
 * `share-token.ts` sets out: a caller with no token must not be able to tell a
 * forgery from something that has expired from a conversation that was deleted.
 * Failures of *ours* — the demo account being unconfigured, Cognito refusing — keep
 * their own status codes, because those are not facts about the link.
 */

/** The one answer any unresolvable link gets. */
const NOT_FOUND: HttpResponse = {
  status: 404,
  body: { error: 'This link has expired or is not valid' },
};

/**
 * How a visitor credential gets minted, in either environment.
 *
 * Local development and `npm test` run with no Cognito at all, and a share link
 * that only works in a deployment is a share link nobody can verify before
 * shipping it — so the bypass is a first-class branch here rather than an
 * afterthought. See {@link ShareContinueDeps.authDisabled}.
 */
interface VisitorCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  visitorId: string | null;
  demo: boolean;
  /** Already scoped; pass straight to `forUser`. */
  storageUserId: string;
}

/** Matches `DevBypassTokenVerifier`'s own lifetime closely enough to be honest. */
const DEV_CREDENTIAL_SECONDS = 60 * 60;

export interface ShareContinueDeps {
  /** Builds a scoped store. Called twice: once for the owner, once for the visitor. */
  forUser: (userId: string) => { store: StorageInterface };
  /**
   * The demo account, when this deployment has one.
   *
   * Absent means "no shared account configured", which is a 503 and not a 404: the
   * link is fine, the deployment cannot honour it.
   */
  demoLogin?: {
    isConfigured: boolean;
    issueVisitorCredentials: () => Promise<
      | {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
          visitorId: string;
          storageUserId: string;
        }
      | { error: HttpResponse }
    >;
  };
  /**
   * True when the process runs `DevBypassTokenVerifier`, i.e. `isAuthDisabled()`.
   *
   * Passed in rather than read here so a test can exercise both branches without
   * mutating `config`.
   */
  authDisabled: boolean;
  /** Injectable clock, milliseconds, for the token's expiry check. */
  now?: number;
}

/**
 * A guest identity for a server with no Cognito.
 *
 * `share-guest-` rather than a bare UUID so a stray row in a local DynamoDB table
 * is identifiable as having come from a share link, and so it cannot collide with
 * `anonymous` — the id every *other* bypass caller gets, and therefore the one
 * partition a fork must not be written into.
 */
function devCredential(): VisitorCredential {
  const userId = `share-guest-${randomUUID()}`;
  return {
    accessToken: `dev:${userId}`,
    refreshToken: null,
    expiresIn: DEV_CREDENTIAL_SECONDS,
    visitorId: null,
    demo: false,
    storageUserId: userId,
  };
}

async function issueVisitor(
  deps: ShareContinueDeps,
): Promise<VisitorCredential | { error: HttpResponse }> {
  if (deps.authDisabled) return devCredential();

  if (!deps.demoLogin?.isConfigured) {
    return {
      error: {
        status: 503,
        body: {
          error: 'Continuing a shared conversation is not available on this deployment',
        },
      },
    };
  }

  const issued = await deps.demoLogin.issueVisitorCredentials();
  if ('error' in issued) return issued;

  return {
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    expiresIn: issued.expiresIn,
    visitorId: issued.visitorId,
    demo: true,
    storageUserId: issued.storageUserId,
  };
}

/**
 * Verify a link, fork the conversation behind it, and hand back a way in.
 *
 * Ordering matters and is deliberate: the token is checked and the owner's session
 * is confirmed to exist **before** any credential is minted. Doing it the other way
 * round would burn a Cognito call and a rate-limit slot on every scan of `/api/share/
 * <garbage>/continue`.
 */
export async function continueSharedConversation(
  token: string | undefined,
  deps: ShareContinueDeps,
): Promise<HttpResponse> {
  const payload = verifyShareToken(token, deps.now);
  if (!payload) return NOT_FOUND;

  const { store: source } = deps.forUser(payload.userId);
  const session = await source.getSession(payload.sessionId);
  if (!session) return NOT_FOUND;

  const credential = await issueVisitor(deps);
  if ('error' in credential) return credential.error;

  const { store: target } = deps.forUser(credential.storageUserId);
  const branch = await branchSharedConversation({
    source,
    target,
    session,
    sourceSessionId: payload.sessionId,
    sharedAt: sharedAtSeconds(payload),
  });

  return {
    status: 200,
    body: {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      expiresIn: credential.expiresIn,
      sessionId: branch.sessionId,
      visitorId: credential.visitorId,
      demo: credential.demo,
      title: branch.title,
      copied: branch.copied,
      advanced: branch.advanced,
    } satisfies ShareContinueResponse,
  };
}
