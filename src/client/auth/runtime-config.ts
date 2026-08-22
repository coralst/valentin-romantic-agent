/**
 * What the browser needs to sign someone in, fetched from the server at boot.
 *
 * Deliberately *not* `VITE_*` build-time variables: those would mean copying
 * pool ids out of the AWS console into a `.env` file before the frontend could
 * be built, and a separate bundle per environment. The server already has this
 * wiring injected by CDK, so it hands it over instead — one bundle everywhere,
 * and no AWS configuration for anyone to get wrong.
 */
export interface RuntimeAuthConfig {
  /** True when the backend is running without Cognito (local development) */
  authDisabled: boolean;
  /** Hosted UI origin, e.g. https://valentin-dev.auth.us-east-1.amazoncognito.com */
  cognitoDomain: string | null;
  /** Public PKCE client id */
  clientId: string | null;
  /** Whether POST /api/demo/login is available on this deployment */
  demoAvailable: boolean;
  /**
   * The demo profiles the login screen may offer.
   *
   * Counts, not values: `/api/config` is unauthenticated, so the server sends
   * only enough to render a choice. Absent on a deployment that predates
   * personas, hence optional.
   */
  demoPersonas?: DemoPersonaSummary[];
}

/** One selectable demo profile, as `/api/config` advertises it */
export interface DemoPersonaSummary {
  id: string;
  /** Button label, and the header chip once signed in as this persona */
  name: string;
  /** One line of copy explaining what this persona demonstrates */
  blurb: string;
  /** How many preferences the persona seeds — 0 for "start fresh" */
  fieldCount: number;
}

/** Read the deployment's auth configuration */
export async function fetchRuntimeConfig(): Promise<RuntimeAuthConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error(`Could not read the server configuration (${response.status})`);
  }
  return (await response.json()) as RuntimeAuthConfig;
}

/** True when a real Hosted UI login can be attempted */
export function canHostedLogin(config: RuntimeAuthConfig): boolean {
  return Boolean(config.cognitoDomain && config.clientId);
}
