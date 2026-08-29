export const config = {
  dynamoTableName: process.env.DYNAMO_TABLE_NAME ?? 'ValentinTable-dev',
  s3PhotoBucket: process.env.S3_PHOTO_BUCKET ?? 'valentin-photos-dev',
  bedrockGuardrailId: process.env.BEDROCK_GUARDRAIL_ID,
  bedrockGuardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),

  /**
   * Cognito wiring, all supplied by compute-stack.ts.
   *
   * Deliberately optional: with `userPoolId` unset the server falls back to the
   * dev-bypass verifier, which is what keeps `npm test`, Playwright and a bare
   * `npm run dev:server` working without an AWS account. In production the same
   * absence is a hard boot failure — see auth/token-verifier.ts.
   */
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    /** The public SPA client: PKCE only, no password flow. */
    spaClientId: process.env.COGNITO_SPA_CLIENT_ID,
    /** The server-only client behind POST /api/demo/login. */
    demoClientId: process.env.COGNITO_DEMO_CLIENT_ID,
    demoSecretArn: process.env.DEMO_SECRET_ARN,
    /**
     * Hosted UI origin, e.g. `https://valentin-dev.auth.us-east-1.amazoncognito.com`.
     *
     * Handed to the browser by `GET /api/config` rather than baked into the
     * bundle at build time, so the SPA needs no AWS configuration of its own.
     */
    domain: process.env.COGNITO_DOMAIN,
  },

  /**
   * Credentials for the outside world.
   *
   * Every field is optional, and that is the contract: `buildToolRegistry` only
   * registers a tool whose credentials are actually present, so the server boots
   * and the conversation works with none of these set. An integration that is
   * not configured is absent from the model's tool list rather than present and
   * failing, which is the difference between "Valentin cannot book tables yet"
   * and "Valentin tried to book a table and broke".
   *
   * Hebcal needs nothing — it is a local calculation, so it is always available.
   */
  integrations: {
    /**
     * Amadeus Self-Service. `host` stays on the test sandbox unless someone
     * deliberately points it at production, because the booking endpoints spend
     * real money.
     */
    amadeusClientId: process.env.AMADEUS_CLIENT_ID,
    amadeusClientSecret: process.env.AMADEUS_CLIENT_SECRET,
    amadeusHost: process.env.AMADEUS_HOST ?? 'test.api.amadeus.com',

    /**
     * One Google account, hardcoded — this build has no per-user OAuth, so
     * Calendar and Gmail act as the account whose refresh token is set here.
     */
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,

    /** WhatsApp Cloud API, via the Graph endpoint for one phone number id. */
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    whatsappToken: process.env.WHATSAPP_TOKEN,
  },

  /**
   * Engine B's managed half, all supplied by compute-stack.ts to the proxy
   * service only.
   *
   * Deliberately optional, for the same reason the Cognito block is: with these
   * unset the server runs engine A and nothing here is read, which is what keeps
   * `npm test` and a bare `npm run dev:server` working without an AWS account.
   * The engine selector treats a missing `runtimeArn` as "engine B is not
   * available here" rather than as a boot failure — see agent/engine.ts.
   */
  agentCore: {
    runtimeArn: process.env.AGENTCORE_RUNTIME_ARN,
    memoryId: process.env.AGENTCORE_MEMORY_ID,
    gatewayUrl: process.env.AGENTCORE_GATEWAY_URL,
  },
};
