import { describeFailure } from '../utils/api-client';

/** What POST /api/demo/login returns */
export interface DemoLoginResult {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** A session already populated with the demo partner profile */
  sessionId: string;
}

/**
 * Sign in as the shared demo account.
 *
 * Unauthenticated by necessity — it is the call that *hands out* a token — so it
 * deliberately does not go through `apiFetch`.
 */
export async function demoLogin(): Promise<DemoLoginResult> {
  const response = await fetch('/api/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }
  return (await response.json()) as DemoLoginResult;
}
