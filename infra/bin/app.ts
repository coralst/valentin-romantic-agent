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
// Optional override for environments whose CloudFront domain isn't in config yet:
//   npx cdk deploy --context env=staging --context siteUrl=https://xyz.cloudfront.net/
const siteUrl = app.node.tryGetContext('siteUrl') as string | undefined;
const config = getConfig(env, siteUrl);

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

// Callback URLs come from static config rather than the CloudFront distribution.
// Reading cdnStack here would close the cycle Auth -> CDN -> Compute -> Auth,
// which CDK rejects at synth (CdnStack already depends on ComputeStack below).
const authStack = new AuthStack(app, `Valentin-Auth-${env}`, {
  environment: env,
  callbackUrls: config.appUrls.callback,
  logoutUrls: config.appUrls.logout,
  env: stackEnv,
  description: `Valentin Cognito authentication (${env})`,
});

const computeStack = new ComputeStack(app, `Valentin-Compute-${env}`, {
  environment: env,
  vpc: networkStack.vpc,
  tableName: config.tableName,
  userPoolId: authStack.userPool.userPoolId,
  userPoolArn: authStack.userPool.userPoolArn,
  spaClientId: authStack.userPoolClient.userPoolClientId,
  demoClientId: authStack.demoClient.userPoolClientId,
  demoSecret: authStack.demoSecret,
  env: stackEnv,
  description: `Valentin ECS Fargate compute (${env})`,
});
computeStack.addStackDependency(networkStack);
computeStack.addStackDependency(dataStack);
computeStack.addStackDependency(authStack);

const cdnStack = new CdnStack(app, `Valentin-CDN-${env}`, {
  environment: env,
  alb: computeStack.loadBalancer,
  env: stackEnv,
  description: `Valentin CloudFront CDN with WAF (${env})`,
});
cdnStack.addStackDependency(computeStack);

const monitoringStack = new MonitoringStack(app, `Valentin-Monitoring-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin CloudWatch monitoring (${env})`,
});
monitoringStack.addStackDependency(dataStack);
monitoringStack.addStackDependency(computeStack);

// Tag all resources
cdk.Tags.of(app).add('Project', 'Valentin');
cdk.Tags.of(app).add('Environment', env);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
