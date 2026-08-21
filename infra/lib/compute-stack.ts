import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface ComputeStackProps extends cdk.StackProps {
  /** Environment name (dev, staging, prod) */
  environment: string;
  /**
   * Environment configuration, mirroring DataStack.
   *
   * Needed so the table name the task reads is the same value DataStack creates
   * the table from. Three places used to disagree — this stack hardcoded
   * `valentin-sessions-${env}`, DataStack created `ValentinTable-${env}`, and
   * the server defaulted to a third — so the deployed task pointed at a table
   * that did not exist.
   */
  config: EnvironmentConfig;
  /** VPC to deploy into — if not provided, a new one is created */
  vpc?: ec2.IVpc;
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

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
        ],
        // Scoped to the one table and its indexes. This replaces a
        // `resources: ['*']` plus a `dynamodb:TableName StringLike
        // valentin-*-${env}` condition that matched nothing the stack creates —
        // wrong prefix, and StringLike is case-sensitive — so the task was
        // unauthorized against its own table. An ARN is both stricter and
        // actually correct.
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.config.tableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.config.tableName}/index/*`,
        ],
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
        DYNAMO_TABLE_NAME: props.config.tableName,
        // Opt in to durable storage. Without this the server falls back to
        // InMemoryStore and the deployed app silently forgets everything on
        // every task replacement.
        STORAGE_BACKEND: 'dynamodb',
        S3_PHOTO_BUCKET: `valentin-photos-${env}`,
        BEDROCK_GUARDRAIL_ID: '',
        AWS_REGION: cdk.Stack.of(this).region,
        NODE_ENV: 'production',
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
