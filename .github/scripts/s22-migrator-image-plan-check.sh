#!/usr/bin/env bash

set -euo pipefail

PLAN_PATH="${1:?saved Terraform plan path is required}"
EXPECTED_IMAGE="${2:?expected migrator image is required}"
EXPECTED_COMMIT="${3:?expected migrator commit is required}"
EXPECTED_TIMESTAMP="${4:?expected migrator deployment timestamp is required}"
PLAN_DIR="$(dirname "$PLAN_PATH")"
PLAN_NAME="$(basename "$PLAN_PATH")"
PLAN_JSON="$(mktemp)"
trap 'rm -f "$PLAN_JSON"' EXIT

terraform -chdir="$PLAN_DIR" show -json "$PLAN_NAME" > "$PLAN_JSON"

jq -e \
  --arg commit "$EXPECTED_COMMIT" \
  --arg image "$EXPECTED_IMAGE" \
  --arg timestamp "$EXPECTED_TIMESTAMP" '
  .variables.project_id.value == "lead-agent-stg-739284"
    and .variables.region.value == "me-central1"
    and .variables.git_commit_sha.value == "2396fdf797eb4b19252a34c8b45e93945a8f53a3"
    and .variables.deployment_timestamp.value == "2026-09-26T09:53:56Z"
    and .variables.migrator_git_commit_sha.value == $commit
    and .variables.migrator_deployment_timestamp.value == $timestamp
    and .variables.migrator_image.value == $image
    and .variables.deploy_runtime.value == "true"
    and .variables.bootstrap_runtime.value == "true"
    and .variables.prepare_migration.value == "true"
    and .variables.cloud_sql_activation_policy.value == "ALWAYS"
    and .variables.cloud_sql_tier.value == "db-f1-micro"
    and .variables.api_max_instance_count.value == "1"
    and .variables.web_max_instance_count.value == "1"
    and .variables.worker_instance_count.value == "0"
' "$PLAN_JSON" > /dev/null

ACTUAL_ACTIONS="$(
  jq -c '
    [.resource_changes[]
     | select(.mode == "managed" and .change.actions != ["no-op"])
     | ((.change.actions | join(",")) + ":" + .address)]
    | sort
  ' "$PLAN_JSON"
)"
[[ "$ACTUAL_ACTIONS" == '["update:google_cloud_run_v2_job.migrator[0]"]' ]]

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
   | select(.address == "google_cloud_run_v2_job.migrator[0]")
   | .change] as $changes
  | ($changes | length) == 1
    and $changes[0].actions == ["update"]
    and ($changes[0].replace_paths | length) == 0
    and $changes[0].before.name == "lead-agent-staging-migrator"
    and $changes[0].after.name == "lead-agent-staging-migrator"
    and $changes[0].before.deletion_protection == true
    and $changes[0].after.deletion_protection == true
    and $changes[0].after.location == "me-central1"
    and $changes[0].before.template[0].task_count == $changes[0].after.template[0].task_count
    and $changes[0].after.template[0].task_count == 1
    and $changes[0].before.template[0].parallelism == $changes[0].after.template[0].parallelism
    and $changes[0].after.template[0].parallelism == 1
    and $changes[0].before.template[0].template[0].service_account == $changes[0].after.template[0].template[0].service_account
    and $changes[0].after.template[0].template[0].service_account == "lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com"
    and $changes[0].before.template[0].template[0].max_retries == $changes[0].after.template[0].template[0].max_retries
    and $changes[0].after.template[0].template[0].max_retries == 0
    and $changes[0].before.template[0].template[0].timeout == $changes[0].after.template[0].template[0].timeout
    and $changes[0].after.template[0].template[0].timeout == "900s"
    and $changes[0].before.template[0].template[0].vpc_access == $changes[0].after.template[0].template[0].vpc_access
    and $changes[0].after.template[0].template[0].vpc_access[0].egress == "PRIVATE_RANGES_ONLY"
    and ($changes[0].after.template[0].template[0].vpc_access[0].network_interfaces[0].network | endswith("/networks/lead-agent-staging-vpc"))
    and ($changes[0].after.template[0].template[0].vpc_access[0].network_interfaces[0].subnetwork | endswith("/subnetworks/lead-agent-staging-cloud-run"))
    and $changes[0].before.template[0].template[0].containers[0].command == $changes[0].after.template[0].template[0].containers[0].command
    and $changes[0].after.template[0].template[0].containers[0].command == ["node"]
    and $changes[0].before.template[0].template[0].containers[0].args == $changes[0].after.template[0].template[0].containers[0].args
    and $changes[0].after.template[0].template[0].containers[0].args == ["dist/index.js"]
    and $changes[0].before.template[0].template[0].containers[0].resources == $changes[0].after.template[0].template[0].containers[0].resources
    and $changes[0].before.template[0].template[0].containers[0].image != $image
    and $changes[0].after.template[0].template[0].containers[0].image == $image
    and ($changes[0].after.labels["git-sha"] == ($commit[0:12]))
    and any($changes[0].after.template[0].template[0].containers[0].env[]; .name == "DEPLOYMENT_GIT_SHA" and .value == $commit)
    and any($changes[0].after.template[0].template[0].containers[0].env[]; .name == "DEPLOYMENT_TIMESTAMP" and .value == $timestamp)
    and any($changes[0].after.template[0].template[0].containers[0].env[]; .name == "DEPLOYMENT_IMAGE_DIGEST" and .value == $image)
    and ([ $changes[0].before.template[0].template[0].containers[0].env[]
           | select(.value_source != null and .value_source != [])
           | {name, value_source} ]
         == [ $changes[0].after.template[0].template[0].containers[0].env[]
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

echo "migrator_image_plan_creates=$CREATE_COUNT"
echo "migrator_image_plan_changes=$CHANGE_COUNT"
echo "migrator_image_plan_destroys=$DESTROY_COUNT"
echo "migrator_image_plan_replacements=$REPLACE_COUNT"
echo "migrator_image_plan_actions=$ACTUAL_ACTIONS"
echo "migrator_image_plan_unexpected_actions=NONE"
