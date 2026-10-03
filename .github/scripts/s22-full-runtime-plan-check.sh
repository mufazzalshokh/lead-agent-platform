#!/usr/bin/env bash

set -euo pipefail

PLAN_PATH="${1:?usage: s22-full-runtime-plan-check.sh <saved-plan>}"
PLAN_DIRECTORY="$(cd "$(dirname "$PLAN_PATH")" && pwd)"
PLAN_FILENAME="$(basename "$PLAN_PATH")"
PLAN_JSON="$(mktemp)"
trap 'rm -f "$PLAN_JSON"' EXIT

terraform -chdir="$PLAN_DIRECTORY" show -json "$PLAN_FILENAME" > "$PLAN_JSON"

jq -e --arg project "$TF_VAR_project_id" --arg region "$TF_VAR_region" \
  --arg commit "$TF_VAR_git_commit_sha" --arg timestamp "$TF_VAR_deployment_timestamp" \
  --arg api_image "$TF_VAR_api_image" --arg web_image "$TF_VAR_web_image" \
  --arg worker_image "$TF_VAR_worker_image" --arg migrator_image "$TF_VAR_migrator_image" \
  --arg api_origin "$TF_VAR_api_public_origin" --arg web_origin "$TF_VAR_web_public_origin" '
  .variables.project_id.value == $project
    and .variables.region.value == $region
    and .variables.git_commit_sha.value == $commit
    and .variables.deployment_timestamp.value == $timestamp
    and .variables.api_image.value == $api_image
    and .variables.web_image.value == $web_image
    and .variables.worker_image.value == $worker_image
    and .variables.migrator_image.value == $migrator_image
    and .variables.api_public_origin.value == $api_origin
    and .variables.web_public_origin.value == $web_origin
    and .variables.deploy_runtime.value == "true"
    and .variables.bootstrap_runtime.value == "false"
    and .variables.prepare_migration.value == "true"
    and .variables.cloud_sql_activation_policy.value == "ALWAYS"
    and .variables.cloud_sql_tier.value == "db-f1-micro"
    and .variables.api_max_instance_count.value == "1"
    and .variables.web_max_instance_count.value == "1"
    and .variables.worker_instance_count.value == "1"
    and .variables.worker_memory.value == "512Mi"
    and .variables.migration_head.value == "0031_s22_widget_inbound_route_management"
' "$PLAN_JSON" > /dev/null

INITIAL_ACTIONS='["create:google_cloud_run_v2_worker_pool.worker[0]","update:google_cloud_run_v2_job.migrator[0]","update:google_cloud_run_v2_service.api[0]","update:google_cloud_run_v2_service.web[0]"]'
RECONCILIATION_ACTIONS='["update:google_cloud_run_v2_job.migrator[0]","update:google_cloud_run_v2_service.api[0]","update:google_cloud_run_v2_service.web[0]","update:google_cloud_run_v2_worker_pool.worker[0]"]'
ACTUAL_ACTIONS="$(
  jq -c '
    [.resource_changes[]
     | select(.mode == "managed" and .change.actions != ["no-op"])
     | ((.change.actions | join(",")) + ":" + .address)]
    | sort
  ' "$PLAN_JSON"
)"

case "$ACTUAL_ACTIONS" in
  "$INITIAL_ACTIONS")
    CREATE_COUNT=1
    UPDATE_COUNT=3
    PLAN_MODE=initial
    ;;
  "$RECONCILIATION_ACTIONS")
    CREATE_COUNT=0
    UPDATE_COUNT=4
    PLAN_MODE=reconciliation
    ;;
  *)
    echo "Unexpected full-runtime action set: $ACTUAL_ACTIONS" >&2
    exit 1
    ;;
esac

jq -e '
  [.resource_changes[]
   | select(.mode == "data" and .change.actions != ["no-op"])]
  | all(.[];
      .address == "data.google_project.staging"
        and .change.actions == ["read"])
' "$PLAN_JSON" > /dev/null

jq -e --arg image "$TF_VAR_api_image" '
  [.resource_changes[]
   | select(.address == "google_cloud_run_v2_service.api[0]")
   | .change.after] as $api
  | ($api | length) == 1
    and $api[0].deletion_protection == true
    and $api[0].ingress == "INGRESS_TRAFFIC_ALL"
    and $api[0].template[0].service_account == "lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $api[0].template[0].containers[0].image == $image
    and ($api[0].template[0].containers[0].command == null or $api[0].template[0].containers[0].command == [])
    and ($api[0].template[0].containers[0].args == null or $api[0].template[0].containers[0].args == [])
    and $api[0].template[0].scaling[0].min_instance_count == 0
    and $api[0].template[0].scaling[0].max_instance_count == 1
    and $api[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
' "$PLAN_JSON" > /dev/null

jq -e --arg image "$TF_VAR_web_image" '
  [.resource_changes[]
   | select(.address == "google_cloud_run_v2_service.web[0]")
   | .change.after] as $web
  | ($web | length) == 1
    and $web[0].deletion_protection == true
    and $web[0].ingress == "INGRESS_TRAFFIC_ALL"
    and $web[0].template[0].service_account == "lead-agent-staging-web@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $web[0].template[0].containers[0].image == $image
    and ($web[0].template[0].containers[0].command == null or $web[0].template[0].containers[0].command == [])
    and ($web[0].template[0].containers[0].args == null or $web[0].template[0].containers[0].args == [])
    and $web[0].template[0].scaling[0].min_instance_count == 0
    and $web[0].template[0].scaling[0].max_instance_count == 1
    and $web[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
' "$PLAN_JSON" > /dev/null

jq -e --arg image "$TF_VAR_worker_image" '
  [.resource_changes[]
   | select(.address == "google_cloud_run_v2_worker_pool.worker[0]")
   | .change.after] as $worker
  | ($worker | length) == 1
    and $worker[0].scaling[0].scaling_mode == "MANUAL"
    and $worker[0].scaling[0].manual_instance_count == 1
    and $worker[0].template[0].service_account == "lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $worker[0].template[0].containers[0].image == $image
    and $worker[0].template[0].containers[0].resources[0].limits.cpu == "1"
    and $worker[0].template[0].containers[0].resources[0].limits.memory == "512Mi"
    and $worker[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
' "$PLAN_JSON" > /dev/null

jq -e --arg image "$TF_VAR_migrator_image" '
  [.resource_changes[]
   | select(.address == "google_cloud_run_v2_job.migrator[0]")
   | .change.after] as $migrator
  | ($migrator | length) == 1
    and $migrator[0].deletion_protection == true
    and $migrator[0].template[0].task_count == 1
    and $migrator[0].template[0].parallelism == 1
    and $migrator[0].template[0].template[0].service_account == "lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $migrator[0].template[0].template[0].max_retries == 0
    and $migrator[0].template[0].template[0].containers[0].image == $image
    and $migrator[0].template[0].template[0].containers[0].command == ["node"]
    and $migrator[0].template[0].template[0].containers[0].args == ["dist/index.js"]
    and $migrator[0].template[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
' "$PLAN_JSON" > /dev/null

jq -e '[.resource_changes[] | select(.change.actions == ["delete"])] | length == 0' "$PLAN_JSON" > /dev/null
jq -e '[.resource_changes[] | select(.change.actions == ["delete", "create"] or .change.actions == ["create", "delete"])] | length == 0' "$PLAN_JSON" > /dev/null

printf '%s\n' \
  "full_runtime_plan_mode=$PLAN_MODE" \
  "full_runtime_plan_creates=$CREATE_COUNT" \
  "full_runtime_plan_changes=$UPDATE_COUNT" \
  "full_runtime_plan_destroys=0" \
  "full_runtime_plan_replacements=0" \
  "full_runtime_plan_actions=$ACTUAL_ACTIONS" \
  "full_runtime_public_iam_changes=NONE" \
  "full_runtime_migrator_execution=DISABLED" \
  "full_runtime_unexpected_actions=NONE"
