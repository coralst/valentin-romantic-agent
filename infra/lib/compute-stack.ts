import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface ComputeStackProps extends cdk.StackProps {
  /**
   * Environment configuration, mirroring DataStack. `config.env` is the
   * environment name, so no separate `environment` prop is needed.
   */
  config: EnvironmentConfig;
  /** VPC to deploy into — if not provided, a new one is created */
  vpc?: ec2.IVpc;
  /** Session table from DataStack. Passed as a construct so the container's
   *  DYNAMO_TABLE_NAME and the task role's grant can never disagree. */
  table: dynamodb.ITable;
  /** Photo bucket from DataStack. */
  photoBucket: s3.IBucket;
  /** Guardrail from SafetyStack. Without this the guardrail is deployed but
   *  never enforced, because the server disables it on an empty ID. */
  guardrailId: string;
  guardrailVersion: string;
  /** Image tag to run, supplied by deploy.sh as the git SHA. */
  imageTag: string;
  /** Bucket for ALB access logs. */
  accessLogBucket: s3.IBucket;
  /**
   * Prefix of the per-service integration secrets DataStack declares, with no
   * trailing slash.
   *
   * A string rather than four `ISecret`s on purpose: this stack needs only
   * something to grant against and to hand the container, and four more
   * cross-stack exports would thicken the Data→Compute edge that
   * `scripts/deploy.sh` already has to order by hand.
   */
  integrationSecretsPrefix: string;
  /** Cognito User Pool the backend verifies access tokens against */
  userPoolId: string;
  userPoolArn: string;
  /** Public SPA app client id — one of the two accepted token audiences */
  spaClientId: string;
  /** Server-only app client id used for the demo sign-in */
  demoClientId: string;
  /** Secret holding the demo account's credentials */
  demoSecret: secretsmanager.ISecret;
  /**
   * Hosted UI domain prefix.
   *
   * Passed through to the browser via `GET /api/config` so the SPA needs no
   * build-time AWS configuration at all — one bundle works locally and in every
   * environment, and nobody has to copy ids out of the console.
   */
  cognitoDomainPrefix: string;
  /**
   * AgentCore Runtime the engine-B proxy invokes, from AgentCoreStack.
   *
   * The proxy exists because an AgentCore Runtime cannot be an ALB target — the
   * only target types are instance, ip, lambda and alb. A Lambda target would
   * work for the HTTP routes and then fail the thing that matters: ALB-to-Lambda
   * cannot response-stream, so time-to-first-token would be unmeasurable, which
   * is one of the two numbers this whole comparison exists to produce.
   */
  agentCoreRuntimeArn: string;
  /** AgentCore Memory the proxy reads and writes conversation events on. */
  agentCoreMemoryId: string;
  /** Gateway MCP endpoint, passed through for the drawer to display. */
  agentCoreGatewayUrl: string;
}

/**
 * ECS Fargate compute stack for the Valentin backend.
 *
 * Creates: ECS Cluster, Task Definition, Fargate Service, ALB with
 * health-check and sticky sessions, auto-scaling, and security groups.
 * The ECR repository is imported, not created.
 *
 * Two services run here, not one. Both run the *same* image off the same tag;
 * they differ only by the AGENT_ENGINE environment variable:
 *
 *   valentin-service-<env>   AGENT_ENGINE=valentin   the hand-built orchestrator
 *   valentin-ac-proxy-<env>  AGENT_ENGINE=agentcore  streams from AgentCore Runtime
 *
 * Same image is the point. A measured difference between the two engines has to
 * come from the engine, so anything that isn't the engine — Node version, HTTP
 * stack, DynamoDB client, guardrail, model id, task size — is held identical by
 * construction rather than by discipline.
 */
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly ecrRepository: ecr.IRepository;
  /** Engine-B service: terminates the browser connection and streams from the Runtime. */
  public readonly proxyService: ecs.FargateService;
  /** Engine-B target group, wired to the same ALB by the listener rules below. */
  public readonly proxyTargetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config } = props;
    const env = config.env;

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
      // Deliberately kept at the original wording even though it no longer
      // describes the rules. EC2 cannot change a security group description in
      // place, so editing this string makes CloudFormation replace the group,
      // which in turn recreates the ALB -> ECS ingress rule and can blip health
      // checks on a running service. The ingress rules below are the source of
      // truth; see the comment there for what this group actually allows.
      description: 'ALB security group - accepts HTTP/HTTPS from internet',
      allowAllOutbound: true,
    });
    // The ALB is internet-facing because CloudFront reaches it over the public
    // internet, but only CloudFront edge locations may connect. Opening this to
    // 0.0.0.0/0 would let clients reach the origin directly and skip the WAF.
    albSg.addIngressRule(
      ec2.Peer.prefixList(config.cloudfrontPrefixListId),
      ec2.Port.tcp(80),
      'Allow HTTP from CloudFront edge locations only',
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

    // --- Task Roles (permissions for AWS services) ---
    //
    // One role per service rather than one shared role. Both run the same image,
    // so the code paths are identical, but the *engines* are not: only engine A
    // calls Bedrock Converse directly, and only engine B calls the AgentCore
    // data plane. Sharing a role would grant each service the other's
    // permissions and quietly hide that distinction from anyone auditing which
    // engine actually talks to which API.
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `valentin-task-role-${env}`,
    });

    const proxyTaskRole = new iam.Role(this, 'ProxyTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `valentin-ac-proxy-role-${env}`,
    });

    /**
     * Everything both engines need: the same table, the same photo bucket, the
     * same secret and the same demo sign-in. Engine B still owns session and
     * message persistence and still serves the profile UI, so its access to
     * these is identical rather than reduced.
     */
    const grantSharedAccess = (role: iam.IRole) => {
      // Grants derive the exact table/bucket ARNs (including GSIs) from the
      // constructs. The previous hand-written statements used resources:['*']
      // with a StringLike condition on `valentin-*-<env>`, which never matched
      // the real table name `ValentinTable-<env>`.
      //
      // Deriving from the construct also covers `/index/*`, which a Query against
      // GSI1 is authorized against rather than the table ARN — so the session
      // list would 403 under a table-ARN-only grant.
      props.table.grantReadWriteData(role);
      props.photoBucket.grantReadWrite(role);

      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:*:*:secret:valentin/${env}/*`],
        }),
      );

      /*
       * Write, for the integrations panel's connect flow only.
       *
       * Deliberately far narrower than the read grant above: `integrations/*`
       * rather than `valentin/<env>/*`. A credential pasted into the panel must
       * never be able to overwrite `valentin/<env>/demo-user` — that secret holds
       * the password `POST /api/demo/login` exchanges for real Cognito tokens, so
       * a write there would lock every visitor out of the deployed app. Scoping
       * this by prefix means no code path in the server can reach it, rather than
       * relying on nobody ever passing the wrong secret id.
       *
       * `CreateSecret` is absent, and that is the load-bearing omission: a secret
       * created at runtime would carry none of the SpringClean exemption tags, and
       * the Isengard janitor deletes untagged resources. So the four secrets are
       * declared in DataStack and `putRemoteCredentials` uses PutSecretValue only,
       * treating ResourceNotFoundException as "the Data stack isn't deployed yet".
       *
       * The trailing `*` also absorbs the six random characters Secrets Manager
       * appends to every secret ARN — a resource ending at the plain name matches
       * nothing.
       */
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['secretsmanager:PutSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [
            `arn:aws:secretsmanager:*:*:secret:${props.integrationSecretsPrefix}/*`,
          ],
        }),
      );

      // Cognito: only what the demo sign-in needs, scoped to this one pool.
      // AdminInitiateAuth is how POST /api/demo/login exchanges the stored demo
      // password for real Cognito tokens. Notably absent: AdminCreateUser and
      // AdminSetUserPassword — the task must not be able to mint pool users. That
      // is scripts/seed-demo-user.sh's job, run once at deploy time by an
      // operator identity, so no long-lived role holds pool-admin rights.
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminInitiateAuth'],
          resources: [props.userPoolArn],
        }),
      );
    };

    grantSharedAccess(taskRole);
    grantSharedAccess(proxyTaskRole);

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            resource: 'guardrail',
            resourceName: props.guardrailId,
          }),
        ],
      }),
    );

    // Scoped to foundation models and inference profiles rather than '*'.
    // config.bedrockModelId is a cross-region inference profile, which resolves
    // to foundation models in several regions at invoke time, so both resource
    // types are required and the region segment is left open.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          cdk.Stack.of(this).formatArn({
            service: 'bedrock',
            region: '*',
            resource: 'inference-profile',
            resourceName: config.bedrockModelId,
          }),
        ],
      }),
    );

    // --- Engine-B-only permissions ---
    //
    // Deliberately absent: bedrock:InvokeModel. The proxy never calls the model
    // itself — the Runtime does, under its own role in AgentCoreStack. If a
    // future change makes the proxy fall back to direct Bedrock on a Runtime
    // error, that fallback should fail loudly with AccessDenied rather than
    // silently serve engine-A answers on engine-B's route and corrupt every
    // number the comparison produces.
    proxyTaskRole.addToPolicy(
      new iam.PolicyStatement({
        /*
         * Both actions, not just the first.
         *
         * The proxy sends `X-Amzn-Bedrock-AgentCore-Runtime-User-Id` on every
         * invoke (see `runtimeUserId` in agent/agentcore-adapter.ts), which is
         * what keeps one demo visitor's Memory partition separate from the next.
         * Supplying that header makes AgentCore authorize the call against
         * `InvokeAgentRuntimeForUser` *as well as* `InvokeAgentRuntime`, and it
         * refuses the request naming both when either is missing. With only the
         * first, every engine-B turn died with AccessDenied and the UI served its
         * "having a little trouble" fallback — engine B looked broken rather than
         * unauthorized.
         */
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeForUser',
        ],
        resources: [
          props.agentCoreRuntimeArn,
          // Runtime *endpoints* are children of the runtime ARN and are what an
          // InvokeAgentRuntime call is actually authorized against when a
          // qualifier is supplied — including the DEFAULT endpoint.
          `${props.agentCoreRuntimeArn}/*`,
        ],
      }),
    );

    // Memory data plane. The proxy writes each turn as an event and reads the
    // extracted records back, so the profile drawer can show what AgentCore
    // inferred alongside what the hand-rolled extractor found.
    proxyTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:CreateEvent',
          'bedrock-agentcore:ListEvents',
          'bedrock-agentcore:GetEvent',
          'bedrock-agentcore:RetrieveMemoryRecords',
          'bedrock-agentcore:ListMemoryRecords',
          'bedrock-agentcore:GetMemoryRecord',
        ],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'bedrock-agentcore',
            resource: 'memory',
            resourceName: props.agentCoreMemoryId,
          }),
          cdk.Stack.of(this).formatArn({
            service: 'bedrock-agentcore',
            resource: 'memory',
            resourceName: `${props.agentCoreMemoryId}/*`,
          }),
        ],
      }),
    );

    // --- Task Definition ---
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      taskRole,
      family: `valentin-task-${env}`,
    });

    // Declared explicitly so retention is bounded. The implicit group the
    // awslogs driver creates has retention 'Never expire'.
    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      logGroupName: `/valentin/${env}/service`,
      retention: config.logRetention,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Writable tmpfs so a read-only root filesystem cannot break anything that
    // expects /tmp to exist. The server itself writes nothing to disk.
    taskDefinition.addVolume({ name: 'tmp' });

    /**
     * Google OAuth credentials for the Gmail-send and Calendar-write tools.
     *
     * Created empty on purpose. `generateSecretString` only runs at *create*
     * time, so a later `put-secret-value` with the real credentials survives
     * every subsequent `cdk deploy` — the template's SecretString never changes,
     * so CloudFormation never touches the value again. Nothing secret is ever in
     * this repo or in the synthesised template.
     *
     * The refresh token is the one that matters: it grants send-mail-as and
     * calendar-write on a real personal Google account, and it does not expire.
     * Hence RETAIN, and hence `auto-delete=no` — the Isengard janitor deletes
     * untagged resources regardless of CloudFormation retain policies.
     *
     * `GOOGLE_REFRESH_TOKEN` is the generated key rather than a third empty
     * template field because Secrets Manager requires exactly one generated
     * key. Its initial random value is meaningless and is overwritten by the
     * real token; until then Google rejects it and `integrationReadiness()`
     * reports Gmail and Calendar as not connected, which is the truth.
     *
     * If `config.adoptedSecretArns.googleOAuth` is set the secret already exists
     * and is adopted instead — see that field's comment. Adoption emits no
     * resource, so none of the create-time reasoning below applies to it; the
     * value in the account is whatever was last put there and is left alone.
     */
    const adopted = config.adoptedSecretArns;
    const googleSecret: secretsmanager.ISecret = adopted?.googleOAuth
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'GoogleOAuthSecret',
          adopted.googleOAuth,
        )
      : new secretsmanager.Secret(this, 'GoogleOAuthSecret', {
          secretName: `valentin/${env}/google-oauth`,
          description:
            'Google OAuth client id/secret and refresh token for the Gmail-send and ' +
            'Calendar-write tools. Populate with `aws secretsmanager put-secret-value`.',
          generateSecretString: {
            secretStringTemplate: JSON.stringify({
              GOOGLE_CLIENT_ID: '',
              GOOGLE_CLIENT_SECRET: '',
            }),
            generateStringKey: 'GOOGLE_REFRESH_TOKEN',
          },
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
    // Tagging an adopted secret would be a silent no-op — it is not this stack's
    // resource — and the existing one already carries `auto-delete=no`.
    if (!adopted?.googleOAuth) cdk.Tags.of(googleSecret).add('auto-delete', 'no');

    /**
     * Spotify credentials for `find_music` and `propose_playlist`.
     *
     * A separate secret from Google's, not three more keys in it: the two
     * providers are rotated, revoked and re-consented independently, and a
     * `put-secret-value` is a whole-document write — so sharing one secret means
     * repopulating Google's refresh token every time Spotify's changes.
     *
     * **The id and secret alone are load-bearing.** Track search and playlist
     * assembly use the client-credentials grant, which needs no user consent, so
     * id+secret are enough to make the music row work deployed.
     * `SPOTIFY_REFRESH_TOKEN` is needed only to write a playlist into a real
     * library; without it `propose_playlist` confirms into a links handoff, which
     * is a correct and honest outcome rather than a failure. So a half-populated
     * secret is a legitimate steady state here, unlike Google's all-or-nothing.
     *
     * ## Why the generated key is a throwaway
     *
     * Secrets Manager requires exactly one generated key, and the obvious choice
     * would be `SPOTIFY_REFRESH_TOKEN`. That would be wrong. Readiness is
     * `Boolean(config.integrations.spotifyRefreshToken)` — a *present* value, not
     * a valid one — and `outcome()` in `spotify/tools.ts` reads the same field to
     * decide between saving a playlist and handing over links. A random generated
     * token is present, so the app would advertise a connected Spotify account,
     * promise on the confirmation card that confirming saves to it, and only then
     * fail against the real API. Seeding the token as an empty string instead
     * makes the untouched state read as `links`, which is the truth.
     *
     * So the generated key is a field nothing consumes, and all three real keys
     * start empty in the template. Note this shape only ever applies at *create*
     * time — and editing `generateSecretString` on a live secret is not a no-op,
     * CloudFormation regenerates the value and would clobber real credentials.
     */
    /*
     * Adopted on dev, for the same reason Google's is. An earlier note here said
     * this secret was "not adoptable" because it had never been created — that was
     * true when it was written and is not true now.
     *
     * How it orphaned is worth stating precisely, because the obvious guess is
     * wrong: no deploy failed. This secret reached `CREATE_COMPLETE`, its deploy
     * finished `UPDATE_COMPLETE`, and then a second successful deploy ran from a
     * branch that did not yet contain the commit adding it. The resource was absent
     * from that template, so CloudFormation moved to delete it during
     * `UPDATE_COMPLETE_CLEANUP_IN_PROGRESS`, and RETAIN turned that into
     * `DELETE_SKIPPED` — leaving the secret in the account and out of the stack.
     * Every later update then failed `AlreadyExists` on a name that is taken.
     *
     * So the thing to avoid is not a failed deploy. It is deploying a stack from a
     * branch that is behind on any RETAIN'd resource in it.
     *
     * The stale reasoning was still sound in one respect: an environment that has
     * never deployed this must go through a normal create, because a complete ARN
     * for a secret that does not exist fails in the opposite direction. Hence the
     * per-environment branch rather than adopting unconditionally.
     */
    const spotifySecret: secretsmanager.ISecret = adopted?.spotifyOAuth
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'SpotifyOAuthSecret',
          adopted.spotifyOAuth,
        )
      : new secretsmanager.Secret(this, 'SpotifyOAuthSecret', {
          secretName: `valentin/${env}/spotify-oauth`,
          description:
            'Spotify client id/secret for track search, plus an optional refresh token ' +
            'for writing playlists. Populate with `aws secretsmanager put-secret-value`.',
          generateSecretString: {
            secretStringTemplate: JSON.stringify({
              SPOTIFY_CLIENT_ID: '',
              SPOTIFY_CLIENT_SECRET: '',
              SPOTIFY_REFRESH_TOKEN: '',
            }),
            generateStringKey: 'UNUSED_PLACEHOLDER',
          },
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
    if (!adopted?.spotifyOAuth) cdk.Tags.of(spotifySecret).add('auto-delete', 'no');

    /**
     * The key share links are signed with.
     *
     * `sharing/share-token.ts` falls back to a per-process random key when this is
     * unset, which is the safe direction — an unset secret makes links *break*
     * rather than makes them *forgeable* — but it also means every share link dies
     * at the next task replacement, and a link advertised as good for seven days
     * that stops working at the next deploy is worse than no link at all.
     *
     * Generated by CloudFormation rather than templated-and-populated like
     * `googleSecret`: there is no external system to get this value from, so nobody
     * ever has to type it in, and a generated secret always exists — which is what
     * makes it safe to inject with no JSON field below.
     *
     * RETAIN and `auto-delete=no` for a sharper reason than the Google secret's:
     * replacing this secret silently invalidates every share link already in
     * somebody's inbox. The janitor deletes untagged resources regardless of
     * CloudFormation retain policies.
     *
     * Adopted on dev for the same reason Google's is: a rolled-back deploy left it
     * in Secrets Manager but out of the stack's resource set.
     */
    const shareSecret: secretsmanager.ISecret = adopted?.shareToken
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'ShareTokenSecret',
          adopted.shareToken,
        )
      : new secretsmanager.Secret(this, 'ShareTokenSecret', {
          secretName: `valentin/${env}/share-token`,
          description:
            'HMAC key for the signed share links that let a guest read one conversation. ' +
            'Generated; never populated by hand. Replacing it invalidates every live link.',
          generateSecretString: {
            passwordLength: 64,
            // Not for a human to read or retype — but a plain alphanumeric key cannot
            // be mangled by anything that quotes an environment variable badly.
            excludePunctuation: true,
          },
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
    if (!adopted?.shareToken) cdk.Tags.of(shareSecret).add('auto-delete', 'no');

    /**
     * Injected by the ECS agent at task start, so the values reach the process
     * as ordinary environment variables and never appear in the task definition,
     * the console, or `describe-tasks` output.
     *
     * This — not the integrations panel — is how the deployed app gets its
     * credentials. The panel's connect flow writes `.env`, and both containers run
     * `readonlyRootFilesystem: true`, so that path cannot persist anything here.
     *
     * Every key named here must *exist* in its secret document, empty or not: ECS
     * resolves each one individually and a task whose secret is missing a key dies
     * at launch with `ResourceInitializationError`, indistinguishable from a
     * missing IAM grant. That is why the populate step writes all three keys of
     * each secret and uses `""` for absent optional values rather than omitting
     * them.
     */

    const sharedSecrets: Record<string, ecs.Secret> = {
      GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(googleSecret, 'GOOGLE_CLIENT_ID'),
      GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(googleSecret, 'GOOGLE_CLIENT_SECRET'),
      GOOGLE_REFRESH_TOKEN: ecs.Secret.fromSecretsManager(googleSecret, 'GOOGLE_REFRESH_TOKEN'),
      // No JSON field: the whole secret value *is* the key. A missing JSON key
      // fails task startup, and this secret is generated, so there is none to miss.
      SHARE_TOKEN_SECRET: ecs.Secret.fromSecretsManager(shareSecret),
      SPOTIFY_CLIENT_ID: ecs.Secret.fromSecretsManager(spotifySecret, 'SPOTIFY_CLIENT_ID'),
      SPOTIFY_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
        spotifySecret,
        'SPOTIFY_CLIENT_SECRET',
      ),
      SPOTIFY_REFRESH_TOKEN: ecs.Secret.fromSecretsManager(
        spotifySecret,
        'SPOTIFY_REFRESH_TOKEN',
      ),
    };

    /**
     * Origin the Google OAuth callback URL is built from — see
     * `redirectUri()` in src/server/integrations/google/oauth.ts, which
     * otherwise defaults to `http://localhost:5173` and would send a deployed
     * user to their own machine.
     *
     * Derived from the Cognito callback list rather than restated, so the origin
     * Google redirects to and the origin Cognito redirects to cannot drift
     * apart. localhost is filtered out because it is only ever an *additional*
     * dev origin, never the one a deployed task should advertise.
     */
    const publicOrigin = (
      config.appUrls.callback.find((url) => !url.includes('localhost')) ??
      config.appUrls.callback[0]
    ).replace(/\/$/, '');

    /**
     * Environment shared verbatim by both engines. Anything engine-specific goes
     * in the per-container spread below, so a reader can see at a glance that the
     * two services differ by exactly four variables and nothing else.
     */
    const sharedEnvironment: Record<string, string> = {
      PUBLIC_ORIGIN: publicOrigin,
      DYNAMO_TABLE_NAME: props.table.tableName,
      // Opt in to durable storage. Without this the server falls back to
      // InMemoryStore and the deployed app silently forgets everything on
      // every task replacement.
      STORAGE_BACKEND: 'dynamodb',
      S3_PHOTO_BUCKET: props.photoBucket.bucketName,
      BEDROCK_GUARDRAIL_ID: props.guardrailId,
      BEDROCK_GUARDRAIL_VERSION: props.guardrailVersion,
      BEDROCK_MODEL_ID: config.bedrockModelId,
      AWS_REGION: cdk.Stack.of(this).region,
      NODE_ENV: 'production',
      // Auth. The server treats missing Cognito config as a hard boot failure
      // in production — see src/server/auth/jwt-verifier.ts.
      COGNITO_USER_POOL_ID: props.userPoolId,
      COGNITO_SPA_CLIENT_ID: props.spaClientId,
      COGNITO_DEMO_CLIENT_ID: props.demoClientId,
      DEMO_SECRET_ARN: props.demoSecret.secretArn,
      /*
       * Switches `credential-store.ts` on. Unset — as it is locally and in
       * `npm test` — the whole remote-credential path is a no-op and `.env` is the
       * only source, which is what keeps a clone with no AWS account working.
       *
       * Set on *both* engines, not just engine B: the panel that writes these
       * secrets is served by whichever task the visitor is talking to.
       */
      INTEGRATION_SECRETS_PREFIX: props.integrationSecretsPrefix,
      COGNITO_DOMAIN: `https://${props.cognitoDomainPrefix}.auth.${cdk.Stack.of(this).region}.amazoncognito.com`,
    };

    /** Container-level health check, identical for both services. */
    const containerHealthCheck: ecs.HealthCheck = {
      command: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/health || exit 1'],
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      retries: 3,
      startPeriod: cdk.Duration.seconds(60),
    };

    const container = taskDefinition.addContainer('Backend', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, props.imageTag),
      containerName: 'valentin-backend',
      readonlyRootFilesystem: true,
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      environment: {
        ...sharedEnvironment,
        // Engine A. Named explicitly rather than left to the code's default, so
        // that flipping the default in src/ cannot silently change what the
        // baseline service runs.
        AGENT_ENGINE: 'valentin',
      },
      secrets: sharedSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `valentin-${env}`,
        logGroup,
      }),
      healthCheck: containerHealthCheck,
    });

    container.addMountPoints({
      sourceVolume: 'tmp',
      containerPath: '/tmp',
      readOnly: false,
    });

    // --- Engine-B Task Definition (same image, AGENT_ENGINE=agentcore) ---
    const proxyTaskDefinition = new ecs.FargateTaskDefinition(this, 'ProxyTaskDef', {
      // Same size on purpose: a proxy on a smaller task would show up as worse
      // latency and be misread as an AgentCore result.
      memoryLimitMiB: config.memoryLimitMiB,
      cpu: config.cpu,
      taskRole: proxyTaskRole,
      family: `valentin-ac-task-${env}`,
    });

    // A separate log group, not a separate stream prefix in the shared one.
    // Per-engine telemetry is the deliverable here, and a Logs Insights query
    // scoped by log group is both cheaper and impossible to get wrong.
    const proxyLogGroup = new logs.LogGroup(this, 'ProxyLogGroup', {
      logGroupName: `/valentin/${env}/agentcore`,
      retention: config.logRetention,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    proxyTaskDefinition.addVolume({ name: 'tmp' });

    const proxyContainer = proxyTaskDefinition.addContainer('Backend', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, props.imageTag),
      containerName: 'valentin-backend',
      readonlyRootFilesystem: true,
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      environment: {
        ...sharedEnvironment,
        AGENT_ENGINE: 'agentcore',
        AGENTCORE_RUNTIME_ARN: props.agentCoreRuntimeArn,
        AGENTCORE_MEMORY_ID: props.agentCoreMemoryId,
        AGENTCORE_GATEWAY_URL: props.agentCoreGatewayUrl,
      },
      secrets: sharedSecrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `valentin-ac-${env}`,
        logGroup: proxyLogGroup,
      }),
      healthCheck: containerHealthCheck,
    });

    proxyContainer.addMountPoints({
      sourceVolume: 'tmp',
      containerPath: '/tmp',
      readOnly: false,
    });

    // --- Application Load Balancer ---
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `valentin-alb-${env}`,
      // Long idle timeout is deliberate: the /ws behaviour carries WebSocket
      // connections that stay open between messages.
      idleTimeout: cdk.Duration.seconds(3600),
      deletionProtection: config.deletionProtection,
    });

    this.loadBalancer.setAttribute(
      'routing.http.drop_invalid_header_fields.enabled',
      'true',
    );
    this.loadBalancer.logAccessLogs(props.accessLogBucket, `alb/${env}`);

    // --- Target Group ---
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
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
      // The ALB default is 300s, and `ecs wait services-stable` does not return
      // until the old target has finished draining -- so the default made every
      // deploy and every rollback drain-bound at 5+ minutes. The only
      // long-lived connections here are `/ws` WebSockets, which the client
      // reconnects on its own, so 30s is ample.
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // --- Engine-B Target Group ---
    // Every setting matches the group above. Stickiness in particular is not
    // optional: both engines keep per-connection WebSocket state, so a session
    // that lands on a different task mid-conversation loses its stream.
    this.proxyTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ProxyTargetGroup', {
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
      targetGroupName: `valentin-tg-ac-${env}`,
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // --- ALB Listener ---
    // HTTP only: TLS terminates at CloudFront, and the origin hop is
    // restricted to CloudFront by the security group above. Adding HTTPS here
    // requires a custom domain and an ACM certificate.
    // `open: false` is essential: the default (true) makes addListener append
    // its own 0.0.0.0/0 ingress rule to the security group, which would
    // silently defeat the CloudFront prefix-list restriction above.
    const listener = this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // Engine A stays the default action, so every existing path — the SPA's
      // /api/*, /ws, /api/health — keeps reaching the baseline service with no
      // rule needed and no behaviour change if the rules below are removed.
      defaultTargetGroups: [this.targetGroup],
      open: false,
    });

    // --- Engine routing ---
    //
    // Three rules, in priority order. The two path rules carry the explicit
    // engine-B endpoints; the header rule is what lets the compare harness send
    // the *same* request to both engines and change only the routing, which is
    // the only way a latency comparison is apples-to-apples.
    listener.addAction('AgentCoreApi', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/agentcore/*'])],
      action: elbv2.ListenerAction.forward([this.proxyTargetGroup]),
    });

    listener.addAction('AgentCoreWs', {
      // Exact path, not a prefix: src/server/http/attach-websocket.ts matches
      // request.url with === , so /ws/agentcore/anything would upgrade nowhere.
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/ws/agentcore'])],
      action: elbv2.ListenerAction.forward([this.proxyTargetGroup]),
    });

    listener.addAction('AgentCoreHeader', {
      priority: 30,
      conditions: [
        elbv2.ListenerCondition.httpHeader('X-Valentin-Engine', ['agentcore']),
      ],
      action: elbv2.ListenerAction.forward([this.proxyTargetGroup]),
    });

    // --- Fargate Service ---
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: config.desiredCount,
      securityGroups: [ecsSg],
      assignPublicIp: false,
      serviceName: `valentin-service-${env}`,
      circuitBreaker: { rollback: true },
      // 100/200 makes ECS start the replacement task before draining the old
      // one. The previous default of 50 floored to zero healthy tasks at
      // desiredCount 1, so a deploy could take the service fully offline.
      minHealthyPercent: config.minHealthyPercent,
      maxHealthyPercent: config.maxHealthyPercent,
    });

    this.service.attachToApplicationTargetGroup(this.targetGroup);

    // --- Engine-B Fargate Service ---
    this.proxyService = new ecs.FargateService(this, 'ProxyService', {
      cluster: this.cluster,
      taskDefinition: proxyTaskDefinition,
      desiredCount: config.desiredCount,
      // Same security group: it already allows 3001 from the ALB and nothing
      // else, which is exactly this service's ingress requirement too.
      securityGroups: [ecsSg],
      assignPublicIp: false,
      serviceName: `valentin-ac-proxy-${env}`,
      circuitBreaker: { rollback: true },
      minHealthyPercent: config.minHealthyPercent,
      maxHealthyPercent: config.maxHealthyPercent,
    });

    this.proxyService.attachToApplicationTargetGroup(this.proxyTargetGroup);

    // CloudFormation updates the execution role's DefaultPolicy and the ECS
    // service in parallel, because nothing in the template connects them. When a
    // new ECS secret is added, that race is lost by default: on 2026-09-03 the
    // service update began at 20:21:54 and the two policies only reached
    // UPDATE_COMPLETE at 20:22:05, so every task launched in those 11 seconds
    // failed with `ResourceInitializationError ... AccessDeniedException` on
    // secretsmanager:GetSecretValue. The circuit breaker counts those launches,
    // trips, and rolls the whole stack back — which reverts the grant too, so
    // the evidence disappears and the next attempt fails identically.
    //
    // Making each service depend on its own execution role forces the grant to
    // land first. This matters on every future secret addition, not just Google.
    forceExecutionRolePolicyFirst(this.service, taskDefinition);
    forceExecutionRolePolicyFirst(this.proxyService, proxyTaskDefinition);

    // --- Auto Scaling ---
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: 4,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Identical scaling policy, for the same reason the task size is identical:
    // if one engine could scale out and the other could not, a load test would
    // measure the scaling difference and report it as an engine difference.
    const proxyScaling = this.proxyService.autoScaleTaskCount({
      minCapacity: config.desiredCount,
      maxCapacity: 4,
    });

    proxyScaling.scaleOnCpuUtilization('ProxyCpuScaling', {
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

    // No exportName on the engine-B outputs. An export creates a cross-stack
    // lock that blocks any later change to the exporting resource while another
    // stack consumes it — the failure mode this repo already has a production
    // incident from. These are for `aws cloudformation describe-stacks` and for
    // deploy.sh to read, not for another stack to import.
    new cdk.CfnOutput(this, 'ProxyServiceName', {
      value: this.proxyService.serviceName,
      description: 'Engine-B (AgentCore) ECS service name',
    });

    new cdk.CfnOutput(this, 'ProxyLogGroupName', {
      value: proxyLogGroup.logGroupName,
      description: 'Engine-B log group — per-engine telemetry lives here',
    });
  }
}

/**
 * Make an ECS service wait for its task execution role's inline policy.
 *
 * CDK grants `secretsmanager:GetSecretValue` on the execution role when a task
 * definition references an ECS secret, but it adds no dependency between that
 * policy and the service that launches the tasks. CloudFormation therefore
 * updates them concurrently, and a task that starts before the grant exists dies
 * with `ResourceInitializationError ... AccessDeniedException`.
 *
 * The grant lives on the role's auto-generated `DefaultPolicy` child, so the
 * lookup is by that construct id. If a future CDK version renames it the
 * dependency would silently stop being added, so a missing child throws rather
 * than passing quietly.
 */
function forceExecutionRolePolicyFirst(
  service: ecs.FargateService,
  taskDefinition: ecs.FargateTaskDefinition,
): void {
  const executionRole = taskDefinition.executionRole;
  if (!executionRole) return;

  const defaultPolicy = executionRole.node.tryFindChild('DefaultPolicy');
  if (!defaultPolicy) {
    throw new Error(
      'Execution role has no DefaultPolicy child — the CDK construct id changed, ' +
        'so the secret grant is no longer ordered before the ECS service. ' +
        'See forceExecutionRolePolicyFirst in compute-stack.ts.',
    );
  }

  service.node.addDependency(defaultPolicy);
}
