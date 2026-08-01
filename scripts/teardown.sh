#!/usr/bin/env bash
set -euo pipefail

# Tear down Valentin infrastructure using CDK
# Usage: ./scripts/teardown.sh [env]
# env: dev (default), staging, prod

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"

echo "=== Tearing down Valentin infrastructure (env=$ENV, region=$REGION) ==="

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod."
  exit 1
fi

# Safety check for production
if [[ "$ENV" == "prod" ]]; then
  echo ""
  echo "WARNING: You are about to destroy PRODUCTION infrastructure!"
  echo "This will permanently delete all data including DynamoDB tables and S3 buckets."
  echo ""
  read -rp "Type 'destroy-production' to confirm: " confirm
  if [[ "$confirm" != "destroy-production" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "$(dirname "$0")/../infra"

# Destroy all stacks
echo "--- Destroying stacks..."
npx cdk destroy --all \
  --context env="$ENV" \
  --force

# Clean up outputs file
rm -f "cdk-outputs-${ENV}.json"

echo ""
echo "=== Teardown complete (env=$ENV) ==="
