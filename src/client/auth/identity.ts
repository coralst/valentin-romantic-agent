/**
 * Read the display name out of an access token.
 *
 * Unverified on purpose: this is used for a chip in the header, nothing more.
 * Every decision that matters is made by the server, which does verify the
 * signature. A tampered token would produce a wrong label and then fail on the
 * very next request.
 */
export function describeToken(accessToken: string): string {
  if (accessToken.startsWith('dev:')) {
    return `dev · ${accessToken.slice(4).slice(0, 8)}`;
  }

  const claims = decodeClaims(accessToken);
  if (!claims) return 'Signed in';

  const username = claims.username ?? claims['cognito:username'] ?? claims.sub;
  if (typeof username !== 'string') return 'Signed in';

  // Federated usernames look like 'google_1029384756'; a raw sub is a uuid.
  // Neither reads as a person, so shorten rather than showing the whole thing.
  return username.length > 24 ? `${username.slice(0, 24)}…` : username;
}

function decodeClaims(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
