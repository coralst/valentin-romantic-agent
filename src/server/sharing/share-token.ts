import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { SHARE_TTL_DAYS } from '../../shared/constants/share-link';
import { config } from '../config';
import { logger } from '../logging';

/**
 * The one credential in this codebase that lets somebody read data that is not theirs.
 *
 * ## What this deliberately bypasses
 *
 * Every other read in the server is authorised *structurally*, not by a check.
 * A store is obtained by naming a user and every key it builds starts
 * `USER#<sub>#SESSION#<sid>` (see `persistence/keys.ts`), so asking for a foreign
 * session does not fail an `if` — it simply misses, and the handler maps the miss
 * to 404. There is no code path in which a caller's claim about who they are is
 * trusted, because no caller ever makes one.
 *
 * A share link breaks that by construction: the person clicking it has no account,
 * so there is no `sub` to scope a store to. This module is the single, deliberate
 * exception, and it is written so the exception keeps as much of the original
 * property as possible:
 *
 * - The token **carries** the owner's id, signed. The guest never asserts an
 *   identity and is never believed about one; the server reads the id out of a
 *   payload it signed itself and then goes through **that owner's own scoped
 *   store**. So the read is still structurally scoped — the only new thing is
 *   where the `sub` came from.
 * - Tampering fails closed. Flip a byte of the payload and the HMAC no longer
 *   matches, so `verifyShareToken` returns `null` and the caller 404s.
 * - It expires. {@link SHARE_TTL_DAYS} days after minting the same URL stops
 *   resolving with no revocation list to maintain.
 *
 * What it gives up, plainly: for those days, **possession of the URL is
 * sufficient** for a read-only, dossier-free view of one conversation. Anyone the
 * link is forwarded to has it. That is the same bargain as an unlisted document
 * link, it is the bargain the Share control has to describe in words, and it is why
 * `SharedConversation` is a narrow allowlist rather than a filtered `SessionDetail`.
 *
 * ## Wire format
 *
 * `base64url(JSON payload) . base64url(HMAC-SHA256(that same base64url text))`.
 * Two segments, no header segment: this is not a JWT and should not be mistaken for
 * one. A JWT would bring an `alg` field, and with it the whole family of
 * confused-algorithm attacks, in exchange for interoperability nothing here needs —
 * the only minter and the only verifier are both this file.
 *
 * ## The secret, and why absence breaks links rather than forging them
 *
 * `SHARE_TOKEN_SECRET` signs the tokens. With it unset we mint a random 32-byte
 * secret per process instead, and warn once. The consequence is real and worth
 * stating: links do not survive a restart, and on a multi-container deployment a
 * link minted by one task will not verify on another, so a share can 404 for no
 * reason the user can see.
 *
 * The alternative — a hardcoded default secret — would make every link verify
 * everywhere, including links **forged by anyone who has read this repository**.
 * That turns the one deliberate authorisation exception into an open read of any
 * session id for any user id. Between "some valid links stop working" and "invalid
 * links start working", breaking is the safe direction, so that is the direction
 * chosen. Set `SHARE_TOKEN_SECRET` in any deployment where sharing matters.
 */

/** What a share token says, once its signature has been checked. */
export interface ShareTokenPayload {
  /** The owner whose scoped store the read must go through. */
  userId: string;
  sessionId: string;
  /** Epoch **seconds**, matching `exp` everywhere else in this codebase. */
  exp: number;
  /**
   * When the link was minted, epoch **seconds** — the point the conversation was
   * shared *at*.
   *
   * This is what makes a branch possible. Opening a link continues the
   * conversation from the moment it was handed over, not from wherever the owner
   * has since dragged it: a link sent on Tuesday should still open on Tuesday's
   * conversation on Friday. Without a mark, "the shared point" and "the latest
   * message" are the same thing and a branch cannot be cut anywhere.
   *
   * Optional because tokens minted before this field existed are still valid and
   * still verify. {@link sharedAtSeconds} supplies the answer for them.
   */
  iat?: number;
}

/** A freshly minted token, plus the expiry in the form the API reports. */
export interface MintedShareToken {
  token: string;
  /** ISO instant, for `ShareLinkResponse.expiresAt`. */
  expiresAt: string;
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * The per-process fallback secret, minted at most once.
 *
 * Lazily, not at import time, so a process that never mints or verifies a share
 * link neither burns entropy nor logs a warning about a feature it is not using.
 */
let ephemeralSecret: Buffer | null = null;

function signingSecret(): Buffer {
  const configured = config.shareTokenSecret;
  if (configured && configured.length > 0) return Buffer.from(configured, 'utf8');

  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32);
    // Once per process, at first use. Logged as a warning rather than thrown
    // because a missing secret must not take down a deployment that only ever
    // uses the rest of the app — see the header for why breaking beats forging.
    logger.warn('share.secret_ephemeral', {
      detail:
        'SHARE_TOKEN_SECRET is unset, so share links are signed with a per-process ' +
        'random key: existing links stop verifying after a restart and will not ' +
        'verify on a second container.',
    });
  }
  return ephemeralSecret;
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

/**
 * Mint a token naming one conversation and its owner.
 *
 * `now` is injectable in milliseconds — the clock convention the rest of the server
 * uses — while `exp` is stored in seconds, so a token is a little shorter and reads
 * like every other `exp` in the codebase.
 */
export function mintShareToken(
  userId: string,
  sessionId: string,
  now: number = Date.now(),
): MintedShareToken {
  const iat = Math.floor(now / 1000);
  const exp = iat + SHARE_TTL_DAYS * DAY_SECONDS;
  const payload: ShareTokenPayload = { userId, sessionId, exp, iat };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  return {
    token: `${encoded}.${sign(encoded)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Constant-time signature comparison.
 *
 * `timingSafeEqual` **throws** on differing lengths, which would turn a truncated
 * token into a 500, so the length is compared first. That early return is not a
 * timing leak worth caring about: it reveals the length of a signature whose
 * algorithm is fixed and public.
 */
function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Whether a parsed JSON value is really a payload, rather than merely signed. */
function isShareTokenPayload(value: unknown): value is ShareTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0 &&
    typeof candidate.sessionId === 'string' &&
    candidate.sessionId.length > 0 &&
    typeof candidate.exp === 'number' &&
    Number.isFinite(candidate.exp) &&
    // Absent is fine — see `iat`. Present and nonsense is not: it decides where a
    // branch gets cut, and a NaN there would silently cut at the beginning.
    (candidate.iat === undefined ||
      (typeof candidate.iat === 'number' && Number.isFinite(candidate.iat)))
  );
}

/**
 * The instant a link was shared, in epoch seconds.
 *
 * Falls back to `exp - SHARE_TTL_DAYS` for tokens minted before `iat` existed,
 * which is exactly right rather than merely tolerable: `exp` was always derived
 * from the mint time by adding the TTL, so subtracting it recovers the original.
 */
export function sharedAtSeconds(payload: ShareTokenPayload): number {
  return payload.iat ?? payload.exp - SHARE_TTL_DAYS * DAY_SECONDS;
}

/**
 * Check a token and return what it says, or `null`.
 *
 * **Never throws.** A malformed, truncated, re-signed, mis-signed or expired token
 * is `null`, indistinguishably, and the caller turns every `null` into the same
 * 404. That indistinguishability is the point: this is called before any
 * authentication, so an unauthenticated caller must not be able to learn from the
 * response whether they hold a forgery or something that used to work.
 */
export function verifyShareToken(
  token: string | undefined,
  now: number = Date.now(),
): ShareTokenPayload | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  if (!signatureMatches(sign(encoded), signature)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    // Signed by us and still unparseable should be impossible; treated as an
    // invalid token anyway rather than as a server fault, because the whole
    // contract of this function is that a caller never sees a throw.
    return null;
  }

  if (!isShareTokenPayload(parsed)) return null;
  if (parsed.exp <= Math.floor(now / 1000)) return null;

  return parsed;
}
