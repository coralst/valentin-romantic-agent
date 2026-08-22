#!/usr/bin/env bash
set -euo pipefail

# Roll the running deployment back to the last verified-good release.
#
# Usage: ./scripts/rollback.sh [env] [flags]
#   env: dev (default). Other environments are refused for now — see REFUSALS.
#
# Flags:
#   --to <tag>        roll back to a specific image tag / git sha
#   --to-stable       roll back to whatever the stable-<env> git tag points at
#   --list            print the last 10 verified releases and exit
#   --only backend|frontend
#                     default is BOTH, from a single manifest entry: rolling back
#                     one layer alone risks a frontend/backend contract mismatch
#   --via-cdk         redeploy the Compute stack pinned to the good tag instead
#                     of re-registering a task definition (slower, but leaves no
#                     CloudFormation drift)
#   --fast-frontend   one destructive S3 pass instead of the safe two-pass
#   --no-wait         don't wait for ECS stability / invalidation completion
#   --allow-dirty     permit a target tag ending in -dirty
#   --dry-run         print every command, execute nothing
#
# WHY NOT `update-service --task-definition <prior revision>`:
# CloudFormation deregisters the superseded task definition on every Compute
# stack update, so every prior revision is INACTIVE and ECS refuses to launch
# from it. `describe-task-definition` still reads INACTIVE revisions, so we read
# the current one, swap the image, and register a NEW revision instead.

ENV="dev"
TARGET=""
USE_STABLE=false
LIST_ONLY=false
ONLY="both"
VIA_CDK=false
FAST_FRONTEND=false
WAIT=true
ALLOW_DIRTY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)            TARGET="${2:-}"; shift 2 ;;
    --to-stable)     USE_STABLE=true; shift ;;
    --list)          LIST_ONLY=true; shift ;;
    --only)          ONLY="${2:-}"; shift 2 ;;
    --via-cdk)       VIA_CDK=true; shift ;;
    --fast-frontend) FAST_FRONTEND=true; shift ;;
    --no-wait)       WAIT=false; shift ;;
    --allow-dirty)   ALLOW_DIRTY=true; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)       sed -n '4,26p' "$0"; exit 0 ;;
    -*)              echo "ERROR: unknown flag '$1'" >&2; exit 1 ;;
    *)               ENV="$1"; shift ;;
  esac
done

# --- REFUSALS ---------------------------------------------------------------
# Only dev for now. Rolling back staging/prod needs the drill proven on dev
# first, and prod additionally needs a typed confirmation token in the style of
# teardown.sh. Deliberately not wired up yet.
if [[ "$ENV" != "dev" ]]; then
  echo "ERROR: rollback is enabled for 'dev' only (got '$ENV')." >&2
  echo "       Roll back $ENV by hand, or extend this script once the dev drill is proven." >&2
  exit 1
fi
if [[ ! "$ONLY" =~ ^(both|backend|frontend)$ ]]; then
  echo "ERROR: --only must be backend or frontend." >&2
  exit 1
fi

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="valentin-cluster-${ENV}"
SERVICE="valentin-service-${ENV}"
RELEASE_BUCKET="valentin-releases-${ENV}"
STATIC_BUCKET="valentin-static-${ENV}"
ECR_REPO="valentin-backend-${ENV}"

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

aws_() { aws "$@" --profile "$PROFILE" --region "$REGION"; }

# --- Load the manifest ------------------------------------------------------
MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST" /tmp/valentin-rollback-td.json' EXIT
if ! aws_ s3 cp "s3://${RELEASE_BUCKET}/manifest.jsonl" "$MANIFEST" --only-show-errors 2>/dev/null; then
  echo "ERROR: no deploy manifest at s3://${RELEASE_BUCKET}/manifest.jsonl." >&2
  echo "       Nothing has been recorded as verified-good yet. Deploy once with" >&2
  echo "       scripts/deploy.sh to create it, or pass --to <tag> explicitly." >&2
  exit 1
fi

manifest_query() {
  python3 -c "
import json, sys
entries = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get('env') == sys.argv[2] and e.get('verified'):
        entries.append(e)
$1
" "$MANIFEST" "$ENV" "${2:-}"
}

if [[ "$LIST_ONLY" == true ]]; then
  echo "Last verified releases for $ENV (newest last):"
  manifest_query "
for e in entries[-10:]:
    print(f\"  {e['ts']}  {e['imageTag']:20s} {e.get('scope','all'):9s} {e.get('branch','')}\")
"
  exit 0
fi

# --- Resolve the target -----------------------------------------------------
CURRENT_TD=$(aws_ ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text 2>/dev/null || true)
if [[ -z "$CURRENT_TD" || "$CURRENT_TD" == "None" ]]; then
  echo "ERROR: could not find service '$SERVICE' in cluster '$CLUSTER'." >&2
  echo "       Has the environment been torn down?" >&2
  exit 1
fi
CURRENT_IMAGE=$(aws_ ecs describe-task-definition --task-definition "$CURRENT_TD" \
  --query 'taskDefinition.containerDefinitions[0].image' --output text)
CURRENT_TAG="${CURRENT_IMAGE##*:}"

if [[ "$USE_STABLE" == true ]]; then
  TARGET=$(git -C "$ROOT" rev-parse --short "stable-${ENV}" 2>/dev/null || true)
  [[ -z "$TARGET" ]] && { echo "ERROR: no stable-${ENV} git tag found." >&2; exit 1; }
fi

if [[ -z "$TARGET" ]]; then
  # Default: the newest verified entry whose image differs from what's running.
  TARGET=$(manifest_query "
prev = [e for e in entries if e['imageTag'] != sys.argv[3]]
print(prev[-1]['imageTag'] if prev else '')
" "$CURRENT_TAG")
  if [[ -z "$TARGET" ]]; then
    echo "ERROR: no verified release older than the running one ($CURRENT_TAG)." >&2
    echo "       Run --list to see what is recorded, or pass --to <tag>." >&2
    exit 1
  fi
fi

if [[ "$TARGET" == *-dirty && "$ALLOW_DIRTY" != true ]]; then
  echo "ERROR: target '$TARGET' was built from a dirty worktree, so its source" >&2
  echo "       cannot be reconstructed from any commit. Pass --allow-dirty to override." >&2
  exit 1
fi

ENTRY_TS=$(manifest_query "
m = [e for e in entries if e['imageTag'] == sys.argv[3]]
print(m[-1]['ts'] if m else 'not in manifest')
" "$TARGET")

echo "=== Rollback plan ($ENV) ==="
echo "  currently running : $CURRENT_TAG  (task def $CURRENT_TD)"
echo "  rolling back to   : $TARGET  (verified $ENTRY_TS)"
echo "  scope             : $ONLY"
echo "  backend mechanism : $([[ "$VIA_CDK" == true ]] && echo 'cdk deploy Compute --exclusively' || echo 're-register task definition')"
echo ""

# --- Backend ----------------------------------------------------------------
if [[ "$ONLY" == "both" || "$ONLY" == "backend" ]]; then
  TARGET_DIGEST=$(aws_ ecr describe-images --repository-name "$ECR_REPO" \
    --image-ids "imageTag=${TARGET}" --query 'imageDetails[0].imageDigest' \
    --output text 2>/dev/null || true)
  if [[ -z "$TARGET_DIGEST" || "$TARGET_DIGEST" == "None" ]]; then
    echo "ERROR: image tag '$TARGET' is not in ECR repo '$ECR_REPO'." >&2
    echo "       The service would be unable to pull it. Aborting before any change." >&2
    exit 1
  fi
  CURRENT_DIGEST=$(aws_ ecr describe-images --repository-name "$ECR_REPO" \
    --image-ids "imageTag=${CURRENT_TAG}" --query 'imageDetails[0].imageDigest' \
    --output text 2>/dev/null || true)
  if [[ -n "$CURRENT_DIGEST" && "$TARGET_DIGEST" == "$CURRENT_DIGEST" ]]; then
    # Several tags in this repo already point at one digest, so a differing tag
    # does not guarantee a differing image.
    echo "  NOTE: '$TARGET' resolves to the same image digest as '$CURRENT_TAG'."
    echo "        The backend rollback will be a no-op (the frontend may not be)."
    if [[ "$ONLY" == "backend" ]]; then
      echo "  Nothing to do."
      exit 0
    fi
  fi

  echo "--- Rolling back the backend..."
  if [[ "$VIA_CDK" == true ]]; then
    cd "${ROOT}/infra"
    run env AWS_PROFILE="$PROFILE" npx cdk deploy "Valentin-Compute-${ENV}" --exclusively \
      --context env="$ENV" --context imageTag="$TARGET" --require-approval never
    cd "$ROOT"
  else
    ACCOUNT=$(aws_ sts get-caller-identity --query Account --output text)
    NEW_IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:${TARGET}"
    if [[ "$DRY_RUN" == true ]]; then
      echo "  [dry-run] describe-task-definition $CURRENT_TD, set image=$NEW_IMAGE,"
      echo "  [dry-run] register-task-definition, update-service --task-definition <new>"
    else
      aws_ ecs describe-task-definition --task-definition "$CURRENT_TD" \
        --query 'taskDefinition' \
        | python3 -c "
import json, sys
td = json.load(sys.stdin)
# These are server-populated and rejected on register.
for k in ('taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
          'compatibilities', 'registeredAt', 'registeredBy', 'deregisteredAt'):
    td.pop(k, None)
td['containerDefinitions'][0]['image'] = sys.argv[1]
json.dump(td, sys.stdout)
" "$NEW_IMAGE" > /tmp/valentin-rollback-td.json
      NEW_TD=$(aws_ ecs register-task-definition \
        --cli-input-json "file:///tmp/valentin-rollback-td.json" \
        --query 'taskDefinition.taskDefinitionArn' --output text)
      echo "  registered $NEW_TD  (image $TARGET)"
      aws_ ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
        --task-definition "$NEW_TD" > /dev/null
      echo "  service updated"
      echo ""
      echo "  NOTE: CloudFormation still declares the previous image, so the"
      echo "        Compute stack now shows drift. The next scripts/deploy.sh"
      echo "        reconciles it. Use --via-cdk to avoid drift instead."
    fi
  fi
fi

# --- Frontend ---------------------------------------------------------------
if [[ "$ONLY" == "both" || "$ONLY" == "frontend" ]]; then
  echo ""
  echo "--- Rolling back the frontend..."
  ARCHIVE_URI="s3://${RELEASE_BUCKET}/frontend/${TARGET}/"
  if ! aws_ s3 ls "$ARCHIVE_URI" > /dev/null 2>&1; then
    echo "ERROR: no frontend archive at $ARCHIVE_URI" >&2
    echo "       That release predates release archiving. The static bucket is" >&2
    echo "       versioned, so it is recoverable by hand via list-object-versions," >&2
    echo "       but this script will not guess at it." >&2
    [[ "$ONLY" == "frontend" ]] && exit 1
  else
    # Two passes by default. index.html is served with CACHING_OPTIMIZED and no
    # short TTL, so a cached index.html referencing hashed assets we just deleted
    # would hard-404 for the length of the invalidation. Restore first WITHOUT
    # --delete so the old assets survive the propagation window, then clean up.
    run aws_ s3 sync "$ARCHIVE_URI" "s3://${STATIC_BUCKET}/" --only-show-errors

    DIST_ID=$(aws_ cloudformation describe-stacks --stack-name "Valentin-CDN-${ENV}" \
      --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
      --output text 2>/dev/null || true)
    if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
      if [[ "$DRY_RUN" == true ]]; then
        echo "  [dry-run] create-invalidation on $DIST_ID, poll until Completed"
      else
        INV_ID=$(aws_ cloudfront create-invalidation --distribution-id "$DIST_ID" \
          --paths "/*" --query 'Invalidation.Id' --output text)
        echo "  invalidation $INV_ID created"
        if [[ "$WAIT" == true ]]; then
          echo -n "  waiting for the invalidation to complete"
          for _ in $(seq 1 60); do
            STATUS=$(aws_ cloudfront get-invalidation --distribution-id "$DIST_ID" \
              --id "$INV_ID" --query 'Invalidation.Status' --output text 2>/dev/null || echo Unknown)
            [[ "$STATUS" == "Completed" ]] && break
            echo -n "."
            sleep 5
          done
          echo " $STATUS"
        fi
      fi
    fi

    if [[ "$FAST_FRONTEND" == true ]]; then
      run aws_ s3 sync "$ARCHIVE_URI" "s3://${STATIC_BUCKET}/" --delete --only-show-errors
    else
      # Now that no client can be holding a stale index.html, drop the assets
      # that the rolled-back build does not reference.
      run aws_ s3 sync "$ARCHIVE_URI" "s3://${STATIC_BUCKET}/" --delete --only-show-errors
    fi
  fi
fi

# --- Wait for the backend, then verify --------------------------------------
if [[ "$ONLY" != "frontend" && "$WAIT" == true && "$DRY_RUN" != true ]]; then
  echo ""
  echo "--- Waiting for ECS to stabilise (deregistration delay bounds this)..."
  aws_ ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
    && echo "  service stable" \
    || echo "  WARNING: services-stable timed out; check the ECS console."
fi

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "Dry run only — nothing was changed."
  exit 0
fi

CDN_DOMAIN=$(aws_ cloudformation describe-stacks --stack-name "Valentin-CDN-${ENV}" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomain'].OutputValue" \
  --output text 2>/dev/null || true)
echo ""
echo "==========================================="
echo "  ROLLBACK COMPLETE  ($CURRENT_TAG -> $TARGET)"
echo "==========================================="
if [[ -n "$CDN_DOMAIN" && "$CDN_DOMAIN" != "None" ]]; then
  echo ""
  echo "  Website: https://${CDN_DOMAIN}"
  if curl -fsS --max-time 15 "https://${CDN_DOMAIN}/api/health" > /dev/null; then
    echo "  Health:  OK"
  else
    echo "  Health:  FAILED — the rollback did not restore a working service."
  fi
fi
echo ""
echo "  This restored the running system only; git history is untouched."
echo "  To also revert the code, on a branch off main:"
echo "    git revert -m 1 <merge-commit-sha>   # -m 1 is required for a merge commit"
echo "  then open a PR (main's ruleset means it runs the full CI gates)."
echo ""
