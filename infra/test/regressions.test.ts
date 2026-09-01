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
import { Match, Template } from 'aws-cdk-lib/assertions';
import { applySpringCleanExemption } from '../lib/springclean-exemption';
import { getConfig } from '../config/environments';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { SafetyStack } from '../lib/safety-stack';
import { ComputeStack } from '../lib/compute-stack';
import { AuthStack } from '../lib/auth-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { AgentCoreStack } from '../lib/agentcore-stack';
import { CdnStack } from '../lib/cdn-stack';

const config = getConfig('dev');

let computeTemplate: Template;
let monitoringTemplate: Template;
let dataTemplate: Template;
let safetyTemplate: Template;
let agentCoreTemplate: Template;
let cdnTemplate: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stackEnv = { account: '111111111111', region: config.region };

  const network = new NetworkStack(app, 'Net', { config, env: stackEnv });
  const data = new DataStack(app, 'Data', { config, env: stackEnv });
  const safety = new SafetyStack(app, 'Safety', { config, env: stackEnv });
  const auth = new AuthStack(app, 'Auth', { config, env: stackEnv });

  const agentCore = new AgentCoreStack(app, 'AgentCore', {
    config,
    table: data.table,
    guardrailId: safety.guardrailId,
    guardrailVersion: 'DRAFT',
    userPool: auth.userPool,
    cognitoDomainPrefix: auth.userPoolDomainPrefix,
    imageTag: 'test-sha',
    env: stackEnv,
  });

  const compute = new ComputeStack(app, 'Compute', {
    config,
    vpc: network.vpc,
    table: data.table,
    photoBucket: data.photoBucket,
    accessLogBucket: data.accessLogBucket,
    guardrailId: safety.guardrailId,
    guardrailVersion: safety.guardrailVersion,
    imageTag: 'test-sha',
    userPoolId: auth.userPool.userPoolId,
    userPoolArn: auth.userPool.userPoolArn,
    spaClientId: auth.userPoolClient.userPoolClientId,
    demoClientId: auth.demoClient.userPoolClientId,
    demoSecret: auth.demoSecret,
    cognitoDomainPrefix: auth.userPoolDomainPrefix,
    agentCoreRuntimeArn: agentCore.runtimeArn,
    agentCoreMemoryId: agentCore.memoryId,
    agentCoreGatewayUrl: agentCore.gatewayUrl,
    env: stackEnv,
  });

  const cdn = new CdnStack(app, 'Cdn', {
    config,
    alb: compute.loadBalancer,
    accessLogBucket: data.accessLogBucket,
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
  safetyTemplate = Template.fromStack(safety);
  agentCoreTemplate = Template.fromStack(agentCore);
  cdnTemplate = Template.fromStack(cdn);
});

/** The guardrail's denied-topic list, keyed by topic name. */
function deniedTopics(): Record<string, any> {
  const guardrails = safetyTemplate.findResources('AWS::Bedrock::Guardrail');
  const props = Object.values<any>(guardrails)[0].Properties;
  return Object.fromEntries(
    props.TopicPolicyConfig.TopicsConfig.map((t: any) => [t.Name, t]),
  );
}

/**
 * One engine's container definition, selected by AGENT_ENGINE rather than by
 * position. Two task definitions live in this stack now, and their order in the
 * template is an implementation detail of construct traversal.
 */
function containerDef(engine: 'valentin' | 'agentcore'): any {
  const taskDefs = computeTemplate.findResources('AWS::ECS::TaskDefinition');
  const containers = Object.values<any>(taskDefs).map(
    (def) => def.Properties.ContainerDefinitions[0],
  );
  const match = containers.find((c: any) =>
    (c.Environment ?? []).some((e: any) => e.Name === 'AGENT_ENGINE' && e.Value === engine),
  );
  if (!match) throw new Error(`no container definition for engine ${engine}`);
  return match;
}

/** The container's environment block, as a name -> value map. */
function containerEnv(engine: 'valentin' | 'agentcore' = 'valentin'): Record<string, unknown> {
  const entries = containerDef(engine).Environment as Array<{
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

describe('durable storage is switched on', () => {
  // A correct table name and a correct IAM grant are still not enough: the
  // server defaults to InMemoryStore and only reaches for DynamoDB when
  // STORAGE_BACKEND says so. Without it the deployed app forgets every
  // preference on each task replacement while looking perfectly healthy —
  // the failure is invisible until a Fargate task cycles mid-demo.
  it('tells the container to use DynamoDB', () => {
    expect(containerEnv().STORAGE_BACKEND).toBe('dynamodb');
  });

  // Guards the pairing rather than the value: pointing the app at durable
  // storage while granting it nothing, or granting access it never uses, are
  // both silent no-ops. resolveStorageBackend() accepts exactly these two
  // spellings, so a typo here degrades to memory without erroring.
  it('uses a backend the server actually recognises', () => {
    expect(['dynamodb', 'memory']).toContain(containerEnv().STORAGE_BACKEND);
  });
});

describe('engine B can reach the model it is configured to use', () => {
  // BEDROCK_MODEL_ID is `us.anthropic.claude-sonnet-4-5-...`. The `us.` prefix
  // makes it a cross-region inference profile, so Bedrock fulfils the call from
  // whichever US region has capacity and authorizes against THAT region's
  // foundation-model ARN. Pinned to the stack's own region, every engine-B turn
  // died with "not authorized ... on resource: arn:aws:bedrock:us-east-2::
  // foundation-model/..." from a stack deployed to us-east-1 — and because
  // agent.py returns its failure as a 200 body, it surfaced only as the UI's
  // apology.
  //
  // Asserted on both roles: the Runtime invokes per turn, and Memory invokes on
  // its own schedule to extract preferences. The Memory one fails silently —
  // engine B just never learns anything.
  // The policies attach by `Ref` to the role's logical id, not by role name, so
  // match on that rather than on `valentin-agentcore-*`.
  it.each([
    ['the Runtime role', 'RuntimeRole'],
    ['the Memory extraction role', 'MemoryRole'],
  ])('does not pin the foundation model to one region for %s', (_label, roleLogicalId) => {
    const policies = agentCoreTemplate.findResources('AWS::IAM::Policy');

    const invokeStatements = Object.values(policies)
      .filter((policy) => {
        const props = policy.Properties as { Roles?: unknown; PolicyDocument?: unknown };
        return (
          JSON.stringify(props?.Roles ?? '').includes(roleLogicalId) &&
          JSON.stringify(props?.PolicyDocument ?? '').includes(
            'bedrock:InvokeModelWithResponseStream',
          )
        );
      })
      .flatMap((policy) => {
        const doc = (policy.Properties as { PolicyDocument?: { Statement?: unknown[] } })
          .PolicyDocument;
        return (doc?.Statement ?? []).filter((statement) =>
          JSON.stringify((statement as { Action?: unknown }).Action ?? '').includes(
            'bedrock:InvokeModelWithResponseStream',
          ),
        );
      });

    expect(invokeStatements.length).toBeGreaterThan(0);
    expect(JSON.stringify(invokeStatements)).toContain('arn:aws:bedrock:*::foundation-model/*');
  });
});

describe('engine B can actually invoke its Runtime', () => {
  // The proxy sends X-Amzn-Bedrock-AgentCore-Runtime-User-Id on every invoke, to
  // keep one demo visitor's Memory partition off another's. That header makes
  // AgentCore authorize against InvokeAgentRuntimeForUser *as well as*
  // InvokeAgentRuntime, and it refuses the call naming both when either is
  // missing. With only the first granted, every engine-B turn returned
  // AccessDenied and the UI showed its "having a little trouble" fallback — so
  // engine B read as broken rather than unauthorized.
  it('grants both invoke actions, not just InvokeAgentRuntime', () => {
    computeTemplate.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'bedrock-agentcore:InvokeAgentRuntime',
              'bedrock-agentcore:InvokeAgentRuntimeForUser',
            ]),
          }),
        ]),
      },
    });
  });
});

describe('the account janitor cannot take the table again', () => {
  // On 2026-09-01 SpringClean — the Isengard account janitor, not anything AWS
  // documents — deleted ValentinTable-dev. Valentin-Data-dev still reported
  // UPDATE_COMPLETE and still listed the table among its resources; the table
  // was simply gone. Every POST /api/demo/login then returned 500 ("Requested
  // resource not found") and the deployed app could not be signed in to at all.
  //
  // Two independent guards, tested separately because either one alone leaves a
  // real hole: the tags stop SpringClean from selecting the table, and deletion
  // protection refuses DeleteTable at the API if the tags are ever lost.
  it('carries deletion protection even in dev', () => {
    // Deliberately not config.deletionProtection — that flag is false in dev
    // and is shared with the ALB, so reading it here is what left the table
    // unprotected. Dev is the only deployed environment and holds real data.
    dataTemplate.hasResourceProperties('AWS::DynamoDB::Table', {
      DeletionProtectionEnabled: true,
    });
  });

  it('carries the exemption tags SpringClean honours', () => {
    // Applied at app scope in bin/app.ts, so this asserts the helper's output
    // on a stack rather than the entry point's wiring.
    const app = new cdk.App();
    const stack = new DataStack(app, 'TaggedData', {
      config,
      env: { account: '111111111111', region: config.region },
    });
    applySpringCleanExemption(app);

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([
        { Key: 'auto-delete', Value: 'no' },
        { Key: 'springclean', Value: 'exempt' },
      ]),
    });
  });

  // A resource added to a later stack must inherit the exemption rather than
  // becoming a seven-day fuse nobody remembers to tag.
  it('exempts every stack, not just the data stack', () => {
    const app = new cdk.App();
    const stackEnv = { account: '111111111111', region: config.region };
    const net = new NetworkStack(app, 'TaggedNet', { config, env: stackEnv });
    applySpringCleanExemption(app);

    Template.fromStack(net).hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([{ Key: 'auto-delete', Value: 'no' }]),
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

  // The off-topic topic judged Valentin's own replies and got the most important
  // one wrong: asked what to get her for their anniversary, he wrote four
  // specific gift ideas from her profile and the classifier replaced the whole
  // answer with the blocked-output message. Confirmed against the live guardrail
  // — the prompt scored `action: NONE`, the reply scored `BLOCKED`.
  it('does not judge the model output for the off-topic topic', () => {
    expect(deniedTopics()['off-topic'].OutputEnabled).toBe(false);
  });

  // Leaking the system prompt is an output-side risk by definition, so this one
  // must keep judging replies.
  it('still judges the model output for prompt extraction', () => {
    expect(
      deniedTopics()['system-prompt-extraction'].OutputEnabled,
    ).not.toBe(false);
  });

  /** The guardrail's sensitive-information policy. */
  function sensitiveInfo(): any {
    const guardrails = safetyTemplate.findResources('AWS::Bedrock::Guardrail');
    return Object.values<any>(guardrails)[0].Properties.SensitiveInformationPolicyConfig;
  }

  /*
   * ADDRESS matches place names, not just home addresses, and this agent plans
   * dates and holidays. Exempting the reply fixed half of it; the entity was
   * still BLOCKing the prompt, where the visitor types "she's been saving for
   * Kyoto" and "take her to Rome" — both measured as blocked against the live
   * guardrail, along with Paris, Seattle and the bare word "France".
   */
  it('does not use the ADDRESS entity in either direction', () => {
    const types = sensitiveInfo().PiiEntitiesConfig.map((e: any) => e.Type);
    expect(types).not.toContain('ADDRESS');
  });

  // The risk the entity was there for is a residence, which has a shape.
  it('blocks a residence by pattern instead', () => {
    const regexes = sensitiveInfo().RegexesConfig ?? [];
    const names = regexes.map((r: any) => r.Name);
    expect(names).toContain('street-address');
    for (const regex of regexes) {
      expect(regex.Action).toBe('BLOCK');
    }
  });

  // "42 Maple Street" is a residence; "Rome" is a date. The pattern has to tell
  // them apart, since that distinction is the whole reason it replaced ADDRESS.
  it('has a street-address pattern that matches a residence but not a city', () => {
    const regexes = sensitiveInfo().RegexesConfig ?? [];
    const street = new RegExp(
      regexes.find((r: any) => r.Name === 'street-address').Pattern,
    );

    expect(street.test('She lives at 42 Maple Street')).toBe(true);
    expect(street.test('Send the flowers to 221B Baker Street')).toBe(true);
    expect(street.test('I want to take her to Rome for our anniversary')).toBe(false);
    expect(street.test("She's been saving for Kyoto")).toBe(false);
  });

  // At HIGH, "Her ring size is 6 and she is 5 foot 4" tripped the SEXUAL filter,
  // and her sizes are among the profile fields the agent asks for outright.
  it('screens the prompt for SEXUAL at MEDIUM while holding the reply to HIGH', () => {
    const guardrails = safetyTemplate.findResources('AWS::Bedrock::Guardrail');
    const filters = Object.values<any>(guardrails)[0].Properties.ContentPolicyConfig
      .FiltersConfig as Array<any>;
    const sexual = filters.find((f) => f.Type === 'SEXUAL');

    expect(sexual.InputStrength).toBe('MEDIUM');
    expect(sexual.OutputStrength).toBe('HIGH');
  });

  it('still blocks the identifiers a partner profile never needs', () => {
    const actions = Object.fromEntries(
      sensitiveInfo().PiiEntitiesConfig.map((e: any) => [e.Type, e.Action]),
    );
    for (const type of [
      'CREDIT_DEBIT_CARD_NUMBER',
      'US_SOCIAL_SECURITY_NUMBER',
      'PHONE',
      'EMAIL',
      'AWS_ACCESS_KEY',
      'AWS_SECRET_KEY',
    ]) {
      expect(actions[type]).toBe('BLOCK');
    }
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

  it('runs both containers with a read-only root filesystem', () => {
    expect(containerDef('valentin').ReadonlyRootFilesystem).toBe(true);
    expect(containerDef('agentcore').ReadonlyRootFilesystem).toBe(true);
  });

  it('bounds log retention', () => {
    computeTemplate.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: config.logRetention,
    });
  });
});

describe('two engines behind one ALB', () => {
  /** Every listener rule, as {priority, conditions, targetGroup}. */
  function listenerRules(): Array<any> {
    const rules = computeTemplate.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    return Object.values<any>(rules)
      .map((r) => r.Properties)
      .sort((a, b) => a.Priority - b.Priority);
  }

  it('runs exactly two services and two target groups', () => {
    computeTemplate.resourceCountIs('AWS::ECS::Service', 2);
    computeTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 2);
  });

  it('keeps exactly one listener, so both engines share the same front door', () => {
    // Two listeners would mean two ports, and CloudFront only has one origin
    // configured. The whole point is one ALB routing by path and header.
    computeTemplate.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
  });

  it('leaves engine A as the listener default action', () => {
    // If a rule ever captured '/api/*' or '/ws', removing the rules would break
    // the baseline app. Engine A must work with zero rules present.
    const listeners = computeTemplate.findResources('AWS::ElasticLoadBalancingV2::Listener');
    const listener = Object.values<any>(listeners)[0].Properties;
    const acTargetGroups = new Set(
      listenerRules().flatMap((r) =>
        r.Actions.flatMap((a: any) => JSON.stringify(a.TargetGroupArn)),
      ),
    );
    const defaultTg = JSON.stringify(listener.DefaultActions[0].TargetGroupArn);
    expect(acTargetGroups.has(defaultTg)).toBe(false);
  });

  it('routes the three engine-B conditions at the expected priorities', () => {
    const rules = listenerRules();
    expect(rules.map((r) => r.Priority)).toEqual([10, 20, 30]);
    expect(rules[0].Conditions[0].PathPatternConfig.Values).toEqual(['/api/agentcore/*']);
    // Exact, not a prefix: attach-websocket.ts compares request.url with ===.
    expect(rules[1].Conditions[0].PathPatternConfig.Values).toEqual(['/ws/agentcore']);
    expect(rules[2].Conditions[0].HttpHeaderConfig).toEqual({
      HttpHeaderName: 'X-Valentin-Engine',
      Values: ['agentcore'],
    });
  });

  it('sends all three rules to the same non-default target group', () => {
    const targets = new Set(
      listenerRules().map((r) => JSON.stringify(r.Actions[0].TargetGroupArn)),
    );
    expect(targets.size).toBe(1);
  });

  it('adds no ingress rule beyond the prefix list and the ALB-to-ECS hop', () => {
    /*
     * addListener with the default open:true appends its own 0.0.0.0/0 ingress
     * rule. Capturing the listener in a local so rules can be attached to it is
     * exactly the kind of edit that drops `open: false` by accident, and adding a
     * second service is exactly when someone reaches for a third rule. Two is the
     * whole set: CloudFront -> ALB:80, and ALB -> ECS:3001, which both services
     * share.
     */
    computeTemplate.resourceCountIs('AWS::EC2::SecurityGroupIngress', 2);
  });

  it('holds both engines to the same model, guardrail, table and task size', () => {
    // Any difference here would show up as a measured engine difference that is
    // actually a configuration difference.
    const a = containerEnv('valentin');
    const b = containerEnv('agentcore');
    for (const key of [
      'BEDROCK_MODEL_ID',
      'BEDROCK_GUARDRAIL_ID',
      'BEDROCK_GUARDRAIL_VERSION',
      'DYNAMO_TABLE_NAME',
      'STORAGE_BACKEND',
      'COGNITO_USER_POOL_ID',
    ]) {
      expect(JSON.stringify(b[key])).toBe(JSON.stringify(a[key]));
    }

    const taskDefs = Object.values<any>(
      computeTemplate.findResources('AWS::ECS::TaskDefinition'),
    ).map((d) => d.Properties);
    expect(new Set(taskDefs.map((d) => `${d.Cpu}/${d.Memory}`)).size).toBe(1);
  });

  it('runs both engines from the same image tag', () => {
    expect(JSON.stringify(containerDef('valentin').Image)).toBe(
      JSON.stringify(containerDef('agentcore').Image),
    );
  });

  it('names the engine on both services rather than relying on a code default', () => {
    expect(containerEnv('valentin').AGENT_ENGINE).toBe('valentin');
    expect(containerEnv('agentcore').AGENT_ENGINE).toBe('agentcore');
  });

  it('gives the proxy the Runtime and Memory it needs to reach', () => {
    const b = containerEnv('agentcore');
    expect(b.AGENTCORE_RUNTIME_ARN).toBeDefined();
    expect(b.AGENTCORE_MEMORY_ID).toBeDefined();
    expect(b.AGENTCORE_GATEWAY_URL).toBeDefined();
  });

  it('does not let the proxy call Bedrock directly', () => {
    /*
     * A silent fallback to direct Converse on the engine-B route would serve
     * engine-A answers under engine-B's label and invalidate every measurement.
     * The proxy is denied InvokeModel so that fallback fails loudly instead.
     */
    const policies = computeTemplate.findResources('AWS::IAM::Policy');
    const proxyPolicies = Object.values<any>(policies).filter((p) =>
      JSON.stringify(p.Properties.Roles ?? []).includes('ProxyTaskRole'),
    );
    expect(proxyPolicies.length).toBeGreaterThan(0);

    const actions = proxyPolicies.flatMap((p) =>
      p.Properties.PolicyDocument.Statement.flatMap((s: any) => [].concat(s.Action ?? [])),
    );
    expect(actions).not.toContain('bedrock:InvokeModel');
    expect(actions).not.toContain('bedrock:InvokeModelWithResponseStream');
    expect(actions).toContain('bedrock-agentcore:InvokeAgentRuntime');
  });

  it('does not let engine A invoke the AgentCore data plane', () => {
    const policies = computeTemplate.findResources('AWS::IAM::Policy');
    const basePolicies = Object.values<any>(policies).filter(
      (p) =>
        JSON.stringify(p.Properties.Roles ?? []).includes('TaskRole') &&
        !JSON.stringify(p.Properties.Roles ?? []).includes('ProxyTaskRole'),
    );
    const actions = basePolicies.flatMap((p) =>
      p.Properties.PolicyDocument.Statement.flatMap((s: any) => [].concat(s.Action ?? [])),
    );
    expect(actions.filter((a: string) => a.startsWith('bedrock-agentcore:'))).toEqual([]);
  });

  it('separates the two engines by log group so per-engine queries are exact', () => {
    const groups = Object.values<any>(computeTemplate.findResources('AWS::Logs::LogGroup')).map(
      (g) => g.Properties.LogGroupName,
    );
    expect(groups).toContain(`/valentin/${config.env}/service`);
    expect(groups).toContain(`/valentin/${config.env}/agentcore`);
  });
});

describe('agentcore engine B', () => {
  /*
   * The two naming rules are opposites, and `cdk synth` only *warns* about a
   * violation — it does not fail. So a wrong name synthesises fine, deploys for
   * ten minutes, and then fails at CreateStack. These two tests turn that into a
   * red test in a second.
   */
  it('names Runtime and Memory with underscores, which their API requires', () => {
    agentCoreTemplate.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      AgentRuntimeName: 'valentin_agent_dev',
    });
    agentCoreTemplate.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
      Name: 'valentin_memory_dev',
    });
  });

  it('names the Gateway without underscores, which its API rejects', () => {
    const gateways = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Gateway');
    const name = (Object.values(gateways)[0] as any).Properties.Name;
    expect(name).toBe('valentin-gateway-dev');
    expect(name).not.toContain('_');
  });

  it('scopes the Gateway JWT authorizer to the machine client only', () => {
    // Without allowedClients, any token this pool issues would open the gateway —
    // including a signed-in visitor's, which would let a browser call the tools.
    const gateways = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Gateway');
    const authorizer = (Object.values(gateways)[0] as any).Properties.AuthorizerConfiguration
      .CustomJWTAuthorizer;
    expect(authorizer.AllowedClients).toHaveLength(1);
    expect(authorizer.DiscoveryUrl).toBeDefined();
  });

  it('never puts the gateway client secret in the template', () => {
    // The runtime reads it with DescribeUserPoolClient instead. A custom-resource
    // read would store the plaintext in this stack's own event history.
    const json = JSON.stringify(agentCoreTemplate.toJSON());
    expect(json).not.toContain('ClientSecret');
    expect(json).not.toContain('userPoolClientSecret');
  });

  it('gives Memory an execution role, without which extraction silently produces nothing', () => {
    const memories = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Memory');
    const props = (Object.values(memories)[0] as any).Properties;
    expect(props.MemoryExecutionRoleArn).toBeDefined();
    expect(props.MemoryStrategies[0].UserPreferenceMemoryStrategy).toBeDefined();
  });

  it('scopes the memory namespace per session, not per user', () => {
    // A user-wide namespace blends two partners' profiles for anyone who starts a
    // second session — the exact bug the per-session DynamoDB partition avoids.
    const memories = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Memory');
    const namespaces = (Object.values(memories)[0] as any).Properties.MemoryStrategies[0]
      .UserPreferenceMemoryStrategy.Namespaces;
    expect(namespaces[0]).toContain('{sessionId}');
  });

  it('runs the agent on a specific image tag rather than :latest', () => {
    const json = JSON.stringify(agentCoreTemplate.toJSON());
    expect(json).toContain('test-sha');
    expect(json).not.toContain(':latest');
  });

  it('holds both engines to the same model and guardrail', () => {
    // If the engines differed here, a measured difference between them would say
    // nothing about AgentCore.
    const runtimes = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Runtime');
    const vars = (Object.values(runtimes)[0] as any).Properties.EnvironmentVariables;
    expect(vars.BEDROCK_MODEL_ID).toBe(config.bedrockModelId);
    expect(vars.BEDROCK_GUARDRAIL_ID).toBeDefined();
  });

  it('exposes exactly the three profile tools', () => {
    const targets = agentCoreTemplate.findResources('AWS::BedrockAgentCore::GatewayTarget');
    const tools = (Object.values(targets)[0] as any).Properties.TargetConfiguration.Mcp.Lambda
      .ToolSchema.InlinePayload;
    expect(tools.map((t: any) => t.Name).sort()).toEqual([
      'get_partner_profile',
      'list_preferences',
      'save_preference',
    ]);
  });

  it('bounds log retention on both new log groups', () => {
    agentCoreTemplate.resourceCountIs('AWS::Logs::LogGroup', 2);
    const groups = agentCoreTemplate.findResources('AWS::Logs::LogGroup');
    for (const group of Object.values(groups)) {
      expect((group as any).Properties.RetentionInDays).toBe(config.logRetention);
    }
  });
});

describe('CloudFront reaches both engines', () => {
  /** The distribution's cache behaviors, keyed by path pattern. */
  function behaviors(): Record<string, any> {
    const distributions = cdnTemplate.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values<any>(distributions)[0].Properties.DistributionConfig;
    return Object.fromEntries(
      (dist.CacheBehaviors ?? []).map((b: any) => [b.PathPattern, b]),
    );
  }

  it('has a behavior for the AgentCore socket', () => {
    // `/ws` is an exact pattern, not a prefix, so without its own entry
    // `/ws/agentcore` falls through to the S3 default behavior and the upgrade
    // comes back as a cached 403 rather than as anything diagnosable.
    expect(Object.keys(behaviors()).sort()).toEqual(['/api/*', '/ws', '/ws/agentcore']);
  });

  it('gives the two sockets identical treatment', () => {
    // The frames are the same on both; the path exists only so the ALB can pick
    // a target group. A difference here would be measured as an engine result.
    const all = behaviors();
    const baseline = all['/ws'];
    const agentcore = all['/ws/agentcore'];
    // toEqual throughout: the policy ids synth as `{ Ref: ... }` objects, which
    // are structurally identical but not the same object.
    expect(agentcore.CachePolicyId).toEqual(baseline.CachePolicyId);
    expect(agentcore.OriginRequestPolicyId).toEqual(baseline.OriginRequestPolicyId);
    expect(agentcore.AllowedMethods).toEqual(baseline.AllowedMethods);
    expect(agentcore.TargetOriginId).toEqual(baseline.TargetOriginId);
    expect(agentcore.ViewerProtocolPolicy).toEqual(baseline.ViewerProtocolPolicy);
  });

  it('needs no extra behavior for engine B HTTP routes', () => {
    // `/api/*` already covers `/api/agentcore/*`, and ALL_VIEWER forwards the
    // `X-Valentin-Engine` header the third listener rule matches on.
    expect(behaviors()['/api/*']).toBeDefined();
    expect(behaviors()['/api/agentcore/*']).toBeUndefined();
  });
});
