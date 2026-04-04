import { AppError } from './base-error';

/** Thrown when a WebSocket or network connection fails */
export class ConnectionError extends AppError {
  readonly code = 'CONNECTION_ERROR' as const;
  readonly statusCode = 503 as const;
}
