import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';
import { GATEWAY_IDENTITY_ARGS } from './gateway-identity-args';
/*
 * The agent's instruction set for the integration tools, generated from the tools
 * themselves by `npm run generate:tool-schemas`.
 *
 * `infra/tsconfig.json` has `rootDir: '.'`, so the CDK app cannot import
 * `src/server/integrations`. The alternative to this committed file is describing
 * sixteen tools a second time here, where a stale copy would not fail — it would
 * make the model call the right tool with arguments it no longer accepts. A unit
 * test (`src/server/integrations/__tests__/tool-schemas.test.ts`) fails on drift.
 */
import integrationToolSchemas from './generated/integration-tool-schemas.json';
import { applySpringCleanExemption } from './springclean-exemption';

export interface AgentCoreStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  /** The one table both engines write. Engine B reaches it through the Gateway. */
  table: dynamodb.ITable;
  /** Guardrail the Strands agent applies, so both engines are held to one policy. */
  guardrailId: string;
  guardrailVersion: string;
  /** Cognito pool that issues the Gateway's JWTs. */
  userPool: cognito.IUserPool;
  /** Hosted-UI prefix of that pool, which is also its OAuth token endpoint host. */
  cognitoDomainPrefix: string;
  /** Tag of the ARM64 agent image in `valentin-agentcore-<env>`. */
  imageTag: string;
  /**
   * Where the integration credentials live — `valentin/<env>/integrations`.
   *
   * A plain string rather than four `ISecret`s, matching how the compute stack
   * receives it: the tool Lambda needs read access to a prefix, not references to
   * individual secrets, and every `ISecret` passed across a stack boundary is one
   * more CloudFormation export to hold open.
   */
  integrationSecretsPrefix: string;
}

/**
 * Engine B's managed half: AgentCore Runtime, Memory, Gateway and the log group
 * their telemetry lands in.
 *
 * ## What this stack is for
 *
 * Valentin already works. Everything here exists to run the *same product* on
 * managed AgentCore primitives instead of hand-rolled ones, so the two can be
 * measured against each other on identical inputs:
 *
 * | Valentin does by hand              | AgentCore does here          |
 * |------------------------------------|------------------------------|
 * | `agent-orchestrator.ts` turn loop  | Runtime (Strands agent)      |
 * | `preference-extractor.ts`          | Memory, `userPreferenceMemoryStrategy` |
 * | tool wiring inside the server      | Gateway, MCP over Lambda     |
 *
 * The model is the same, the guardrail is the same, and the table is the same.
 * That is the whole design: if the engines differed in any of those three, a
 * measured difference between them would say nothing about AgentCore.
 *
 * ## What this stack deliberately does not own
 *
 * The **proxy** that fronts the Runtime lives in `compute-stack.ts`, not here.
 * An AgentCore Runtime cannot be an ALB target — ALB targets are instance, ip,
 * lambda or alb, and nothing else — so reaching it from the browser needs a
 * process that can hold a WebSocket open and call `InvokeAgentRuntime`. Putting
 * that second Fargate service next to the first one keeps one VPC, one listener
 * and one security group in play.
 *
 * ## Observability, honestly
 *
 * AgentCore emits OTEL spans to CloudWatch GenAI Observability on its own, but
 * the account-level switch that makes them *visible* — CloudWatch Transaction
 * Search — is not a CloudFormation resource. It is enabled once per account and
 * cannot be set from here; `TransactionSearchCommand` below is the command to
 * run. This stack creates the retained log group that the proxy writes engine-B
 * spans to, which is the part that is code.
 */
export class AgentCoreStack extends cdk.Stack {
  /** Passed to the proxy service so it can call `InvokeAgentRuntime`. */
  public readonly runtimeArn: string;
  /** Passed to the proxy service so it can read and write conversation events. */
  public readonly memoryId: string;
  /** MCP endpoint the Strands agent calls for the three profile tools. */
  public readonly gatewayUrl: string;
  /** Role the proxy must be allowed to reach; exported for the compute stack's policy. */
  public readonly runtimeRole: iam.Role;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const { config, table, userPool, imageTag } = props;
    const env = config.env;

    /*
     * Two naming rules, not one — and they are opposites.
     *
     * Runtime and Memory names accept `[a-zA-Z][a-zA-Z0-9_]{0,47}`: a hyphen is
     * rejected. Gateway names accept `^([0-9a-zA-Z][-]?){1,100}$`: an underscore
     * is rejected. So the first two break this repo's `valentin-thing-dev`
     * convention and the third keeps it, and neither is a style choice. `cdk
     * synth` flags a violation as a template-validation warning rather than an
     * error, so it will not stop a deploy — it fails at CreateStack instead.
     */
    const runtimeName = `valentin_agent_${env}`;
    const memoryName = `valentin_memory_${env}`;
    const gatewayName = `valentin-gateway-${env}`;

    // ---------------------------------------------------------------------
    // Telemetry
    // ---------------------------------------------------------------------

    this.logGroup = new logs.LogGroup(this, 'AgentCoreLogGroup', {
      logGroupName: `/valentin/agentcore/${env}`,
      retention: config.logRetention,
      // Nothing else reads this group, and an orphaned group would silently
      // block the next deploy of the same environment on a name collision.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------------
    // Profile tools: one Lambda, three MCP tools
    // ---------------------------------------------------------------------

    const profileTools = new lambda.Function(this, 'ProfileTools', {
      functionName: `valentin-profile-tools-${env}`,
      description: 'The three profile tools AgentCore Gateway exposes to engine B',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      // A plain asset, not a bundled one. The handler imports only
      // `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`, both of which the
      // Node 22 runtime already ships, so there is nothing to bundle and no
      // esbuild step for the infra deploy to depend on.
      code: lambda.Code.fromAsset('lambda/profile-tools'),
      environment: {
        VALENTIN_TABLE_NAME: table.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      // An explicit group rather than `logRetention`, which is deprecated and
      // implements itself as a custom resource that rewrites retention on an
      // already-existing group.
      logGroup: new logs.LogGroup(this, 'ProfileToolsLogs', {
        logGroupName: `/aws/lambda/valentin-profile-tools-${env}`,
        retention: config.logRetention,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Read and write preferences, read session meta. Nothing else: this function
    // must not be able to delete a session or touch another table.
    table.grantReadWriteData(profileTools);

    // ---------------------------------------------------------------------
    // Integration tools: the real fourteen, bundled from the server's own code
    // ---------------------------------------------------------------------

    /*
     * The same tools engine A runs, hosted for the Gateway.
     *
     * `NodejsFunction`, not `Code.fromAsset`, and the entry point is in `src/`
     * rather than `infra/lambda/`. Both follow from one decision: engine B must
     * run the *same* tool code as engine A, or a measured difference between the
     * engines stops being about AgentCore. `profile-tools/index.mjs` gets away
     * with re-implementing the key layout because it is forty lines of DynamoDB;
     * re-implementing fourteen integrations would mean a second Ontopo client and
     * a second Amadeus token cache, and the first one to drift would make engine
     * B answer differently for a reason nobody could attribute.
     *
     * The cost is that synth now bundles TypeScript, so `npm run test:infra`
     * needs esbuild — pinned in `infra/devDependencies` deliberately, because
     * without a local esbuild CDK silently falls back to bundling in Docker,
     * which in CI is a slow failure rather than a fast one.
     */
    const integrationTools = new NodejsFunction(this, 'IntegrationTools', {
      functionName: `valentin-integration-tools-${env}`,
      description: 'The integration tools AgentCore Gateway exposes to engine B',
      runtime: lambda.Runtime.NODEJS_22_X,
      // Matching `profileTools` and the agent image. Everything bundled here is
      // pure JS (`@hebcal/core` included), so the build is architecture-neutral —
      // but a future native binding would compile for x86 here and fail at invoke.
      architecture: lambda.Architecture.ARM_64,
      entry: '../src/server/integrations/lambda-handler.ts',
      handler: 'handler',
      // The repo root, so esbuild resolves `src/shared/**` and node_modules the
      // same way `tsc` does.
      projectRoot: '..',
      depsLockFilePath: '../package-lock.json',
      bundling: {
        /*
         * CJS, even though the source is ESM — and this was measured, not assumed.
         *
         * The obvious choice is `OutputFormat.ESM`, since the root package is
         * `"type": "module"`. Building it that way produces a bundle that throws
         * on *import*, before any handler code runs:
         *
         *   Error: Dynamic require of "node:https" is not supported
         *     at @smithy/node-http-handler/dist-cjs/index.js
         *     at @aws-sdk/client-secrets-manager/dist-cjs/index.js
         *
         * The AWS SDK v3 resolves to its CJS build, and esbuild's ESM output
         * shims `require` with a function that throws. The failure is total — the
         * module never loads, so *every* tool call becomes a Gateway error — and
         * it cannot be reproduced by any unit test, because unit tests import the
         * TypeScript, not the bundle. Found by loading the synthesised asset with
         * `node` before deploying; do that again if this line is ever changed.
         *
         * esbuild converts ESM sources to CJS reliably, so this direction has no
         * equivalent hazard. The asset ships no `package.json`, so Lambda reads
         * the emitted `index.js` as CommonJS regardless of the repo's setting.
         */
        format: OutputFormat.CJS,
        /*
         * Playwright is imported through a *variable* specifier in
         * `browser/session.ts`, so esbuild leaves it alone — but naming it here
         * makes that intentional rather than incidental. The browser probe simply
         * reports false in Lambda, which is the same graceful degradation a
         * Fargate task without Chromium already gets.
         */
        externalModules: ['playwright', 'playwright-core'],
        minify: false,
        sourceMap: false,
      },
      environment: {
        VALENTIN_TABLE_NAME: table.tableName,
        // Switches `credential-store.ts` on. Unset — locally, and in `npm test` —
        // the whole remote-credential path is a no-op.
        INTEGRATION_SECRETS_PREFIX: props.integrationSecretsPrefix,
      },
      // Ontopo and Amadeus are third-party HTTP calls behind a token exchange, so
      // 10s (what the profile tools get for a DynamoDB read) is too tight.
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: new logs.LogGroup(this, 'IntegrationToolsLogs', {
        logGroupName: `/aws/lambda/valentin-integration-tools-${env}`,
        retention: config.logRetention,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    /*
     * Read-only on the integration secrets, and nothing wider.
     *
     * This function serves a model's tool calls; the panel that *writes* these
     * secrets runs in the compute stack and holds the only `PutSecretValue`
     * grant. Scoped to `integrations/*` rather than `valentin/<env>/*` so the
     * demo-user password — which `POST /api/demo/login` exchanges for Cognito
     * tokens — is not reachable from here at all.
     *
     * The `/*` suffix already absorbs Secrets Manager's six-character name
     * suffix; no extra wildcard is needed.
     */
    integrationTools.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [
          `arn:aws:secretsmanager:*:*:secret:${props.integrationSecretsPrefix}/*`,
        ],
      }),
    );

    // Belt and braces on top of the app-scope call in `bin/app.ts`: this is the
    // one new resource holding a state nobody can recreate from the repo in under
    // a minute, and SpringClean calls service APIs directly — `RemovalPolicy` is
    // not a defence against it. See `springclean-exemption.ts`.
    applySpringCleanExemption(integrationTools);

    // The Gateway target that exposes this function lives further down, beside the
    // profile one, because it needs the `gateway` construct. It arrived in its own
    // deploy *after* this function existed: a target naming a Lambda that is not
    // there yet fails at stack update, and since `CfnRuntime` depends on its
    // targets the rollback can leave the Runtime a version behind a new proxy —
    // which surfaces as engine B apologising and reads like AgentCore latency.

    // ---------------------------------------------------------------------
    // Gateway auth: a machine client, not a user
    // ---------------------------------------------------------------------

    /*
     * Gateway's only inbound auth mode is CUSTOM_JWT, and the caller is an agent
     * rather than a person, so it needs a client-credentials client of its own.
     *
     * The SPA client cannot be reused: it is public, has no secret, and
     * client_credentials requires a confidential client. The demo client cannot
     * be reused either — OAuth is disabled on it entirely.
     */
    /*
     * Constructed here rather than via `userPool.addResourceServer(...)`.
     *
     * The `add*` helpers scope the new construct to the *pool*, which lives in
     * AuthStack — so they would quietly create engine-B resources inside the
     * auth stack and leave this one owning nothing. Passing `userPool` as a prop
     * keeps the resources where the stack that reviews them is.
     */
    const invokeScope = new cognito.ResourceServerScope({
      scopeName: 'invoke',
      scopeDescription: 'Call the Valentin profile tools through AgentCore Gateway',
    });

    const resourceServer = new cognito.UserPoolResourceServer(this, 'ToolsResourceServer', {
      userPool,
      identifier: 'valentin-tools',
      userPoolResourceServerName: `valentin-tools-${env}`,
      scopes: [invokeScope],
    });

    const gatewayClient = new cognito.UserPoolClient(this, 'GatewayClient', {
      userPool,
      userPoolClientName: `valentin-gateway-${env}`,
      generateSecret: true,
      oAuth: {
        flows: { clientCredentials: true },
        scopes: [cognito.OAuthScope.resourceServer(resourceServer, invokeScope)],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      enableTokenRevocation: true,
    });

    /*
     * The client secret is never read into this template.
     *
     * `gatewayClient.userPoolClientSecret` would work, but it resolves through a
     * custom resource whose response CloudFormation stores in plaintext in the
     * stack's own event history. The Strands agent instead calls
     * `DescribeUserPoolClient` at cold start with the runtime role's own
     * credentials — one extra API call, and the secret only ever exists in the
     * runtime's memory.
     */
    const discoveryUrl = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`;
    const tokenUrl = `https://${props.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com/oauth2/token`;

    // ---------------------------------------------------------------------
    // Memory
    // ---------------------------------------------------------------------

    const memoryRole = new iam.Role(this, 'MemoryRole', {
      roleName: `valentin-agentcore-memory-${env}`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Lets AgentCore Memory call a model to extract long-term preferences',
    });

    // The extraction strategy invokes a model on Memory's own schedule, with
    // Memory's credentials rather than the agent's — so this grant is what makes
    // `userPreferenceMemoryStrategy` actually produce records.
    memoryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          // Region-wildcarded for the same reason as the Runtime role below: a
          // cross-region inference profile is authorized against the fulfilling
          // region's foundation-model ARN, which is often not this stack's. The
          // failure mode here is quieter than the Runtime's — extraction runs on
          // Memory's own schedule, so an AccessDenied surfaces as engine B simply
          // never learning anything, with no failed turn to trace it back from.
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      }),
    );

    const memory = new agentcore.CfnMemory(this, 'Memory', {
      name: memoryName,
      description: `Conversation memory and managed preference extraction for Valentin (${env})`,
      /*
       * Required by the API — there is no "keep forever".
       *
       * 90 days is chosen to outlive a demo cycle without becoming an indefinite
       * store of someone's private notes about their partner. It is also why
       * DynamoDB stays the source of truth for the profile: these records expire
       * by design, and the profile must not.
       */
      eventExpiryDuration: 90,
      memoryExecutionRoleArn: memoryRole.roleArn,
      memoryStrategies: [
        {
          userPreferenceMemoryStrategy: {
            name: 'partner_preferences',
            description:
              'Extracts durable facts about the user\'s partner from the conversation',
            /*
             * `/{actorId}/{sessionId}` keeps extraction scoped to one session of
             * one user, matching how the DynamoDB rows are keyed. A
             * user-wide namespace would blend two partners' profiles for anyone
             * who started a second session, which is exactly the bug the
             * per-session DynamoDB partition avoids.
             */
            namespaces: ['/valentin/{actorId}/{sessionId}'],
          },
        },
      ],
      tags: { Engine: 'agentcore' },
    });
    memory.node.addDependency(memoryRole);

    // ---------------------------------------------------------------------
    // Gateway
    // ---------------------------------------------------------------------

    const gatewayRole = new iam.Role(this, 'GatewayRole', {
      roleName: `valentin-agentcore-gateway-${env}`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: 'Lets AgentCore Gateway invoke the tool Lambdas behind it',
    });
    profileTools.grantInvoke(gatewayRole);
    // A target added without its grant is the most likely deploy-time failure here:
    // the stack updates cleanly and every tool call then fails AccessDenied at
    // invoke, which the agent reports as the integration being broken. Asserted in
    // `infra/test/regressions.test.ts`.
    integrationTools.grantInvoke(gatewayRole);

    const gateway = new agentcore.CfnGateway(this, 'Gateway', {
      name: gatewayName,
      description: `MCP gateway over Valentin's profile and integration tools (${env})`,
      roleArn: gatewayRole.roleArn,
      protocolType: 'MCP',
      authorizerType: 'CUSTOM_JWT',
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl,
          // Scoped to the one machine client. Without this any token the pool
          // issues — including a signed-in visitor's — would open the gateway.
          allowedClients: [gatewayClient.userPoolClientId],
        },
      },
      // DEBUG returns the underlying tool error to the agent instead of a generic
      // failure. The tools return validation messages the model can act on, and
      // swallowing them would waste that.
      exceptionLevel: 'DEBUG',
    });
    gateway.node.addDependency(gatewayRole);

    /**
     * Shared shape: every tool is called with the user and session it acts on.
     *
     * Imported rather than declared here, so the integration target's generated
     * schemas and these hand-written ones cannot drift apart. See the module for
     * why identity is an argument and not a claim.
     */
    const identityArgs = GATEWAY_IDENTITY_ARGS;

    const categoryArg = {
      type: 'string',
      description:
        'One of: food, hobbies, music, travel, gifts, love_language, important_dates, personality_traits',
    };

    const gatewayTarget = new agentcore.CfnGatewayTarget(this, 'ProfileToolsTarget', {
      name: 'valentin-profile',
      description: 'Read and write the partner profile in DynamoDB',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      credentialProviderConfigurations: [
        // The gateway signs the Lambda call with its own role. GATEWAY_IAM_ROLE
        // is the only credential type that applies to a Lambda target.
        { credentialProviderType: 'GATEWAY_IAM_ROLE' },
      ],
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: profileTools.functionArn,
            /*
             * The tool schema is inline rather than in S3.
             *
             * These three tools are the interface between the agent and the
             * table, so they belong in the reviewed artefact. An S3 schema would
             * let the contract change without a diff.
             */
            toolSchema: {
              inlinePayload: [
                {
                  name: 'get_partner_profile',
                  description:
                    "Get everything known about the user's partner, grouped by category. Call this before answering anything that depends on her preferences.",
                  inputSchema: {
                    type: 'object',
                    properties: identityArgs,
                    required: ['user_id', 'session_id'],
                  },
                },
                {
                  name: 'save_preference',
                  description:
                    "Record one durable fact about the user's partner. Use this only for facts that will still be true next month, not for what she wants right now.",
                  inputSchema: {
                    type: 'object',
                    properties: {
                      ...identityArgs,
                      category: categoryArg,
                      key: {
                        type: 'string',
                        description: 'Short stable name for the fact, e.g. "favourite_cuisine"',
                      },
                      value: { type: 'string', description: 'The fact itself, in plain words' },
                      confidence: {
                        type: 'number',
                        description:
                          'How certain this is, 0 to 1. Omit if the user stated it outright.',
                      },
                    },
                    required: ['user_id', 'session_id', 'category', 'key', 'value'],
                  },
                },
                {
                  name: 'list_preferences',
                  description:
                    'List the recorded facts as flat rows, optionally narrowed to one category.',
                  inputSchema: {
                    type: 'object',
                    properties: { ...identityArgs, category: categoryArg },
                    required: ['user_id', 'session_id'],
                  },
                },
              ],
            },
          },
        },
      },
    });
    gatewayTarget.node.addDependency(gateway);

    /*
     * The second target: the real integration tools, behind the same endpoint.
     *
     * This is the point of the whole exercise. Engine A reaches Ontopo, Amadeus,
     * Hebcal, Wolt and Spotify through a hand-written tool loop in the Express
     * process; engine B reaches the *same* registry through one MCP endpoint whose
     * tool schemas are declared once and whose access is JWT-scoped to a single
     * machine client. Two targets, one gateway, no second tool loop.
     *
     * Read-only tools only, for now. The seven `propose_*` tools each need a paired
     * `confirm_*` that the *proxy* calls — putting a language model in the
     * authority path for spending money is the exact thing propose/confirm exists
     * to prevent — and that needs proposal state in DynamoDB plus a second Cognito
     * client. None of it is required to prove the Gateway is in the path, so it
     * ships separately and this target grows then.
     *
     * Filtered on the tool's own `requiresConfirmation` flag rather than the
     * `propose_` name prefix. The two agree today and a unit test asserts it, but a
     * naming convention is a weaker thing to key tool exposure on than the flag the
     * tool declares.
     */
    /*
     * Read-only, and still not exposed.
     *
     * `create_conversation_link` mints a signed share token. `SHARE_TOKEN_SECRET`
     * reaches the proxy as an `ecs.Secret` and reaches this Lambda not at all, so
     * `share-token.ts` falls back to a per-process random key — a link minted here
     * would be signed with a key the process that serves the guest view does not
     * have, and would fail verification every time. The origin is wrong too: with
     * no base URL in this environment the link points at `localhost:5173`.
     *
     * A tool the agent does not have is a sentence Valentin can say. A link he
     * hands over that silently does not open is worse, and it would look like the
     * sharing feature being broken rather than engine B lacking a wiring. So it is
     * withheld until the signing key and the base URL are shared with this
     * function, and engine A keeps it exactly as it is.
     */
    const WITHHELD = new Set(['create_conversation_link']);

    const readOnlyToolSchemas = integrationToolSchemas
      .filter((tool) => !tool.requiresConfirmation && !WITHHELD.has(tool.name))
      // `requiresConfirmation` is ours, not the Gateway's: `inlinePayload` takes
      // schema fields only, and an unknown property fails at CreateStack — ten
      // minutes into a deploy — rather than at synth.
      .map(
        ({ name, description, inputSchema }): agentcore.CfnGatewayTarget.ToolDefinitionProperty => ({
          name,
          description,
          /*
           * The one cast in this file, and it is about JSON, not about CDK.
           *
           * TypeScript infers the imported array as a union of sixteen literal
           * types, so every property one tool declares becomes `city?: undefined`
           * on the fifteen that do not — which no `Record<string, …>` accepts, and
           * which is why it needs the `unknown` hop rather than a direct assertion.
           * The shape itself is right; it is checked where it can be, by the test
           * that regenerates this file from the tools and asserts each `inputSchema`
           * is an object with the identity args required.
           */
          inputSchema: inputSchema as unknown as agentcore.CfnGatewayTarget.SchemaDefinitionProperty,
        }),
      );

    const integrationsTarget = new agentcore.CfnGatewayTarget(this, 'IntegrationToolsTarget', {
      name: 'valentin-integrations',
      description: 'The real integration tools: restaurants, hotels, calendar, dates, delivery',
      gatewayIdentifier: gateway.attrGatewayIdentifier,
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: integrationTools.functionArn,
            toolSchema: { inlinePayload: readOnlyToolSchemas },
          },
        },
      },
    });
    integrationsTarget.node.addDependency(gateway);

    /*
     * Neither target carries the SpringClean exemption, and neither can.
     *
     * `CfnGatewayTarget` implements only `IInspectable` and `IGatewayTargetRef` —
     * not `ITaggableV2` — and `CfnGatewayTargetProps` has no `tags` field, so
     * `AWS::BedrockAgentCore::GatewayTarget` is untaggable. Three things make that
     * tolerable: the parent `CfnGateway` **is** taggable and does carry the
     * exemption, and a target is its child; a target holds no state, so if one is
     * deleted `scripts/deploy.sh dev --scope=infra` recreates it in ~2 minutes with
     * nothing lost, unlike the table SpringClean ate on 2026-09-01; and if the
     * service later accepts `Tags` it can be applied with `addPropertyOverride`.
     *
     * Do **not** add that override speculatively — an unknown property fails at
     * `CreateStack`, ten minutes into a deploy, rather than at synth.
     */

    // ---------------------------------------------------------------------
    // Runtime
    // ---------------------------------------------------------------------

    const runtimeRole = new iam.Role(this, 'RuntimeRole', {
      roleName: `valentin-agentcore-runtime-${env}`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock-agentcore:${this.region}:${this.account}:*`,
          },
        },
      }),
      description: 'Execution role for the Valentin Strands agent on AgentCore Runtime',
    });
    this.runtimeRole = runtimeRole;

    // The ECR repository holding the ARM64 agent image. Imported by name for the
    // same reason compute-stack imports its own: `scripts/deploy.sh` creates and
    // pushes to it, so CDK owning it would fight the deploy over lifecycle.
    const agentRepo = ecr.Repository.fromRepositoryName(
      this,
      'AgentRepo',
      `valentin-agentcore-${env}`,
    );
    agentRepo.grantPull(runtimeRole);
    // `grantPull` covers the image layers; the auth token is account-wide and has
    // no resource to scope to.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          /*
           * The foundation model is region-wildcarded on purpose.
           *
           * BEDROCK_MODEL_ID is `us.anthropic.claude-sonnet-4-5-...`, and the
           * `us.` prefix makes it a cross-region inference profile: Bedrock
           * fulfils the call from whichever US region has capacity, and
           * authorizes it against the *fulfilling* region's foundation-model
           * ARN. Pinned to `${this.region}` this denied every engine-B turn with
           * "not authorized to perform: bedrock:InvokeModelWithResponseStream on
           * resource: arn:aws:bedrock:us-east-2::foundation-model/..." — us-east-2,
           * from a stack deployed to us-east-1. The action was granted all along;
           * only the region was wrong, which is why it read as a missing
           * permission rather than a misscoped one.
           *
           * Safe to widen: foundation-model ARNs are AWS-owned and carry no
           * account id, so this grants nothing customer-specific. The
           * inference-profile ARN below stays scoped to this account and region,
           * which is the resource that actually gates *which* profiles we may use.
           */
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // ApplyGuardrail is separate from InvokeModel: the Strands agent applies the
    // same guardrail engine A does, which is what makes a safety comparison
    // between them mean anything.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [`arn:aws:bedrock:${this.region}:${this.account}:guardrail/${props.guardrailId}`],
      }),
    );

    // Memory data plane. The agent writes each turn as an event and reads back
    // what the extraction strategy has learned.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:RetrieveMemoryRecords',
          'bedrock-agentcore:ListMemoryRecords',
          'bedrock-agentcore:GetMemoryRecord',
        ],
        resources: [memory.attrMemoryArn, `${memory.attrMemoryArn}/*`],
      }),
    );

    // Reading its own Gateway client secret, so the secret never enters a
    // template or a log. Scoped to the pool, which is as narrow as
    // DescribeUserPoolClient's resource model allows.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:DescribeUserPoolClient'],
        resources: [userPool.userPoolArn],
      }),
    );

    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: [this.logGroup.logGroupArn, `${this.logGroup.logGroupArn}:*`],
      }),
    );

    // OTEL spans to GenAI Observability. X-Ray's put APIs take no resource.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'xray:PutTraceSegments',
          'xray:PutTelemetryRecords',
          'xray:GetSamplingRules',
          'xray:GetSamplingTargets',
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      }),
    );

    // Workload identity — how the runtime gets a token for its own outbound
    // calls. Without it `InvokeAgentRuntime` fails before the agent starts.
    runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:GetWorkloadAccessToken',
          'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
          'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
        ],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/${runtimeName}-*`,
        ],
      }),
    );

    const runtime = new agentcore.CfnRuntime(this, 'Runtime', {
      agentRuntimeName: runtimeName,
      description: `Valentin's Strands agent, engine B (${env})`,
      roleArn: runtimeRole.roleArn,
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: `${agentRepo.repositoryUri}:${imageTag}`,
        },
      },
      /*
       * PUBLIC, not VPC.
       *
       * The agent's only outbound calls are Bedrock, Memory and Gateway — all
       * public AWS endpoints. Putting it in the VPC would mean either NAT egress
       * or three more interface endpoints, and would still not let the ALB reach
       * it, because an AgentCore Runtime is not an ALB target under any network
       * mode. It reaches nothing private, so it is in nothing private.
       */
      networkConfiguration: { networkMode: 'PUBLIC' },
      // The agent speaks the plain `/invocations` + `/ping` HTTP contract, not
      // MCP. MCP here would make the runtime a tool server rather than an agent.
      protocolConfiguration: 'HTTP',
      environmentVariables: {
        AGENTCORE_MEMORY_ID: memory.attrMemoryId,
        AGENTCORE_GATEWAY_URL: gateway.attrGatewayUrl,
        GATEWAY_CLIENT_ID: gatewayClient.userPoolClientId,
        GATEWAY_SCOPE: 'valentin-tools/invoke',
        GATEWAY_TOKEN_URL: tokenUrl,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        BEDROCK_GUARDRAIL_ID: props.guardrailId,
        BEDROCK_GUARDRAIL_VERSION: props.guardrailVersion,
        VALENTIN_ENV: env,
        VALENTIN_LOG_GROUP: this.logGroup.logGroupName,
      },
      tags: { Engine: 'agentcore' },
    });
    runtime.node.addDependency(runtimeRole);
    runtime.node.addDependency(memory);
    // Both targets, so a cold start never lists a partial tool set: the agent calls
    // `gateway.list_tools_sync()` once at init, and a Runtime that came up before
    // the integration target existed would hold three profile tools for the life of
    // the container and read as "AgentCore lost the integrations".
    runtime.node.addDependency(gatewayTarget);
    runtime.node.addDependency(integrationsTarget);

    this.runtimeArn = runtime.attrAgentRuntimeArn;
    this.memoryId = memory.attrMemoryId;
    this.gatewayUrl = gateway.attrGatewayUrl;

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------

    new cdk.CfnOutput(this, 'RuntimeArn', {
      value: runtime.attrAgentRuntimeArn,
      description: 'AgentCore Runtime ARN — the proxy calls InvokeAgentRuntime on this',
      exportName: `valentin-agentcore-runtime-arn-${env}`,
    });

    new cdk.CfnOutput(this, 'MemoryId', {
      value: memory.attrMemoryId,
      description: 'AgentCore Memory id',
      exportName: `valentin-agentcore-memory-id-${env}`,
    });

    new cdk.CfnOutput(this, 'GatewayUrl', {
      value: gateway.attrGatewayUrl,
      description: 'AgentCore Gateway MCP endpoint',
      exportName: `valentin-agentcore-gateway-url-${env}`,
    });

    new cdk.CfnOutput(this, 'GatewayClientId', {
      value: gatewayClient.userPoolClientId,
      description: 'Cognito client-credentials client the agent uses for the Gateway',
      exportName: `valentin-agentcore-gateway-client-id-${env}`,
    });

    // Not a resource, so not a stack. This is the one manual step engine B needs.
    new cdk.CfnOutput(this, 'TransactionSearchCommand', {
      value:
        'aws xray update-trace-segment-destination --destination CloudWatchLogs && ' +
        'aws xray update-indexing-rule --name Default --rule "{\\"Probabilistic\\":{\\"DesiredSamplingPercentage\\":100}}"',
      description:
        'Run once per account to enable CloudWatch Transaction Search, without which AgentCore spans are collected but not queryable',
    });
  }
}
