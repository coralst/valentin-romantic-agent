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
}

const configs: Record<string, EnvironmentConfig> = {
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

export function getConfig(env: string): EnvironmentConfig {
  const config = configs[env];
  if (!config) {
    throw new Error(`Unknown environment: ${env}. Valid: ${Object.keys(configs).join(', ')}`);
  }
  return config;
}
