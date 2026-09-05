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
    integrationSecretsPrefix: data.integrationSecretsPrefix,
    imageTag: 'test-sha',
    env: stackEnv,
  });

  const compute = new ComputeStack(app, 'Compute', {
    config,
    vpc: network.vpc,
    table: data.table,
    photoBucket: data.photoBucket,
    accessLogBucket: data.accessLogBucket,
    integrationSecretsPrefix: data.integrationSecretsPrefix,
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

/** One Gateway target, found by its `Name` rather than its position. */
function gatewayTarget(name: string): any {
  const targets = agentCoreTemplate.findResources('AWS::BedrockAgentCore::GatewayTarget');
  const found = Object.values<any>(targets).filter((t) => t.Properties.Name === name);
  if (found.length !== 1) throw new Error(`expected one gateway target named ${name}`);
  return found[0];
}

/** Every tool the shared registry declares, from the generated file. */
function committedToolNames(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schemas = require('../lib/generated/integration-tool-schemas.json') as Array<{
    name: string;
  }>;
  return schemas.map((s) => s.name);
}

/** The tool names one target declares, sorted. */
function gatewayToolNames(target: string): string[] {
  const tools = gatewayTarget(target).Properties.TargetConfiguration.Mcp.Lambda.ToolSchema
    .InlinePayload as Array<{ Name: string }>;
  return tools.map((t) => t.Name).sort();
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

  it('lets the proxy read its Gateway client secret at runtime', () => {
    // Without this the confirm path fails at the first token exchange, and the
    // failure looks like a Gateway problem rather than a missing grant. The secret
    // is deliberately *not* in the template — see the ClientSecret test — so
    // DescribeUserPoolClient is the only way the proxy can obtain it.
    computeTemplate.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'cognito-idp:DescribeUserPoolClient' }),
        ]),
      },
    });
  });

  it('gives the Gateway credentials to the engine-B container only', () => {
    /*
     * Engine A confirms in-process and has no business holding a credential that
     * can call the Gateway. This is checked by container rather than by task
     * definition because both containers share `sharedEnvironment`, and the easy
     * mistake is adding these three there.
     */
    const containers = Object.values(
      computeTemplate.findResources('AWS::ECS::TaskDefinition'),
    ).flatMap((def) => (def as any).Properties.ContainerDefinitions as any[]);

    const withGatewayCreds = containers.filter((c) =>
      (c.Environment as any[]).some((e) => e.Name === 'GATEWAY_CLIENT_ID'),
    );
    expect(withGatewayCreds).toHaveLength(1);

    const names = (withGatewayCreds[0].Environment as any[]).map((e) => e.Name);
    expect(names).toContain('GATEWAY_TOKEN_URL');
    expect(names).toContain('GATEWAY_SCOPE');
    // The one that identifies this as the engine-B container, so the assertion
    // above cannot pass by landing on the wrong one.
    expect(names).toContain('AGENTCORE_RUNTIME_ARN');
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

  // The off-topic topic is gone, and this asserts it stays gone. Twice it refused
  // a request the product was built to honour: once on the output side, where four
  // specific anniversary gift ideas drawn from her profile were replaced wholesale
  // by the blocked-output message, and once on the input side, where
  // "send gmail with link to <address>" scored `topic:off-topic` in the live log.
  // A DENY topic defined by what it excludes cannot recognise the agent's own
  // mechanics — delivery, reminders, a recipient address — as on-topic. The
  // system prompt keeps Valentin on the subject of her; a classifier never did.
  it('does not deny a topic for being off-topic', () => {
    expect(deniedTopics()['off-topic']).toBeUndefined();
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
      'AWS_ACCESS_KEY',
      'AWS_SECRET_KEY',
    ]) {
      expect(actions[type]).toBe('BLOCK');
    }
  });

  /*
   * EMAIL used to be in the list above, and it broke the feature it was guarding.
   * `propose_email` takes a recipient address as a required input, so "email me
   * the options" means the visitor has to type one — and with the entity BLOCKing
   * the prompt they could not. The turn came back `guardrail_intervened`, for
   * which `bedrock-client.ts` substitutes a canned line, so on screen Valentin
   * simply declined to discuss it. Reported from the live app 2026-09-03.
   *
   * ANONYMIZE is asserted against too, and is the subtler trap: it would let the
   * turn through while rewriting the address into a placeholder, so the mail would
   * be addressed to nothing and the failure would move from visible to silent.
   */
  it('does not block or anonymise EMAIL — a recipient is an input, not a leak', () => {
    const actions = Object.fromEntries(
      sensitiveInfo().PiiEntitiesConfig.map((e: any) => [e.Type, e.Action]),
    );
    expect(actions.EMAIL).toBeUndefined();
  });

  // The three patterns that replaced ADDRESS are address-shaped. If one of them
  // matched an email the entity's removal would be undone without anyone editing
  // `piiEntitiesConfig`, which is the sort of thing that only shows up live.
  it('has no regex that catches an email address', () => {
    for (const regex of sensitiveInfo().RegexesConfig ?? []) {
      expect(
        new RegExp(regex.Pattern).test('send it to koral.example@gmail.com'),
        regex.Name,
      ).toBe(false);
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

  it('scopes the Gateway JWT authorizer to the two machine clients only', () => {
    // Without allowedClients, any token this pool issues would open the gateway —
    // including a signed-in visitor's, which would let a browser call the tools.
    //
    // Two, not one: the agent's client and the proxy's. The count is asserted
    // rather than left open because a third entry is how a *user*-facing client
    // would get in, and that is the one mistake this property exists to prevent.
    const gateways = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Gateway');
    const authorizer = (Object.values(gateways)[0] as any).Properties.AuthorizerConfiguration
      .CustomJWTAuthorizer;
    expect(authorizer.AllowedClients).toHaveLength(2);
    expect(authorizer.DiscoveryUrl).toBeDefined();
  });

  it('gives the proxy its own Gateway client rather than sharing the agent’s', () => {
    // Two callers with different lifetimes: revoking the agent's credential must
    // not silently stop every Confirm button, and the Gateway access log has to be
    // able to answer "was this the model or the application?".
    const clients = Object.values(
      agentCoreTemplate.findResources('AWS::Cognito::UserPoolClient'),
    ).map((r) => (r as any).Properties.ClientName as string);
    expect(clients).toContainEqual(expect.stringContaining('valentin-gateway-'));
    expect(clients).toContainEqual(expect.stringContaining('valentin-proxy-gateway-'));
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
    // Selected by target name, not by position: there are two targets behind this
    // gateway now, and indexing into `findResources` would silently start asserting
    // about whichever one CloudFormation happened to order first.
    expect(gatewayToolNames('valentin-profile')).toEqual([
      'get_partner_profile',
      'list_preferences',
      'save_preference',
    ]);
  });

  it('bounds log retention on every log group this stack creates', () => {
    // Three: the AgentCore telemetry group, the profile-tools group and the
    // integration-tools group. An exact count rather than "at least" because the
    // failure this guards against is a Lambda created without an explicit
    // `logGroup`, which silently gets a never-expiring one from the service.
    agentCoreTemplate.resourceCountIs('AWS::Logs::LogGroup', 3);
    const groups = agentCoreTemplate.findResources('AWS::Logs::LogGroup');
    for (const group of Object.values(groups)) {
      expect((group as any).Properties.RetentionInDays).toBe(config.logRetention);
    }
  });
});

describe('the integration-tools Lambda', () => {
  /** The one function whose name says integrations. */
  function integrationTools(): any {
    const fns = agentCoreTemplate.findResources('AWS::Lambda::Function');
    const found = Object.values<any>(fns).filter(
      (f) => f.Properties.FunctionName === `valentin-integration-tools-${config.env}`,
    );
    expect(found).toHaveLength(1);
    return found[0];
  }

  /** Every policy statement attached to that function's role. */
  function statements(): any[] {
    const fn = integrationTools();
    // The role's logical id, matched verbatim — an earlier version of this helper
    // trimmed it and silently matched nothing, which made the two negative
    // assertions below pass without reading a single statement.
    const roleRef: string = fn.Properties.Role['Fn::GetAtt'][0];
    const policies = agentCoreTemplate.findResources('AWS::IAM::Policy');
    const matched = Object.values<any>(policies).filter((p) =>
      JSON.stringify(p.Properties.Roles ?? []).includes(roleRef),
    );
    expect(matched.length).toBeGreaterThan(0);
    return matched.flatMap((p) => p.Properties.PolicyDocument.Statement);
  }

  it('runs the same runtime and architecture as the agent image', () => {
    // ARM64 matters beyond consistency: a bundle built for the wrong
    // architecture fails at invoke, not at deploy, so it would surface as engine
    // B's tools all being broken.
    const props = integrationTools().Properties;
    expect(props.Runtime).toBe('nodejs22.x');
    expect(props.Architectures).toEqual(['arm64']);
  });

  it('gets long enough to make a third-party HTTP call', () => {
    // Ontopo and Amadeus both sit behind a token exchange; the 10s the profile
    // tools get would time out mid-booking-search.
    expect(integrationTools().Properties.Timeout).toBe(30);
  });

  it('is told where the credentials live', () => {
    expect(integrationTools().Properties.Environment.Variables).toMatchObject({
      INTEGRATION_SECRETS_PREFIX: `valentin/${config.env}/integrations`,
    });
  });

  it('is exempt from the account janitor', () => {
    const tags = integrationTools().Properties.Tags ?? [];
    expect(tags).toEqual(
      expect.arrayContaining([
        { Key: 'auto-delete', Value: 'no' },
        { Key: 'springclean', Value: 'exempt' },
      ]),
    );
  });

  it('can read the integration secrets', () => {
    const reads = statements().filter((s) =>
      JSON.stringify(s.Action).includes('secretsmanager:GetSecretValue'),
    );
    expect(reads.length).toBeGreaterThan(0);
  });

  it('cannot write any secret, anywhere', () => {
    // This function serves a model's tool calls. The panel that writes these
    // secrets runs in the compute stack and holds the only PutSecretValue grant;
    // a write grant here would put a language model one bug away from
    // overwriting a credential.
    expect(JSON.stringify(statements())).not.toContain('secretsmanager:PutSecretValue');
    expect(JSON.stringify(statements())).not.toContain('secretsmanager:CreateSecret');
  });

  it('cannot reach a secret outside integrations/', () => {
    // The wider valentin/<env>/* read grant covers demo-user, whose password
    // POST /api/demo/login exchanges for Cognito tokens.
    for (const statement of statements()) {
      if (!JSON.stringify(statement.Action).includes('secretsmanager')) continue;
      for (const resource of [statement.Resource].flat()) {
        expect(JSON.stringify(resource)).toContain(
          `valentin/${config.env}/integrations/`,
        );
      }
    }
  });

  it('is the Lambda behind the integrations Gateway target', () => {
    const arn = gatewayTarget('valentin-integrations').Properties.TargetConfiguration.Mcp.Lambda
      .LambdaArn;
    const fnLogicalId = Object.entries(
      agentCoreTemplate.findResources('AWS::Lambda::Function'),
    ).find(
      ([, f]: [string, any]) =>
        f.Properties.FunctionName === `valentin-integration-tools-${config.env}`,
    )?.[0];

    expect(JSON.stringify(arn)).toContain(fnLogicalId);
  });

  it('can be invoked by the gateway role', () => {
    /*
     * The most likely deploy-time failure of this whole feature.
     *
     * A target added without its `grantInvoke` updates the stack cleanly and then
     * fails AccessDenied on every tool call, which the agent reports as the
     * integration being broken rather than as a permissions gap.
     */
    const roles = agentCoreTemplate.findResources('AWS::IAM::Role');
    const gatewayRoleId = Object.entries(roles).find(
      ([, r]: [string, any]) =>
        r.Properties.RoleName === `valentin-agentcore-gateway-${config.env}`,
    )?.[0];
    expect(gatewayRoleId).toBeDefined();

    const policies = agentCoreTemplate.findResources('AWS::IAM::Policy');
    const onGatewayRole = Object.values<any>(policies).filter((p) =>
      JSON.stringify(p.Properties.Roles ?? []).includes(gatewayRoleId as string),
    );
    expect(onGatewayRole.length).toBeGreaterThan(0);

    const invokesIntegrations = onGatewayRole
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter(
        (s: any) =>
          JSON.stringify(s.Action).includes('lambda:InvokeFunction') &&
          JSON.stringify(s.Resource).includes('IntegrationTools'),
      );

    expect(invokesIntegrations.length).toBeGreaterThan(0);
  });
});

describe('the integrations Gateway target', () => {
  /*
   * The twelve read-only tools, which the model may call freely.
   *
   * The other fourteen are the seven `propose_*` tools and their paired
   * `confirm_*`. The pairing is what the tests below are actually about: a
   * `propose_*` exposed without its confirm is a card whose button cannot work,
   * and a `confirm_*` the *model* can see is a language model authorising its own
   * spending — which is the one thing propose-then-confirm exists to prevent, and
   * is prevented in `agentcore/agent.py`, not here.
   */
  const READ_ONLY = [
    'check_availability',
    'check_shabbat',
    'find_gift_delivery',
    'find_music',
    'find_occasions',
    'find_places_nearby',
    'find_restaurants',
    'get_hebrew_occasions',
    'read_webpage',
    'search_activities',
    'search_hotels',
    'search_web',
  ];

  it('exposes the twelve read-only tools, unchanged by the confirm machinery', () => {
    const names = gatewayToolNames('valentin-integrations');
    expect(names.filter((n) => !/^(propose|confirm)_/.test(n))).toEqual(READ_ONLY);
  });

  it('exposes exactly 26 tools: 12 read-only, 7 proposals, 7 confirms', () => {
    // The total is asserted so an accidental addition is visible, and the split is
    // asserted because the interesting failure is not the count but the balance.
    const names = gatewayToolNames('valentin-integrations');
    expect(names).toHaveLength(26);
    expect(names.filter((n) => n.startsWith('propose_'))).toHaveLength(7);
    expect(names.filter((n) => n.startsWith('confirm_'))).toHaveLength(7);
  });

  it('withholds the share-link tool, which this Lambda cannot sign', () => {
    /*
     * `create_conversation_link` is read-only and still withheld.
     * `SHARE_TOKEN_SECRET` is an `ecs.Secret` on the proxy and absent here, so
     * `share-token.ts` signs with a per-process random key — the process serving
     * the guest view could never verify it — and the link's origin falls back to
     * localhost. A link handed over that silently does not open reads as sharing
     * being broken, where a missing tool is a sentence Valentin can say.
     *
     * Delete this test in the commit that gives the function the signing key and
     * the base URL, not before.
     */
    expect(gatewayToolNames('valentin-integrations')).not.toContain(
      'create_conversation_link',
    );
    // Engine A still has it: this is a Gateway exposure decision, not a change to
    // the registry both engines share.
    expect(committedToolNames()).toContain('create_conversation_link');
  });

  it('pairs every proposal with a confirm, and every confirm with a proposal', () => {
    /*
     * The failure this catches is asymmetric and silent either way. A `propose_*`
     * with no `confirm_*` gives the user a card whose button returns "tool not
     * found" *after* they have agreed to spend money. A `confirm_*` with no
     * `propose_*` is a Gateway tool that can never have a stored proposal to act
     * on — dead surface area on an endpoint whose whole claim is that its tools are
     * declared once.
     */
    const names = gatewayToolNames('valentin-integrations');
    const proposals = names.filter((n) => n.startsWith('propose_')).map((n) => n.slice(8));
    const confirms = names.filter((n) => n.startsWith('confirm_')).map((n) => n.slice(8));
    expect(confirms.sort()).toEqual(proposals.sort());
  });

  it('asks a confirm for nothing but the proposal it is confirming', () => {
    /*
     * `{user_id, session_id, proposal_id}` and no more. A confirm that accepted,
     * say, a party size would be a second chance to change the booking after the
     * user had agreed to the first one — the proposal row is the record of what
     * was agreed, and it is the only thing the Lambda is allowed to read back.
     */
    const tools = gatewayTarget('valentin-integrations').Properties.TargetConfiguration.Mcp
      .Lambda.ToolSchema.InlinePayload as any[];

    const confirms = tools.filter((t) => (t.Name as string).startsWith('confirm_'));
    expect(confirms).toHaveLength(7);
    for (const tool of confirms) {
      expect(Object.keys(tool.InputSchema.Properties).sort()).toEqual([
        'proposal_id',
        'session_id',
        'user_id',
      ]);
      expect([...(tool.InputSchema.Required as string[])].sort()).toEqual([
        'proposal_id',
        'session_id',
        'user_id',
      ]);
    }
  });

  it('asks every tool for the user and session it acts on', () => {
    // A tool the proxy cannot attribute to a user would still run, which is the
    // problem. The two targets share one definition of these args
    // (`gateway-identity-args.ts`) so they cannot disagree about the spelling —
    // if one asked for `userId`, the agent would call both alike and one would
    // fail every time, presenting as a broken integration.
    const tools = gatewayTarget('valentin-integrations').Properties.TargetConfiguration.Mcp
      .Lambda.ToolSchema.InlinePayload as any[];

    for (const tool of tools) {
      expect(tool.InputSchema.Required).toContain('user_id');
      expect(tool.InputSchema.Required).toContain('session_id');
      expect(tool.InputSchema.Properties).toHaveProperty('user_id');
      expect(tool.InputSchema.Properties).toHaveProperty('session_id');
      expect(tool.Description.length).toBeGreaterThan(20);
    }
  });

  it('carries no field the Gateway schema does not accept', () => {
    // `requiresConfirmation` is ours: it selects the list above. Leaving it in the
    // payload would fail at CreateStack, ten minutes into a deploy, rather than at
    // synth.
    const json = JSON.stringify(gatewayTarget('valentin-integrations'));
    expect(json).not.toContain('requiresConfirmation');
    expect(json).not.toContain('RequiresConfirmation');
  });

  it('is one of exactly two targets behind one gateway', () => {
    // One MCP endpoint, JWT-scoped, reached by the agent for both the profile and
    // the integrations — that single endpoint is the thing being demonstrated. A
    // third target appearing here is a deliberate change to engine B's surface.
    agentCoreTemplate.resourceCountIs('AWS::BedrockAgentCore::GatewayTarget', 2);
    agentCoreTemplate.resourceCountIs('AWS::BedrockAgentCore::Gateway', 1);
  });

  it('is a dependency of the Runtime, so a cold start never lists half the tools', () => {
    const runtimes = agentCoreTemplate.findResources('AWS::BedrockAgentCore::Runtime');
    const dependsOn = JSON.stringify((Object.values(runtimes)[0] as any).DependsOn ?? []);

    expect(dependsOn).toContain('IntegrationToolsTarget');
    expect(dependsOn).toContain('ProfileToolsTarget');
  });

  it('cannot be tagged, and that gap is known rather than forgotten', () => {
    /*
     * `CfnGatewayTarget` implements neither `ITaggableV2` nor a `tags` prop, so
     * `AWS::BedrockAgentCore::GatewayTarget` is untaggable and SpringClean's
     * exemption cannot be applied to it. Tolerable because the parent gateway does
     * carry the exemption and a target holds no state — `--scope=infra` recreates
     * one in ~2 minutes. The day the service accepts `Tags`, this test fails and
     * prompts an `addPropertyOverride`; adding one speculatively today would fail
     * at CreateStack instead of at synth.
     */
    for (const name of ['valentin-profile', 'valentin-integrations']) {
      expect(gatewayTarget(name).Properties.Tags).toBeUndefined();
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

  it('does not rewrite an API 404 into a 200 page', () => {
    // A CloudFront custom error response is distribution-wide — it cannot be
    // scoped to a behavior — so a `404 -> 200 /index.html` SPA fallback also
    // rewrites every 404 the API returns. `GET /api/share/<expired>` answers 404
    // by design, and the guest view then parses index.html as JSON. See the
    // comment in cdn-stack.ts for why nothing is lost by having no fallback.
    const distribution = Object.values(
      cdnTemplate.findResources('AWS::CloudFront::Distribution'),
    )[0] as any;
    const custom =
      distribution.Properties.DistributionConfig.CustomErrorResponses ?? [];
    expect(custom.filter((r: any) => r.ErrorCode === 404)).toEqual([]);
  });

  it('needs no extra behavior for engine B HTTP routes', () => {
    // `/api/*` already covers `/api/agentcore/*`, and ALL_VIEWER forwards the
    // `X-Valentin-Engine` header the third listener rule matches on.
    expect(behaviors()['/api/*']).toBeDefined();
    expect(behaviors()['/api/agentcore/*']).toBeUndefined();
  });
});

describe('Google credentials reach the deployed task', () => {
  /** The container's `secrets` block, as a name -> valueFrom map. */
  function containerSecrets(
    engine: 'valentin' | 'agentcore' = 'valentin',
  ): Record<string, unknown> {
    const entries = (containerDef(engine).Secrets ?? []) as Array<{
      Name: string;
      ValueFrom: unknown;
    }>;
    return Object.fromEntries(entries.map((e) => [e.Name, e.ValueFrom]));
  }

  const GOOGLE_VARS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

  /**
   * dev adopts its secrets instead of creating them, because a rolled-back deploy
   * left them behind (they are RETAIN) and CloudFormation then failed every
   * subsequent deploy with `AlreadyExists`. So the assertions here have to hold
   * either way — see `adoptedSecretArns` in config/environments.ts.
   */
  const adoptedGoogleArn = config.adoptedSecretArns?.googleOAuth;

  it('gets the credentials from the right secret, whether created or adopted', () => {
    if (!adoptedGoogleArn) {
      computeTemplate.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `valentin/${config.env}/google-oauth`,
      });
      return;
    }
    // Adoption emits no resource, so the only evidence in the template is the ARN
    // the container is told to read. It must be a *complete* ARN: ECS cannot pull
    // a secret from a partial one, and that failure appears at task start, never
    // at synth — so this assertion is the only place it can be caught early.
    expect(adoptedGoogleArn).toMatch(
      new RegExp(`:secret:valentin/${config.env}/google-oauth-[A-Za-z0-9]{6}$`),
    );
    expect(JSON.stringify(containerSecrets().GOOGLE_CLIENT_ID)).toContain(
      adoptedGoogleArn,
    );
  });

  it('never puts a Google credential in the template', () => {
    // The whole point of the secret. A literal here would land in cdk.out, in
    // the CloudFormation console, and in git.
    const json = JSON.stringify(computeTemplate.toJSON());
    expect(json).not.toMatch(/GOCSPX-/); // Google client-secret prefix
    expect(json).not.toMatch(/apps\.googleusercontent\.com/);
    expect(json).not.toMatch(/1\/\/0[A-Za-z0-9_-]{20,}/); // refresh-token shape
  });

  it('survives the account janitor, which ignores retain policies', () => {
    if (!adoptedGoogleArn) {
      computeTemplate.hasResourceProperties('AWS::SecretsManager::Secret', {
        Tags: Match.arrayWith([{ Key: 'auto-delete', Value: 'no' }]),
      });
      return;
    }
    // An adopted secret is not this stack's resource, so there is no template tag
    // to assert — the live one already carries `auto-delete=no` from the deploy
    // that created it. What this file can still hold onto is that adoption is a
    // dev-only repair: every other environment takes the create-and-tag path, and
    // if that ever stops being true this assertion is where it is noticed.
    for (const name of ['staging', 'prod']) {
      // The siteUrl argument is required only because neither env has a
      // CloudFront domain yet; it has nothing to do with what is asserted.
      expect(
        getConfig(name, 'https://example.invalid/').adoptedSecretArns,
        name,
      ).toBeUndefined();
    }
  });

  for (const engine of ['valentin', 'agentcore'] as const) {
    it(`injects all three Google variables into engine ${engine}`, () => {
      // All three or none: readiness is gated on the conjunction, so a partial
      // injection reports Gmail as unavailable with no hint as to which value
      // is missing.
      const secrets = containerSecrets(engine);
      for (const name of GOOGLE_VARS) {
        expect(secrets[name], `${name} on ${engine}`).toBeDefined();
      }
    });

    it(`passes them as secrets, not as plain environment on ${engine}`, () => {
      expect(Object.keys(containerEnv(engine))).not.toContain('GOOGLE_CLIENT_ID');
      expect(Object.keys(containerEnv(engine))).not.toContain('GOOGLE_REFRESH_TOKEN');
    });

    it(`tells engine ${engine} its own public origin, not localhost`, () => {
      // redirectUri() defaults to http://localhost:5173 when PUBLIC_ORIGIN is
      // unset, which sends a deployed user's OAuth callback to their laptop.
      const origin = containerEnv(engine).PUBLIC_ORIGIN;
      expect(origin).toBe('https://d26dwovftfq9oe.cloudfront.net');
      expect(origin).not.toContain('localhost');
    });
  }

  it('uses an origin Cognito also redirects to', () => {
    // Derived from appUrls rather than restated, so the two cannot drift.
    const origin = containerEnv().PUBLIC_ORIGIN as string;
    expect(config.appUrls.callback).toContain(`${origin}/`);
  });

  // Spotify shipped (PR #102) with server code reading SPOTIFY_CLIENT_ID /
  // SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN and nothing injecting any of
  // them, so playlists worked locally and were silently dead deployed — the exact
  // shape of the gap Google had. Connecting from the deployed panel cannot close
  // it either: both containers are readonlyRootFilesystem, so persistEnv's write
  // fails with EROFS and is only logged.
  const SPOTIFY_VARS = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN'];

  /**
   * Spotify joined `adoptedSecretArns` on 2026-09-03, for the same reason Google
   * and the share token did: the deploy that introduced the secret created it and
   * then failed elsewhere in the stack, the rollback logged `DELETE_SKIPPED`, and
   * every later deploy of this stack died with `AlreadyExists` on a name that was
   * taken. So — exactly as with Google above — these assertions have to hold on
   * both paths, because on dev there is no longer a secret resource to inspect.
   */
  const adoptedSpotifyArn = config.adoptedSecretArns?.spotifyOAuth;

  it('reads Spotify from its own secret, separate from the Google one', () => {
    // Separate, because put-secret-value is a whole-document write: sharing one
    // secret would mean rewriting Google's refresh token to rotate Spotify's.
    if (!adoptedSpotifyArn) {
      computeTemplate.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `valentin/${config.env}/spotify-oauth`,
      });
      return;
    }
    // Complete ARN, for the reason spelled out on the Google case: ECS cannot pull
    // a secret from a partial ARN, and that failure surfaces at task start rather
    // than at synth, so this is the only place it can be caught early.
    expect(adoptedSpotifyArn).toMatch(
      new RegExp(`:secret:valentin/${config.env}/spotify-oauth-[A-Za-z0-9]{6}$`),
    );
    // Still a different secret from Google's — the separation is the invariant, and
    // it survives adoption.
    const secrets = containerSecrets();
    expect(JSON.stringify(secrets.SPOTIFY_CLIENT_ID)).toContain(adoptedSpotifyArn);
    expect(JSON.stringify(secrets.GOOGLE_CLIENT_ID)).not.toContain(adoptedSpotifyArn);
  });

  it('keeps the Spotify secret out of the janitor’s reach', () => {
    if (!adoptedSpotifyArn) {
      computeTemplate.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `valentin/${config.env}/spotify-oauth`,
        Tags: Match.arrayWith([{ Key: 'auto-delete', Value: 'no' }]),
      });
      return;
    }
    // An adopted secret is not this stack's resource, so there is no template tag to
    // assert; the live one carries `auto-delete=no` from the deploy that created it.
    // What is still assertable is that adoption stays a dev-only repair.
    for (const name of ['staging', 'prod']) {
      expect(
        getConfig(name, 'https://example.invalid/').adoptedSecretArns,
        name,
      ).toBeUndefined();
    }
  });

  it('does not seed SPOTIFY_REFRESH_TOKEN with a generated value', () => {
    // Readiness is Boolean(spotifyRefreshToken) and outcome() in spotify/tools.ts
    // reads the same field to choose between saving a playlist and handing over
    // links. A *generated* token is present but invalid, so the app would claim a
    // connected account and promise a save it cannot perform. Empty is honest.
    //
    // This one is genuinely weaker after adoption, and it is worth being explicit
    // about why rather than deleting it: `generateSecretString` only ever runs at
    // *create* time, so on dev the shape is already fixed in Secrets Manager and no
    // template assertion can reach it — the live document has all three keys with
    // the refresh token empty, which is what this test was defending. The create
    // path still exists for staging and prod, and this keeps guarding it there.
    const found = computeTemplate.findResources('AWS::SecretsManager::Secret', {
      Properties: { Name: `valentin/${config.env}/spotify-oauth` },
    });
    if (adoptedSpotifyArn) {
      expect(Object.keys(found), 'adoption must emit no secret resource').toHaveLength(0);
      return;
    }

    const secret = Object.values(found)[0] as {
      Properties: { GenerateSecretString: Record<string, string> };
    };

    const generate = secret.Properties.GenerateSecretString;
    expect(generate.GenerateStringKey).not.toBe('SPOTIFY_REFRESH_TOKEN');
    // Present but empty: ECS resolves each key by name, so an absent key kills the
    // task at launch just as a missing IAM grant does.
    expect(JSON.parse(generate.SecretStringTemplate)).toMatchObject({
      SPOTIFY_REFRESH_TOKEN: '',
    });
  });

  for (const engine of ['valentin', 'agentcore'] as const) {
    it(`injects all three Spotify variables into engine ${engine}`, () => {
      const secrets = containerSecrets(engine);
      for (const name of SPOTIFY_VARS) {
        expect(secrets[name], `${name} on ${engine}`).toBeDefined();
      }
    });

    it(`passes the Spotify secret as a secret, not plain env, on ${engine}`, () => {
      expect(Object.keys(containerEnv(engine))).not.toContain('SPOTIFY_CLIENT_SECRET');
      expect(Object.keys(containerEnv(engine))).not.toContain('SPOTIFY_REFRESH_TOKEN');
    });
  }

  it('never puts a Spotify credential in the template', () => {
    const json = JSON.stringify(computeTemplate.toJSON());
    // Spotify ids and secrets are both 32-char lowercase hex.
    expect(json).not.toMatch(/"SPOTIFY_CLIENT_ID"\s*:\s*"[0-9a-f]{32}"/);
    expect(json).not.toMatch(/"SPOTIFY_CLIENT_SECRET"\s*:\s*"[0-9a-f]{32}"/);
  });

  // The first attempt to deploy the secret failed for a reason no unit test
  // covered: CloudFormation updated the execution role's grant and the ECS
  // service concurrently. The service update began 11 seconds before the two
  // IAM policies reached UPDATE_COMPLETE, every task launched in that window
  // died with `ResourceInitializationError ... AccessDeniedException` on
  // secretsmanager:GetSecretValue, and the circuit breaker rolled the whole
  // stack back — reverting the grant, so the next attempt failed identically.
  //
  // Both services must therefore declare a DependsOn covering their own
  // execution-role policy. Asserted on the synthesized template rather than on
  // the construct tree, because DependsOn is the only thing CloudFormation
  // actually reads.
  for (const [service, role] of [
    ['ServiceD69D759B', 'TaskDefExecutionRole'],
    ['ProxyServiceE575189E', 'ProxyTaskDefExecutionRole'],
  ] as const) {
    it(`orders the ${role} grant before its ECS service`, () => {
      const resources = computeTemplate.toJSON().Resources as Record<
        string,
        { Type: string; DependsOn?: string | string[] }
      >;

      const policyId = Object.keys(resources).find(
        (id) => resources[id].Type === 'AWS::IAM::Policy' && id.startsWith(`${role}DefaultPolicy`),
      );
      expect(policyId, `no DefaultPolicy found for ${role}`).toBeDefined();

      const dependsOn = resources[service]?.DependsOn ?? [];
      const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
      expect(deps).toContain(policyId);
    });
  }
});

describe('integration credentials survive a task replacement', () => {
  // The panel's connect flow writes `config.integrations` and `.env`. Both
  // containers run `readonlyRootFilesystem: true`, and a Fargate task is replaced
  // on every deploy, so before these secrets existed a credential pasted into the
  // deployed app lived exactly as long as the task did — and was invisible to any
  // second process, which is what the Gateway's tool Lambda is about to be.
  const SERVICES = ['amadeus', 'google', 'spotify', 'whatsapp'] as const;

  /** Every SecretsManager secret in the Data stack, keyed by its `Name`. */
  function dataSecrets(): Record<string, any> {
    const found = dataTemplate.findResources('AWS::SecretsManager::Secret');
    return Object.fromEntries(
      Object.values<any>(found).map((res) => [res.Properties.Name, res]),
    );
  }

  it('declares one secret per connectable service', () => {
    // The literal list rather than an import: `infra/tsconfig.json` has
    // `rootDir: '.'`, so nothing here can import `src/`. The runtime half of the
    // same list is asserted by the `integrationSecretNames` tests in
    // `src/server/integrations/__tests__/credential-store.test.ts` — if the two
    // ever disagree, the tool Lambda reads a secret nobody writes.
    expect(Object.keys(dataSecrets()).sort()).toEqual(
      SERVICES.map((s) => `valentin/${config.env}/integrations/${s}`).sort(),
    );
  });

  it('declares them in the Data stack, not the stack that rolls back', () => {
    // Compute carries the ECS rolling deploy, so a create there is the one most
    // likely to be caught in a rollback — and a RETAIN'd secret created by a
    // rolling-back deploy logs DELETE_SKIPPED, leaves the stack's resource set,
    // and deadlocks every later deploy with AlreadyExists. That is exactly how
    // `valentin/<env>/google-oauth` got stuck. Data is a ~16s near-no-op.
    const computeSecrets = Object.values<any>(
      computeTemplate.findResources('AWS::SecretsManager::Secret'),
    ).map((res) => res.Properties.Name);
    for (const service of SERVICES) {
      expect(computeSecrets).not.toContain(`valentin/${config.env}/integrations/${service}`);
    }
  });

  for (const service of SERVICES) {
    it(`exempts ${service} from the account janitor`, () => {
      // SpringClean calls DeleteSecret directly and never reads a stack policy,
      // so the tag is the only thing standing between these and a seven-day fuse.
      // It took ValentinTable-dev on 2026-09-01 this way.
      expect(
        dataSecrets()[`valentin/${config.env}/integrations/${service}`].Properties.Tags,
      ).toEqual(
        // `expect.arrayContaining`, not CDK's `Match.arrayWith` — the latter only
        // works inside `hasResourceProperties`, and against `toEqual` it silently
        // compares the matcher object itself.
        expect.arrayContaining([
          { Key: 'auto-delete', Value: 'no' },
          { Key: 'springclean', Value: 'exempt' },
        ]),
      );
    });
  }

  // RETAIN is not a free "protect the data" choice — it buys the DELETE_SKIPPED
  // deadlock above. So it is spent only where the value cannot be recovered.
  for (const [service, policy] of [
    // Refresh tokens minted by a browser consent popup, which cannot be run
    // against a Fargate task.
    ['google', 'Retain'],
    ['spotify', 'Retain'],
    // Values a human pastes into the connect form, recoverable in seconds.
    ['amadeus', 'Delete'],
    ['whatsapp', 'Delete'],
  ] as const) {
    it(`sets ${service} to ${policy}, because of how the value is obtained`, () => {
      const secret = dataSecrets()[`valentin/${config.env}/integrations/${service}`];
      expect(secret.DeletionPolicy).toBe(policy);
      expect(secret.UpdateReplacePolicy).toBe(policy);
    });
  }

  it('creates them empty, so a deploy never overwrites a live credential', () => {
    // `SecretString` is written at create time only, so a later PutSecretValue
    // survives every subsequent `cdk deploy`. `{}` rather than a generated random
    // key: `credential-store.ts` reads this as JSON and treats a missing field as
    // "not connected", which is the honest starting state — a generated value
    // would read like a real credential to whoever opens the console.
    for (const secret of Object.values<any>(dataSecrets())) {
      expect(secret.Properties.SecretString).toBe('{}');
      expect(secret.Properties.GenerateSecretString).toBeUndefined();
    }
  });

  for (const engine of ['valentin', 'agentcore'] as const) {
    it(`switches the remote store on for engine ${engine}`, () => {
      // Both engines, not just B: the panel that writes these secrets is served
      // by whichever task the visitor happens to be talking to. Unset, the whole
      // module is a no-op and `.env` is the only source.
      expect(containerEnv(engine).INTEGRATION_SECRETS_PREFIX).toBe(
        `valentin/${config.env}/integrations`,
      );
    });
  }

  /** Every statement across every Compute IAM policy. */
  function computeStatements(): Array<any> {
    return Object.values<any>(computeTemplate.findResources('AWS::IAM::Policy')).flatMap(
      (res) => res.Properties.PolicyDocument.Statement as Array<any>,
    );
  }

  it('can write the integration secrets', () => {
    const writes = computeStatements().filter((stmt) =>
      ([] as string[]).concat(stmt.Action ?? []).includes('secretsmanager:PutSecretValue'),
    );
    expect(writes.length).toBeGreaterThan(0);
  });

  it('cannot write any secret outside integrations/', () => {
    // The read grant is `valentin/<env>/*`, which includes the demo-user secret
    // holding the password POST /api/demo/login exchanges for Cognito tokens. A
    // write grant that wide would let a credential pasted into the panel lock
    // every visitor out of the deployed app. Scoped by prefix so no code path can
    // reach it, rather than trusting nobody to pass the wrong secret id.
    for (const stmt of computeStatements()) {
      const actions = ([] as string[]).concat(stmt.Action ?? []);
      if (!actions.includes('secretsmanager:PutSecretValue')) continue;
      for (const resource of ([] as unknown[]).concat(stmt.Resource ?? [])) {
        expect(String(resource)).toContain(`valentin/${config.env}/integrations/`);
      }
    }
  });

  it('never grants CreateSecret, which would produce an untagged secret', () => {
    // A secret created at runtime carries none of the exemption tags above, so
    // the janitor would delete it weeks later with no diff to blame it on. Hence
    // `putRemoteCredentials` uses PutSecretValue only and treats
    // ResourceNotFoundException as "the Data stack isn't deployed yet".
    expect(JSON.stringify(computeTemplate.toJSON())).not.toContain(
      'secretsmanager:CreateSecret',
    );
  });
});
