#!/usr/bin/env bash
#
# Point the deployed backend at the Spotify app whose refresh token we actually have.
#
# There are two Spotify secrets in this account and they disagreed:
#
#   valentin/dev/spotify-oauth        -> injected into the ECS task as env vars.
#                                       Held the OLD app's client id/secret and an
#                                       EMPTY refresh token.
#   valentin/dev/integrations/spotify -> read at runtime by credential-store.ts.
#                                       Holds the NEW valentin-agent app's creds.
#
# credential-store.ts merges env-wins: a field already set in the environment is
# never overwritten by the runtime secret, and only empty ones are filled. So the
# container ran with the old app's client credentials and the new app's refresh
# token — a pairing Spotify rejects with `invalid_client`, which is exactly what
# the logs showed. `fields: 1` on the integration.secret-loaded line is that
# mismatch: one field filled, two already occupied by the wrong app.
#
# spotify-oauth is the canonical secret (infra/test/regressions.test.ts pins it),
# so the fix is to make it agree with reality rather than to delete either one.
#
# Reversible: put-secret-value keeps the prior version as AWSPREVIOUS. To undo,
# `aws secretsmanager update-secret-version-stage --secret-id valentin/dev/spotify-oauth
# --version-stage AWSCURRENT --move-to-version-id <the AWSPREVIOUS id>` then restart again.

set -euo pipefail

PROFILE="${AWS_PROFILE:-dev-devops-agent}"
REGION="${AWS_REGION:-us-east-1}"
CLUSTER="valentin-cluster-dev"
SERVICE="valentin-service-dev"
CANONICAL="valentin/dev/spotify-oauth"
RUNTIME="valentin/dev/integrations/spotify"

echo "==> Reading the new app's credentials from ${RUNTIME}"
NEW_JSON="$(aws secretsmanager get-secret-value \
  --secret-id "$RUNTIME" --query SecretString --output text \
  --profile "$PROFILE" --region "$REGION")"

# Rebuilt with python rather than jq: jq is not guaranteed present on a fresh mac,
# and a missing key here does not fail loudly — it launches a task with an empty
# env var and the same 400 we are trying to fix.
PAYLOAD="$(printf '%s' "$NEW_JSON" | python3 -c '
import json, sys
src = json.load(sys.stdin)
out = {
    "SPOTIFY_CLIENT_ID": src["clientId"],
    "SPOTIFY_CLIENT_SECRET": src["clientSecret"],
    "SPOTIFY_REFRESH_TOKEN": src["refreshToken"],
}
missing = [k for k, v in out.items() if not str(v).strip()]
if missing:
    sys.exit("refusing to write empty " + ", ".join(missing))
print(json.dumps(out))
')"

echo "==> Writing all three keys into ${CANONICAL}"
# All three, every time. An omitted key in a secret that the task definition maps
# per-key does not fall back to the old value — the task fails to launch.
aws secretsmanager put-secret-value \
  --secret-id "$CANONICAL" --secret-string "$PAYLOAD" \
  --profile "$PROFILE" --region "$REGION" --query VersionId --output text

echo "==> Restarting ${SERVICE} so it picks the new values up"
# Secrets resolve at task start, so a running task keeps the old credentials
# forever. No new task definition is needed: the mapping already points here.
aws ecs update-service \
  --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment \
  --profile "$PROFILE" --region "$REGION" --query 'service.deployments[0].id' --output text

echo "==> Waiting for the service to go stable (a few minutes)"
aws ecs wait services-stable \
  --cluster "$CLUSTER" --services "$SERVICE" \
  --profile "$PROFILE" --region "$REGION"

echo
echo "Done. Confirm the fix in the logs — you want 'fields: 3' and no invalid_client:"
echo "  aws logs tail /valentin/dev/service --since 5m --profile $PROFILE --region $REGION | grep -i spotify"
