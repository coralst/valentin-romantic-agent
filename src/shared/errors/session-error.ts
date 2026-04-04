import { AppError } from './base-error';

/** Thrown when a session is not found or invalid */
export class SessionError extends AppError {
  readonly code = 'SESSION_ERROR' as const;
  readonly statusCode = 404 as const;
}
