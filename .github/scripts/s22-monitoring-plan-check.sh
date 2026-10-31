#!/usr/bin/env bash
set -euo pipefail
PLAN_PATH="${1:?usage: s22-monitoring-plan-check.sh <saved-plan> <plan|verify>}"
MODE="${2:?plan or verify is required}"
[[ "$MODE" == "plan" || "$MODE" == "verify" ]]
PLAN_DIRECTORY="$(cd "$(dirname "$PLAN_PATH")" && pwd)"
PLAN_FILENAME="$(basename "$PLAN_PATH")"
PLAN_JSON="$(mktemp)"
PROVIDER_SCHEMA="$(mktemp)"
trap 'rm -f "$PLAN_JSON" "$PROVIDER_SCHEMA"' EXIT
terraform -chdir="$PLAN_DIRECTORY" show -json "$PLAN_FILENAME" > "$PLAN_JSON"
terraform -chdir="$PLAN_DIRECTORY" providers schema -json > "$PROVIDER_SCHEMA"
node "$(dirname "${BASH_SOURCE[0]}")/s22-monitoring-plan-check.mjs" "$PLAN_JSON" "$PROVIDER_SCHEMA" "$MODE"
