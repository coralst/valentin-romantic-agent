import { existsSync, readFileSync } from 'node:fs';

/**
 * Read `.env` into `process.env` before anything reads config.
 *
 * The deployed task never needs this — `compute-stack.ts` injects every value as a
 * real environment variable, from Secrets Manager for the secret ones. Locally
 * there is no such injection, and until this existed nothing read `.env` at all:
 * the panel's connect flow wrote the file and updated config in memory, so the
 * credentials worked until the next restart and then silently vanished. A visitor
 * who had already signed in with Google was asked to do it again, which looks
 * exactly like the connect having failed.
 *
 * Import-order matters. `config.ts` snapshots `process.env` at module evaluation,
 * so this has to run first — hence a module imported for its side effect as the
 * first import of the entrypoint, rather than a function someone has to remember
 * to call.
 *
 * Deliberately hand-rolled rather than `dotenv`: this parses the subset the app's
 * own writer in `integrations/credentials.ts` produces, and a dependency whose job
 * is to read one file of `KEY=value` lines is not worth the supply chain.
 */

/**
 * An already-set variable always wins.
 *
 * The real environment is the more authoritative source in every case that
 * matters: a container's injected secret must not be overridden by a stale `.env`
 * that happened to get baked into an image, and `GOOGLE_CLIENT_ID=… npx tsx …` on
 * the command line should mean what it says. So this fills gaps and never
 * overwrites.
 */
export function loadEnvFile(path = '.env'): void {
  if (!existsSync(path)) return;

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    // Unreadable `.env` is not fatal. The process may well have everything it
    // needs from the real environment, and refusing to boot over a file that is
    // optional by design would be worse than starting with less.
    return;
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = line.slice(eq + 1).trim();
    // Quotes are stripped, because a value copied out of a shell script or a
    // console arrives wearing them and `"secret"` is not the secret.
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0];
      if (value.endsWith(quote)) value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
