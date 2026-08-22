import { logger } from '../logging';

/** Which persistence backend to construct. */
export type StorageBackend = 'memory' | 'dynamodb';

/**
 * Read the backend from the environment.
 *
 * Defaults to `memory`, and that default is load-bearing: local dev, every
 * existing test, and any developer who has never held AWS credentials all keep
 * working untouched. Durability is opt-in via `STORAGE_BACKEND=dynamodb`, which
 * the deployed task definition sets.
 *
 * An unrecognised value falls back to memory with a warning rather than
 * throwing. A typo in an env var should not take the server down — but it must
 * not silently look like it worked either, because the failure mode is data
 * quietly evaporating on restart.
 */
export function resolveStorageBackend(
  raw: string | undefined = process.env.STORAGE_BACKEND,
): StorageBackend {
  if (raw === undefined || raw === '') return 'memory';

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'dynamodb' || normalized === 'memory') return normalized;

  logger.warn('storage.backend.unrecognized', {
    requested: raw,
    fallback: 'memory',
  });
  return 'memory';
}

// There is deliberately no `createStore()` here any more. Stores are scoped to a
// user, so the only legitimate way to obtain one is a `ScopedStorageFactory` —
// see `defaultStoreFactory` in `../index.ts`, this module's one consumer. An
// unscoped constructor would build a store with no user in its partition key,
// which is exactly the cross-tenant bug the key change fixed.
