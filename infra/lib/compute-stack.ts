import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface ComputeStackProps extends cdk.StackProps {
  /**
   * Environment configuration, mirroring DataStack. `config.env` is the
   * environment name, so no separate `environment` prop is needed.
   */
  config: EnvironmentConfig;
  /** VPC to deploy into — if not provided, a new one is created */
  vpc?: ec2.IVpc;
  /** Session table from DataStack. Passed as a construct so the container's
   *  DYNAMO_TABLE_NAME and the task role's grant can never disagree. */
  table: dynamodb.ITable;
  /** Photo bucket from DataStack. */
  photoBucket: s3.IBucket;
  /** Guardrail from SafetyStack. Without this the guardrail is deployed but
   *  never enforced, because the server disables it on an empty ID. */
  guardrailId: string;
  guardrailVersion: string;
  /** Image tag to run, supplied by deploy.sh as the git SHA. */
  imageTag: string;
  /** Bucket for ALB access logs. */
  accessLogBucket: s3.IBucket;
  /** Cognito User Pool the backend verifies access tokens against */
  userPoolId: string;
  userPoolArn: string;
  /** Public SPA app client id — one of the two accepted token audiences */
  spaClientId: string;
  /** Server-only app client id used for the demo sign-in */
  demoClientId: string;
  /** Secret holding the demo account's credentials */
  demoSecret: secretsmanager.ISecret;
  /**
   * Hosted UI domain prefix.
   *
   * Passed through to the browser via `GET /api/config` so the SPA needs no
   * build-time AWS configuration at all — one bundle works locally and in every
   * environment, and nobody has to copy ids out of the console.
   */
  cognitoDomainPrefix: string;
}

/**
 * ECS Fargate compute stack for the Valentin backend.
 *
 * Creates: ECS Cluster, Task Definition, Fargate Service, ALB with
 * health-check and sticky sessions, auto-scaling, and security groups.
 * The ECR repository is imported, not created.
 */
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly ecrRepository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config } = props;
    const env = config.env;

    // --- VPC ---
    const vpc =
      props.vpc ??
      new ec2.Vpc(this, 'Vpc', {
        maxAzs: 2,
        natGateways: 1,
      });

    // --- ECR Repository ---
    // Imported rather than declared: deploy.sh builds and pushes the image
    // before `cdk deploy` runs, so the repository already exists and must
    // not be managed by this stack.
    this.ecrRepository = ecr.Repository.fromRepositoryName(
      this,
      'BackendRepo',
      `valentin-backend-${env}`,
    );

    // --- ECS Cluster ---
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `valentin-cluster-${env}`,
      vpc,
      containerInsights: true,
    });

    // --- Security Groups ---
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      // Deliberately kept at the original wording even though it no longer
      // describes the rules. EC2 cannot change a security group description in
      // place, so editing this string makes CloudFormation replace the group,
      // which in turn recreates the ALB -> ECS ingress rule and can blip health
      // checks on a running service. The ingress rules below are the source of
      // truth; see the comment there for what this group actually allows.
      description: 'ALB security group - accepts HTTP/HTTPS from internet',
      allowAllOutbound: true,
    });
    // The ALB is internet-facing because CloudFront reaches it over the public
    // internet, but only CloudFront edge locations may connect. Opening this to
    // 0.0.0.0/0 would let clients reach the origin directly and skip the WAF.
    albSg.addIngressRule(
      ec2.Peer.prefixList(config.cloudfrontPrefixListId),
      ec2.Port.tcp(80),
      'Allow HTTP from CloudFront edge locations only',
    );

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS tasks - accepts traffic only from ALB',
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(
      albSg,
      ec2.Port.tcp(3001),
      'Allow traffic from ALB only',
    );

    // --- Task Role (permissions for AWS services) ---
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `valentin-task-role-${env}`,
    });

    // Grants derive the exact table/bucket ARNs (including GSIs) from the
    // constructs. The previous hand-written statements used resources:['*']
    // with a StringLike condition on `valentin-*-<env>`, which never matched
    // the real table name `ValentinTable-<env>`.
    //
    // Deriving from the construct also covers `/index/*`, which a Query against
    // GSI1 is authorized against rather than the table ARN — so the session
    // list would 403 under a table-ARN-only grant.
    props.table.grantReadWriteData(taskRole);
    props.photoBucket.grantReadWrite(taskRole);

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            resource: 'guardrail',
            resourceName: props.guardrailId,
          }),
        ],
      }),
    );

    // Scoped to foundation models and inference profiles rather than '*'.
    // config.bedrockModelId is a cross-region inference profile, which resolves
    // to foundation models in several regions at invoke time, so both resource
    // types are required and the region segment is left open.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            region: '*',
            resource: 'inference-profile',
            resourceName: config.bedrockModelId,
          }),
        ],
      }),
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:*:*:secret:valentin/${env}/*`],
      }),
    );

    // Cognito: only what the demo sign-in needs, scoped to this one pool.
    // AdminInitiateAuth is how POST /api/demo/login exchanges the stored demo
    // password for real Cognito tokens. Notably absent: AdminCreateUser and
    // AdminSetUserPassword — the task must not be able to mint pool users. That
    // is scripts/seed-demo-user.sh's job, run once at deploy time by an
    // operator identity, so no long-lived role holds pool-admin rights.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminInitiateAuth'],
        resources: [props.userPoolArn],
      }),
    );

    // --- Task Definition ---
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      taskRole,
      family: `valentin-task-${env}`,
    });

    // Declared explicitly so retention is bounded. The implicit group the
    // awslogs driver creates has retention 'Never expire'.
    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      logGroupName: `/valentin/${env}/service`,
      retention: config.logRetention,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Writable tmpfs so a read-only root filesystem cannot break anything that
    // expects /tmp to exist. The server itself writes nothing to disk.
    taskDefinition.addVolume({ name: 'tmp' });

    const container = taskDefinition.addContainer('Backend', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, props.imageTag),
      containerName: 'valentin-backend',
      readonlyRootFilesystem: true,
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      environment: {
        DYNAMO_TABLE_NAME: props.table.tableName,
        // Opt in to durable storage. Without this the server falls back to
        // InMemoryStore and the deployed app silently forgets everything on
        // every task replacement.
        STORAGE_BACKEND: 'dynamodb',
        S3_PHOTO_BUCKET: props.photoBucket.bucketName,
        BEDROCK_GUARDRAIL_ID: props.guardrailId,
        BEDROCK_GUARDRAIL_VERSION: props.guardrailVersion,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        AWS_REGION: cdk.Stack.of(this).region,
        NODE_ENV: 'production',
        // Auth. The server treats missing Cognito config as a hard boot failure
        // in production — see src/server/auth/jwt-verifier.ts.
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_SPA_CLIENT_ID: props.spaClientId,
        COGNITO_DEMO_CLIENT_ID: props.demoClientId,
        DEMO_SECRET_ARN: props.demoSecret.secretArn,
        COGNITO_DOMAIN: `https://${props.cognitoDomainPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `valentin-${env}`,
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addMountPoints({
      sourceVolume: 'tmp',
      containerPath: '/tmp',
      readOnly: false,
    });

    // --- Application Load Balancer ---
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `valentin-alb-${env}`,
      // Long idle timeout is deliberate: the /ws behaviour carries WebSocket
      // connections that stay open between messages.
      idleTimeout: cdk.Duration.seconds(3600),
      deletionProtection: config.deletionProtection,
    });

    this.loadBalancer.setAttribute(
      'routing.http.drop_invalid_header_fields.enabled',
      'true',
    );
    this.loadBalancer.logAccessLogs(props.accessLogBucket, `alb/${env}`);

    // --- Target Group ---
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      stickinessCookieDuration: cdk.Duration.hours(1),
      targetGroupName: `valentin-tg-${env}`,
    });

    // --- ALB Listener ---
    // HTTP only: TLS terminates at CloudFront, and the origin hop is
    // restricted to CloudFront by the security group above. Adding HTTPS here
    // requires a custom domain and an ACM certificate.
    // `open: false` is essential: the default (true) makes addListener append
    // its own 0.0.0.0/0 ingress rule to the security group, which would
    // silently defeat the CloudFront prefix-list restriction above.
    this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
      open: false,
    });

    // --- Fargate Service ---
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: config.desiredCount,
      securityGroups: [ecsSg],
      assignPublicIp: false,
      serviceName: `valentin-service-${env}`,
      circuitBreaker: { rollback: true },
      // 100/200 makes ECS start the replacement task before draining the old
      // one. The previous default of 50 floored to zero healthy tasks at
      // desiredCount 1, so a deploy could take the service fully offline.
      minHealthyPercent: config.minHealthyPercent,
      maxHealthyPercent: config.maxHealthyPercent,
    });

    this.service.attachToApplicationTargetGroup(this.targetGroup);

    // --- Auto Scaling ---
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'ALB DNS name',
      exportName: `valentin-alb-dns-${env}`,
    });

    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: this.ecrRepository.repositoryUri,
      description: 'ECR repository URI',
      exportName: `valentin-ecr-uri-${env}`,
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS cluster ARN',
      exportName: `valentin-cluster-arn-${env}`,
    });
  }
}
