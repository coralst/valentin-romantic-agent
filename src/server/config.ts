export const config = {
  dynamoTableName: process.env.DYNAMO_TABLE_NAME ?? 'ValentinTable-dev',
  s3PhotoBucket: process.env.S3_PHOTO_BUCKET ?? 'valentin-photos-dev',
  bedrockGuardrailId: process.env.BEDROCK_GUARDRAIL_ID,
  bedrockGuardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION ?? 'DRAFT',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
};
