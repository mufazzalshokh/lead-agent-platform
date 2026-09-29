#!/usr/bin/env bash

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"

JOB_NAME="lead-agent-staging-migrator"
MIGRATOR_SERVICE_ACCOUNT="lead-agent-staging-migrator@${PROJECT_ID}.iam.gserviceaccount.com"
FAILED_EXECUTION="${FAILED_EXECUTION:-}"
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
if [[ -z "$FAILED_EXECUTION" ]]; then
  curl --fail --silent --show-error \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions?pageSize=100" \
    > "$WORK_DIR/executions.json"
  RECENT_INDEX=0
  while IFS=$'\t' read -r execution_name create_time failed_count succeeded_count running_count; do
    report "recent_execution_${RECENT_INDEX}" "${execution_name}|${create_time}|failed=${failed_count}|succeeded=${succeeded_count}|running=${running_count}"
    RECENT_INDEX=$((RECENT_INDEX + 1))
  done < <(
    jq -r '
      [.executions[]?
       | {
           create_time: (.createTime // "unavailable"),
           failed_count: (.failedCount // 0),
           name: (.name | split("/") | last),
           running_count: (.runningCount // 0),
           succeeded_count: (.succeededCount // 0)
         }]
      | sort_by(.create_time)
      | reverse
      | .[0:8][]
      | [.name, .create_time, .failed_count, .succeeded_count, .running_count]
      | @tsv
    ' "$WORK_DIR/executions.json"
  )
  FAILED_EXECUTION="$(
    jq -er '
      [.executions[]?
       | select((.failedCount // 0) > 0)
       | {name, createTime}]
      | sort_by(.createTime)
      | last
      | .name
      | split("/")
      | last
    ' "$WORK_DIR/executions.json"
  )"
fi
[[ "$FAILED_EXECUTION" =~ ^lead-agent-staging-migrator-[a-z0-9]+$ ]]
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}" \
  > "$WORK_DIR/live-job.json"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions/${FAILED_EXECUTION}" \
  > "$WORK_DIR/failed-execution.json"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions/${FAILED_EXECUTION}/tasks?pageSize=1" \
  > "$WORK_DIR/failed-task.json"

terraform -chdir=infra/deploy/gcp/staging show -json > "$WORK_DIR/terraform-state.json"
jq -e '
  .values.root_module.resources[]
  | select(.address == "google_cloud_run_v2_job.migrator[0]")
' "$WORK_DIR/terraform-state.json" > "$WORK_DIR/terraform-migrator.json"

LIVE_SERVICE_ACCOUNT="$(jq -r '.template.template.serviceAccount // ""' "$WORK_DIR/live-job.json")"
LIVE_IMAGE="$(jq -r '.template.template.containers[0].image // ""' "$WORK_DIR/live-job.json")"
LIVE_COMMAND="$(jq -c '.template.template.containers[0].command // []' "$WORK_DIR/live-job.json")"
LIVE_ARGS="$(jq -c '.template.template.containers[0].args // []' "$WORK_DIR/live-job.json")"
LIVE_NETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].network // ""' "$WORK_DIR/live-job.json")"
LIVE_SUBNETWORK="$(jq -r '.template.template.vpcAccess.networkInterfaces[0].subnetwork // ""' "$WORK_DIR/live-job.json")"
LIVE_EGRESS="$(jq -r '.template.template.vpcAccess.egress // ""' "$WORK_DIR/live-job.json")"
LIVE_GENERATION="$(jq -r '.generation // "unavailable"' "$WORK_DIR/live-job.json")"
LIVE_OBSERVED_GENERATION="$(jq -r '.observedGeneration // "unavailable"' "$WORK_DIR/live-job.json")"
LIVE_RECONCILING="$(jq -r '.reconciling // false' "$WORK_DIR/live-job.json")"
LIVE_TERMINAL_STATE="$(jq -r '.terminalCondition.state // "unavailable"' "$WORK_DIR/live-job.json")"
LIVE_TERMINAL_REASON="$(jq -r '.terminalCondition.reason // "unavailable"' "$WORK_DIR/live-job.json")"
LIVE_TERMINAL_REVISION_REASON="$(jq -r '.terminalCondition.revisionReason // "unavailable"' "$WORK_DIR/live-job.json")"
LIVE_UPDATE_TIME="$(jq -r '.updateTime // "unavailable"' "$WORK_DIR/live-job.json")"

report live_job_service_account "$LIVE_SERVICE_ACCOUNT"
report live_job_service_account_matches "$([[ "$LIVE_SERVICE_ACCOUNT" == "$MIGRATOR_SERVICE_ACCOUNT" ]] && echo true || echo false)"
report live_job_image "$LIVE_IMAGE"
report live_job_image_digest_pinned "$([[ "$LIVE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] && echo true || echo false)"
report live_job_command "$LIVE_COMMAND"
report live_job_args "$LIVE_ARGS"
report live_job_generation "$LIVE_GENERATION"
report live_job_observed_generation "$LIVE_OBSERVED_GENERATION"
report live_job_generation_observed "$([[ "$LIVE_GENERATION" == "$LIVE_OBSERVED_GENERATION" ]] && echo true || echo false)"
report live_job_reconciling "$LIVE_RECONCILING"
report live_job_terminal_state "$LIVE_TERMINAL_STATE"
report live_job_terminal_reason "$LIVE_TERMINAL_REASON"
report live_job_terminal_revision_reason "$LIVE_TERMINAL_REVISION_REASON"
report live_job_update_time "$LIVE_UPDATE_TIME"
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
FAILED_TASK_SERVICE_ACCOUNT="$(jq -r '.tasks[0].serviceAccount // ""' "$WORK_DIR/failed-task.json")"
FAILED_TASK_IMAGE="$(jq -r '.tasks[0].containers[0].image // ""' "$WORK_DIR/failed-task.json")"
FAILED_TASK_COMMAND="$(jq -c '.tasks[0].containers[0].command // []' "$WORK_DIR/failed-task.json")"
FAILED_TASK_ARGS="$(jq -c '.tasks[0].containers[0].args // []' "$WORK_DIR/failed-task.json")"
FAILED_TASK_ENV_NAMES="$(jq -c '[.tasks[0].containers[0].env[]?.name] | sort' "$WORK_DIR/failed-task.json")"
FAILED_TASK_DIAGNOSTIC_OVERRIDE="$(
  jq -r '
    any(.tasks[0].containers[0].env[]?; (.name | startswith("S22_DIAGNOSTIC_")) or (.name | startswith("S22_PROBE_")))
  ' "$WORK_DIR/failed-task.json"
)"
FAILED_TASK_NETWORK="$(jq -r '.tasks[0].vpcAccess.networkInterfaces[0].network // ""' "$WORK_DIR/failed-task.json")"
FAILED_TASK_SUBNETWORK="$(jq -r '.tasks[0].vpcAccess.networkInterfaces[0].subnetwork // ""' "$WORK_DIR/failed-task.json")"
FAILED_TASK_EGRESS="$(jq -r '.tasks[0].vpcAccess.egress // ""' "$WORK_DIR/failed-task.json")"
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
report failed_task_service_account "$FAILED_TASK_SERVICE_ACCOUNT"
report failed_task_service_account_matches "$([[ "$FAILED_TASK_SERVICE_ACCOUNT" == "$MIGRATOR_SERVICE_ACCOUNT" ]] && echo true || echo false)"
report failed_task_image "$FAILED_TASK_IMAGE"
report failed_task_image_matches "$([[ "$FAILED_TASK_IMAGE" == "$LIVE_IMAGE" ]] && echo true || echo false)"
report failed_task_command "$FAILED_TASK_COMMAND"
report failed_task_command_matches "$([[ "$FAILED_TASK_COMMAND" == "$LIVE_COMMAND" ]] && echo true || echo false)"
report failed_task_args "$FAILED_TASK_ARGS"
report failed_task_args_matches "$([[ "$FAILED_TASK_ARGS" == "$LIVE_ARGS" ]] && echo true || echo false)"
report failed_task_env_names "$FAILED_TASK_ENV_NAMES"
report failed_task_diagnostic_override_present "$FAILED_TASK_DIAGNOSTIC_OVERRIDE"
report failed_task_network "$FAILED_TASK_NETWORK"
report failed_task_network_matches "$({ matches_resource_name "$FAILED_TASK_NETWORK" lead-agent-staging-vpc; } && echo true || echo false)"
report failed_task_subnetwork "$FAILED_TASK_SUBNETWORK"
report failed_task_subnetwork_matches "$({ matches_resource_name "$FAILED_TASK_SUBNETWORK" lead-agent-staging-cloud-run; } && echo true || echo false)"
report failed_task_egress "$FAILED_TASK_EGRESS"
report failed_task_egress_matches "$([[ "$FAILED_TASK_EGRESS" == "PRIVATE_RANGES_ONLY" ]] && echo true || echo false)"
report failed_execution_task_exit_code "$(jq -r '.tasks[0].lastAttemptResult.exitCode // "unavailable"' "$WORK_DIR/failed-task.json")"
report failed_execution_task_status_code "$(jq -r '.tasks[0].lastAttemptResult.status.code // "unavailable"' "$WORK_DIR/failed-task.json")"

if gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${JOB_NAME}\" AND labels.\"run.googleapis.com/execution_name\"=\"${FAILED_EXECUTION}\"" \
  --project="$PROJECT_ID" \
  --freshness=24h \
  --limit=200 \
  --order=asc \
  --format=json > "$WORK_DIR/failed-execution-logs.json"; then
  ROOT_ERROR="$(node - "$WORK_DIR/failed-execution-logs.json" <<'NODE'
const fs = require("node:fs");
const entries = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const messages = entries
  .flatMap((entry) => [entry.textPayload, entry.jsonPayload?.message])
  .filter((value) => typeof value === "string" && value.trim().length > 0);
const selected = messages.find((message) => /(?:error|failed|migration|exception)/i.test(message)) ?? messages[0] ?? "unavailable";
const sanitized = selected
  .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgresql://[REDACTED]")
  .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 1200);
process.stdout.write(sanitized || "unavailable");
NODE
  )"
  report failed_execution_first_root_error "$ROOT_ERROR"
else
  report failed_execution_first_root_error unavailable
fi

PROBE_SCRIPT="$WORK_DIR/probe.mjs"
cat > "$PROBE_SCRIPT" <<'EOF'
(async () => {
const process = globalThis.process;

const mode = process.env.S22_PROBE_MODE;
const key = process.env.S22_PROBE_ENV_NAME;
const expectedUser = process.env.S22_PROBE_EXPECTED_USER;
const value = key ? process.env[key] : undefined;

const inspectMigrationFailure = async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { migrationsFolder } = await import("@lead-agent/database");
  const { Pool } = await import("pg");
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  const migrations = await Promise.all(
    journal.entries.map(async (entry) => ({
      folderMillis: entry.when,
      sql: (await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8"))
        .split("--> statement-breakpoint"),
    })),
  );
  const pool = new Pool({
    application_name: "lead-agent-staging-migration-rollback-diagnostic",
    connectionString: withLibpqCompatibleRequireSsl(process.env.MIGRATION_DATABASE_URL),
    connectionTimeoutMillis: 15000,
    max: 1,
    query_timeout: 30000,
  });
  const client = await pool.connect();
  try {
    const migrationTable = await client.query(
      "select to_regclass($$drizzle.__drizzle_migrations$$) is not null as present",
    );
    let lastApplied = -1;
    if (migrationTable.rows[0]?.present === true) {
      const latest = await client.query(
        "select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      lastApplied = Number(latest.rows[0]?.created_at ?? -1);
    }
    await client.query("begin");
    for (const [migrationIndex, migration] of migrations.entries()) {
      if (lastApplied >= migration.folderMillis) continue;
      for (const [statementIndex, statement] of migration.sql.entries()) {
        try {
          await client.query(statement);
        } catch (error) {
          return {
            errorCode: typeof error?.code === "string" ? error.code : "unavailable",
            migrationIndex,
            statementIndex,
          };
        }
      }
    }
    return { errorCode: "none", migrationIndex: -1, statementIndex: -1 };
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await pool.end().catch(() => {});
  }
};

if (mode === "migration_failure_index") {
  const failure = await inspectMigrationFailure();
  process.exit(failure.migrationIndex < 0 ? 0 : failure.migrationIndex + 1);
}

if (mode === "migration_failure_statement") {
  const failure = await inspectMigrationFailure();
  process.exit(failure.statementIndex < 0 ? 0 : Math.min(failure.statementIndex + 1, 252));
}

if (mode === "migration_failure_sqlstate") {
  const failure = await inspectMigrationFailure();
  const codes = {
    "0A000": 2,
    "23503": 3,
    "23505": 4,
    "23514": 5,
    "25001": 6,
    "42501": 7,
    "42701": 8,
    "42704": 9,
    "42710": 10,
    "42723": 11,
    "42883": 12,
    "42P01": 13,
  };
  process.exit(failure.errorCode === "none" ? 0 : (codes[failure.errorCode] ?? 1));
}

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
  const net = await import("node:net");
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

if (mode === "sql_connectivity") {
  const { Pool } = await import("pg");
  const pool = new Pool({
    application_name: "lead-agent-staging-sql-connectivity-diagnostic",
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 15000,
    max: 1,
    query_timeout: 15000,
  });
  let result = 9;
  try {
    await pool.query("select 1 as connected");
    result = 0;
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") result = 2;
    else if (code === "DEPTH_ZERO_SELF_SIGNED_CERT") result = 3;
    else if (code === "SELF_SIGNED_CERT_IN_CHAIN") result = 4;
    else if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") result = 5;
    else if (code.startsWith("28")) result = 6;
    else if (/^(?:ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)$/u.test(code)) result = 7;
    else if (/(?:certificate|ssl|tls)/iu.test(message)) result = 8;
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(result);
}

if (mode === "normalized_sql_connectivity") {
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  const pool = new Pool({
    application_name: "lead-agent-staging-normalized-sql-connectivity-diagnostic",
    connectionString: withLibpqCompatibleRequireSsl(process.env.MIGRATION_DATABASE_URL),
    connectionTimeoutMillis: 15000,
    max: 1,
    query_timeout: 15000,
  });
  let result = 9;
  try {
    await pool.query("select 1 as connected");
    result = 0;
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") result = 2;
    else if (code === "DEPTH_ZERO_SELF_SIGNED_CERT") result = 3;
    else if (code === "SELF_SIGNED_CERT_IN_CHAIN") result = 4;
    else if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") result = 5;
    else if (code.startsWith("28")) result = 6;
    else if (/^(?:ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)$/u.test(code)) result = 7;
    else if (/(?:certificate|ssl|tls)/iu.test(message)) result = 8;
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(result);
}

if (mode === "migration_state_flags") {
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  const pool = new Pool({
    application_name: "lead-agent-staging-migration-state-diagnostic",
    connectionString: withLibpqCompatibleRequireSsl(process.env.MIGRATION_DATABASE_URL),
    connectionTimeoutMillis: 15000,
    max: 1,
    query_timeout: 15000,
  });
  let flags = 0;
  try {
    const identity = await pool.query(`
      select current_user as role_name,
             rolcreaterole,
             rolbypassrls,
             rolsuper
      from pg_catalog.pg_roles
      where rolname = current_user
    `);
    const role = identity.rows[0];
    if (role?.role_name === "postgres") flags |= 1;
    if (role?.rolcreaterole === true) flags |= 2;
    if (role?.rolbypassrls === true) flags |= 4;
    if (role?.rolsuper === true) flags |= 8;

    const migrationTable = await pool.query(
      "select to_regclass($$drizzle.__drizzle_migrations$$) is not null as present",
    );
    if (migrationTable.rows[0]?.present === true) {
      flags |= 16;
      const migrations = await pool.query(
        "select count(*)::integer as count from drizzle.__drizzle_migrations",
      );
      if (migrations.rows[0]?.count === 31) flags |= 32;
    }
    const tables = await pool.query(
      "select count(*)::integer as count from information_schema.tables where table_schema = $$public$$ and table_type = $$BASE TABLE$$",
    );
    if (tables.rows[0]?.count === 52) flags |= 64;
    const bypassRole = await pool.query(`
      select count(*)::integer as count
      from pg_catalog.pg_roles
      where rolname = $1::text
        and rolbypassrls
    `, ["lead_agent_inbound_route_definer"]);
    if (bypassRole.rows[0]?.count === 1) flags |= 128;
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(flags);
}

if (mode === "cloudsql_superuser_flags") {
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  const pool = new Pool({
    application_name: "lead-agent-staging-cloudsql-role-diagnostic",
    connectionString: withLibpqCompatibleRequireSsl(process.env.MIGRATION_DATABASE_URL),
    connectionTimeoutMillis: 15000,
    max: 1,
    query_timeout: 15000,
  });
  let flags = 0;
  try {
    const result = await pool.query(`
      select role.rolbypassrls,
             role.rolsuper,
             pg_catalog.pg_has_role(current_user, role.oid, $$USAGE$$) as current_user_has_usage
      from pg_catalog.pg_roles role
      where role.rolname = $$cloudsqlsuperuser$$
    `);
    const role = result.rows[0];
    if (role !== undefined) flags |= 1;
    if (role?.rolbypassrls === true) flags |= 2;
    if (role?.rolsuper === true) flags |= 4;
    if (role?.current_user_has_usage === true) flags |= 8;
  } finally {
    await pool.end().catch(() => {});
  }
  process.exit(flags);
}

if (mode === "packaged_manifest_flags") {
  const { readStagingMigrationManifest } = await import("./dist/migrate.js");
  const manifest = await readStagingMigrationManifest();
  let flags = 1;
  if (manifest.entries.length === 31) flags |= 2;
  if (manifest.entries.at(-1)?.tag === "0030_s22_first_tenant_bootstrap") flags |= 4;
  process.exit(flags);
}

process.exit(254);
})().catch(() => process.exit(253));
EOF
PROBE_SCRIPT_B64="$(base64 -w0 "$PROBE_SCRIPT")"

run_encoded_probe() {
  local key="$1"
  local expected_user="$2"
  local mode="$3"
  local execution_name
  execution_name="$(
    gcloud run jobs execute "$JOB_NAME" \
      --project="$PROJECT_ID" \
      --region="$REGION" \
      --task-timeout=60s \
      --args='--input-type=module,-e,eval(atob(process.env.S22_DIAGNOSTIC_SCRIPT_B64))' \
      --update-env-vars="S22_DIAGNOSTIC_SCRIPT_B64=$PROBE_SCRIPT_B64,S22_PROBE_ENV_NAME=$key,S22_PROBE_EXPECTED_USER=$expected_user,S22_PROBE_MODE=$mode" \
      --format='value(metadata.name)'
  )"
  [[ -n "$execution_name" ]]
  local execution_id="${execution_name##*/}"
  local completed=false
  for _ in $(seq 1 45); do
    curl --fail --silent --show-error \
      --header "Authorization: Bearer $ACCESS_TOKEN" \
      "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}/executions/${execution_id}" \
      > "$WORK_DIR/latest-execution.json"
    if [[ "$(jq -r '(.completionTime // "") != ""' "$WORK_DIR/latest-execution.json")" == "true" ]]; then
      completed=true
      break
    fi
    sleep 2
  done
  [[ "$completed" == "true" ]]
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

if [[ "${S22_RUN_SQL_PROBE:-false}" == "true" ]]; then
  SQL_CONNECTIVITY_CODE="$(run_encoded_probe MIGRATION_DATABASE_URL postgres sql_connectivity)"
  case "$SQL_CONNECTIVITY_CODE" in
    0) SQL_CONNECTIVITY_RESULT=CONNECTED ;;
    2) SQL_CONNECTIVITY_RESULT=TLS_CERT_ALTNAME_INVALID ;;
    3) SQL_CONNECTIVITY_RESULT=TLS_SELF_SIGNED_CERT ;;
    4) SQL_CONNECTIVITY_RESULT=TLS_SELF_SIGNED_CHAIN ;;
    5) SQL_CONNECTIVITY_RESULT=TLS_UNVERIFIED_LEAF ;;
    6) SQL_CONNECTIVITY_RESULT=AUTHENTICATION_FAILED ;;
    7) SQL_CONNECTIVITY_RESULT=NETWORK_FAILED ;;
    8) SQL_CONNECTIVITY_RESULT=OTHER_TLS_FAILURE ;;
    *) SQL_CONNECTIVITY_RESULT=OTHER_DATABASE_FAILURE ;;
  esac
  report runtime_sql_connectivity "$SQL_CONNECTIVITY_RESULT"

  NORMALIZED_SQL_CONNECTIVITY_CODE="$(run_encoded_probe MIGRATION_DATABASE_URL postgres normalized_sql_connectivity)"
  case "$NORMALIZED_SQL_CONNECTIVITY_CODE" in
    0) NORMALIZED_SQL_CONNECTIVITY_RESULT=CONNECTED ;;
    2) NORMALIZED_SQL_CONNECTIVITY_RESULT=TLS_CERT_ALTNAME_INVALID ;;
    3) NORMALIZED_SQL_CONNECTIVITY_RESULT=TLS_SELF_SIGNED_CERT ;;
    4) NORMALIZED_SQL_CONNECTIVITY_RESULT=TLS_SELF_SIGNED_CHAIN ;;
    5) NORMALIZED_SQL_CONNECTIVITY_RESULT=TLS_UNVERIFIED_LEAF ;;
    6) NORMALIZED_SQL_CONNECTIVITY_RESULT=AUTHENTICATION_FAILED ;;
    7) NORMALIZED_SQL_CONNECTIVITY_RESULT=NETWORK_FAILED ;;
    8) NORMALIZED_SQL_CONNECTIVITY_RESULT=OTHER_TLS_FAILURE ;;
    *) NORMALIZED_SQL_CONNECTIVITY_RESULT=OTHER_DATABASE_FAILURE ;;
  esac
  report runtime_normalized_sql_connectivity "$NORMALIZED_SQL_CONNECTIVITY_RESULT"

  MIGRATION_STATE_FLAGS="$(run_encoded_probe MIGRATION_DATABASE_URL postgres migration_state_flags)"
  report runtime_admin_role_postgres "$(decode_boolean "$MIGRATION_STATE_FLAGS" 1)"
  report runtime_admin_role_createrole "$(decode_boolean "$MIGRATION_STATE_FLAGS" 2)"
  report runtime_admin_role_bypassrls "$(decode_boolean "$MIGRATION_STATE_FLAGS" 4)"
  report runtime_admin_role_superuser "$(decode_boolean "$MIGRATION_STATE_FLAGS" 8)"
  report runtime_migration_table_present "$(decode_boolean "$MIGRATION_STATE_FLAGS" 16)"
  report runtime_migration_count_31 "$(decode_boolean "$MIGRATION_STATE_FLAGS" 32)"
  report runtime_production_table_count_52 "$(decode_boolean "$MIGRATION_STATE_FLAGS" 64)"
  report runtime_required_bypassrls_role_present "$(decode_boolean "$MIGRATION_STATE_FLAGS" 128)"

  MIGRATION_FAILURE_INDEX_CODE="$(run_encoded_probe UNUSED UNUSED migration_failure_index)"
  if (( MIGRATION_FAILURE_INDEX_CODE >= 1 && MIGRATION_FAILURE_INDEX_CODE <= 31 )); then
    MIGRATION_FAILURE_INDEX=$((MIGRATION_FAILURE_INDEX_CODE - 1))
    MIGRATION_FAILURE_TAG="$(
      jq -er --argjson index "$MIGRATION_FAILURE_INDEX" \
        '.entries[$index].tag' packages/database/drizzle/meta/_journal.json
    )"
    report migration_rollback_probe_failure_tag "$MIGRATION_FAILURE_TAG"
    MIGRATION_FAILURE_STATEMENT_CODE="$(
      run_encoded_probe UNUSED UNUSED migration_failure_statement
    )"
    report migration_rollback_probe_statement_number "$MIGRATION_FAILURE_STATEMENT_CODE"
    MIGRATION_FAILURE_SQLSTATE_CODE="$(
      run_encoded_probe UNUSED UNUSED migration_failure_sqlstate
    )"
    case "$MIGRATION_FAILURE_SQLSTATE_CODE" in
      2) MIGRATION_FAILURE_SQLSTATE=0A000 ;;
      3) MIGRATION_FAILURE_SQLSTATE=23503 ;;
      4) MIGRATION_FAILURE_SQLSTATE=23505 ;;
      5) MIGRATION_FAILURE_SQLSTATE=23514 ;;
      6) MIGRATION_FAILURE_SQLSTATE=25001 ;;
      7) MIGRATION_FAILURE_SQLSTATE=42501 ;;
      8) MIGRATION_FAILURE_SQLSTATE=42701 ;;
      9) MIGRATION_FAILURE_SQLSTATE=42704 ;;
      10) MIGRATION_FAILURE_SQLSTATE=42710 ;;
      11) MIGRATION_FAILURE_SQLSTATE=42723 ;;
      12) MIGRATION_FAILURE_SQLSTATE=42883 ;;
      13) MIGRATION_FAILURE_SQLSTATE=42P01 ;;
      *) MIGRATION_FAILURE_SQLSTATE=OTHER ;;
    esac
    report migration_rollback_probe_sqlstate "$MIGRATION_FAILURE_SQLSTATE"
  elif [[ "$MIGRATION_FAILURE_INDEX_CODE" == "0" ]]; then
    report migration_rollback_probe_failure_tag NONE
    report migration_rollback_probe_statement_number NONE
    report migration_rollback_probe_sqlstate NONE
  else
    report migration_rollback_probe_failure_tag DIAGNOSTIC_ERROR
    report migration_rollback_probe_statement_number unavailable
    report migration_rollback_probe_sqlstate unavailable
  fi

  CLOUDSQL_SUPERUSER_FLAGS="$(run_encoded_probe MIGRATION_DATABASE_URL postgres cloudsql_superuser_flags)"
  report runtime_cloudsql_superuser_role_present "$(decode_boolean "$CLOUDSQL_SUPERUSER_FLAGS" 1)"
  report runtime_cloudsql_superuser_role_bypassrls "$(decode_boolean "$CLOUDSQL_SUPERUSER_FLAGS" 2)"
  report runtime_cloudsql_superuser_role_superuser "$(decode_boolean "$CLOUDSQL_SUPERUSER_FLAGS" 4)"
  report runtime_admin_has_cloudsql_superuser_usage "$(decode_boolean "$CLOUDSQL_SUPERUSER_FLAGS" 8)"

  PACKAGED_MANIFEST_FLAGS="$(run_encoded_probe UNUSED UNUSED packaged_manifest_flags)"
  report packaged_manifest_importable "$(decode_boolean "$PACKAGED_MANIFEST_FLAGS" 1)"
  report packaged_manifest_count_31 "$(decode_boolean "$PACKAGED_MANIFEST_FLAGS" 2)"
  report packaged_manifest_head_0030 "$(decode_boolean "$PACKAGED_MANIFEST_FLAGS" 4)"
fi

if [[ "${S22_SKIP_ACTIVE_PROBES:-false}" == "true" ]]; then
  unset ACCESS_TOKEN
  exit 0
fi

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
