#!/usr/bin/env bash
set -euo pipefail

# One-click deploy: build, push, and launch Valentin on AWS
#
# Usage: ./scripts/deploy.sh [env] [flags]
#   env: dev (default), staging, prod
#
# Flags:
#   --scope=all|frontend|backend|infra
#                    all       (default) everything, as this script always did
#                    frontend  vite build + S3 sync + CDN invalidation only
#                              -> no Docker, no CDK. ~45s instead of ~7min.
#                    backend   Docker + ECR + the Compute stack only
#                    infra     CDK only (no Docker build, no frontend)
#   --bootstrap      run `cdk bootstrap` first (it used to run on every deploy,
#                    where it reported "no changes" and cost a round trip)
#   --no-archive     skip copying this build to the release archive
#   --dry-run        print what would run, execute nothing
#
# Match the scope to what you changed. A frontend-only change does not need a
# Docker build or an ECS rolling deploy; `cdk deploy --all` walks 7 stacks, 6 of
# which are ~16s no-ops, and Compute is a multi-minute ECS wait.

ENV="dev"
SCOPE="all"
RUN_BOOTSTRAP=false
ARCHIVE=true
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --scope=*)    SCOPE="${arg#*=}" ;;
    --bootstrap)  RUN_BOOTSTRAP=true ;;
    --no-archive) ARCHIVE=false ;;
    --dry-run)    DRY_RUN=true ;;
    -h|--help)    sed -n '4,26p' "$0"; exit 0 ;;
    -*)           echo "ERROR: unknown flag '$arg'" >&2; exit 1 ;;
    *)            ENV="$arg" ;;
  esac
done

# Validate before doing any work (this used to happen after the STS call).
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be dev, staging, or prod." >&2
  exit 1
fi
if [[ ! "$SCOPE" =~ ^(all|frontend|backend|infra)$ ]]; then
  echo "ERROR: Invalid scope '$SCOPE'. Must be all, frontend, backend, or infra." >&2
  exit 1
fi

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/valentin-backend-${ENV}"
RELEASE_BUCKET="valentin-releases-${ENV}"

# Engine B's agent is a second, ARM64 image in its own repository. Separate
# because it shares nothing with the backend: different language, different base
# image, different architecture.
AGENT_REPO="valentin-agentcore-${ENV}"
AGENT_ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${AGENT_REPO}"

# Immutable, content-addressed image tag. Using :latest made the ECS circuit
# breaker's rollback a no-op, because the "previous" task definition pointed at
# the same mutable tag that had just failed.
IMAGE_TAG="$(git rev-parse --short HEAD)"
GIT_SHA_FULL="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DIRTY=false
if [[ -n "$(git status --porcelain)" ]]; then
  IMAGE_TAG="${IMAGE_TAG}-dirty"
  DIRTY=true
fi

echo "=== Deploying Valentin (env=$ENV, scope=$SCOPE, region=$REGION, account=$ACCOUNT, tag=$IMAGE_TAG) ==="

if [[ "$DIRTY" == true ]]; then
  echo ""
  echo "  WARNING: worktree is dirty, so this build is tagged '$IMAGE_TAG'."
  echo "  A -dirty tag cannot be reconstructed from any commit, so this deploy"
  echo "  will NOT be recorded as a rollback target. Commit first if you want"
  echo "  to be able to roll back to it."
fi

# Reads a CDN stack output, preferring the outputs file CDK just wrote over an
# extra describe-stacks round trip.
cdn_output() {
  local key="$1" outputs="${ROOT}/infra/cdk-outputs-${ENV}.json" value=""
  if [[ -f "$outputs" ]]; then
    value=$(python3 -c "
import json,sys
try:
    data = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
for stack, outs in data.items():
    if stack.startswith('Valentin-CDN-') and sys.argv[2] in outs:
        print(outs[sys.argv[2]]); break
" "$outputs" "$key" 2>/dev/null || true)
  fi
  if [[ -z "$value" ]]; then
    value=$(aws cloudformation describe-stacks \
      --stack-name "Valentin-CDN-${ENV}" \
      --profile "$PROFILE" --region "$REGION" \
      --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
      --output text 2>/dev/null || true)
  fi
  [[ "$value" == "None" ]] && value=""
  echo "$value"
}

# The agent image tag baked into the deployed AgentCore Runtime, or empty.
#
# `containerUri` in the live template is a CloudFormation `Fn::Join` of the ECR
# host, the URL suffix, and `:<tag>`, so the tag is the text after the final `:`.
# Read straight from the deployed template rather than a local outputs file: this
# is asked before deciding whether AgentCore even needs a deploy, when no local
# state is trustworthy. Empty on any failure — a missing stack, a shape change,
# no python — which the caller treats as "deploy it", the safe direction.
agentcore_deployed_tag() {
  aws cloudformation get-template \
    --stack-name "Valentin-AgentCore-${ENV}" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'TemplateBody' --output json 2>/dev/null \
  | python3 -c "
import json,sys
try:
    t = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for name, res in t.get('Resources', {}).items():
    if res.get('Type') == 'AWS::BedrockAgentCore::Runtime':
        uri = res.get('Properties', {}).get('AgentRuntimeArtifact', {}) \
                 .get('ContainerConfiguration', {}).get('ContainerUri', '')
        # ContainerUri is usually an Fn::Join: ['', [host, {Ref: URLSuffix}, ':tag']].
        parts = []
        if isinstance(uri, dict):
            for join in uri.values():
                if isinstance(join, list) and len(join) == 2 and isinstance(join[1], list):
                    parts = [p for p in join[1] if isinstance(p, str)]
        elif isinstance(uri, str):
            parts = [uri]
        joined = ''.join(parts)
        if ':' in joined:
            print(joined.rsplit(':', 1)[1])
        break
" 2>/dev/null || true
}

# True when the AgentCore stack exists in a healthy, non-rolled-back state.
agentcore_is_healthy() {
  local status
  status=$(aws cloudformation describe-stacks \
    --stack-name "Valentin-AgentCore-${ENV}" \
    --profile "$PROFILE" --region "$REGION" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)
  case "$status" in
    CREATE_COMPLETE|UPDATE_COMPLETE|IMPORT_COMPLETE) return 0 ;;
    *) return 1 ;;
  esac
}

# --- 1. Build & push Docker image ---
if [[ "$SCOPE" == "all" || "$SCOPE" == "backend" ]]; then
  echo ""
  echo "--- Building Docker image..."
  run docker build --platform linux/amd64 -t "$ECR_URI:${IMAGE_TAG}" "$ROOT"

  # ARM64 on purpose. AgentCore Runtime is arm64-only and accepts an amd64
  # image at deploy time, then fails at cold start with an exec format error
  # that surfaces as an invoke timeout — so the platform is pinned here
  # rather than inherited.
  run docker build --platform linux/arm64 \
    -t "$AGENT_ECR_URI:${IMAGE_TAG}" "$ROOT/agentcore"

  # The AgentCore stack imports this repository by name rather than creating it,
  # so a first deploy into a fresh account would otherwise fail at push with a
  # RepositoryNotFoundException after both images are already built. Idempotent,
  # and inside the scope guard because a frontend-only deploy pushes nothing.
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] ensure ECR repository $AGENT_REPO exists"
  elif ! aws ecr describe-repositories --repository-names "$AGENT_REPO" \
         --profile "$PROFILE" --region "$REGION" > /dev/null 2>&1; then
    aws ecr create-repository --repository-name "$AGENT_REPO" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability IMMUTABLE \
      --profile "$PROFILE" --region "$REGION" > /dev/null
  fi

  echo "--- Pushing to ECR..."
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] docker login + docker push $ECR_URI:${IMAGE_TAG}"
    echo "  [dry-run] docker push $AGENT_ECR_URI:${IMAGE_TAG}"
  else
    aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
      | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
    docker push "$ECR_URI:${IMAGE_TAG}"
    docker push "$AGENT_ECR_URI:${IMAGE_TAG}"
  fi
else
  echo ""
  echo "--- Skipping Docker build (scope=$SCOPE)"
fi

# --- 2. Deploy CDK stacks ---
if [[ "$SCOPE" == "all" || "$SCOPE" == "backend" || "$SCOPE" == "infra" ]]; then
  echo ""
  echo "--- Deploying infrastructure..."
  cd "${ROOT}/infra"

  if [[ "$RUN_BOOTSTRAP" == true ]]; then
    run env AWS_PROFILE="$PROFILE" npx cdk bootstrap --context env="$ENV"
  fi

  # An infra-scoped deploy builds no image, but it still deploys Compute — and
  # `imageTag` defaults to HEAD's SHA, which has nothing behind it in ECR. That
  # produces a task definition pointing at an image that cannot be pulled: the
  # tasks fail, the circuit breaker rolls the service back, and the deploy fails
  # for a reason that has nothing to do with the infra change. Keep the tag the
  # service is already running instead.
  if [[ "$SCOPE" == "infra" ]]; then
    RUNNING_IMAGE="$(aws ecs describe-task-definition \
      --task-definition "valentin-task-${ENV}" \
      --profile "$PROFILE" --region "$REGION" \
      --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null || true)"
    if [[ -n "$RUNNING_IMAGE" && "$RUNNING_IMAGE" != "None" ]]; then
      IMAGE_TAG="${RUNNING_IMAGE##*:}"
      echo "--- scope=infra: keeping the running image tag ${IMAGE_TAG}"
    else
      echo "ERROR: scope=infra could not read the running image tag; refusing to" >&2
      echo "       deploy Compute with an unbuilt tag. Use --scope=backend." >&2
      exit 1
    fi
  fi

  # `backend` touches only the service, so deploy just Compute. --exclusively is
  # load-bearing: without it CDK walks the addStackDependency chains in
  # bin/app.ts and re-checks Network/Data/Safety at ~16s each.
  #
  # But Compute cannot deploy alone. `bin/app.ts` feeds the AgentCore Runtime
  # ARN, Memory id and Gateway URL into ComputeStack, which makes them
  # CloudFormation cross-stack imports; with --exclusively and no AgentCore, the
  # import cannot resolve and Compute rolls back with "No export named
  # Valentin-AgentCore-dev:...RuntimeAgentRuntimeArn... found". That is precisely
  # how a scope=backend deploy failed the first time engine B shipped. So deploy
  # AgentCore first — unless it is already healthy AND already running this exact
  # agent tag, in which case a redeploy is ~16s of nothing. Any uncertainty
  # (missing stack, unreadable tag, mid-rollback) deploys: a redundant AgentCore
  # deploy is cheap, a missing one costs a Compute rollback.
  if [[ "$SCOPE" == "backend" ]]; then
    if agentcore_is_healthy && [[ "$(agentcore_deployed_tag)" == "$IMAGE_TAG" ]]; then
      echo "--- AgentCore already healthy at ${IMAGE_TAG}; deploying Compute only"
    else
      echo "--- Deploying AgentCore first (Compute imports its exports)"
      run env AWS_PROFILE="$PROFILE" npx cdk deploy "Valentin-AgentCore-${ENV}" --exclusively \
        --context env="$ENV" \
        --context imageTag="$IMAGE_TAG" \
        --context agentImageTag="$IMAGE_TAG" \
        --require-approval never \
        --outputs-file "cdk-outputs-${ENV}.json"
    fi
    run env AWS_PROFILE="$PROFILE" npx cdk deploy "Valentin-Compute-${ENV}" --exclusively \
      --context env="$ENV" \
      --context imageTag="$IMAGE_TAG" \
      --context agentImageTag="$IMAGE_TAG" \
      --require-approval never \
      --outputs-file "cdk-outputs-${ENV}.json"
  else
    # Named stacks with --exclusively rather than `--all`: `--all` would also
    # deploy whatever other branches have changed in their own stacks, so two
    # people deploying from different branches stomp each other. Order matters:
    # Auth before Compute, because Compute imports the pool id and client ids.
    # AgentCore before Compute: the proxy service names the Runtime ARN, the
    # Memory id and the Gateway URL in its container environment, and none of
    # the three exists until AgentCore is deployed. See infra/bin/app.ts.
    for STACK in Network Data Safety Auth AgentCore Compute CDN Monitoring; do
      echo "    -> Valentin-${STACK}-${ENV}"
      run env AWS_PROFILE="$PROFILE" npx cdk deploy "Valentin-${STACK}-${ENV}" \
        --exclusively \
        --context env="$ENV" \
        --context imageTag="$IMAGE_TAG" \
        --context agentImageTag="$IMAGE_TAG" \
        --require-approval never \
        --outputs-file "cdk-outputs-${ENV}.json"
    done
  fi
  cd "$ROOT"
else
  echo ""
  echo "--- Skipping CDK (scope=$SCOPE)"
fi

# --- 3. Seed the shared demo account ---
# Runs here, not by hand: the one-click demo button is broken until the pool user
# exists, and "remember to run a script" is exactly the step people forget. Only
# when Auth was part of this deploy; scope=backend touches Compute alone.
if [[ "$SCOPE" == "all" || "$SCOPE" == "infra" ]]; then
  echo ""
  echo "--- Seeding demo account..."
  run env AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" \
    bash "${ROOT}/scripts/seed-demo-user.sh" "$ENV"
fi

# Reads an Auth stack output. Same shape as cdn_output, but Cognito ids are only
# needed for the frontend build, so it is not worth caching.
auth_output() {
  local value
  value=$(aws cloudformation describe-stacks \
    --stack-name "Valentin-Auth-${ENV}" \
    --profile "$PROFILE" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text 2>/dev/null || true)
  [[ "$value" == "None" ]] && value=""
  echo "$value"
}

# --- 4. Build & deploy frontend ---
if [[ "$SCOPE" == "all" || "$SCOPE" == "frontend" ]]; then
  echo ""
  echo "--- Deploying frontend..."
  cd "$ROOT"

  # Cognito ids are read straight out of the stack, so there is no .env to keep
  # in sync and no chance of shipping a bundle pointed at the wrong user pool.
  COGNITO_DOMAIN_PREFIX="$(auth_output UserPoolDomain)"
  VITE_COGNITO_CLIENT_ID="$(auth_output UserPoolClientId)"
  VITE_COGNITO_DOMAIN=""
  if [[ -n "$COGNITO_DOMAIN_PREFIX" ]]; then
    VITE_COGNITO_DOMAIN="https://${COGNITO_DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"
  fi
  echo "    user pool client: ${VITE_COGNITO_CLIENT_ID:-<unresolved>}"

  run env VITE_COGNITO_DOMAIN="$VITE_COGNITO_DOMAIN" \
    VITE_COGNITO_CLIENT_ID="$VITE_COGNITO_CLIENT_ID" \
    npx vite build

  # Archive BEFORE the live sync overwrites the previous build, so rollback is
  # one sync rather than a walk through S3 version history.
  if [[ "$ARCHIVE" == true && "$DIRTY" == false ]]; then
    run aws s3 sync dist/ "s3://${RELEASE_BUCKET}/frontend/${IMAGE_TAG}/" \
      --profile "$PROFILE" --region "$REGION" --only-show-errors || \
      echo "  NOTE: archive sync failed (is the ReleaseBucket deployed yet?) — continuing."
  fi

  # Two passes, because the entry point and the assets want opposite caching.
  #
  # The first sync ships everything; the hashed files under assets/ are safe to
  # cache forever because a content change changes their name. index.html is the
  # one file whose name never changes, and it is the map to those hashes — so if
  # a browser or CloudFront caches it, a returning visitor keeps loading the
  # PREVIOUS build's JS long after a deploy, with no error to show for it. That
  # is exactly what happened after the engine-B deploy: the app was live but
  # every returning tab ran the Aug-28 bundle until its heuristic cache expired,
  # because S3 sent index.html with no Cache-Control at all. The second cp
  # rewrites just the HTML with no-cache so the edge and the browser always
  # revalidate it; the hashed assets it points at are still served from cache.
  run aws s3 sync dist/ "s3://valentin-static-${ENV}/" --delete \
    --profile "$PROFILE" --region "$REGION"

  run aws s3 cp "s3://valentin-static-${ENV}/index.html" "s3://valentin-static-${ENV}/index.html" \
    --content-type text/html \
    --cache-control "no-cache, must-revalidate" \
    --metadata-directive REPLACE \
    --profile "$PROFILE" --region "$REGION" --only-show-errors

  DIST_ID=$(cdn_output DistributionId)
  if [[ -n "$DIST_ID" ]]; then
    run aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
      --profile "$PROFILE" --region "$REGION" --output text --query 'Invalidation.Id'
  fi
else
  echo ""
  echo "--- Skipping frontend (scope=$SCOPE)"
fi

# --- Done ---
echo ""
echo "==========================================="
echo "  DEPLOYMENT COMPLETE"
echo "==========================================="
CDN_DOMAIN=$(cdn_output DistributionDomain)

echo ""
echo "  Website: https://${CDN_DOMAIN}"
echo "  API:     https://${CDN_DOMAIN}/api/health"
echo ""

# --- Record as a rollback target, but only if it actually works ---
# A manifest entry means "verified good", so rollback.sh can trust it. Anything
# that fails the health probe, or was built from a dirty tree, is not recorded.
if [[ "$DRY_RUN" == true ]]; then
  echo "  [dry-run] would health-probe, then append to s3://${RELEASE_BUCKET}/manifest.jsonl"
  exit 0
fi

if [[ "$DIRTY" == true ]]; then
  echo "  Not recorded as a rollback target: built from a dirty worktree."
  exit 0
fi

if [[ -z "$CDN_DOMAIN" ]]; then
  echo "  Not recorded as a rollback target: could not resolve the CDN domain."
  exit 0
fi

echo "--- Verifying deployment..."
if ! curl -fsS --max-time 15 "https://${CDN_DOMAIN}/api/health" > /dev/null; then
  echo "  WARNING: /api/health did not pass — deploy NOT recorded as stable."
  exit 0
fi
echo "  /api/health OK"

STACKS="Valentin-Compute-${ENV},Valentin-CDN-${ENV}"
[[ "$SCOPE" == "frontend" ]] && STACKS=""
TASK_DEF=$(aws ecs describe-services \
  --cluster "valentin-cluster-${ENV}" --services "valentin-service-${ENV}" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'services[0].taskDefinition' --output text 2>/dev/null || true)
IMAGE_DIGEST=$(aws ecr describe-images \
  --repository-name "valentin-backend-${ENV}" --image-ids "imageTag=${IMAGE_TAG}" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)

ENTRY=$(python3 -c "
import json, sys
print(json.dumps({
    'ts': sys.argv[1], 'env': sys.argv[2], 'scope': sys.argv[3],
    'gitSha': sys.argv[4], 'gitShaFull': sys.argv[5], 'branch': sys.argv[6],
    'imageTag': sys.argv[4], 'imageDigest': sys.argv[7],
    'taskDefArn': sys.argv[8],
    'stacks': [s for s in sys.argv[9].split(',') if s],
    'frontendArchive': sys.argv[10], 'verified': True, 'deployedBy': 'deploy.sh',
}))
" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENV" "$SCOPE" "$IMAGE_TAG" "$GIT_SHA_FULL" \
  "$GIT_BRANCH" "$IMAGE_DIGEST" "$TASK_DEF" "$STACKS" \
  "s3://${RELEASE_BUCKET}/frontend/${IMAGE_TAG}/")

# Read-modify-write. The bucket is versioned, so a clobbered manifest is
# recoverable. S3 is authoritative rather than git: this script runs from
# throwaway worktrees on branches that get deleted at merge, committing here
# would flip the next build's tag to -dirty, and rollback has to work from a
# fresh clone in an unknown git state.
TMP_MANIFEST="$(mktemp)"
aws s3 cp "s3://${RELEASE_BUCKET}/manifest.jsonl" "$TMP_MANIFEST" \
  --profile "$PROFILE" --region "$REGION" --only-show-errors 2>/dev/null || : > "$TMP_MANIFEST"
printf '%s\n' "$ENTRY" >> "$TMP_MANIFEST"
if aws s3 cp "$TMP_MANIFEST" "s3://${RELEASE_BUCKET}/manifest.jsonl" \
    --profile "$PROFILE" --region "$REGION" --only-show-errors; then
  echo "  Recorded as a rollback target (tag $IMAGE_TAG)"
  # Tags live in the shared .git, so this survives `git worktree remove`.
  git tag -f "stable-${ENV}" "$GIT_SHA_FULL" -m "verified deploy $IMAGE_TAG" >/dev/null 2>&1 || true
  git push -f origin "refs/tags/stable-${ENV}" >/dev/null 2>&1 \
    || echo "  NOTE: could not push the stable-${ENV} tag to origin."
else
  echo "  WARNING: could not write the manifest (is the ReleaseBucket deployed?)."
fi
rm -f "$TMP_MANIFEST"
echo ""
