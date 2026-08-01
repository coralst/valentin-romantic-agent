import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config } = props;

    // DynamoDB single-table design
    this.table = new dynamodb.Table(this, 'ValentinTable', {
      tableName: config.tableName,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'ttl',
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1 for access patterns like SESSION#<id> lookups
    (this.table as dynamodb.Table).addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 bucket for photos (private, lifecycle to Glacier IA)
    this.photoBucket = new s3.Bucket(this, 'PhotoBucket', {
      bucketName: config.photoBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
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
