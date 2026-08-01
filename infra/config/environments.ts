export interface EnvironmentConfig {
  env: string;
  region: string;
  account?: string;
  tableName: string;
  photoBucketName: string;
  frontendBucketName: string;
  guardrailName: string;
}

const configs: Record<string, EnvironmentConfig> = {
  dev: {
    env: 'dev',
    region: 'us-east-1',
    tableName: 'ValentinTable-dev',
    photoBucketName: 'valentin-photos-dev',
    frontendBucketName: 'valentin-frontend-dev',
    guardrailName: 'valentin-safety-dev',
  },
  staging: {
    env: 'staging',
    region: 'us-east-1',
    tableName: 'ValentinTable-staging',
    photoBucketName: 'valentin-photos-staging',
    frontendBucketName: 'valentin-frontend-staging',
    guardrailName: 'valentin-safety-staging',
  },
  prod: {
    env: 'prod',
    region: 'us-east-1',
    tableName: 'ValentinTable-prod',
    photoBucketName: 'valentin-photos-prod',
    frontendBucketName: 'valentin-frontend-prod',
    guardrailName: 'valentin-safety-prod',
  },
};

export function getConfig(env: string): EnvironmentConfig {
  const config = configs[env];
  if (!config) {
    throw new Error(`Unknown environment: ${env}. Valid: ${Object.keys(configs).join(', ')}`);
  }
  return config;
}
