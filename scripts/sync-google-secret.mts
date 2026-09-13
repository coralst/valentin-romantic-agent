/**
 * Copy the working Google credential set from `.env` into Secrets Manager.
 *
 * ## Why this exists
 *
 * The deployed backend reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
 * `GOOGLE_REFRESH_TOKEN` out of the `valentin/dev/google-oauth` secret; local scripts
 * read the same three from `.env`. Nothing keeps the two in step, and the refresh
 * token is perishable — while the OAuth client's consent screen is in Google's
 * `Testing` publishing status, every token it mints dies after seven days.
 *
 * When that happens, *both* Google integrations fail at once and neither says why:
 * `googleAccessToken()` returns `null`, `find_occasions` answers "I could not reach
 * the calendar", and a reminder send answers "Gmail accepted no message id". On
 * 2026-09-13 that combination cost an hour to trace to one expired string, and the
 * user-visible symptom was a recorded demo claiming a mail had been sent when the
 * mail had never left.
 *
 * So: one command, and it **proves the token before it writes it**. Writing a dead
 * credential into the secret would replace a known-bad value with another known-bad
 * value and cost the next person the same hour.
 *
 * ## Usage
 *
 *   npm run sync:google-secret              # verify .env, then write the secret
 *   npm run sync:google-secret -- --check   # verify only, write nothing
 *
 * Then **restart the tasks**: `ecs.Secret.fromSecretsManager` injects the value as an
 * environment variable at task start, so a running container keeps whatever it booted
 * with no matter what the secret now says.
 *
 *   AWS_REGION=us-east-1 npm run deploy:backend
 *
 * ## What it prints
 *
 * Fingerprints — eight hex characters of a SHA-256 — never a credential. That is
 * enough to answer "is the deployed value the one I just tested" and nothing more,
 * so the output is safe to paste into a PR or a chat.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SECRET_ID = 'valentin/dev/google-oauth';

/**
 * The region is pinned, not inherited.
 *
 * Every stack in this account lives in `us-east-1`, and this machine has been seen
 * with a stray `AWS_REGION=us-west-2` exported into the shell — which has already
 * sent one deploy to the wrong region. Honouring that variable here would make the
 * script report "the secret does not exist" while looking 4,000km from the secret.
 * `--region=` is there for the day a second region is real.
 */
const REGION =
  process.argv.slice(2).find((arg) => arg.startsWith('--region='))?.slice('--region='.length) ??
  'us-east-1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Where `.env` might be, in order.
 *
 * `.env` is git-ignored, so a worktree under `.claude/worktrees/<name>` never has one
 * — the credential lives in the main checkout three levels up. Looking there is not a
 * convenience: a script that only ever reads `../.env` fails in exactly the place this
 * repo does its work, which is how it would come to be run with `AWS_PROFILE` set and
 * `.env` absent and be believed when it said "no credential".
 */
function envCandidates(): string[] {
  const own = new URL('../.env', import.meta.url).pathname;
  const fromFlag = process.argv.slice(2).find((arg) => arg.startsWith('--env='));
  const mainCheckout = new URL('../../../../.env', import.meta.url).pathname;
  return [
    ...(fromFlag ? [fromFlag.slice('--env='.length)] : []),
    own,
    ...(own.includes('/.claude/worktrees/') ? [mainCheckout] : []),
  ];
}

/** The three keys the ECS task definition names. Writing a subset breaks task launch. */
const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
type Key = (typeof KEYS)[number];

const CHECK_ONLY = process.argv.slice(2).includes('--check');

/** Eight hex characters: enough to say "same" or "different", useless to an attacker. */
function fingerprint(value: string | undefined): string {
  if (!value) return '(absent)';
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function readEnvFile(): Promise<{ values: Record<string, string>; path: string }> {
  const candidates = envCandidates();
  let raw: string | undefined;
  let path = '';
  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, 'utf8');
      path = candidate;
      break;
    } catch {
      // Next candidate.
    }
  }
  if (raw === undefined) {
    fail(
      `no .env found. Looked in:\n${candidates.map((c) => `    ${c}`).join('\n')}\n` +
        '  This script copies a credential you already hold; it cannot mint one.\n' +
        '  Connect Google once from the integrations panel to write the three keys there,\n' +
        '  or point at the file directly with --env=/path/to/.env',
    );
  }

  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const split = trimmed.indexOf('=');
    if (split === -1) continue;
    values[trimmed.slice(0, split).trim()] = trimmed
      .slice(split + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { values, path };
}

async function aws(args: string[], stdin?: string): Promise<string> {
  const child = run('aws', args, { env: { ...process.env, AWS_REGION: REGION }, maxBuffer: 1 << 20 });
  if (stdin !== undefined) {
    child.child.stdin?.end(stdin);
  }
  const { stdout } = await child;
  return stdout;
}

/**
 * Ask Google whether the credential set works, and report the scopes it carries.
 *
 * A `200` here is the only evidence that matters: it means this exact triple can mint
 * a bearer token right now, which is precisely what the deployed container will try
 * to do at its first calendar read.
 */
async function verifyAtGoogle(values: Record<string, string>): Promise<string[]> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: values.GOOGLE_CLIENT_ID,
      client_secret: values.GOOGLE_CLIENT_SECRET,
      refresh_token: values.GOOGLE_REFRESH_TOKEN,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.text();
  if (!response.ok) {
    let slug = '';
    let description = '';
    try {
      const parsed = JSON.parse(body) as { error?: string; error_description?: string };
      slug = parsed.error ?? '';
      description = parsed.error_description ?? '';
    } catch {
      description = body.slice(0, 200);
    }
    const guidance =
      slug === 'invalid_grant'
        ? 'The token in .env is itself dead. Reconnect Google — from the integrations panel\n' +
          '  locally, or `npm run demo:drive -- --gmail-login` — and run this again.'
        : slug === 'invalid_client'
          ? 'The client id and secret in .env do not belong together. Check both.'
          : 'Google refused the exchange for a reason it did not name.';
    fail(
      `.env's credential does not work — HTTP ${response.status} ${slug}: ${description}\n` +
        `  Nothing was written; the secret still holds whatever it held.\n` +
        `  ${guidance}`,
    );
  }

  const parsed = JSON.parse(body) as { scope?: string };
  return (parsed.scope ?? '').split(' ').filter(Boolean);
}

async function main(): Promise<void> {
  const { values: env, path: envPath } = await readEnvFile();
  const missing = KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    fail(`${envPath} is missing ${missing.join(', ')} — refusing to write a partial credential.`);
  }

  console.log(`sync:google-secret · ${SECRET_ID} · ${REGION}`);
  console.log(`credential read from ${envPath}\n`);

  const scopes = await verifyAtGoogle(env);
  console.log('✓ Google minted a token from .env — the credential is live');
  console.log(`  scopes: ${scopes.join(', ') || '(none reported)'}`);
  for (const needed of ['gmail.send', 'calendar.events'] as const) {
    if (!scopes.some((scope) => scope.endsWith(needed))) {
      console.log(`  ⚠ no ${needed} scope on this grant — that feature will still fail`);
    }
  }

  let current: Partial<Record<string, string>> = {};
  try {
    const raw = await aws([
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      SECRET_ID,
      '--query',
      'SecretString',
      '--output',
      'text',
    ]);
    current = JSON.parse(raw) as Record<string, string>;
  } catch (cause) {
    // AWS puts the reason on stderr, not in the Error message — without this the
    // report is "Command failed: aws secretsmanager get-secret-value", which does not
    // distinguish a missing secret from a missing permission.
    const stderr = (cause as { stderr?: string }).stderr?.trim();
    fail(
      `cannot read ${SECRET_ID} in ${REGION}:\n  ${
        stderr || (cause instanceof Error ? cause.message : String(cause))
      }`,
    );
  }

  console.log('\nkey                     deployed → .env');
  let differs = false;
  for (const key of KEYS) {
    const before = fingerprint(current[key]);
    const after = fingerprint(env[key]);
    if (before !== after) differs = true;
    console.log(`  ${key.padEnd(23)} ${before} → ${after}${before === after ? '' : '  (changes)'}`);
  }

  if (!differs) {
    console.log('\n✓ the secret already holds this exact credential — nothing to write.');
    console.log('  If Google calls are still failing, the running task booted before the last');
    console.log('  write: restart it with `AWS_REGION=us-east-1 npm run deploy:backend`.');
    return;
  }

  if (CHECK_ONLY) {
    console.log('\n--check given, so nothing was written.');
    return;
  }

  // Merge rather than replace: any key another consumer added stays put, and the
  // three this task needs are overwritten together so a client can never end up
  // paired with a token from a different consent.
  const payload = JSON.stringify({ ...current, ...Object.fromEntries(KEYS.map((k) => [k, env[k]])) });
  const written = await aws(
    ['secretsmanager', 'put-secret-value', '--secret-id', SECRET_ID, '--secret-string', 'fileb:///dev/stdin'],
    payload,
  );
  const { VersionId } = JSON.parse(written) as { VersionId?: string };

  console.log(`\n✓ wrote version ${VersionId ?? '(unnamed)'} — the previous one is kept as AWSPREVIOUS`);
  console.log('\nThe running container still holds the old value. Restart it:');
  console.log('  AWS_REGION=us-east-1 npm run deploy:backend');
}

main().catch((cause: unknown) => {
  console.error(`\nsync:google-secret failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
