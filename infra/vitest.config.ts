import { defineConfig } from 'vitest/config';

/**
 * The CDK regression suite runs from `infra/`, not from the root runner.
 *
 * `aws-cdk-lib` is a dependency of infra/package.json, and CI installs only the
 * root manifest — so collecting these tests from the root config fails to load
 * with ERR_MODULE_NOT_FOUND however green it looks on a laptop that happens to
 * have infra/node_modules lying around.
 *
 * Node environment, not jsdom: these assert on synthesised CloudFormation, and
 * the root setup file reaches for browser globals that do not exist here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
