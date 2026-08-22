import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface CdnStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  /** ALB to use as the API origin */
  alb: elbv2.IApplicationLoadBalancer;
  /** Bucket for CloudFront standard access logs. */
  accessLogBucket: s3.IBucket;
}

/**
 * CloudFront CDN stack with WAF protection.
 *
 * - Default behavior: S3 origin for static frontend with caching
 * - /api/* behavior: ALB origin, no caching, all methods
 * - /ws behavior: ALB origin, no caching, WebSocket upgrade headers
 * - WAF: rate limiting + AWS managed rule sets
 * - OAC for S3 origin (no public bucket access)
 */
export class CdnStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly staticBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);

    const { config } = props;
    const env = config.env;

    // --- S3 Bucket for static frontend ---
    // Note: DataStack also declares a `valentin-frontend-<env>` bucket that
    // nothing consumes. Converging the two is deliberately out of scope here —
    // this bucket is RETAIN, so removing it would orphan the real one.
    this.staticBucket = new s3.Bucket(this, 'StaticBucket', {
      bucketName: `valentin-static-${env}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
    });

    // --- WAF Web ACL ---
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `valentin-waf-${env}`,
        sampledRequestsEnabled: true,
      },
      name: `valentin-waf-${env}`,
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `valentin-rate-limit-${env}`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `valentin-common-rules-${env}`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedKnownBadInputs',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `valentin-bad-inputs-${env}`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // --- S3 Origin with OAC ---
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.staticBucket);

    // --- ALB Origin ---
    const albOrigin = new origins.HttpOrigin(props.alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
    });

    // --- Cache Policies ---
    const noCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;

    // --- Origin Request Policy for WebSocket ---
    const wsOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      'WsOriginRequestPolicy',
      {
        originRequestPolicyName: `valentin-ws-${env}`,
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          'Sec-WebSocket-Key',
          'Sec-WebSocket-Version',
          'Sec-WebSocket-Protocol',
          'Sec-WebSocket-Accept',
        ),
      },
    );

    // --- CloudFront Distribution ---
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `valentin-${env}`,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: noCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        '/ws': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: noCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: wsOriginRequestPolicy,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      webAclId: webAcl.attrArn,
      priceClass: config.cloudfrontPriceClass,
      enableLogging: true,
      logBucket: props.accessLogBucket,
      logFilePrefix: `cloudfront/${env}/`,
      // minimumProtocolVersion cannot be raised above the default while the
      // distribution uses the CloudFront default certificate. Requires a
      // custom domain plus an ACM certificate.
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `valentin-cf-dist-id-${env}`,
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
      exportName: `valentin-cf-domain-${env}`,
    });

    new cdk.CfnOutput(this, 'StaticBucketName', {
      value: this.staticBucket.bucketName,
      description: 'S3 bucket for static assets',
      exportName: `valentin-static-bucket-${env}`,
    });
  }
}
