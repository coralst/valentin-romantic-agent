import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

/** Shape returned by POST /api/session/seed */
export interface SeedResponse {
  sessionId: string;
  preferenceCount: number;
}

/** Shape returned by GET /api/session/:id/preferences */
interface PreferencesResponse {
  preferences: PreferenceWithHistory[];
}

/**
 * Turn a failed response into a message safe to show on a projector —
 * specific enough to debug, calm enough not to alarm an audience.
 */
function describeFailure(status: number): string {
  if (status === 404) return 'the demo endpoint is not available yet';
  if (status >= 500) return 'the server could not complete it';
  return `the server responded with ${status}`;
}

async function postJson(url: string): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }
  return response;
}

/** Ask the server to build a fully populated demo session */
export async function seedDemoSession(): Promise<SeedResponse> {
  const response = await postJson('/api/session/seed');
  return (await response.json()) as SeedResponse;
}

/** Read back the preferences the seed created, so the profile panel can render them */
export async function fetchSessionPreferences(
  sessionId: string,
): Promise<PreferenceWithHistory[]> {
  const response = await fetch(`/api/session/${sessionId}/preferences`);
  if (!response.ok) {
    throw new Error(describeFailure(response.status));
  }
  const body = (await response.json()) as PreferencesResponse;
  return body.preferences ?? [];
}

/** Clear a session's server-side state */
export async function resetSession(sessionId: string): Promise<void> {
  await postJson(`/api/session/${sessionId}/reset`);
}
