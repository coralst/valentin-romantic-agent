#!/usr/bin/env bash
#
# Ship a frontend-only change to production. ~45 seconds.
#
# Usage: ./scripts/ship-frontend.sh [env]   (env: dev, default dev)
#
# deploy.sh does the whole world: Docker build, ECR push, seven CDK stacks, an
# ECS rolling deploy, the demo-user seed, then the frontend. That is ~7 minutes
# at best and most of it is irrelevant to a change under src/client -- the
# bundle is static files in S3 behind CloudFront, and nothing about it involves
# the container.
#
# So this does exactly the three steps that matter and nothing else. Use it for
# anything in src/client or public. For a change under src/server you need
# ship-backend.sh, because that code runs in the ECS task.
#
# The Cognito ids are read out of the Auth stack rather than an .env file: this
# is what keeps a bundle from shipping pointed at the wrong user pool, and it is
# the one piece of deploy.sh's frontend step that is load-bearing.
set -euo pipefail

ENV="${1:-dev}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"
REGION="${AWS_REGION:-us-east-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

started=$(date +%s)
cd "$ROOT"

auth_output() {
  aws cloudformation describe-stacks \
    --stack-name "Valentin-Auth-${ENV}" \
    --profile "$PROFILE" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "--- [1/3] Building bundle..."
VITE_COGNITO_DOMAIN="https://$(auth_output UserPoolDomain).auth.${REGION}.amazoncognito.com" \
VITE_COGNITO_CLIENT_ID="$(auth_output UserPoolClientId)" \
  npx vite build

echo "--- [2/3] Syncing to s3://valentin-static-${ENV}/ ..."
aws s3 sync dist/ "s3://valentin-static-${ENV}/" --delete \
  --profile "$PROFILE" --region "$REGION" --only-show-errors

echo "--- [3/3] Invalidating CloudFront..."
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name "Valentin-CDN-${ENV}" \
  --profile "$PROFILE" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' \
  --profile "$PROFILE" --region "$REGION" \
  --query 'Invalidation.Id' --output text

echo ""
echo "=== Shipped in $(( $(date +%s) - started ))s"
echo "    Invalidation is eventually consistent; hard-reload if you see the old bundle."
