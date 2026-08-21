import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  /** Environment name (dev, staging, prod) */
  environment: string;
  /** VPC to deploy into — if not provided, a new one is created */
  vpc?: ec2.IVpc;
  /** DynamoDB table the backend reads and writes (from config/environments.ts) */
  tableName: string;
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
  public readonly ecrRepository: ecr.IRepository;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const env = props.environment;

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
      description: 'ALB security group - accepts HTTP/HTTPS from internet',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from anywhere',
    );
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from anywhere',
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

    // DynamoDB: scoped by ARN, not by condition key.
    //
    // This previously used `resources: ['*']` with a
    // `StringLike { 'dynamodb:TableName': ... }` condition. `dynamodb:TableName`
    // is not a supported DynamoDB IAM condition key, so the condition never
    // matched and the statement granted nothing at all. Nothing noticed because
    // no code path had ever touched the table.
    //
    // `/index/*` matters: a Query against GSI1 is authorized against the index
    // ARN, not the table ARN, so the session list would 403 without it.
    const tableArn = `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/${props.tableName}`;
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      }),
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::valentin-photos-${env}`,
          `arn:aws:s3:::valentin-photos-${env}/*`,
        ],
      }),
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:ApplyGuardrail',
        ],
        resources: ['*'],
      }),
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
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
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole,
      family: `valentin-task-${env}`,
    });

    taskDefinition.addContainer('Backend', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, 'latest'),
      containerName: 'valentin-backend',
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      environment: {
        // Was hardcoded to `valentin-sessions-${env}`, a table that has never
        // existed. The real name comes from config/environments.ts, which is
        // also what DataStack names the table.
        DYNAMO_TABLE_NAME: props.tableName,
        S3_PHOTO_BUCKET: `valentin-photos-${env}`,
        BEDROCK_GUARDRAIL_ID: '',
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
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // --- Application Load Balancer ---
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `valentin-alb-${env}`,
      idleTimeout: cdk.Duration.seconds(3600),
    });

    // --- Target Group ---
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
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

    // --- ALB Listener (HTTP for now, HTTPS-ready) ---
    this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // --- Fargate Service ---
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [ecsSg],
      assignPublicIp: false,
      serviceName: `valentin-service-${env}`,
      circuitBreaker: { rollback: true },
    });

    this.service.attachToApplicationTargetGroup(targetGroup);

    // --- Auto Scaling ---
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
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
