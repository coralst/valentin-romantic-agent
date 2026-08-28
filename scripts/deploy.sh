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
# Engine B's agent is a second, ARM64 image in its own repository. Separate
# because it shares nothing with the backend: different language, different base
# image, different architecture.
AGENT_REPO="valentin-agentcore-${ENV}"
AGENT_ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${AGENT_REPO}"

# Immutable, content-addressed image tag. Using :latest made the ECS circuit
# breaker's rollback a no-op, because the "previous" task definition pointed at
# the same mutable tag that had just failed.
IMAGE_TAG="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  IMAGE_TAG="${IMAGE_TAG}-dirty"
fi

echo "=== Deploying Valentin (env=$ENV, region=$REGION, account=$ACCOUNT, tag=$IMAGE_TAG) ==="

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- 1. Build & push Docker images ---
echo ""
echo "--- [1/5] Building Docker images..."
docker build --platform linux/amd64 -t "$ECR_URI:${IMAGE_TAG}" "$REPO_ROOT"

# ARM64 on purpose. AgentCore Runtime is arm64-only and accepts an amd64 image at
# deploy time, then fails at cold start with an exec format error that surfaces as
# an invoke timeout — so the platform is pinned here rather than inherited.
docker build --platform linux/arm64 \
  -t "$AGENT_ECR_URI:${IMAGE_TAG}" "$REPO_ROOT/agentcore"

echo "--- [2/5] Pushing to ECR..."
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
docker push "$ECR_URI:${IMAGE_TAG}"

# The AgentCore stack imports this repository by name rather than creating it, so
# a first deploy into a fresh account would otherwise fail at push with a
# RepositoryNotFoundException after the images are already built. Idempotent.
aws ecr describe-repositories --repository-names "$AGENT_REPO" \
  --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$AGENT_REPO" \
       --image-scanning-configuration scanOnPush=true \
       --image-tag-mutability IMMUTABLE \
       --profile "$PROFILE" --region "$REGION" > /dev/null
docker push "$AGENT_ECR_URI:${IMAGE_TAG}"

# --- 2. Deploy CDK stacks ---
# Named stacks with --exclusively rather than `--all`. `--all` would also deploy
# whatever other branches have changed in their own stacks, so two people
# deploying from different branches stomp each other. Order matters: Auth before
# Compute, because Compute imports the pool id and client ids.
echo ""
echo "--- [3/5] Deploying infrastructure..."
cd "$REPO_ROOT/infra"
AWS_PROFILE="$PROFILE" npx cdk bootstrap --context env="$ENV" 2>&1 | tail -3

# AgentCore before Compute: the proxy service names the Runtime ARN, the Memory
# id and the Gateway URL in its container environment, and none of the three
# exists until AgentCore is deployed. See the note in infra/bin/app.ts.
for STACK in Network Data Safety Auth AgentCore Compute CDN Monitoring; do
  echo "    -> Valentin-${STACK}-${ENV}"
  AWS_PROFILE="$PROFILE" npx cdk deploy "Valentin-${STACK}-${ENV}" \
    --exclusively \
    --context env="$ENV" \
    --context imageTag="$IMAGE_TAG" \
    --context agentImageTag="$IMAGE_TAG" \
    --require-approval never \
    --outputs-file "cdk-outputs-${ENV}.json" \
    --progress events 2>&1 | tail -5
done

# --- 3. Seed the shared demo account ---
# Runs here, not by hand: the one-click demo button is broken until the pool user
# exists, and "remember to run a script" is exactly the step people forget.
echo ""
echo "--- [4/5] Seeding demo account..."
AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" bash "$REPO_ROOT/scripts/seed-demo-user.sh" "$ENV"

# --- 4. Build & deploy frontend ---
# Cognito ids are read straight out of the stack, so there is no .env to keep in
# sync and no chance of shipping a bundle pointed at the wrong user pool.
echo ""
echo "--- [5/5] Deploying frontend..."
cd "$REPO_ROOT"

auth_output() {
  aws cloudformation describe-stacks \
    --stack-name "Valentin-Auth-${ENV}" \
    --profile "$PROFILE" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

VITE_COGNITO_DOMAIN="https://$(auth_output UserPoolDomain).auth.${REGION}.amazoncognito.com"
VITE_COGNITO_CLIENT_ID="$(auth_output UserPoolClientId)"

echo "    user pool client: ${VITE_COGNITO_CLIENT_ID}"

VITE_COGNITO_DOMAIN="$VITE_COGNITO_DOMAIN" \
VITE_COGNITO_CLIENT_ID="$VITE_COGNITO_CLIENT_ID" \
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
