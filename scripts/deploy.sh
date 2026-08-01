#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-dev}"

echo "=== Deploying Valentin to ${ENV} ==="

# Build frontend
echo "[1/5] Building frontend..."
npm run build

# Build server
echo "[2/5] Building server..."
npm run build:server

# Deploy CDK infrastructure
echo "[3/5] Deploying infrastructure..."
cd infra
npx cdk deploy --all --context env="${ENV}" --require-approval never
cd ..

# Build and push Docker image
echo "[4/5] Building and pushing Docker image..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="${AWS_REGION:-us-east-1}"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/valentin-backend-${ENV}"

aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build -t "${ECR_URI}:latest" .
docker push "${ECR_URI}:latest"

# Update ECS service
echo "[5/5] Updating ECS service..."
aws ecs update-service \
  --cluster "valentin-cluster-${ENV}" \
  --service "valentin-service-${ENV}" \
  --force-new-deployment \
  --region "${REGION}"

echo "=== Deployment to ${ENV} complete ==="
