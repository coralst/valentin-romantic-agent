import { InMemoryStore } from './in-memory-store';
import { DynamoDBStore } from './dynamodb-store';
import type { StorageInterface } from './storage-interface';
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

/**
 * Construct the storage layer the server should use.
 *
 * The two implementations are interchangeable behind `StorageInterface`, so
 * this is the only place in the server that knows which one is live.
 */
export function createStore(
  backend: StorageBackend = resolveStorageBackend(),
): StorageInterface {
  if (backend === 'dynamodb') {
    const store = new DynamoDBStore();
    logger.info('storage.initialized', { backend: 'dynamodb' });
    return store;
  }

  logger.info('storage.initialized', { backend: 'memory' });
  return new InMemoryStore();
}
