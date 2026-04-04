import { AppError } from './base-error';

/** Thrown when a Bedrock LLM API call fails */
export class LlmError extends AppError {
  readonly code = 'LLM_ERROR' as const;
  readonly statusCode = 502 as const;
}
