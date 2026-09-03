import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from '../load-env';

/**
 * Reading `.env` at boot.
 *
 * This is the local half of "credentials load themselves". Deployed, every value
 * arrives as a real environment variable and this file does nothing. Locally the
 * panel writes `.env` and, before this existed, nobody read it back — so a Google
 * sign-in survived until the next restart and then quietly disappeared.
 *
 * Every key here is invented. The tests write their own file in a temp directory
 * and never touch the developer's real `.env`, which holds live credentials.
 */

let dir: string;
let envFile: string;
const touched: string[] = [];

/** Set a variable and remember to remove it, so tests cannot leak into each other. */
function preset(key: string, value: string): void {
  process.env[key] = value;
  touched.push(key);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'valentin-env-'));
  envFile = join(dir, '.env');
});

afterEach(() => {
  for (const key of touched.splice(0)) delete process.env[key];
  rmSync(dir, { recursive: true, force: true });
});

describe('loadEnvFile', () => {
  it('fills variables the process does not already have', () => {
    touched.push('VALENTIN_TEST_ALPHA');
    writeFileSync(envFile, 'VALENTIN_TEST_ALPHA=from-file\n');

    loadEnvFile(envFile);

    expect(process.env.VALENTIN_TEST_ALPHA).toBe('from-file');
  });

  it('never overwrites a variable the real environment already set', () => {
    preset('VALENTIN_TEST_BETA', 'from-environment');
    writeFileSync(envFile, 'VALENTIN_TEST_BETA=from-file\n');

    loadEnvFile(envFile);

    /*
     * The precedence that keeps the deployed task correct. A container gets its
     * secrets injected; if an image ever shipped with a stale `.env` beside them,
     * the file must not be able to replace a live credential with an old one.
     */
    expect(process.env.VALENTIN_TEST_BETA).toBe('from-environment');
  });

  it('ignores comments, blank lines and the commented-out placeholders', () => {
    touched.push('VALENTIN_TEST_GAMMA');
    writeFileSync(
      envFile,
      ['# a heading', '', '# VALENTIN_TEST_DELTA=placeholder', 'VALENTIN_TEST_GAMMA=real', ''].join(
        '\n',
      ),
    );

    loadEnvFile(envFile);

    expect(process.env.VALENTIN_TEST_GAMMA).toBe('real');
    // `.env.example` ships commented placeholders. Reading one as a value would
    // configure the app with the word "placeholder" and look like a live setting.
    expect(process.env.VALENTIN_TEST_DELTA).toBeUndefined();
  });

  it('keeps a value containing an equals sign intact', () => {
    touched.push('VALENTIN_TEST_EPSILON');
    // Base64 and OAuth values routinely end in padding. Splitting on every `=`
    // would truncate a credential to something that fails authentication for no
    // visible reason.
    writeFileSync(envFile, 'VALENTIN_TEST_EPSILON=a=b==\n');

    loadEnvFile(envFile);

    expect(process.env.VALENTIN_TEST_EPSILON).toBe('a=b==');
  });

  it('strips surrounding quotes', () => {
    touched.push('VALENTIN_TEST_ZETA');
    writeFileSync(envFile, 'VALENTIN_TEST_ZETA="quoted"\n');

    loadEnvFile(envFile);

    expect(process.env.VALENTIN_TEST_ZETA).toBe('quoted');
  });

  it('does nothing when there is no file, rather than failing to boot', () => {
    expect(() => loadEnvFile(join(dir, 'absent'))).not.toThrow();
  });

  it('survives a file it cannot read', () => {
    writeFileSync(envFile, 'VALENTIN_TEST_ETA=unreadable\n');
    chmodSync(envFile, 0o000);

    // `.env` is optional by design, so an unreadable one must not stop a process
    // that may have everything it needs from the environment already.
    expect(() => loadEnvFile(envFile)).not.toThrow();

    chmodSync(envFile, 0o600);
  });
});
