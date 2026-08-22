#!/usr/bin/env bash
set -euo pipefail

# Enables image scanning on the Valentin ECR repository, and optionally tag
# immutability.
#
# Why this is a separate script rather than part of deploy.sh or the CDK app:
# the repository is imported by ComputeStack, not managed by it (deploy.sh
# builds and pushes before `cdk deploy` runs, so the repo must already exist).
# These are therefore one-time account-level settings.
#
# Usage: ./scripts/harden-ecr.sh [env] [--immutable]

ENV="${1:-dev}"
# Every Valentin environment lives in us-east-1 (see infra/config/environments.ts).
# Deliberately not defaulted from AWS_REGION: that variable is often already set
# to an unrelated region in a developer's shell, which would silently point this
# at a registry where the repository does not exist. Override with VALENTIN_REGION
# if an environment is ever moved.
REGION="${VALENTIN_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"
REPO="valentin-backend-${ENV}"
IMMUTABLE=false
for arg in "$@"; do
  [[ "$arg" == "--immutable" ]] && IMMUTABLE=true
done

echo "=== Hardening ECR repo $REPO (region=$REGION) ==="

# Scan on push: pure gain, no effect on the deploy flow.
aws ecr put-image-scanning-configuration \
  --repository-name "$REPO" \
  --image-scanning-configuration scanOnPush=true \
  --profile "$PROFILE" --region "$REGION" >/dev/null
echo "  scanOnPush enabled"

# Tag immutability is opt-in because it has a real consequence: deploy.sh tags
# images with the short git SHA, so re-running a deploy on the same commit
# would fail at the push step instead of being a harmless no-op. Enable it once
# deploys are driven from CI, where every deploy has a distinct commit.
if [[ "$IMMUTABLE" == true ]]; then
  aws ecr put-image-tag-mutability \
    --repository-name "$REPO" \
    --image-tag-mutability IMMUTABLE \
    --profile "$PROFILE" --region "$REGION" >/dev/null
  echo "  tag mutability set to IMMUTABLE"
else
  echo "  tag mutability left MUTABLE (pass --immutable to change)"
fi

# Expire untagged images so old layers do not accumulate.
cat > /tmp/valentin-ecr-lifecycle.json <<'EOF'
{"rules":[{"rulePriority":1,"description":"Expire untagged images after 14 days","selection":{"tagStatus":"untagged","countType":"sinceImagePushed","countUnit":"days","countNumber":14},"action":{"type":"expire"}}]}
EOF
aws ecr put-lifecycle-policy \
  --repository-name "$REPO" \
  --lifecycle-policy-text "file:///tmp/valentin-ecr-lifecycle.json" \
  --profile "$PROFILE" --region "$REGION" >/dev/null
echo "  lifecycle policy applied (expire untagged after 14d)"

echo "Done."
