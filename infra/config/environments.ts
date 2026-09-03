import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as logs from 'aws-cdk-lib/aws-logs';

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
  /** Bedrock model the agent invokes. Used to scope the task role's IAM policy. */
  bedrockModelId: string;
  /** Fargate task sizing. 256/512 starves Node under Bedrock streaming. */
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  /**
   * Percentage of desiredCount that must stay healthy during a deployment.
   * Must be 100 — at 50 with desiredCount 1 this floors to zero, letting ECS
   * stop the only task before its replacement is ready.
   */
  minHealthyPercent: number;
  maxHealthyPercent: number;
  logRetention: logs.RetentionDays;
  /** Deletion protection on the ALB and the DynamoDB table. */
  deletionProtection: boolean;
  /**
   * Encrypt the photo bucket with a customer managed KMS key rather than
   * SSE-S3. User photos are personal data, so the audit trail and independent
   * key policy are worth the per-key cost in real environments; dev stays on
   * SSE-S3 to avoid the charge.
   */
  photoBucketKmsEncryption: boolean;
  /**
   * ID of the `com.amazonaws.global.cloudfront.origin-facing` managed prefix
   * list. Region-specific, so it belongs in config rather than inline — the
   * ALB security group uses it to reject any traffic that did not come
   * through CloudFront (and therefore through the WAF).
   */
  cloudfrontPrefixListId: string;
  cloudfrontPriceClass: cloudfront.PriceClass;
  /**
   * Secrets that already exist in the account and must be **adopted** rather
   * than created, keyed by complete ARN including the six-character suffix.
   *
   * Both of these are `RemovalPolicy.RETAIN`, which means a stack rollback that
   * happens *after* they are created leaves the physical secret behind while the
   * stack stops tracking it. Every later `cdk deploy` then tries to create a
   * secret whose name is taken and fails the whole stack with
   * `AlreadyExists` — which is exactly what happened to dev, and it is not
   * self-healing: the more valuable the secret, the less acceptable the obvious
   * fix of deleting it. `valentin/dev/google-oauth` holds a real Google refresh
   * token that was typed in by hand, so deleting it to let CloudFormation
   * recreate an empty one is the one option that is off the table.
   *
   * Adoption is the non-destructive way out. `Secret.fromSecretCompleteArn`
   * emits no resource, so CloudFormation stops trying to create what is already
   * there, the existing value is untouched, and the execution role is still
   * granted read. An environment that has never deployed these leaves this
   * undefined and gets the normal created-and-managed secrets.
   *
   * The ARN must be **complete**. `fromSecretNameV2` yields a partial ARN, and
   * an ECS secret built from a partial ARN fails at task start with
   * `ResourceInitializationError: unable to pull secrets` — a failure that shows
   * up only on the real deploy, never in synth or in the infra tests.
   */
  adoptedSecretArns?: {
    googleOAuth?: string;
    shareToken?: string;
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

/**
 * Everything except the Hosted UI redirect targets, which `getConfig` derives
 * from `siteOrigins` (plus localhost on dev) so the two can never disagree.
 */
const baseConfigs: Record<string, Omit<EnvironmentConfig, 'appUrls'>> = {
  dev: {
    env: 'dev',
    region: 'us-east-1',
    tableName: 'ValentinTable-dev',
    photoBucketName: 'valentin-photos-dev',
    frontendBucketName: 'valentin-frontend-dev',
    guardrailName: 'valentin-safety-dev',
    bedrockModelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    cpu: 512,
    memoryLimitMiB: 1024,
    desiredCount: 1,
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
    logRetention: logs.RetentionDays.TWO_WEEKS,
    deletionProtection: false,
    photoBucketKmsEncryption: false,
    cloudfrontPrefixListId: 'pl-3b927c52',
    cloudfrontPriceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    // Both were created by a deploy that later rolled back, and both survived it
    // because they are RETAIN. See `adoptedSecretArns` above for why adopting is
    // the only safe resolution for the Google one in particular.
    adoptedSecretArns: {
      googleOAuth:
        'arn:aws:secretsmanager:us-east-1:684394110906:secret:valentin/dev/google-oauth-5hYOo1',
      shareToken:
        'arn:aws:secretsmanager:us-east-1:684394110906:secret:valentin/dev/share-token-XnBnfq',
    },
  },
  staging: {
    env: 'staging',
    region: 'us-east-1',
    tableName: 'ValentinTable-staging',
    photoBucketName: 'valentin-photos-staging',
    frontendBucketName: 'valentin-frontend-staging',
    guardrailName: 'valentin-safety-staging',
    bedrockModelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    cpu: 512,
    memoryLimitMiB: 1024,
    desiredCount: 2,
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
    logRetention: logs.RetentionDays.ONE_MONTH,
    deletionProtection: true,
    photoBucketKmsEncryption: true,
    cloudfrontPrefixListId: 'pl-3b927c52',
    cloudfrontPriceClass: cloudfront.PriceClass.PRICE_CLASS_100,
  },
  prod: {
    env: 'prod',
    region: 'us-east-1',
    tableName: 'ValentinTable-prod',
    photoBucketName: 'valentin-photos-prod',
    frontendBucketName: 'valentin-frontend-prod',
    guardrailName: 'valentin-safety-prod',
    bedrockModelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    cpu: 1024,
    memoryLimitMiB: 2048,
    desiredCount: 2,
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
    logRetention: logs.RetentionDays.THREE_MONTHS,
    deletionProtection: true,
    photoBucketKmsEncryption: true,
    cloudfrontPrefixListId: 'pl-3b927c52',
    cloudfrontPriceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
  },
};

/** Normalise an origin to a bare root with exactly one trailing slash */
function asRoot(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function getConfig(env: string, siteUrlOverride?: string): EnvironmentConfig {
  const base = baseConfigs[env];
  if (!base) {
    throw new Error(
      `Unknown environment: ${env}. Valid: ${Object.keys(baseConfigs).join(', ')}`,
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
