export interface EnvironmentConfig {
  env: string;
  region: string;
  account?: string;
  tableName: string;
  photoBucketName: string;
  frontendBucketName: string;
  guardrailName: string;
  /**
   * Cognito Hosted UI redirect targets.
   *
   * Deliberately static strings rather than a reference to the CloudFront
   * distribution's domain. AuthStack reading CdnStack would create the synth
   * cycle Auth -> CDN -> Compute -> Auth (see bin/app.ts, where CdnStack
   * depends on ComputeStack).
   *
   * Every URL is a bare origin with a trailing slash — the *site root*, never
   * a /callback path. The frontend bucket is served through CloudFront with
   * OAC, and S3-with-OAC answers a missing key with 403, not 404; cdn-stack
   * only remaps 404 to index.html, so /callback would render raw AccessDenied
   * XML instead of the app. The SPA has no router, so the root works fine.
   */
  appUrls: {
    /** Where Cognito sends the user back after a successful login */
    callback: string[];
    /** Where Cognito sends the user after /logout */
    logout: string[];
  };
}

/**
 * The CloudFront domain each environment is served from.
 *
 * dev's is the live distribution. staging and prod have none yet, so they fall
 * back to localhost only — a login attempt against a domain Cognito has never
 * been told about fails with `redirect_mismatch`, which is a far better failure
 * than silently redirecting a real user to a guessed hostname. Override with
 * `--context siteUrl=https://example.cloudfront.net/` once they exist.
 */
const siteOrigins: Record<string, string[]> = {
  dev: ['https://d26dwovftfq9oe.cloudfront.net/'],
  staging: [],
  prod: [],
};

/** Local Vite dev server. Kept for dev only — never a callback on a real env. */
const LOCAL_ORIGIN = 'http://localhost:5173/';

function baseConfigs(): Record<string, Omit<EnvironmentConfig, 'appUrls'>> {
  return {
    dev: {
      env: 'dev',
      region: 'us-east-1',
      tableName: 'ValentinTable-dev',
      photoBucketName: 'valentin-photos-dev',
      frontendBucketName: 'valentin-frontend-dev',
      guardrailName: 'valentin-safety-dev',
    },
    staging: {
      env: 'staging',
      region: 'us-east-1',
      tableName: 'ValentinTable-staging',
      photoBucketName: 'valentin-photos-staging',
      frontendBucketName: 'valentin-frontend-staging',
      guardrailName: 'valentin-safety-staging',
    },
    prod: {
      env: 'prod',
      region: 'us-east-1',
      tableName: 'ValentinTable-prod',
      photoBucketName: 'valentin-photos-prod',
      frontendBucketName: 'valentin-frontend-prod',
      guardrailName: 'valentin-safety-prod',
    },
  };
}

/** Normalise an origin to a bare root with exactly one trailing slash */
function asRoot(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function getConfig(env: string, siteUrlOverride?: string): EnvironmentConfig {
  const base = baseConfigs()[env];
  if (!base) {
    throw new Error(
      `Unknown environment: ${env}. Valid: ${Object.keys(baseConfigs()).join(', ')}`,
    );
  }

  const origins = new Set<string>(
    siteUrlOverride ? [asRoot(siteUrlOverride)] : (siteOrigins[env] ?? []).map(asRoot),
  );
  if (env === 'dev') {
    origins.add(LOCAL_ORIGIN);
  }

  const urls = [...origins];

  // Cognito rejects an OAuth-enabled app client with no callback URL, and a
  // silent fallback (e.g. localhost) would leave a real environment quietly
  // misconfigured. Fail at synth with an actionable message instead.
  if (urls.length === 0) {
    throw new Error(
      `No site origin known for env "${env}". Pass the CloudFront domain: ` +
        `npx cdk deploy --context env=${env} --context siteUrl=https://<domain>/`,
    );
  }

  return {
    ...base,
    appUrls: {
      callback: urls,
      logout: urls,
    },
  };
}
