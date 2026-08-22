import { getAccessToken } from '../auth/token-store';

/**
 * Every call to our own API goes through here, so the bearer token cannot be
 * forgotten on a new endpoint — the failure would be a 401 that looks like a
 * server bug.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(path, { ...init, headers });
}

/**
 * Turn a failed response into a message safe to show on a projector —
 * specific enough to debug, calm enough not to alarm an audience.
 */
export function describeFailure(status: number): string {
  if (status === 401) return 'the session expired — sign in again';
  // 404 now covers two cases, and neither is worth distinguishing on a
  // projector: the route is missing, or the session belongs to someone else and
  // so does not exist as far as this caller is concerned.
  if (status === 404) return "it isn't there any more";
  if (status === 429) return 'too many attempts just now, give it a moment';
  if (status === 503) return 'that is not configured on this deployment';
  if (status >= 500) return 'the server could not complete it';
  return `the server responded with ${status}`;
}

/** GET a JSON body, throwing a presentable error on failure */
export async function apiGetJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(describeFailure(response.status));
  return (await response.json()) as T;
}

/** POST with no body, returning the parsed response */
export async function apiPostJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
  return (await response.json()) as T;
}
