#!/usr/bin/env bash
set -euo pipefail

# Create (or refresh) the shared account behind the one-click demo button.
#
# Usage: ./scripts/seed-demo-user.sh [env]
#
# Idempotent: safe to run on every deploy. An already-existing user is left in
# place and only its password is re-synced to whatever Secrets Manager holds.
#
# This is a script rather than a CDK custom resource on purpose: a custom
# resource would mean a Lambda holding cognito-idp:AdminCreateUser and
# AdminSetUserPassword on the pool for the lifetime of the stack. Running it
# from the deploy means those rights belong to a human operator's session and
# expire with it. The ECS task role never gets them.
#
# Nothing here prints a password. The only secret material touched is piped
# between two AWS calls.

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-dev-devops-agent}"

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

# --- Resolve the pool and secret from stack outputs, not hardcoded ids ---
stack_output() {
  aws_ cloudformation describe-stacks \
    --stack-name "Valentin-Auth-${ENV}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

USER_POOL_ID=$(stack_output UserPoolId)
SECRET_ARN=$(stack_output DemoSecretArn)
DEMO_EMAIL=$(stack_output DemoUserEmail)

if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "ERROR: could not read UserPoolId from Valentin-Auth-${ENV}." >&2
  echo "       Deploy the Auth stack first." >&2
  exit 1
fi

echo "--- Seeding demo account '${DEMO_EMAIL}' into ${USER_POOL_ID}"

# --- Read the generated password ---
DEMO_PASSWORD=$(aws_ secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --query SecretString --output text \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')

if [[ -z "$DEMO_PASSWORD" ]]; then
  echo "ERROR: demo secret has no 'password' key." >&2
  exit 1
fi

# --- Create the user, tolerating an existing one ---
# --message-action SUPPRESS: no invitation email. The address is a placeholder
# domain nobody owns, and an email would only bounce.
create_output=$(aws_ cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$DEMO_EMAIL" \
  --message-action SUPPRESS \
  --user-attributes "Name=email,Value=${DEMO_EMAIL}" "Name=email_verified,Value=true" \
  2>&1) || {
  if grep -q 'UsernameExistsException' <<<"$create_output"; then
    echo "    user already exists — reusing it"
  else
    echo "$create_output" >&2
    exit 1
  fi
}

# --- Set the password permanently ---
# Without --permanent the account lands in FORCE_CHANGE_PASSWORD and
# AdminInitiateAuth returns a NEW_PASSWORD_REQUIRED challenge instead of tokens,
# which would surface as the demo button failing with no obvious cause.
aws_ cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$DEMO_EMAIL" \
  --password "$DEMO_PASSWORD" \
  --permanent

echo "    demo account ready"
