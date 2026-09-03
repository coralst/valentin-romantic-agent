import { loadEnvFile } from './load-env';

/**
 * Side-effect module: `import './env-first';` as an entrypoint's *first* import.
 *
 * It exists only because ES imports are hoisted. `loadEnvFile()` called as a
 * statement in `dev-server.ts` would run after `./index` — and everything it pulls
 * in, including `config.ts` — had already been evaluated, which is exactly too
 * late. An import cannot be reordered around, so this file is the ordering.
 *
 * Separate from `load-env.ts` so that module stays a pure function a test can call
 * against a temp path without loading the developer's real `.env`.
 */
loadEnvFile();
