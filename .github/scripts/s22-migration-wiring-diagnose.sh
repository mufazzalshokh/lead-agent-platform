#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"

JOB_NAME="lead-agent-staging-migrator"
MIGRATOR_SERVICE_ACCOUNT="lead-agent-staging-migrator@${PROJECT_ID}.iam.gserviceaccount.com"
FAILED_EXECUTION="lead-agent-staging-migrator-bkcxf"
EVIDENCE="s22-migration-wiring-diagnostic-evidence.txt"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

report() {
  printf '%s=%s\n' "$1" "$2" | tee -a "$EVIDENCE"
}

matches_resource_name() {
  local actual="$1"
  local short_name="$2"
  [[ "$actual" == "$short_name" || "$actual" == */"$short_name" ]]
}

ACCESS_TOKEN="$(gcloud auth print-access-token)"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}" \
  > "$WORK_DIR/live-job.json"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions/${FAILED_EXECUTION}" \
  > "$WORK_DIR/failed-execution.json"

terraform -chdir=infra/deploy/gcp/staging show -json > "$WORK_DIR/terraform-state.json"
jq -e '
  .values.root_module.resources[]
  | select(.address == "google_cloud_run_v2_job.migrator[0]")
' "$WORK_DIR/terraform-state.json" > "$WORK_DIR/terraform-migrator.json"

LIVE_SERVICE_ACCOUNT="$(jq -r '.template.template.serviceAccount // ""' "$WORK_DIR/live-job.json")"
LIVE_IMAGE="$(jq -r '.template.template.containers[0].image // ""' "$WORK_DIR/live-job.json")"
LIVE_NETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].network // ""' "$WORK_DIR/live-job.json")"
LIVE_SUBNETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].subnetwork // ""' "$WORK_DIR/live-job.json")"
LIVE_EGRESS="$(jq -r '.template.template.vpcAccess.egress // ""' "$WORK_DIR/live-job.json")"

report live_job_service_account "$LIVE_SERVICE_ACCOUNT"
report live_job_service_account_matches "$([[ "$LIVE_SERVICE_ACCOUNT" == "$MIGRATOR_SERVICE_ACCOUNT" ]] && echo true || echo false)"
report live_job_image "$LIVE_IMAGE"
report live_job_image_digest_pinned "$([[ "$LIVE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] && echo true || echo false)"
report live_job_vpc_network "$LIVE_NETWORK"
report live_job_vpc_subnetwork "$LIVE_SUBNETWORK"
report live_job_vpc_egress "$LIVE_EGRESS"
report live_job_vpc_network_matches "$({ matches_resource_name "$LIVE_NETWORK" lead-agent-staging-vpc; } && echo true || echo false)"
report live_job_vpc_subnetwork_matches "$({ matches_resource_name "$LIVE_SUBNETWORK" lead-agent-staging-cloud-run; } && echo true || echo false)"
report live_job_vpc_egress_matches "$([[ "$LIVE_EGRESS" == "PRIVATE_RANGES_ONLY" ]] && echo true || echo false)"

declare -A EXPECTED_SECRETS=(
  [AUTH_DATABASE_URL]="lead-agent-staging-auth-database-url"
  [DATABASE_URL]="lead-agent-staging-runtime-database-url"
  [INGRESS_DATABASE_URL]="lead-agent-staging-ingress-database-url"
  [MIGRATION_DATABASE_URL]="lead-agent-staging-migration-database-url"
  [QUEUE_DATABASE_URL]="lead-agent-staging-queue-database-url"
)

declare -A EXPECTED_USERS=(
  [AUTH_DATABASE_URL]="lead_agent_auth"
  [DATABASE_URL]="lead_agent_runtime"
  [INGRESS_DATABASE_URL]="lead_agent_ingress"
  [MIGRATION_DATABASE_URL]="postgres"
  [QUEUE_DATABASE_URL]="lead_agent_queue_runtime"
)

for key in AUTH_DATABASE_URL DATABASE_URL INGRESS_DATABASE_URL MIGRATION_DATABASE_URL QUEUE_DATABASE_URL; do
  EXPECTED_SECRET="${EXPECTED_SECRETS[$key]}"
  LIVE_SECRET="$(
    jq -r --arg key "$key" '
      [.template.template.containers[0].env[]? | select(.name == $key)][0].valueSource.secretKeyRef.secret // ""
    ' "$WORK_DIR/live-job.json"
  )"
  LIVE_VERSION="$(
    jq -r --arg key "$key" '
      [.template.template.containers[0].env[]? | select(.name == $key)][0].valueSource.secretKeyRef.version // ""
    ' "$WORK_DIR/live-job.json"
  )"
  report "live_env_${key}_present" "$([[ -n "$LIVE_SECRET" ]] && echo true || echo false)"
  report "live_env_${key}_secret" "$LIVE_SECRET"
  report "live_env_${key}_secret_matches" "$({ matches_resource_name "$LIVE_SECRET" "$EXPECTED_SECRET"; } && echo true || echo false)"
  report "live_env_${key}_version" "$LIVE_VERSION"
  report "live_env_${key}_version_matches" "$([[ "$LIVE_VERSION" == "latest" ]] && echo true || echo false)"

  gcloud secrets get-iam-policy "$EXPECTED_SECRET" \
    --project="$PROJECT_ID" \
    --format=json > "$WORK_DIR/${key}-iam.json"
  if jq -e --arg member "serviceAccount:${MIGRATOR_SERVICE_ACCOUNT}" '
    any(.bindings[]?; .role == "roles/secretmanager.secretAccessor" and any(.members[]?; . == $member))
  ' "$WORK_DIR/${key}-iam.json" > /dev/null; then
    report "live_env_${key}_migrator_accessor" true
  else
    report "live_env_${key}_migrator_accessor" false
  fi
done

TF_SERVICE_ACCOUNT="$(jq -r '.values.template[0].template[0].service_account // ""' "$WORK_DIR/terraform-migrator.json")"
TF_IMAGE="$(jq -r '.values.template[0].template[0].containers[0].image // ""' "$WORK_DIR/terraform-migrator.json")"
TF_NETWORK="$(jq -r '.values.template[0].template[0].vpc_access[0].network_interfaces[0].network // ""' "$WORK_DIR/terraform-migrator.json")"
TF_SUBNETWORK="$(jq -r '.values.template[0].template[0].vpc_access[0].network_interfaces[0].subnetwork // ""' "$WORK_DIR/terraform-migrator.json")"
TF_EGRESS="$(jq -r '.values.template[0].template[0].vpc_access[0].egress // ""' "$WORK_DIR/terraform-migrator.json")"
report terraform_live_service_account_matches "$([[ "$TF_SERVICE_ACCOUNT" == "$LIVE_SERVICE_ACCOUNT" ]] && echo true || echo false)"
report terraform_live_image_matches "$([[ "$TF_IMAGE" == "$LIVE_IMAGE" ]] && echo true || echo false)"
report terraform_live_network_matches "$({ matches_resource_name "$TF_NETWORK" lead-agent-staging-vpc && matches_resource_name "$LIVE_NETWORK" lead-agent-staging-vpc; } && echo true || echo false)"
report terraform_live_subnetwork_matches "$({ matches_resource_name "$TF_SUBNETWORK" lead-agent-staging-cloud-run && matches_resource_name "$LIVE_SUBNETWORK" lead-agent-staging-cloud-run; } && echo true || echo false)"
report terraform_live_egress_matches "$([[ "$TF_EGRESS" == "$LIVE_EGRESS" ]] && echo true || echo false)"

FAILED_SERVICE_ACCOUNT="$(jq -r '.template.serviceAccount // ""' "$WORK_DIR/failed-execution.json")"
FAILED_IMAGE="$(jq -r '.template.containers[0].image // ""' "$WORK_DIR/failed-execution.json")"
FAILED_NETWORK="$(jq -r '.template.vpcAccess.networkInterfaces[0].network // ""' "$WORK_DIR/failed-execution.json")"
FAILED_SUBNETWORK="$(jq -r '.template.vpcAccess.networkInterfaces[0].subnetwork // ""' "$WORK_DIR/failed-execution.json")"
FAILED_EGRESS="$(jq -r '.template.vpcAccess.egress // ""' "$WORK_DIR/failed-execution.json")"
report failed_execution_name "$FAILED_EXECUTION"
report failed_execution_template_present "$(jq -r 'has("template")' "$WORK_DIR/failed-execution.json")"
report failed_execution_service_account "$FAILED_SERVICE_ACCOUNT"
report failed_execution_service_account_matches "$([[ "$FAILED_SERVICE_ACCOUNT" == "$MIGRATOR_SERVICE_ACCOUNT" ]] && echo true || echo false)"
report failed_execution_image "$FAILED_IMAGE"
report failed_execution_image_matches "$([[ "$FAILED_IMAGE" == "$LIVE_IMAGE" ]] && echo true || echo false)"
report failed_execution_network "$FAILED_NETWORK"
report failed_execution_network_matches "$({ matches_resource_name "$FAILED_NETWORK" lead-agent-staging-vpc; } && echo true || echo false)"
report failed_execution_subnetwork "$FAILED_SUBNETWORK"
report failed_execution_subnetwork_matches "$({ matches_resource_name "$FAILED_SUBNETWORK" lead-agent-staging-cloud-run; } && echo true || echo false)"
report failed_execution_egress "$FAILED_EGRESS"
report failed_execution_egress_matches "$([[ "$FAILED_EGRESS" == "PRIVATE_RANGES_ONLY" ]] && echo true || echo false)"

PROBE_SCRIPT="$WORK_DIR/probe.mjs"
cat > "$PROBE_SCRIPT" <<'EOF'
import net from "node:net";
import process from "node:process";

const mode = process.env.S22_PROBE_MODE;
const key = process.env.S22_PROBE_ENV_NAME;
const expectedUser = process.env.S22_PROBE_EXPECTED_USER;
const value = key ? process.env[key] : undefined;

if (mode === "length") {
  process.exit(Math.min(Buffer.byteLength(value ?? "", "utf8"), 255));
}

if (mode === "representation") {
  if (value === undefined) process.exit(1);
  if (value.length === 0) process.exit(2);
  const trimmed = value.trim();
  if (/^projects\/[^/]+\/secrets\/[^/]+(?:\/versions\/[^/]+)?$/u.test(trimmed)) process.exit(3);
  if (/^[{\[]/u.test(trimmed)) process.exit(4);
  if (/^(["']).*\1$/su.test(trimmed)) process.exit(5);
  if (/^[A-Z][A-Z0-9_]*=/u.test(trimmed)) process.exit(6);
  if (trimmed.startsWith("postgresql://")) process.exit(0);
  process.exit(7);
}

if (mode === "flags") {
  let parsed;
  try {
    parsed = typeof value === "string" ? new URL(value) : undefined;
  } catch {
    parsed = undefined;
  }
  let flags = 0;
  if (typeof value === "string") flags |= 1;
  if (value?.startsWith("postgresql://")) flags |= 2;
  if (parsed && decodeURIComponent(parsed.username) === expectedUser) flags |= 4;
  if (parsed && parsed.password.length > 0) flags |= 8;
  if (parsed?.hostname === "10.125.0.3") flags |= 16;
  if (parsed?.port === "5432") flags |= 32;
  if (parsed?.pathname === "/lead_agent_staging") flags |= 64;
  if (parsed?.searchParams.get("sslmode") === "require") flags |= 128;
  process.exit(flags);
}

if (mode === "network") {
  const result = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "10.125.0.3", port: 5432 });
    const finish = (code) => {
      socket.destroy();
      resolve(code);
    };
    socket.setTimeout(10000, () => finish(1));
    socket.once("connect", () => finish(0));
    socket.once("error", (error) => {
      const codes = { ECONNREFUSED: 2, EHOSTUNREACH: 3, ENETUNREACH: 4, ETIMEDOUT: 5 };
      finish(codes[error.code] ?? 6);
    });
  });
  process.exit(result);
}

process.exit(254);
EOF
PROBE_SCRIPT_B64="$(base64 -w0 "$PROBE_SCRIPT")"

run_encoded_probe() {
  local key="$1"
  local expected_user="$2"
  local mode="$3"
  gcloud run jobs execute "$JOB_NAME" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --task-timeout=60s \
    --args='--input-type=module,-e,eval(atob(process.env.S22_DIAGNOSTIC_SCRIPT_B64))' \
    --update-env-vars="S22_DIAGNOSTIC_SCRIPT_B64=$PROBE_SCRIPT_B64,S22_PROBE_ENV_NAME=$key,S22_PROBE_EXPECTED_USER=$expected_user,S22_PROBE_MODE=$mode" \
    --wait > /dev/null 2>&1 || true

  local execution_name
  execution_name="$(
    gcloud run jobs executions list \
      --job="$JOB_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --limit=1 \
      --sort-by='~metadata.creationTimestamp' \
      --format='value(metadata.name)'
  )"
  [[ -n "$execution_name" ]]
  local execution_id="${execution_name##*/}"
  curl --fail --silent --show-error \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions/${execution_id}/tasks?pageSize=1" \
    > "$WORK_DIR/latest-task.json"
  jq -er '
    if (.tasks | length) != 1 then
      error("expected exactly one Cloud Run task")
    else
      .tasks[0] as $task
      | ($task.lastAttemptResult // {}) as $result
      | if ($result | has("exitCode")) then
          $result.exitCode
        elif (($result.status.code // 0) == 0 and ($task.completionTime // "") != "") then
          0
        else
          error("task completed without a usable container exit code")
        end
    end
  ' "$WORK_DIR/latest-task.json"
}

decode_boolean() {
  local value="$1"
  local bit="$2"
  if (( (value & bit) == bit )); then
    printf 'true'
  else
    printf 'false'
  fi
}

representation_name() {
  case "$1" in
    0) echo RAW_POSTGRESQL_DSN ;;
    1) echo ABSENT ;;
    2) echo EMPTY ;;
    3) echo SECRET_RESOURCE_NAME ;;
    4) echo JSON_WRAPPER ;;
    5) echo QUOTED_VALUE ;;
    6) echo ENVIRONMENT_ASSIGNMENT ;;
    *) echo OTHER ;;
  esac
}

for key in AUTH_DATABASE_URL DATABASE_URL INGRESS_DATABASE_URL MIGRATION_DATABASE_URL QUEUE_DATABASE_URL; do
  LENGTH_CODE="$(run_encoded_probe "$key" "${EXPECTED_USERS[$key]}" length)"
  REPRESENTATION_CODE="$(run_encoded_probe "$key" "${EXPECTED_USERS[$key]}" representation)"
  FLAGS_CODE="$(run_encoded_probe "$key" "${EXPECTED_USERS[$key]}" flags)"
  report "runtime_${key}_present" "$(decode_boolean "$FLAGS_CODE" 1)"
  report "runtime_${key}_length" "$([[ "$LENGTH_CODE" == "255" ]] && echo '>=255' || echo "$LENGTH_CODE")"
  report "runtime_${key}_representation" "$(representation_name "$REPRESENTATION_CODE")"
  report "runtime_${key}_starts_postgresql" "$(decode_boolean "$FLAGS_CODE" 2)"
  report "runtime_${key}_expected_username" "$(decode_boolean "$FLAGS_CODE" 4)"
  report "runtime_${key}_password_component_present" "$(decode_boolean "$FLAGS_CODE" 8)"
  report "runtime_${key}_expected_host" "$(decode_boolean "$FLAGS_CODE" 16)"
  report "runtime_${key}_expected_port" "$(decode_boolean "$FLAGS_CODE" 32)"
  report "runtime_${key}_expected_database" "$(decode_boolean "$FLAGS_CODE" 64)"
  report "runtime_${key}_sslmode_require" "$(decode_boolean "$FLAGS_CODE" 128)"
done

NETWORK_CODE="$(run_encoded_probe UNUSED UNUSED network)"
DIAGNOSTIC_TASK_NETWORK="$(jq -r '.tasks[0].vpcAccess.networkInterfaces[0].network // ""' "$WORK_DIR/latest-task.json")"
DIAGNOSTIC_TASK_SUBNETWORK="$(jq -r '.tasks[0].vpcAccess.networkInterfaces[0].subnetwork // ""' "$WORK_DIR/latest-task.json")"
DIAGNOSTIC_TASK_EGRESS="$(jq -r '.tasks[0].vpcAccess.egress // ""' "$WORK_DIR/latest-task.json")"
report diagnostic_execution_vpc_network_matches "$({ matches_resource_name "$DIAGNOSTIC_TASK_NETWORK" lead-agent-staging-vpc; } && echo true || echo false)"
report diagnostic_execution_vpc_subnetwork_matches "$({ matches_resource_name "$DIAGNOSTIC_TASK_SUBNETWORK" lead-agent-staging-cloud-run; } && echo true || echo false)"
report diagnostic_execution_vpc_egress_matches "$([[ "$DIAGNOSTIC_TASK_EGRESS" == "PRIVATE_RANGES_ONLY" ]] && echo true || echo false)"
case "$NETWORK_CODE" in
  0) NETWORK_RESULT=CONNECTED ;;
  1) NETWORK_RESULT=TIMEOUT ;;
  2) NETWORK_RESULT=CONNECTION_REFUSED ;;
  3) NETWORK_RESULT=HOST_UNREACHABLE ;;
  4) NETWORK_RESULT=NETWORK_UNREACHABLE ;;
  5) NETWORK_RESULT=TIMED_OUT_ERROR ;;
  *) NETWORK_RESULT=OTHER_ERROR ;;
esac
report runtime_private_tcp_result "$NETWORK_RESULT"
unset ACCESS_TOKEN
