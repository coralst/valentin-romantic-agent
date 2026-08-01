#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { SafetyStack } from '../lib/safety-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { getConfig } from '../config/environments';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';
const config = getConfig(env);

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

const monitoringStack = new MonitoringStack(app, `Valentin-Monitoring-${env}`, {
  config,
  env: stackEnv,
  description: `Valentin CloudWatch monitoring (${env})`,
});

// Add dependencies — monitoring needs data stack for table name references
monitoringStack.addStackDependency(dataStack);

// Tag all resources
cdk.Tags.of(app).add('Project', 'Valentin');
cdk.Tags.of(app).add('Environment', env);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
