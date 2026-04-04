import { AppError } from './base-error';

/** Thrown when context window management fails */
export class ContextError extends AppError {
  readonly code = 'CONTEXT_ERROR' as const;
  readonly statusCode = 500 as const;
}
