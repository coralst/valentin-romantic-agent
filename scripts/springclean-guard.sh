#!/usr/bin/env bash
#
# Re-arm SpringClean exemption on everything the CDK app cannot tag itself.
#
# SpringClean is the Isengard account janitor: it scans daily, warns on day 4 and
# deletes on day 7 anything carrying no exemption tag. It calls the service APIs
# directly, so `RemovalPolicy.RETAIN` does not stop it — CloudFormation is never
# consulted. On 2026-09-01 it deleted ValentinTable-dev, which already had RETAIN,
# while Valentin-Data-dev still reported UPDATE_COMPLETE and still listed the
# table among its resources.
#
# `applySpringCleanExemption(app)` in infra/bin/app.ts tags every resource inside
# the CDK app. That is necessary and not sufficient, because three classes of
# resource are outside its reach and every one of them is load-bearing:
#
#   1. CDK *bootstrap* resources. The CDKToolkit stack, the
#      cdk-hnb659fds-assets-* bucket, the cdk-hnb659fds-container-assets-* ECR
#      repository and the /cdk-bootstrap/hnb659fds/version SSM parameter are
#      created by `cdk bootstrap`, not by our app, so no app-scope tag reaches
#      them. The ECR repository holds every backend image ever pushed — losing it
#      destroys the deployed image *and* every rollback target at once.
#   2. Resources AWS creates on our behalf. Application Auto Scaling makes the
#      TargetTracking-service/valentin-cluster-dev/* alarms itself; they never
#      pass through CloudFormation and never receive a CDK tag.
#   3. Leftovers from earlier deploys — old task-definition revisions, and log
#      groups orphaned when a stack was replaced.
#
# An audit on 2026-09-03 found 33 such resources in us-east-1 with no exemption
# tag at all, including the container-assets ECR repository. All eight Valentin
# stacks were healthy at the time; the gap was purely in what app-scope tagging
# can reach, which is why this runs as a separate pass rather than as more CDK.
#
# Idempotent: tagging an already-tagged resource is a no-op, so this is safe to
# run after every deploy, and deploy.sh does exactly that.
#
# Deliberately scoped to Valentin and CDK-bootstrap ARNs only. This account also
# holds unrelated demo resources (devops-demo-*, opensearch_mcp_server-*,
# sagemaker-*); exempting those from the janitor is not ours to decide.
#
# Written for bash 3.2, which is what macOS ships: no mapfile, no associative
# arrays.

set -euo pipefail

# Pinned, and deliberately not read from AWS_REGION. That variable is exported in
# some shells here to us-west-2, it outranks AWS_DEFAULT_REGION in the AWS CLI,
# and it has already sent one deploy to the wrong region. All eight real stacks
# are in us-east-1.
REGION="${1:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"

# `auto-delete=no` is the documented signal; `springclean=exempt` is a second
# accepted form. Both, so the exemption survives either being narrowed.
TAGS='auto-delete=no,springclean=exempt'

# Matches our app and the bootstrap that deploys it, nothing else.
PATTERN='valentin|cdk-hnb659fds|cdk-bootstrap|CDKToolkit'

echo "==> SpringClean guard: auditing $REGION"

ALL_JSON="$(mktemp -t springclean-all)"
BARE_TXT="$(mktemp -t springclean-bare)"
trap 'rm -f "$ALL_JSON" "$BARE_TXT"' EXIT

aws resourcegroupstaggingapi get-resources \
  --region "$REGION" --profile "$PROFILE" --output json > "$ALL_JSON"

python3 - "$ALL_JSON" "$PATTERN" > "$BARE_TXT" <<'PY'
import json, re, sys
rows = json.load(open(sys.argv[1]))["ResourceTagMappingList"]
pat = re.compile(sys.argv[2], re.I)
for r in rows:
    arn = r["ResourceARN"]
    if not pat.search(arn):
        continue
    keys = {t["Key"] for t in r.get("Tags", [])}
    if "auto-delete" not in keys and "springclean" not in keys:
        print(arn)
PY

BARE_COUNT="$(wc -l < "$BARE_TXT" | tr -d ' ')"

if [ "$BARE_COUNT" -eq 0 ]; then
  echo "    all Valentin and CDK-bootstrap resources already exempt"
  exit 0
fi

echo "    $BARE_COUNT resource(s) missing the exemption; tagging"

# tag-resources takes at most 20 ARNs per call, and reports per-ARN failures in
# the response body rather than as a non-zero exit — so failures are counted and
# printed explicitly. A few types (CloudFormation stacks, some SSM documents)
# refuse tagging through this API and must be tagged by their own service call or
# at stack-update time.
FAILED=0
while IFS= read -r chunk; do
  [ -z "$chunk" ] && continue
  # shellcheck disable=SC2086  # word splitting is the point: one arg per ARN
  RESULT="$(aws resourcegroupstaggingapi tag-resources \
    --region "$REGION" --profile "$PROFILE" \
    --resource-arn-list $chunk \
    --tags "$TAGS" --output json)"
  N="$(printf '%s' "$RESULT" | python3 -c "
import json, sys
m = json.load(sys.stdin).get('FailedResourcesMap', {})
for arn, info in m.items():
    print('    FAILED', arn, '-', info.get('ErrorCode'), file=sys.stderr)
print(len(m))
")"
  FAILED=$((FAILED + N))
done < <(xargs -n 20 echo < "$BARE_TXT")

echo "    tagged $((BARE_COUNT - FAILED)), could not tag $FAILED"

if [ "$FAILED" -gt 0 ]; then
  # CloudFormation stacks cannot be tagged through the tagging API. The CDKToolkit
  # stack is the one that matters, and `cdk bootstrap` takes tags directly:
  echo "    note: stacks are tagged at create/update time, not through this API."
  echo "    for the bootstrap stack:"
  echo "      npx cdk bootstrap --tags auto-delete=no --tags springclean=exempt"
fi

echo "==> done"
