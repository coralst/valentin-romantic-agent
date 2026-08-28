#!/usr/bin/env bash
set -euo pipefail

# Verify the app against a LOCAL server, with screenshots — the fast path.
#
# Usage: ./scripts/verify-local.sh [runLabel] [-- <extra rehearsal args>]
#
# This is the loop you want instead of deploying to see whether a change works:
# ~15s and no AWS mutation, versus ~7min for scripts/deploy.sh. Reuses servers
# that are already running (the same trick playwright.config.ts uses via
# reuseExistingServer) and only boots what is missing.
#
# The backend still needs AWS credentials for Bedrock — this is local, not offline.

RUN="${1:-local}"
shift || true
[[ "${1:-}" == "--" ]] && shift

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FRONTEND_PORT=5173
BACKEND_PORT=3001
STARTED_PIDS=()

port_open() { nc -z localhost "$1" > /dev/null 2>&1; }

cleanup() {
  for pid in "${STARTED_PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_for_port() {
  local port="$1" name="$2"
  for _ in $(seq 1 60); do
    port_open "$port" && return 0
    sleep 0.5
  done
  echo "ERROR: $name did not come up on port $port in 30s." >&2
  echo "       Check /tmp/valentin-${name}.log" >&2
  return 1
}

if port_open "$BACKEND_PORT"; then
  echo "--- Reusing the backend already on :$BACKEND_PORT"
else
  echo "--- Starting the backend on :$BACKEND_PORT"
  npm run dev:server > "/tmp/valentin-backend.log" 2>&1 &
  STARTED_PIDS+=("$!")
  wait_for_port "$BACKEND_PORT" backend
fi

if port_open "$FRONTEND_PORT"; then
  echo "--- Reusing the frontend already on :$FRONTEND_PORT"
else
  echo "--- Starting the frontend on :$FRONTEND_PORT"
  npm run dev > "/tmp/valentin-frontend.log" 2>&1 &
  STARTED_PIDS+=("$!")
  wait_for_port "$FRONTEND_PORT" frontend
fi

echo "--- Rehearsing against http://localhost:${FRONTEND_PORT}"
echo ""
node rehearsal.mjs "http://localhost:${FRONTEND_PORT}" "$RUN" "$@"
