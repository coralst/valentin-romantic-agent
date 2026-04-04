import { AppError } from './base-error';

/** Thrown when input validation fails */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly statusCode = 400 as const;
}
