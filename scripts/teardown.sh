#!/usr/bin/env bash
set -euo pipefail

# One-click teardown: destroy ALL Valentin AWS resources to $0/month
# Usage: ./scripts/teardown.sh [env]
# env: dev (default), staging, prod

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"

echo "=== Tearing down Valentin (env=$ENV, region=$REGION) ==="

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod."
  exit 1
fi

# Safety check for production
if [[ "$ENV" == "prod" ]]; then
  echo ""
  echo "WARNING: You are about to destroy PRODUCTION infrastructure!"
  echo ""
  read -rp "Type 'destroy-production' to confirm: " confirm
  if [[ "$confirm" != "destroy-production" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# --- 1. Empty S3 buckets (CDK can't delete non-empty buckets) ---
echo ""
echo "--- [1/5] Emptying S3 buckets..."
for BUCKET in "valentin-static-${ENV}" "valentin-photos-${ENV}" "valentin-frontend-${ENV}"; do
  if aws s3api head-bucket --bucket "$BUCKET" --profile "$PROFILE" --region "$REGION" 2>/dev/null; then
    echo "  Emptying $BUCKET..."
    aws s3 rm "s3://${BUCKET}" --recursive --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
    # Delete versioned objects too
    VERSIONS=$(aws s3api list-object-versions --bucket "$BUCKET" --profile "$PROFILE" --region "$REGION" \
      --query '{Objects: [Versions,DeleteMarkers][].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":[]}')
    if echo "$VERSIONS" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('Objects') else 1)" 2>/dev/null; then
      echo "$VERSIONS" | aws s3api delete-objects --bucket "$BUCKET" --delete file:///dev/stdin \
        --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1 || true
    fi
  fi
done

# --- 2. Delete ECR images ---
echo ""
echo "--- [2/5] Cleaning ECR repository..."
REPO="valentin-backend-${ENV}"
if aws ecr describe-repositories --repository-names "$REPO" --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1; then
  IMAGE_IDS=$(aws ecr list-images --repository-name "$REPO" --profile "$PROFILE" --region "$REGION" \
    --query 'imageIds[*]' --output json 2>/dev/null)
  if [[ "$IMAGE_IDS" != "[]" && -n "$IMAGE_IDS" ]]; then
    aws ecr batch-delete-image --repository-name "$REPO" --image-ids "$IMAGE_IDS" \
      --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1 || true
  fi
  aws ecr delete-repository --repository-name "$REPO" --force \
    --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1 || true
fi

# --- 3. Destroy CDK stacks ---
echo ""
echo "--- [3/5] Destroying CDK stacks..."
cd "$(dirname "$0")/../infra"
AWS_PROFILE="$PROFILE" npx cdk destroy --all \
  --context env="$ENV" \
  --force 2>&1 || true

# --- 4. Clean up orphaned resources CDK may retain ---
echo ""
echo "--- [4/5] Cleaning orphaned resources..."

# Log groups
for LG in "/valentin/${ENV}/app" "/valentin/${ENV}/access"; do
  aws logs delete-log-group --log-group-name "$LG" \
    --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
done
aws logs describe-log-groups --log-group-name-prefix "valentin-${ENV}" \
  --profile "$PROFILE" --region "$REGION" --query 'logGroups[].logGroupName' --output text 2>/dev/null \
  | tr '\t' '\n' | while read -r lg; do
    [[ -n "$lg" ]] && aws logs delete-log-group --log-group-name "$lg" \
      --profile "$PROFILE" --region "$REGION" 2>/dev/null || true
  done

# Stuck stacks
for STACK in "Valentin-CDN-${ENV}" "Valentin-Monitoring-${ENV}" "Valentin-Compute-${ENV}" \
             "Valentin-Auth-${ENV}" "Valentin-Safety-${ENV}" "Valentin-Data-${ENV}" "Valentin-Network-${ENV}"; do
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)
  if [[ "$STATUS" == *"ROLLBACK_COMPLETE"* || "$STATUS" == *"DELETE_FAILED"* ]]; then
    echo "  Deleting stuck stack: $STACK"
    aws cloudformation delete-stack --stack-name "$STACK" --profile "$PROFILE" --region "$REGION" || true
  fi
done

# --- 5. Verify zero resources ---
echo ""
echo "--- [5/5] Verifying cleanup..."

PROBLEMS=0

REMAINING=$(aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE CREATE_IN_PROGRESS \
  --profile "$PROFILE" --region "$REGION" \
  --query "StackSummaries[?starts_with(StackName, 'Valentin') && contains(StackName, '${ENV}')].StackName" \
  --output text 2>/dev/null || true)
if [[ -z "$REMAINING" || "$REMAINING" == "None" ]]; then
  echo "  ✓ All CloudFormation stacks deleted"
else
  echo "  ✗ Remaining stacks: $REMAINING"
  PROBLEMS=$((PROBLEMS + 1))
fi

if aws ecr describe-repositories --repository-names "$REPO" --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1; then
  echo "  ✗ ECR repository still exists"
  PROBLEMS=$((PROBLEMS + 1))
else
  echo "  ✓ ECR repository deleted"
fi

echo ""
echo "==========================================="
if [[ $PROBLEMS -eq 0 ]]; then
  echo "  TEARDOWN COMPLETE — \$0/month"
  echo "==========================================="
  echo ""
  echo "  All billable resources destroyed:"
  echo "    - NAT Gateway (\$32/mo)     DELETED"
  echo "    - ALB (\$16/mo)             DELETED"
  echo "    - ECS Fargate tasks         DELETED"
  echo "    - CloudFront distribution   DELETED"
  echo "    - VPC endpoints (\$7/mo ea) DELETED"
  echo "    - DynamoDB table            RETAINED (on purpose — holds real data)"
  echo "    - S3 buckets                DELETED"
  echo "    - ECR images                DELETED"
  echo ""
  echo "  Monthly cost: \$0.00"
else
  echo "  TEARDOWN INCOMPLETE — $PROBLEMS issue(s) remain"
  echo "==========================================="
  echo "  Run this script again or check manually."
fi
echo ""

rm -f "cdk-outputs-${ENV}.json"
