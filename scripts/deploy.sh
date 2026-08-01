#!/usr/bin/env bash
set -euo pipefail

# Deploy Valentin infrastructure using CDK
# Usage: ./scripts/deploy.sh [env]
# env: dev (default), staging, prod

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"

echo "=== Deploying Valentin infrastructure (env=$ENV, region=$REGION) ==="

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod."
  exit 1
fi

# Check prerequisites
if ! command -v npx &> /dev/null; then
  echo "ERROR: npx not found. Install Node.js first."
  exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
  echo "ERROR: AWS credentials not configured. Run 'aws configure' or set AWS_PROFILE."
  exit 1
fi

# Bootstrap CDK (idempotent — safe to run multiple times)
echo "--- Bootstrapping CDK..."
cd "$(dirname "$0")/../infra"
npx cdk bootstrap --context env="$ENV" 2>&1 | tail -5

# Synthesize to validate
echo "--- Synthesizing stacks..."
npx cdk synth --context env="$ENV" --quiet

# Deploy all stacks
echo "--- Deploying stacks..."
npx cdk deploy --all \
  --context env="$ENV" \
  --require-approval never \
  --outputs-file "cdk-outputs-${ENV}.json"

echo ""
echo "=== Deployment complete (env=$ENV) ==="
echo "Outputs written to: infra/cdk-outputs-${ENV}.json"
