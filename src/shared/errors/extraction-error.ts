import { AppError } from './base-error';

/** Thrown when preference extraction fails */
export class ExtractionError extends AppError {
  readonly code = 'EXTRACTION_ERROR' as const;
  readonly statusCode = 500 as const;
}
