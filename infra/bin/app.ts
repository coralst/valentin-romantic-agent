#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ComputeStack } from '../lib/compute-stack';
import { CdnStack } from '../lib/cdn-stack';
import { AuthStack } from '../lib/auth-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') || 'dev';
const awsEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Compute stack (ECS Fargate + ALB)
const compute = new ComputeStack(app, `ValentinCompute-${env}`, {
  environment: env,
  env: awsEnv,
});

// CDN stack (CloudFront + WAF + S3)
new CdnStack(app, `ValentinCdn-${env}`, {
  environment: env,
  alb: compute.loadBalancer,
  env: awsEnv,
});

// Auth stack (Cognito)
new AuthStack(app, `ValentinAuth-${env}`, {
  environment: env,
  env: awsEnv,
});

app.synth();
