import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { apiGetJson, apiPostJson, apiFetch, describeFailure } from './api-client';

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
 * Ask the server to build a demo session from one of its personas.
 *
 * The body is sent only when a persona is named, so the no-argument call stays
 * byte-identical to what it was before personas existed — the server's own
 * default then applies, and there is no second copy of that default here.
 */
export async function seedDemoSession(persona?: string): Promise<SeedResponse> {
  return apiPostJson<SeedResponse>(
    '/api/session/seed',
    persona ? { persona } : undefined,
  );
}

/** Read back the preferences the seed created, so the profile panel can render them */
export async function fetchSessionPreferences(
  sessionId: string,
): Promise<PreferenceWithHistory[]> {
  const body = await apiGetJson<PreferencesResponse>(
    `/api/session/${sessionId}/preferences`,
  );
  return body.preferences ?? [];
}

/** Clear a session's server-side state */
export async function resetSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`/api/session/${sessionId}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
}
