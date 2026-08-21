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
  },
};
