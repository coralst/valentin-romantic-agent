#!/usr/bin/env bash
set -euo pipefail

# One-click deploy: build, push, and launch Valentin on AWS
# Usage: ./scripts/deploy.sh [env]
# env: dev (default), staging, prod

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"
ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/valentin-backend-${ENV}"

echo "=== Deploying Valentin (env=$ENV, region=$REGION, account=$ACCOUNT) ==="

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod."
  exit 1
fi

# --- 1. Build & push Docker image ---
echo ""
echo "--- [1/4] Building Docker image..."
docker build --platform linux/amd64 -t "$ECR_URI:latest" .

echo "--- [2/4] Pushing to ECR..."
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
docker push "$ECR_URI:latest"

# --- 2. Deploy CDK stacks ---
echo ""
echo "--- [3/4] Deploying infrastructure..."
cd "$(dirname "$0")/../infra"
AWS_PROFILE="$PROFILE" npx cdk bootstrap --context env="$ENV" 2>&1 | tail -3
AWS_PROFILE="$PROFILE" npx cdk deploy --all \
  --context env="$ENV" \
  --require-approval never \
  --outputs-file "cdk-outputs-${ENV}.json"

# --- 3. Build & deploy frontend ---
echo ""
echo "--- [4/4] Deploying frontend..."
cd "$(dirname "$0")/.."
npx vite build
aws s3 sync dist/ "s3://valentin-static-${ENV}/" --delete --profile "$PROFILE" --region "$REGION"

# Invalidate CDN cache
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "Valentin-CDN-${ENV}" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' --output text 2>/dev/null || true)
if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
    --profile "$PROFILE" --region "$REGION" > /dev/null
fi

# --- Done ---
echo ""
echo "==========================================="
echo "  DEPLOYMENT COMPLETE"
echo "==========================================="
CDN_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name "Valentin-CDN-${ENV}" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionDomain`].OutputValue' --output text 2>/dev/null || true)

echo ""
echo "  Website: https://${CDN_DOMAIN}"
echo "  API:     https://${CDN_DOMAIN}/api/health"
echo ""
