#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { SafetyStack } from '../lib/safety-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { ComputeStack } from '../lib/compute-stack';
import { CdnStack } from '../lib/cdn-stack';
import { AuthStack } from '../lib/auth-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { getConfig } from '../config/environments';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';
// Optional override for environments whose CloudFront domain isn't in config yet:
//   npx cdk deploy --context env=staging --context siteUrl=https://xyz.cloudfront.net/
const siteUrl = app.node.tryGetContext('siteUrl') as string | undefined;
const config = getConfig(env, siteUrl);

// deploy.sh passes the git SHA so a rollback lands on a different image than
// the one that failed. Defaults to 'latest' for a bare `cdk synth`/`cdk diff`.
const imageTag = app.node.tryGetContext('imageTag') ?? 'latest';

// Engine B's agent is a separate ARM64 image in its own repository, so it has its
// own tag. Defaults to `imageTag` so a single-image deploy still lines up.
const agentImageTag = app.node.tryGetContext('agentImageTag') ?? imageTag;

/*
 * Read once, here, and passed to every stack that needs it.
 *
 * Deliberately not `safetyStack.guardrailVersion` — see the long note on
 * ComputeStack below. Both engines must name the same version, and both must
 * name it without holding a cross-stack export open on it.
 */
const guardrailVersion = (app.node.tryGetContext('guardrailVersion') as string) ?? 'DRAFT';

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
  config,
  env: stackEnv,
  description: `Valentin Cognito authentication (${env})`,
});

/*
 * Engine B's managed half, and the reason ComputeStack comes after it.
 *
 * The proxy service in ComputeStack needs the Runtime ARN, the Memory id and the
 * Gateway URL, none of which exist until AgentCore is deployed. Nothing flows the
 * other way: the Runtime is not in the VPC and is not an ALB target, so it has no
 * dependency on compute at all.
 */
const agentCoreStack = new AgentCoreStack(app, `Valentin-AgentCore-${env}`, {
  config,
  table: dataStack.table,
  guardrailId: safetyStack.guardrailId,
  guardrailVersion,
  userPool: authStack.userPool,
  cognitoDomainPrefix: authStack.userPoolDomainPrefix,
  imageTag: agentImageTag,
  env: stackEnv,
  description: `Valentin AgentCore Runtime, Memory and Gateway (${env})`,
});
agentCoreStack.addStackDependency(dataStack);
agentCoreStack.addStackDependency(authStack);
agentCoreStack.addStackDependency(safetyStack);

const computeStack = new ComputeStack(app, `Valentin-Compute-${env}`, {
  config,
  vpc: networkStack.vpc,
  table: dataStack.table,
  photoBucket: dataStack.photoBucket,
  accessLogBucket: dataStack.accessLogBucket,
  guardrailId: safetyStack.guardrailId,
  /*
   * Deliberately not `safetyStack.guardrailVersion`.
   *
   * Reading it turned the version number into a cross-stack export that Compute
   * holds open, so the first attempt to change the policy was refused outright —
   * "Cannot update export ... as it is in use by Valentin-Compute-dev" — and
   * Safety rolled back with the fix undeployed. Had it succeeded, CFN would then
   * have deleted the version the running task still named.
   *
   * DRAFT always reflects the policy in `safety-stack.ts`, which is the artefact
   * this repo reviews, and exactly one service consumes this guardrail. Pass
   * `--context guardrailVersion=<n>` to pin a published version instead.
   */
  guardrailVersion,
  imageTag,
  userPoolId: authStack.userPool.userPoolId,
  userPoolArn: authStack.userPool.userPoolArn,
  spaClientId: authStack.userPoolClient.userPoolClientId,
  demoClientId: authStack.demoClient.userPoolClientId,
  demoSecret: authStack.demoSecret,
  cognitoDomainPrefix: authStack.userPoolDomainPrefix,
  env: stackEnv,
  description: `Valentin ECS Fargate compute (${env})`,
});
computeStack.addStackDependency(networkStack);
computeStack.addStackDependency(dataStack);
computeStack.addStackDependency(authStack);
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
