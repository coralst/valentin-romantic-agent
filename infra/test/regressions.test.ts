// @vitest-environment node
/**
 * Regression tests for the defects found in the August 2026 infrastructure
 * audit. Each test pins one specific bug that shipped to dev, so that a future
 * refactor cannot quietly reintroduce it.
 *
 * These are synth-time assertions: they run `cdk synth` in-process and inspect
 * the CloudFormation template, so they need no AWS credentials.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { getConfig } from '../config/environments';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { SafetyStack } from '../lib/safety-stack';
import { ComputeStack } from '../lib/compute-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const config = getConfig('dev');

let computeTemplate: Template;
let monitoringTemplate: Template;
let dataTemplate: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stackEnv = { account: '111111111111', region: config.region };

  const network = new NetworkStack(app, 'Net', { config, env: stackEnv });
  const data = new DataStack(app, 'Data', { config, env: stackEnv });
  const safety = new SafetyStack(app, 'Safety', { config, env: stackEnv });

  const compute = new ComputeStack(app, 'Compute', {
    config,
    vpc: network.vpc,
    table: data.table,
    photoBucket: data.photoBucket,
    accessLogBucket: data.accessLogBucket,
    guardrailId: safety.guardrailId,
    guardrailVersion: safety.guardrailVersion,
    imageTag: 'test-sha',
    env: stackEnv,
  });

  const monitoring = new MonitoringStack(app, 'Mon', {
    config,
    loadBalancer: compute.loadBalancer,
    targetGroup: compute.targetGroup,
    service: compute.service,
    table: data.table,
    env: stackEnv,
  });

  computeTemplate = Template.fromStack(compute);
  monitoringTemplate = Template.fromStack(monitoring);
  dataTemplate = Template.fromStack(data);
});

/** The container's environment block, as a name -> value map. */
function containerEnv(): Record<string, unknown> {
  const taskDefs = computeTemplate.findResources('AWS::ECS::TaskDefinition');
  const def = Object.values(taskDefs)[0] as any;
  const entries = def.Properties.ContainerDefinitions[0].Environment as Array<{
    Name: string;
    Value: unknown;
  }>;
  return Object.fromEntries(entries.map((e) => [e.Name, e.Value]));
}

describe('table name wiring', () => {
  // The container was given DYNAMO_TABLE_NAME=valentin-sessions-dev while the
  // table was actually named ValentinTable-dev, so every read and write failed.
  it('resolves DYNAMO_TABLE_NAME from the table construct, not a literal', () => {
    const value = containerEnv().DYNAMO_TABLE_NAME;
    expect(typeof value).not.toBe('string');
    expect(JSON.stringify(value)).toMatch(/Ref|ImportValue|GetAtt/);
  });

  it('never references the phantom valentin-sessions-* table name', () => {
    expect(JSON.stringify(computeTemplate.toJSON())).not.toContain('valentin-sessions');
  });

  it('names the table from shared config', () => {
    dataTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: config.tableName,
    });
  });
});

describe('guardrail enforcement', () => {
  // BEDROCK_GUARDRAIL_ID was '', and the server disables the guardrail on an
  // empty ID, so the deployed guardrail was never applied to any request.
  it('passes a non-empty guardrail id to the container', () => {
    const env = containerEnv();
    expect(env.BEDROCK_GUARDRAIL_ID).toBeDefined();
    expect(env.BEDROCK_GUARDRAIL_ID).not.toBe('');
    expect(JSON.stringify(env.BEDROCK_GUARDRAIL_ID)).toMatch(/Ref|ImportValue|GetAtt/);
  });

  it('passes a pinned guardrail version', () => {
    expect(containerEnv().BEDROCK_GUARDRAIL_VERSION).toBeDefined();
  });
});

describe('ALB is reachable only through CloudFront', () => {
  // The ALB accepted 0.0.0.0/0 on port 80, so anyone could hit the origin
  // directly and bypass CloudFront and therefore the WAF.
  it('has no ingress rule open to the internet', () => {
    const json = computeTemplate.toJSON();
    const offenders: string[] = [];

    for (const [id, res] of Object.entries<any>(json.Resources)) {
      if (res.Type === 'AWS::EC2::SecurityGroup') {
        for (const rule of res.Properties?.SecurityGroupIngress ?? []) {
          if (rule.CidrIp === '0.0.0.0/0' || rule.CidrIpv6 === '::/0') offenders.push(id);
        }
      }
      if (res.Type === 'AWS::EC2::SecurityGroupIngress') {
        const p = res.Properties ?? {};
        if (p.CidrIp === '0.0.0.0/0' || p.CidrIpv6 === '::/0') offenders.push(id);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('allows the CloudFront origin-facing prefix list on port 80', () => {
    computeTemplate.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      SourcePrefixListId: config.cloudfrontPrefixListId,
      FromPort: 80,
      ToPort: 80,
    });
  });
});

describe('alarm dimensions', () => {
  /**
   * Collects every dimension value used by every alarm, including those nested
   * inside metric math expressions.
   */
  function alarmDimensions(): Array<{ alarm: string; name: string; value: unknown }> {
    const out: Array<{ alarm: string; name: string; value: unknown }> = [];
    const alarms = monitoringTemplate.findResources('AWS::CloudWatch::Alarm');

    for (const res of Object.values<any>(alarms)) {
      const p = res.Properties;
      const alarm = p.AlarmName;
      for (const d of p.Dimensions ?? []) {
        out.push({ alarm, name: d.Name, value: d.Value });
      }
      for (const m of p.Metrics ?? []) {
        for (const d of m.MetricStat?.Metric?.Dimensions ?? []) {
          out.push({ alarm, name: d.Name, value: d.Value });
        }
      }
    }
    return out;
  }

  it('creates four alarms', () => {
    monitoringTemplate.resourceCountIs('AWS::CloudWatch::Alarm', 4);
  });

  it('derives every ALB, target group, service and table dimension from a construct', () => {
    // CloudWatch identifies these by full name (app/<name>/<id>,
    // targetgroup/<name>/<id>), which is only obtainable as a CloudFormation
    // attribute. A hardcoded string here means the alarm watches nothing.
    const derived = ['LoadBalancer', 'TargetGroup', 'ServiceName', 'ClusterName', 'TableName'];
    const literals = alarmDimensions().filter(
      (d) => derived.includes(d.name) && typeof d.value === 'string',
    );

    expect(literals).toEqual([]);
  });

  it('has at least one dimension on every alarm', () => {
    const byAlarm = new Set(alarmDimensions().map((d) => d.alarm));
    expect(byAlarm.size).toBe(4);
  });
});

describe('task role scoping', () => {
  it('grants no DynamoDB action on a wildcard resource', () => {
    const policies = computeTemplate.findResources('AWS::IAM::Policy');
    const offenders: unknown[] = [];

    for (const res of Object.values<any>(policies)) {
      for (const stmt of res.Properties.PolicyDocument.Statement) {
        const actions: string[] = [].concat(stmt.Action ?? []);
        const wildcard = ([] as unknown[]).concat(stmt.Resource ?? []).includes('*');
        if (wildcard && actions.some((a) => a.startsWith('dynamodb:'))) offenders.push(stmt);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('does not rely on a dynamodb:TableName condition to scope access', () => {
    // The original policy used resources:['*'] with StringLike
    // dynamodb:TableName 'valentin-*-dev', which matched no real table.
    expect(JSON.stringify(computeTemplate.toJSON())).not.toContain('dynamodb:TableName');
  });
});

describe('deployment safety', () => {
  it('keeps 100% of tasks healthy during a deployment', () => {
    computeTemplate.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: {
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
      },
    });
  });

  it('runs a specific image tag rather than :latest', () => {
    const json = JSON.stringify(computeTemplate.toJSON());
    expect(json).toContain('test-sha');
    expect(json).not.toContain(':latest');
  });

  it('runs the container with a read-only root filesystem', () => {
    const taskDefs = computeTemplate.findResources('AWS::ECS::TaskDefinition');
    const def = Object.values(taskDefs)[0] as any;
    expect(def.Properties.ContainerDefinitions[0].ReadonlyRootFilesystem).toBe(true);
  });

  it('bounds log retention', () => {
    computeTemplate.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: config.logRetention,
    });
  });
});
