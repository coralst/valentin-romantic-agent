/**
 * The two pieces of PKCE this app needs, kept apart from the OAuth flow so they
 * can be tested on their own.
 *
 * `crypto.subtle` requires a secure context. localhost qualifies; a bare LAN IP
 * (http://192.168.x.x:5173) does not, and the login will fail there with a
 * confusing error — use localhost or a tunnel.
 */

/** RFC 4648 §5 base64url, no padding — what OAuth expects everywhere */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A cryptographically random, URL-safe string — used for `state` and the verifier */
export function randomUrlSafeString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** The S256 code challenge for a verifier */
export async function codeChallengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}
