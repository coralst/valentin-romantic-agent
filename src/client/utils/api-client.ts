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

/**
 * POST where the server's own `error` sentence is the useful one.
 *
 * Separate from {@link apiPostJson} rather than a change to it, because the two
 * want opposite things. `describeFailure` deliberately flattens a status into
 * something calm enough for a projector — "the server could not complete it" —
 * which is right when the visitor can do nothing about it. But the integration
 * connect routes fail for reasons the visitor *can* act on, and only the server
 * knows which: a rejected key, an unreachable provider, a redirect URI that does
 * not match. Flattening "Amadeus rejected these credentials" into "the server
 * responded with 400" would throw away the entire answer.
 *
 * Falls back to `describeFailure` when the body carries no `error` string, so a
 * route that has not been written to explain itself still produces something
 * readable rather than "undefined".
 */
export async function apiPostJsonExplained<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // Read the body once, as text, because a failed response may not be JSON at
  // all — a proxy 502 is HTML — and calling .json() on that throws a parse error
  // that would mask the status the caller actually needs.
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const message = (parsed as { error?: unknown } | undefined)?.error;
    throw new Error(
      typeof message === 'string' && message.trim()
        ? message
        : describeFailure(response.status),
    );
  }
  return parsed as T;
}
