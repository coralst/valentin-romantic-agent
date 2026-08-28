import { getAccessToken, peekVisitorId } from '../auth/token-store';

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

  // Every demo visitor authenticates as the same Cognito account, so the token
  // alone cannot say which of them is calling. This can, and the server uses it
  // to keep their conversations apart. Absent for a real account, where the
  // token's own `sub` is already unique.
  const visitorId = peekVisitorId();
  if (visitorId) headers.set('x-demo-visitor', visitorId);

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

/**
 * POST, returning the parsed response.
 *
 * `body` is omitted from the request entirely when absent rather than sent as
 * `{}` — the routes that take no arguments read `req.body?.x`, and an empty
 * object is indistinguishable from a caller who asked for nothing anyway.
 */
export async function apiPostJson<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
  return (await response.json()) as T;
}

/** PUT a JSON body — the shape the manual-value route takes. */
export async function apiPutJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(describeFailure(response.status));
  return (await response.json()) as T;
}

/**
 * DELETE, discarding the body.
 *
 * The delete routes answer `{ deleted: true }`, which no caller reads: the row is
 * already gone from the reducer by the time this resolves. Only the failure
 * matters, and that arrives as a throw.
 */
export async function apiDelete(path: string): Promise<void> {
  const response = await apiFetch(path, { method: 'DELETE' });
  if (!response.ok) throw new Error(describeFailure(response.status));
}
