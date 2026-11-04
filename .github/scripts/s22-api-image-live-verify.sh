#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${S22_API_GIT_COMMIT_SHA:?S22_API_GIT_COMMIT_SHA is required}"
: "${TF_VAR_api_deployment_timestamp:?TF_VAR_api_deployment_timestamp is required}"
: "${TF_VAR_api_image:?TF_VAR_api_image is required}"
: "${TF_VAR_api_migration_head:?TF_VAR_api_migration_head is required}"
: "${TF_VAR_web_image:?TF_VAR_web_image is required}"

EVIDENCE="s22-api-image-live-evidence.txt"
LIVE_SERVICE="$(mktemp)"
LIVE_WEB_SERVICE="$(mktemp)"
FAILURES=0
trap 'rm -f "$LIVE_SERVICE" "$LIVE_WEB_SERVICE"' EXIT

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
  if [[ "$1" == "$2" ]]; then printf 'PASS'; else printf 'FAIL'; fi
}

matches_resource_name() {
  if [[ "$1" == "$2" || "$1" == */"$2" ]]; then printf 'PASS'; else printf 'FAIL'; fi
}

ACCESS_TOKEN="$(gcloud auth print-access-token)"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/lead-agent-staging-api" \
  > "$LIVE_SERVICE"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/services/lead-agent-staging-web" \
  > "$LIVE_WEB_SERVICE"
unset ACCESS_TOKEN

SERVICE_ACCOUNT="$(jq -r '.template.serviceAccount // ""' "$LIVE_SERVICE")"
IMAGE="$(jq -r '.template.containers[0].image // ""' "$LIVE_SERVICE")"
NETWORK="$(jq -r '.template.vpcAccess.networkInterfaces[0].network // ""' "$LIVE_SERVICE")"
SUBNETWORK="$(jq -r '.template.vpcAccess.networkInterfaces[0].subnetwork // ""' "$LIVE_SERVICE")"
EGRESS="$(jq -r '.template.vpcAccess.egress // ""' "$LIVE_SERVICE")"
GIT_COMMIT="$(jq -r '[.template.containers[0].env[]? | select(.name == "DEPLOYMENT_GIT_SHA")][0].value // ""' "$LIVE_SERVICE")"
DEPLOYMENT_TIMESTAMP="$(jq -r '[.template.containers[0].env[]? | select(.name == "DEPLOYMENT_TIMESTAMP")][0].value // ""' "$LIVE_SERVICE")"
IMAGE_DIGEST="$(jq -r '[.template.containers[0].env[]? | select(.name == "DEPLOYMENT_IMAGE_DIGEST")][0].value // ""' "$LIVE_SERVICE")"
MIGRATION_HEAD="$(jq -r '[.template.containers[0].env[]? | select(.name == "DEPLOYMENT_MIGRATION_HEAD")][0].value // ""' "$LIVE_SERVICE")"
SECRET_COUNT="$(jq -r '[.template.containers[0].env[]? | select(.valueSource.secretKeyRef != null)] | length' "$LIVE_SERVICE")"
READY="$(jq -r '.terminalCondition.state // ([.conditions[]? | select(.type == "Ready")][0].state) // ""' "$LIVE_SERVICE")"
REVISION="$(jq -r '.latestReadyRevision // ""' "$LIVE_SERVICE")"
REVISION_SHORT="${REVISION##*/}"
WEB_IMAGE="$(jq -r '.template.containers[0].image // ""' "$LIVE_WEB_SERVICE")"
WEB_READY="$(jq -r '.terminalCondition.state // ([.conditions[]? | select(.type == "Ready")][0].state) // ""' "$LIVE_WEB_SERVICE")"
WEB_REVISION="$(jq -r '.latestReadyRevision // ""' "$LIVE_WEB_SERVICE")"
WEB_REVISION_SHORT="${WEB_REVISION##*/}"

report_check service_account "$SERVICE_ACCOUNT" "lead-agent-staging-api@${PROJECT_ID}.iam.gserviceaccount.com" "$(matches "$SERVICE_ACCOUNT" "lead-agent-staging-api@${PROJECT_ID}.iam.gserviceaccount.com")"
report_check image "$IMAGE" "$TF_VAR_api_image" "$(matches "$IMAGE" "$TF_VAR_api_image")"
report_check vpc_network "$NETWORK" 'lead-agent-staging-vpc' "$(matches_resource_name "$NETWORK" 'lead-agent-staging-vpc')"
report_check vpc_subnetwork "$SUBNETWORK" 'lead-agent-staging-cloud-run' "$(matches_resource_name "$SUBNETWORK" 'lead-agent-staging-cloud-run')"
report_check vpc_egress "$EGRESS" 'PRIVATE_RANGES_ONLY' "$(matches "$EGRESS" 'PRIVATE_RANGES_ONLY')"
report_check deployment_git_sha "$GIT_COMMIT" "$S22_API_GIT_COMMIT_SHA" "$(matches "$GIT_COMMIT" "$S22_API_GIT_COMMIT_SHA")"
report_check deployment_timestamp "$DEPLOYMENT_TIMESTAMP" "$TF_VAR_api_deployment_timestamp" "$(matches "$DEPLOYMENT_TIMESTAMP" "$TF_VAR_api_deployment_timestamp")"
report_check deployment_image_digest "$IMAGE_DIGEST" "$TF_VAR_api_image" "$(matches "$IMAGE_DIGEST" "$TF_VAR_api_image")"
report_check deployment_migration_head "$MIGRATION_HEAD" "$TF_VAR_api_migration_head" "$(matches "$MIGRATION_HEAD" "$TF_VAR_api_migration_head")"
report_check secret_reference_count "$SECRET_COUNT" '15' "$(matches "$SECRET_COUNT" '15')"
report_check ready "$READY" 'CONDITION_SUCCEEDED' "$(matches "$READY" 'CONDITION_SUCCEEDED')"
if [[ "$REVISION_SHORT" =~ ^lead-agent-staging-api-[0-9]{5}-[a-z0-9]+$ ]]; then REVISION_RESULT=PASS; else REVISION_RESULT=FAIL; fi
report_check latest_ready_revision "$REVISION" 'lead-agent-staging-api-<revision>' "$REVISION_RESULT"
report_check web_image "$WEB_IMAGE" "$TF_VAR_web_image" "$(matches "$WEB_IMAGE" "$TF_VAR_web_image")"
report_check web_ready "$WEB_READY" 'CONDITION_SUCCEEDED' "$(matches "$WEB_READY" 'CONDITION_SUCCEEDED')"
if [[ "$WEB_REVISION_SHORT" =~ ^lead-agent-staging-web-[0-9]{5}-[a-z0-9]+$ ]]; then WEB_REVISION_RESULT=PASS; else WEB_REVISION_RESULT=FAIL; fi
report_check web_latest_ready_revision "$WEB_REVISION" 'lead-agent-staging-web-<revision>' "$WEB_REVISION_RESULT"

set +e
terraform plan -detailed-exitcode -lock-timeout=5m > /dev/null
PLAN_EXIT_CODE=$?
set -e
report_check terraform_convergence_exit_code "$PLAN_EXIT_CODE" '0' "$(matches "$PLAN_EXIT_CODE" '0')"

if (( FAILURES > 0 )); then
  printf 'api_image_live_verification=FAIL failures=%s\n' "$FAILURES" | tee -a "$EVIDENCE"
  exit 1
fi

echo 'api_image_live_verification=PASS failures=0' | tee -a "$EVIDENCE"
