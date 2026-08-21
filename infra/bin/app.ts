#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { SafetyStack } from '../lib/safety-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { ComputeStack } from '../lib/compute-stack';
import { CdnStack } from '../lib/cdn-stack';
import { AuthStack } from '../lib/auth-stack';
import { getConfig } from '../config/environments';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';
const config = getConfig(env);

// deploy.sh passes the git SHA so a rollback lands on a different image than
// the one that failed. Defaults to 'latest' for a bare `cdk synth`/`cdk diff`.
const imageTag = app.node.tryGetContext('imageTag') ?? 'latest';

const stackEnv: cdk.Environment = {
  region: config.region,
  account: config.account ?? process.env.CDK_DEFAULT_ACCOUNT,
};

const networkStack = new NetworkStack(app, `Valentin-Network-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin VPC and networking (${env})`,
});

const dataStack = new DataStack(app, `Valentin-Data-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin DynamoDB and S3 storage (${env})`,
});

const safetyStack = new SafetyStack(app, `Valentin-Safety-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin Bedrock Guardrails (${env})`,
});

new AuthStack(app, `Valentin-Auth-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin Cognito authentication (${env})`,
});

const computeStack = new ComputeStack(app, `Valentin-Compute-${env}`, {
  config,
  vpc: networkStack.vpc,
  table: dataStack.table,
  photoBucket: dataStack.photoBucket,
  accessLogBucket: dataStack.accessLogBucket,
  guardrailId: safetyStack.guardrailId,
  guardrailVersion: safetyStack.guardrailVersion,
  imageTag,
  env: stackEnv,
  description: `Valentin ECS Fargate compute (${env})`,
});
computeStack.addStackDependency(networkStack);
computeStack.addStackDependency(dataStack);
// The task reads BEDROCK_GUARDRAIL_ID from this stack, so the guardrail must
// exist first. Without this the guardrail was deployed but never referenced.
computeStack.addStackDependency(safetyStack);

const cdnStack = new CdnStack(app, `Valentin-CDN-${env}`, {
  config,
  alb: computeStack.loadBalancer,
  accessLogBucket: dataStack.accessLogBucket,
  env: stackEnv,
  description: `Valentin CloudFront CDN with WAF (${env})`,
});
cdnStack.addStackDependency(computeStack);

const monitoringStack = new MonitoringStack(app, `Valentin-Monitoring-${env}`, {
  config,
  loadBalancer: computeStack.loadBalancer,
  targetGroup: computeStack.targetGroup,
  service: computeStack.service,
  table: dataStack.table,
  env: stackEnv,
  description: `Valentin CloudWatch monitoring (${env})`,
});
monitoringStack.addStackDependency(dataStack);
monitoringStack.addStackDependency(computeStack);

// Tag all resources
cdk.Tags.of(app).add('Project', 'Valentin');
cdk.Tags.of(app).add('Environment', env);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
