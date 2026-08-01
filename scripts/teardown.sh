#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-dev}"

echo "=== Tearing down Valentin ${ENV} environment ==="
echo ""
echo "WARNING: This will destroy all infrastructure for the '${ENV}' environment."
echo "Data in DynamoDB and S3 will be preserved (RETAIN policy)."
echo ""
read -p "Are you sure? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

cd infra

echo "[1/3] Destroying CDN stack..."
npx cdk destroy "ValentinCdn-${ENV}" --context env="${ENV}" --force

echo "[2/3] Destroying Auth stack..."
npx cdk destroy "ValentinAuth-${ENV}" --context env="${ENV}" --force

echo "[3/3] Destroying Compute stack..."
npx cdk destroy "ValentinCompute-${ENV}" --context env="${ENV}" --force

echo "=== Teardown of ${ENV} complete ==="
echo ""
echo "Note: ECR repository, S3 bucket, and User Pool were retained."
echo "Delete them manually if no longer needed."
