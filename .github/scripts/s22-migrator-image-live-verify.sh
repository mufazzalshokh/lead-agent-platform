#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${S22_MIGRATOR_GIT_COMMIT_SHA:?S22_MIGRATOR_GIT_COMMIT_SHA is required}"
: "${TF_VAR_migrator_deployment_timestamp:?TF_VAR_migrator_deployment_timestamp is required}"
: "${TF_VAR_migrator_image:?TF_VAR_migrator_image is required}"

EVIDENCE="s22-migrator-image-live-evidence.txt"
LIVE_JOB="$(mktemp)"
FAILURES=0
trap 'rm -f "$LIVE_JOB"' EXIT

report_check() {
  local name="$1"
  local observed="$2"
  local expected="$3"
  local result="$4"
  printf '%s=%s observed=%s expected=%s\n' "$name" "$result" "$observed" "$expected" | tee -a "$EVIDENCE"
  if [[ "$result" != "PASS" ]]; then
    FAILURES=$((FAILURES + 1))
  fi
}

matches() {
  if [[ "$1" == "$2" ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

matches_resource_name() {
  if [[ "$1" == "$2" || "$1" == */"$2" ]]; then
    printf 'PASS'
  else
    printf 'FAIL'
  fi
}

ACCESS_TOKEN="$(gcloud auth print-access-token)"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/lead-agent-staging-migrator" \
  > "$LIVE_JOB"
unset ACCESS_TOKEN

SERVICE_ACCOUNT="$(jq -r '.template.template.serviceAccount // ""' "$LIVE_JOB")"
IMAGE="$(jq -r '.template.template.containers[0].image // ""' "$LIVE_JOB")"
COMMAND="$(jq -c '.template.template.containers[0].command // []' "$LIVE_JOB")"
ARGS="$(jq -c '.template.template.containers[0].args // []' "$LIVE_JOB")"
NETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].network // ""' "$LIVE_JOB")"
SUBNETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].subnetwork // ""' "$LIVE_JOB")"
EGRESS="$(jq -r '.template.template.vpcAccess.egress // ""' "$LIVE_JOB")"
GIT_COMMIT="$(jq -r '[.template.template.containers[0].env[]? | select(.name == "DEPLOYMENT_GIT_SHA")][0].value // ""' "$LIVE_JOB")"
DEPLOYMENT_TIMESTAMP="$(jq -r '[.template.template.containers[0].env[]? | select(.name == "DEPLOYMENT_TIMESTAMP")][0].value // ""' "$LIVE_JOB")"
IMAGE_DIGEST="$(jq -r '[.template.template.containers[0].env[]? | select(.name == "DEPLOYMENT_IMAGE_DIGEST")][0].value // ""' "$LIVE_JOB")"
SECRET_COUNT="$(jq -r '[.template.template.containers[0].env[]? | select(.valueSource.secretKeyRef != null)] | length' "$LIVE_JOB")"
SECRET_VERSIONS="$(jq -c '[.template.template.containers[0].env[]? | select(.valueSource.secretKeyRef != null) | .valueSource.secretKeyRef.version] | sort' "$LIVE_JOB")"

report_check service_account "$SERVICE_ACCOUNT" "lead-agent-staging-migrator@${PROJECT_ID}.iam.gserviceaccount.com" "$(matches "$SERVICE_ACCOUNT" "lead-agent-staging-migrator@${PROJECT_ID}.iam.gserviceaccount.com")"
report_check image "$IMAGE" "$TF_VAR_migrator_image" "$(matches "$IMAGE" "$TF_VAR_migrator_image")"
report_check command "$COMMAND" '["node"]' "$(matches "$COMMAND" '["node"]')"
report_check args "$ARGS" '["dist/index.js"]' "$(matches "$ARGS" '["dist/index.js"]')"
report_check vpc_network "$NETWORK" 'lead-agent-staging-vpc' "$(matches_resource_name "$NETWORK" 'lead-agent-staging-vpc')"
report_check vpc_subnetwork "$SUBNETWORK" 'lead-agent-staging-cloud-run' "$(matches_resource_name "$SUBNETWORK" 'lead-agent-staging-cloud-run')"
report_check vpc_egress "$EGRESS" 'PRIVATE_RANGES_ONLY' "$(matches "$EGRESS" 'PRIVATE_RANGES_ONLY')"
report_check deployment_git_sha "$GIT_COMMIT" "$S22_MIGRATOR_GIT_COMMIT_SHA" "$(matches "$GIT_COMMIT" "$S22_MIGRATOR_GIT_COMMIT_SHA")"
report_check deployment_timestamp "$DEPLOYMENT_TIMESTAMP" "$TF_VAR_migrator_deployment_timestamp" "$(matches "$DEPLOYMENT_TIMESTAMP" "$TF_VAR_migrator_deployment_timestamp")"
report_check deployment_image_digest "$IMAGE_DIGEST" "$TF_VAR_migrator_image" "$(matches "$IMAGE_DIGEST" "$TF_VAR_migrator_image")"
report_check secret_reference_count "$SECRET_COUNT" '5' "$(matches "$SECRET_COUNT" '5')"
report_check secret_reference_versions "$SECRET_VERSIONS" '["latest","latest","latest","latest","latest"]' "$(matches "$SECRET_VERSIONS" '["latest","latest","latest","latest","latest"]')"

STATE_COUNT="$(terraform state list | wc -l | tr -d '[:space:]')"
report_check terraform_state_count "$STATE_COUNT" '89' "$(matches "$STATE_COUNT" '89')"

set +e
terraform plan -detailed-exitcode -lock-timeout=5m > /dev/null
PLAN_EXIT_CODE=$?
set -e
report_check terraform_convergence_exit_code "$PLAN_EXIT_CODE" '0' "$(matches "$PLAN_EXIT_CODE" '0')"

if (( FAILURES > 0 )); then
  printf 'migrator_image_live_verification=FAIL failures=%s\n' "$FAILURES" | tee -a "$EVIDENCE"
  exit 1
fi

echo 'migrator_image_live_verification=PASS failures=0' | tee -a "$EVIDENCE"
