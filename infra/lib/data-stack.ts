import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface DataStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.ITable;
  public readonly photoBucket: s3.IBucket;
  public readonly frontendBucket: s3.IBucket;
  public readonly accessLogBucket: s3.IBucket;

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
