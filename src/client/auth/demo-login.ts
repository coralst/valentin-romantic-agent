import { describeFailure } from '../utils/api-client';

/** What POST /api/demo/login returns */
export interface DemoLoginResult {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** A session already seeded with the chosen persona's profile */
  sessionId: string;
  /** The persona the server actually seeded — it falls back on an unknown id */
  persona?: string;
}

/**
 * Sign in as the shared demo account.
 *
 * Unauthenticated by necessity — it is the call that *hands out* a token — so it
 * deliberately does not go through `apiFetch`.
 *
 * One account, many personas: `persona` selects which fixture profile the server
 * seeds, not which credential it uses. A second demo account would mean a second
 * password to store and rotate for no gain.
 */
export async function demoLogin(persona?: string): Promise<DemoLoginResult> {
  const response = await fetch('/api/demo/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Sent only when asked for, so the request stays byte-identical to the one
    // the pre-persona client made.
    body: persona ? JSON.stringify({ persona }) : undefined,
  });
  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }
  return (await response.json()) as DemoLoginResult;
}
