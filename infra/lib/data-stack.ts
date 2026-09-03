import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';
import { applySpringCleanExemption } from './springclean-exemption';

/**
 * The services whose credentials arrive through the integrations panel.
 *
 * One secret each under `valentin/<env>/integrations/`, never one blob: a Google
 * reconnect must not rewrite Amadeus, and two processes writing a shared blob
 * lose whichever write landed first. Mirrors `ConnectableId` in
 * `src/server/integrations/credentials.ts` — `integrationSecretNames()` in
 * `credential-store.ts` is the runtime side of the same list, and
 * `infra/test/regressions.test.ts` asserts the two agree.
 *
 * `canBeRepasted` decides the removal policy, and nothing else. See the orphan
 * trap note below.
 */
const INTEGRATION_SECRETS: ReadonlyArray<{
  readonly service: string;
  readonly constructId: string;
  readonly description: string;
  readonly canBeRepasted: boolean;
}> = [
  {
    service: 'amadeus',
    constructId: 'AmadeusIntegrationSecret',
    description: 'Amadeus API key and secret for hotel and activity search.',
    canBeRepasted: true,
  },
  {
    service: 'google',
    constructId: 'GoogleIntegrationSecret',
    description:
      'Google OAuth client and refresh token for the Gmail-send and Calendar-write tools.',
    // The refresh token only exists as the output of a browser consent popup,
    // which cannot be run against a Fargate task.
    canBeRepasted: false,
  },
  {
    service: 'spotify',
    constructId: 'SpotifyIntegrationSecret',
    description: 'Spotify client credentials and refresh token for playlist search and save.',
    // Same consent-popup problem as Google.
    canBeRepasted: false,
  },
  {
    service: 'whatsapp',
    constructId: 'WhatsappIntegrationSecret',
    description: 'WhatsApp Cloud API phone number id and access token.',
    canBeRepasted: true,
  },
];

export interface DataStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.ITable;
  public readonly photoBucket: s3.IBucket;
  public readonly frontendBucket: s3.IBucket;
  public readonly accessLogBucket: s3.IBucket;
  /**
   * Where the integration credentials live, without a trailing slash.
   *
   * Handed to both engines as `INTEGRATION_SECRETS_PREFIX`. A plain string rather
   * than the secret constructs: `ComputeStack` needs only a prefix to grant
   * against and to set an environment variable, and passing constructs would add
   * four more cross-stack exports to the Data→Compute edge that
   * `scripts/deploy.sh` already has to order carefully.
   */
  public readonly integrationSecretsPrefix: string;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config } = props;

    // DynamoDB single-table design.
    //
    // Do not rename this construct id. The logical id CloudFormation holds for
    // the live `ValentinTable-dev` is `ValentinTable64F53A3F`, derived from the
    // string below. Renaming it makes CloudFormation retire the old logical id
    // and create a new one under the *same* `tableName`, which fails early
    // validation with "Resource of type 'AWS::DynamoDB::Table' with identifier
    // 'ValentinTable-dev' already exists" — and the retirement is evaluated
    // against the deployed template's DeletionPolicy, so a rename attempted
    // before the policy below was live would have deleted the real table.
    this.table = new dynamodb.Table(this, 'ValentinTable', {
      tableName: config.tableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      /*
       * Always on, dev included — deliberately *not* `config.deletionProtection`
       * (false in dev), which is the ALB's setting and is shared.
       *
       * `removalPolicy: RETAIN` below only binds CloudFormation. SpringClean,
       * the Isengard account janitor, calls `DeleteTable` directly and never
       * reads a stack policy, so on 2026-09-01 it removed `ValentinTable-dev`
       * while the stack still reported UPDATE_COMPLETE. Deletion protection is
       * the only guard that lives at the API and refuses that call. The
       * `auto-delete=no` tag in `bin/app.ts` should stop SpringClean before it
       * gets this far; this is the layer that holds when a tag is lost.
       *
       * `teardown.sh` does not delete the table, so this costs it nothing.
       */
      deletionProtection: true,
      // RETAIN in every environment, dev included. This used to be
      // `env === 'prod' ? RETAIN : DESTROY`, and that is precisely how
      // `ValentinTable-dev` came to be missing: a stack teardown took the table
      // with it, and point-in-time recovery dies with the table it belongs to,
      // so nothing written up to that moment was recoverable. Dev holds real
      // conversations now. `teardown.sh` therefore leaves the table behind by
      // design — deleting it is a deliberate, manual act.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1 for access patterns like SESSION#<id> lookups
    (this.table as dynamodb.Table).addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Customer managed key for user photos, in environments that opt in.
    // Bucket keys are enabled by CDK for KMS buckets, so per-request KMS calls
    // stay cheap.
    const photoKey = config.photoBucketKmsEncryption
      ? new kms.Key(this, 'PhotoKey', {
          alias: `valentin-photos-${config.env}`,
          description: `Encrypts Valentin user photos (${config.env})`,
          enableKeyRotation: true,
          removalPolicy: config.env === 'prod'
            ? cdk.RemovalPolicy.RETAIN
            : cdk.RemovalPolicy.DESTROY,
        })
      : undefined;

    // S3 bucket for photos (private, lifecycle to Glacier IA)
    this.photoBucket = new s3.Bucket(this, 'PhotoBucket', {
      bucketName: config.photoBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: photoKey ? s3.BucketEncryption.KMS : s3.BucketEncryption.S3_MANAGED,
      encryptionKey: photoKey,
      versioned: true,
      lifecycleRules: [
        {
          id: 'GlacierIATransition',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
      ],
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.env !== 'prod',
    });

    // S3 bucket for static frontend (CloudFront OAC access only)
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: config.frontendBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.env !== 'prod',
    });

    // S3 bucket for ALB and CloudFront access logs.
    // SSE-S3 rather than KMS: the ALB log delivery service cannot write to a
    // bucket encrypted with a customer managed key. ACLs stay enabled because
    // CloudFront standard logging still delivers via ACL.
    this.accessLogBucket = new s3.Bucket(this, 'AccessLogBucket', {
      bucketName: `valentin-access-logs-${config.env}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [
        {
          id: 'ExpireAccessLogs',
          expiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: config.env !== 'prod',
    });

    /*
     * Integration credentials, one secret per service.
     *
     * ## Why they are declared here and not in ComputeStack
     *
     * A secret with `RemovalPolicy.RETAIN` that is *created* by a deploy which
     * then rolls back logs `DELETE_SKIPPED`: the secret stays in Secrets Manager
     * but leaves the stack's resource set. Every later deploy then tries to
     * CREATE it and fails `AlreadyExists`, and that failure rolls back, which
     * re-orphans it — self-perpetuating, and exactly what happened to
     * `valentin/<env>/google-oauth`. Compute is the stack that rolls back: it
     * carries the ECS rolling deploy. Data is a ~16s near-no-op, so a create here
     * is far less likely to be caught in one.
     *
     * ## Why the removal policy differs per secret
     *
     * RETAIN is not a free "protect the data" choice — it trades a janitor risk
     * for the deploy-deadlock above. So it is spent only where the value cannot
     * be recovered: Google's and Spotify's refresh tokens come out of a browser
     * consent popup and cannot be re-pasted. Amadeus and WhatsApp hold values a
     * human types into the connect form, recoverable in seconds, so they get
     * DESTROY. The SpringClean exemption still protects all four from the
     * janitor — `RemovalPolicy` only governs CloudFormation, which is the actor
     * that creates the deadlock.
     *
     * ## Why they are created empty, and never created at runtime
     *
     * `secretStringValue` is written at create time only, so a later
     * `PutSecretValue` from the connect flow survives every subsequent
     * `cdk deploy` — the template's value never changes, so CloudFormation never
     * touches it again. Nothing secret is in this repo or in the synthesised
     * template. Declaring them here rather than letting the server call
     * `CreateSecret` is the point: a runtime-created secret would carry none of
     * the exemption tags below, and the janitor would delete it weeks later with
     * no diff to blame it on.
     */
    this.integrationSecretsPrefix = `valentin/${config.env}/integrations`;

    for (const { service, constructId, description, canBeRepasted } of INTEGRATION_SECRETS) {
      const secret = new secretsmanager.Secret(this, constructId, {
        secretName: `${this.integrationSecretsPrefix}/${service}`,
        description: `${description} Written by the integrations panel; read by both engines and the Gateway tool Lambda.`,
        // `{}` rather than `generateSecretString`: `credential-store.ts` reads
        // this as a JSON object and treats any field it does not find as simply
        // not connected, so an empty object is the honest starting state. A
        // generated random key would look like a credential to a human reading
        // the console.
        secretStringValue: cdk.SecretValue.unsafePlainText('{}'),
        removalPolicy: canBeRepasted
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      });

      // Belt and braces over the app-scope tagging in `bin/app.ts`: these four
      // are the only new resources holding state that cannot be rebuilt from the
      // repo, so the exemption is stated where a reader of this file can see it.
      applySpringCleanExemption(secret);
    }

    // Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: `Valentin-TableName-${config.env}`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      exportName: `Valentin-TableArn-${config.env}`,
    });

    new cdk.CfnOutput(this, 'PhotoBucketName', {
      value: this.photoBucket.bucketName,
      exportName: `Valentin-PhotoBucket-${config.env}`,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      exportName: `Valentin-FrontendBucket-${config.env}`,
    });
  }
}
