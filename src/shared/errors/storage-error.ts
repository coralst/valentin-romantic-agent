import { AppError } from './base-error';

/** Thrown when a storage operation fails */
export class StorageError extends AppError {
  readonly code = 'STORAGE_ERROR' as const;
  readonly statusCode = 500 as const;
}
