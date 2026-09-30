#!/usr/bin/env bash

set -euo pipefail

PLAN_PATH="${1:?saved Terraform plan path is required}"
EXPECTED_IMAGE="${2:?expected API image is required}"
EXPECTED_COMMIT="${3:?expected API commit is required}"
EXPECTED_TIMESTAMP="${4:?expected API deployment timestamp is required}"
EXPECTED_RUNTIME_COMMIT="${5:?expected preserved runtime commit is required}"
EXPECTED_RUNTIME_TIMESTAMP="${6:?expected preserved runtime deployment timestamp is required}"
EXPECTED_RUNTIME_MIGRATION_HEAD="${7:?expected preserved runtime migration head is required}"
EXPECTED_WEB_IMAGE="${8:?expected preserved Web image is required}"
EXPECTED_WORKER_IMAGE="${9:?expected preserved Worker image is required}"
EXPECTED_MIGRATOR_IMAGE="${10:?expected preserved migrator image is required}"
EXPECTED_MIGRATOR_COMMIT="${11:?expected preserved migrator commit is required}"
EXPECTED_MIGRATOR_TIMESTAMP="${12:?expected preserved migrator deployment timestamp is required}"
PLAN_DIR="$(dirname "$PLAN_PATH")"
PLAN_NAME="$(basename "$PLAN_PATH")"
PLAN_JSON="$(mktemp)"
trap 'rm -f "$PLAN_JSON"' EXIT

terraform -chdir="$PLAN_DIR" show -json "$PLAN_NAME" > "$PLAN_JSON"

jq -e \
  --arg api_commit "$EXPECTED_COMMIT" \
  --arg api_image "$EXPECTED_IMAGE" \
  --arg api_timestamp "$EXPECTED_TIMESTAMP" \
  --arg runtime_commit "$EXPECTED_RUNTIME_COMMIT" \
  --arg runtime_timestamp "$EXPECTED_RUNTIME_TIMESTAMP" \
  --arg runtime_migration_head "$EXPECTED_RUNTIME_MIGRATION_HEAD" \
  --arg web_image "$EXPECTED_WEB_IMAGE" \
  --arg worker_image "$EXPECTED_WORKER_IMAGE" \
  --arg migrator_image "$EXPECTED_MIGRATOR_IMAGE" \
  --arg migrator_commit "$EXPECTED_MIGRATOR_COMMIT" \
  --arg migrator_timestamp "$EXPECTED_MIGRATOR_TIMESTAMP" '
  .variables.project_id.value == "lead-agent-stg-739284"
    and .variables.region.value == "me-central1"
    and .variables.git_commit_sha.value == $runtime_commit
    and .variables.deployment_timestamp.value == $runtime_timestamp
    and .variables.api_git_commit_sha.value == $api_commit
    and .variables.api_deployment_timestamp.value == $api_timestamp
    and .variables.migration_head.value == "0030_s22_first_tenant_bootstrap"
    and .variables.runtime_migration_head.value == $runtime_migration_head
    and .variables.api_image.value == $api_image
    and .variables.web_image.value == $web_image
    and .variables.worker_image.value == $worker_image
    and .variables.migrator_image.value == $migrator_image
    and .variables.migrator_git_commit_sha.value == $migrator_commit
    and .variables.migrator_deployment_timestamp.value == $migrator_timestamp
    and .variables.deploy_runtime.value == "true"
    and .variables.bootstrap_runtime.value == "false"
    and .variables.prepare_migration.value == "true"
    and .variables.cloud_sql_activation_policy.value == "ALWAYS"
    and .variables.cloud_sql_tier.value == "db-f1-micro"
    and .variables.api_max_instance_count.value == "1"
    and .variables.web_max_instance_count.value == "1"
    and .variables.worker_instance_count.value == "1"
' "$PLAN_JSON" > /dev/null

ACTUAL_ACTIONS="$(
  jq -c '
    [.resource_changes[]
     | select(.mode == "managed" and .change.actions != ["no-op"])
     | ((.change.actions | join(",")) + ":" + .address)]
    | sort
  ' "$PLAN_JSON"
)"
[[ "$ACTUAL_ACTIONS" == '["update:google_cloud_run_v2_service.api[0]"]' ]]

jq -e '
  [.resource_changes[]
   | select(.mode == "data" and .change.actions != ["no-op"])]
  | all(.[];
      .address == "data.google_project.staging"
        and .change.actions == ["read"])
' "$PLAN_JSON" > /dev/null

jq -e \
  --arg commit "$EXPECTED_COMMIT" \
  --arg image "$EXPECTED_IMAGE" \
  --arg timestamp "$EXPECTED_TIMESTAMP" '
  [.resource_changes[]
   | select(.address == "google_cloud_run_v2_service.api[0]")
   | .change] as $changes
  | ($changes | length) == 1
    and $changes[0].actions == ["update"]
    and ($changes[0].replace_paths | length) == 0
    and $changes[0].before.name == "lead-agent-staging-api"
    and $changes[0].after.name == "lead-agent-staging-api"
    and $changes[0].before.deletion_protection == true
    and $changes[0].after.deletion_protection == true
    and $changes[0].after.location == "me-central1"
    and $changes[0].before.ingress == $changes[0].after.ingress
    and $changes[0].after.ingress == "INGRESS_TRAFFIC_ALL"
    and $changes[0].before.template[0].service_account == $changes[0].after.template[0].service_account
    and $changes[0].after.template[0].service_account == "lead-agent-staging-api@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $changes[0].before.template[0].vpc_access == $changes[0].after.template[0].vpc_access
    and $changes[0].after.template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
    and ($changes[0].after.template[0].vpc_access[0].network_interfaces[0].network | endswith("/networks/lead-agent-staging-vpc"))
    and ($changes[0].after.template[0].vpc_access[0].network_interfaces[0].subnetwork | endswith("/subnetworks/lead-agent-staging-cloud-run"))
    and $changes[0].before.template[0].containers[0].resources == $changes[0].after.template[0].containers[0].resources
    and $changes[0].before.template[0].containers[0].image != $image
    and $changes[0].after.template[0].containers[0].image == $image
    and ($changes[0].after.labels["git-sha"] == ($commit[0:12]))
    and any($changes[0].after.template[0].containers[0].env[]; .name == "DEPLOYMENT_GIT_SHA" and .value == $commit)
    and any($changes[0].after.template[0].containers[0].env[]; .name == "DEPLOYMENT_MIGRATION_HEAD" and .value == "0030_s22_first_tenant_bootstrap")
    and any($changes[0].after.template[0].containers[0].env[]; .name == "DEPLOYMENT_TIMESTAMP" and .value == $timestamp)
    and any($changes[0].after.template[0].containers[0].env[]; .name == "DEPLOYMENT_IMAGE_DIGEST" and .value == $image)
    and ([ $changes[0].before.template[0].containers[0].env[]
           | select(.value_source != null and .value_source != [])
           | {name, value_source} ]
         == [ $changes[0].after.template[0].containers[0].env[]
              | select(.value_source != null and .value_source != [])
              | {name, value_source} ])
' "$PLAN_JSON" > /dev/null

CREATE_COUNT="$(jq '[.resource_changes[] | select(.change.actions == ["create"])] | length' "$PLAN_JSON")"
CHANGE_COUNT="$(jq '[.resource_changes[] | select(.change.actions == ["update"])] | length' "$PLAN_JSON")"
DESTROY_COUNT="$(jq '[.resource_changes[] | select(.change.actions == ["delete"])] | length' "$PLAN_JSON")"
REPLACE_COUNT="$(jq '[.resource_changes[] | select(.change.actions == ["delete", "create"] or .change.actions == ["create", "delete"])] | length' "$PLAN_JSON")"

[[ "$CREATE_COUNT" == "0" ]]
[[ "$CHANGE_COUNT" == "1" ]]
[[ "$DESTROY_COUNT" == "0" ]]
[[ "$REPLACE_COUNT" == "0" ]]

echo "api_image_plan_creates=$CREATE_COUNT"
echo "api_image_plan_changes=$CHANGE_COUNT"
echo "api_image_plan_destroys=$DESTROY_COUNT"
echo "api_image_plan_replacements=$REPLACE_COUNT"
echo "api_image_plan_actions=$ACTUAL_ACTIONS"
echo "api_image_plan_unexpected_actions=NONE"
