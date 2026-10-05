import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
const project = "lead-agent-stg-739284",
  region = "me-central1",
  job = "lead-agent-staging-migrator";
export const reviewed = Object.freeze({
  source: "f523ba330c7b1dcffe8a18d22a65d0dea6d7b40d",
  timestamp: "2026-10-05T16:28:09Z",
  head: "0031_s22_widget_inbound_route_management",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:ebdd10763876631af48baea838814a37f7cc397088a1810991f4f36b52509669",
  migrator:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:612db330f27d25a9b6c92c05d361bee86ba59e6ff03e0e61c646eef4d1b476fd",
});
const requireSafe = (value, code) => {
  if (!value) throw Object.assign(new Error(), { code });
};
const plainEnvironment = (container) => {
  const values = new Map();
  requireSafe(Array.isArray(container?.env), "ENVIRONMENT_MISSING");
  for (const env of container.env) {
    requireSafe(!values.has(env.name), "DUPLICATE_ENVIRONMENT");
    values.set(env.name, env.value);
  }
  return values;
};
export function verifyWorker(worker) {
  const template = worker?.template,
    containers = template?.containers;
  requireSafe(
    worker.name === `projects/${project}/locations/${region}/workerPools/lead-agent-staging-worker`,
    "WORKER_SCOPE_MISMATCH",
  );
  requireSafe(
    Array.isArray(containers) && containers.length === 1 && containers[0].image === reviewed.worker,
    "WORKER_IMAGE_MISMATCH",
  );
  const env = plainEnvironment(containers[0]);
  requireSafe(
    env.get("DEPLOYMENT_ENVIRONMENT") === "staging" && env.get("AI_JOURNEY_MODE") === "booking",
    "WORKER_GATE_MISMATCH",
  );
  requireSafe(
    env.get("DEPLOYMENT_GIT_SHA") === reviewed.source &&
      env.get("DEPLOYMENT_TIMESTAMP") === reviewed.timestamp &&
      env.get("DEPLOYMENT_MIGRATION_HEAD") === reviewed.head,
    "WORKER_PROVENANCE_MISMATCH",
  );
  requireSafe(
    template.serviceAccount === `lead-agent-staging-worker@${project}.iam.gserviceaccount.com`,
    "WORKER_IDENTITY_MISMATCH",
  );
  // WorkerPoolScaling (unlike ServiceScaling) has only manualInstanceCount.
  // https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.workerPools#WorkerPoolScaling
  requireSafe(
    worker.scaling?.manualInstanceCount === 1 &&
      Object.keys(worker.scaling).every((key) => key === "manualInstanceCount"),
    "WORKER_SCALING_MISMATCH",
  );
  requireSafe(worker.terminalCondition?.state === "CONDITION_SUCCEEDED", "WORKER_NOT_READY");
  const network = template.vpcAccess?.networkInterfaces;
  requireSafe(
    template.vpcAccess?.egress === "PRIVATE_RANGES_ONLY" &&
      Array.isArray(network) &&
      network.length === 1 &&
      [
        "lead-agent-staging-vpc",
        `projects/${project}/global/networks/lead-agent-staging-vpc`,
      ].includes(network[0].network) &&
      [
        "lead-agent-staging-cloud-run",
        `projects/${project}/regions/${region}/subnetworks/lead-agent-staging-cloud-run`,
      ].includes(network[0].subnetwork),
    "WORKER_VPC_MISMATCH",
  );
  return {
    source: reviewed.source,
    image: reviewed.worker,
    mode: "booking",
    instances: 1,
    private_vpc: true,
  };
}
export function verifyJob(metadata) {
  const task = metadata?.spec?.template?.spec?.template?.spec;
  const annotations = metadata?.spec?.template?.metadata?.annotations;
  requireSafe(
    task?.containers?.length === 1 &&
      task.containers[0].image === reviewed.migrator &&
      JSON.stringify(task.containers[0].command) === '["node"]' &&
      JSON.stringify(task.containers[0].args) === '["dist/index.js"]',
    "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH",
  );
  requireSafe(
    task.serviceAccountName === `lead-agent-staging-migrator@${project}.iam.gserviceaccount.com`,
    "DIAGNOSTIC_IDENTITY_MISMATCH",
  );
  requireSafe(
    Object.hasOwn(task, "maxRetries") &&
      typeof task.maxRetries === "number" &&
      task.maxRetries === 0,
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  );
  const env = task.containers[0].env?.filter((e) => e.name === "DATABASE_URL");
  requireSafe(
    env?.length === 1 &&
      env[0].value === undefined &&
      env[0].valueFrom?.secretKeyRef?.name?.split("/").at(-1) ===
        "lead-agent-staging-runtime-database-url",
    "RUNTIME_SECRET_REFERENCE_MISMATCH",
  );
  let network;
  try {
    network = JSON.parse(annotations?.["run.googleapis.com/network-interfaces"]);
  } catch {
    throw Object.assign(new Error(), { code: "DIAGNOSTIC_NETWORK_METADATA_INVALID" });
  }
  requireSafe(
    annotations?.["run.googleapis.com/vpc-access-egress"] === "private-ranges-only" &&
      Array.isArray(network) &&
      network.length === 1 &&
      [
        "lead-agent-staging-vpc",
        `projects/${project}/global/networks/lead-agent-staging-vpc`,
      ].includes(network[0].network) &&
      [
        "lead-agent-staging-cloud-run",
        `projects/${project}/regions/${region}/subnetworks/lead-agent-staging-cloud-run`,
      ].includes(network[0].subnetwork),
    "DIAGNOSTIC_VPC_MISMATCH",
  );
  return {
    image: reviewed.migrator,
    runtime_secret_reference: true,
    private_vpc: true,
    explicit_zero_retries: true,
  };
}
const assertions = new Set([
  "runtime_rls_and_baseline",
  "synthetic_conversation",
  "synthetic_requests",
  "synthetic_delivery_metadata",
  "deployed_cohort_binding",
  "cohort_reservation_accounting",
]);
const traceAssertions = new Set([
  "first_turn_runs",
  "first_turn_actions",
  "first_turn_messages",
  "first_turn_audits",
  "first_turn_outbox",
  "first_turn_queue_access",
]);
const optionalAssertions = new Set([
  "first_turn_readiness",
  "first_turn_trace",
  "initialize",
  "pool_error",
  "cleanup",
  ...traceAssertions,
]);
const fields = new Set([
  "runtime_read_only_tenant_guard",
  "force_rls",
  "tables",
  "historical_runs",
  "historical_null_costs_preserved",
  "rows",
  "exact_conversation",
  "id",
  "status",
  "version",
  "automation_mode",
  "no_active_handoff",
  "offer_version",
  "start_at",
  "end_at",
  "confirmation_issued_at",
  "offer_expires_at",
  "confirmed_at",
  "confirmation_source",
  "direction",
  "delivery_status",
  "created_at",
  "profile",
  "organization",
  "conversation",
  "maximum_calls",
  "maximum_messages",
  "maximum_calls_per_message",
  "historical_reserve_micros",
  "hard_ceiling_micros",
  "mode",
  "physicalCalls",
  "logicalMessages",
  "knownCostMicros",
  "unresolvedReserveMicros",
  "historicalReserveMicros",
  "combinedExposureMicros",
  "perCallReserveMicros",
  "accountingComplete",
  "blocked",
  "reason",
  "no_pending_paid_calls",
  "no_existing_synthetic_request",
  "collection_only",
  "run_id",
  "trigger_message_id",
  "correlation_id",
  "attempt_no",
  "expected_conversation_version",
  "provider_id",
  "requested_model_id",
  "provider_resolved_model_id",
  "schema_valid",
  "policy_allowed",
  "failure_category",
  "input_units",
  "output_units",
  "cached_input_units",
  "reasoning_units",
  "total_units",
  "estimated_cost_micros",
  "cost_catalog_version",
  "latency_ms",
  "has_output_hash",
  "started_at",
  "finished_at",
  "ai_run_id",
  "action_name",
  "validation_status",
  "policy_reason_code",
  "application_status",
  "sequence_no",
  "processing_status",
  "reply_to_message_id",
  "event_type",
  "target_type",
  "target_id",
  "action",
  "result",
  "reason_code",
  "occurred_at",
  "recorded_status",
  "recorded_attempt_no",
  "dispatch_authorized",
  "reservation_micros",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "attempt_count",
  "last_error_category",
  "available_at",
  "published_at",
  "causation_id",
  "ai_run_outcome",
  "proposed_action",
  "handler_read",
  "job_read",
  "queue_record_proof",
]);
const redact = (value) => {
  if (Array.isArray(value)) return value.slice(0, 21).map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => fields.has(key))
        .map(([key, item]) => [key, redact(item)]),
    );
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  )
    return value;
  if (typeof value === "string" && /^[a-zA-Z0-9_.:+-]{1,100}$/.test(value)) return value;
  return "REDACTED";
};
export const sanitizeRows = (entries) =>
  entries.flatMap((entry) => {
    const p = entry.jsonPayload;
    if (
      p?.operation !== "s22_booking_readonly" ||
      !(assertions.has(p.assertion) || optionalAssertions.has(p.assertion)) ||
      !["PASS", "FAIL", "BLOCKED"].includes(p.outcome)
    )
      return [];
    return [
      {
        assertion: p.assertion,
        outcome: p.outcome,
        ...(p.observed ? { observed: redact(p.observed) } : {}),
        ...(typeof p.code === "string" && /^[A-Z0-9_]{2,64}$/.test(p.code) ? { code: p.code } : {}),
      },
    ];
  });
const cloud = async (args, timeout = 15000) =>
  (await execute("gcloud", args, { timeout, maxBuffer: 1024 * 1024 })).stdout;
export const logReadFailureCode = (error) =>
  typeof error?.stderr === "string" &&
  /PERMISSION_DENIED|does not have permission|permission denied|403 Forbidden/iu.test(error.stderr)
    ? "EXACT_EXECUTION_LOG_PERMISSION_DENIED"
    : "EXACT_EXECUTION_LOG_READ_BLOCKED";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const moduleBootstrap =
  'import{spawnSync}from"node:child_process";const r=spawnSync(process.execPath,["--input-type=module"],{input:Buffer.from(process.env.S22_BOOKING_READ_B64,"base64"),cwd:process.cwd(),env:process.env,stdio:["pipe","inherit","inherit"],timeout:60000,killSignal:"SIGTERM"});process.exitCode=r.error||r.signal?1:Number.isInteger(r.status)?r.status:1;';

async function main() {
  const stage = process.env.BOOKING_EVIDENCE_STAGE ?? "initial";
  const evidence = {
    runtime_source: reviewed.source,
    paid_calls: 0,
    migration_execution: false,
    job_configuration_changed: false,
    assertions: [],
    stage,
  };
  let execution,
    terminal = false;
  try {
    requireSafe(["initial", "observe", "first-turn"].includes(stage), "READ_STAGE_INVALID");
    const token = (await cloud(["auth", "print-access-token"])).trim();
    const response = await fetch(
      `https://run.googleapis.com/v2/projects/${project}/locations/${region}/workerPools/lead-agent-staging-worker`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    requireSafe(response.ok, "WORKER_METADATA_UNAVAILABLE");
    const workerMetadata = await response.json();
    evidence.worker_scaling = {
      manual_instance_count:
        typeof workerMetadata.scaling?.manualInstanceCount === "number"
          ? workerMetadata.scaling.manualInstanceCount
          : null,
      fields: Object.keys(workerMetadata.scaling ?? {}).filter((name) =>
        /^[a-zA-Z]{1,50}$/.test(name),
      ),
    };
    evidence.worker = verifyWorker(workerMetadata);
    evidence.diagnostic = verifyJob(
      JSON.parse(
        await cloud([
          "run",
          "jobs",
          "describe",
          job,
          `--project=${project}`,
          `--region=${region}`,
          "--format=json",
        ]),
      ),
    );
    const reader = await readFile(new URL("./s22-booking-evidence-readonly.mjs", import.meta.url));
    const traceReader =
      stage === "first-turn"
        ? await readFile(new URL("./s22-booking-first-turn-readonly.mjs", import.meta.url))
        : null;
    if (traceReader !== null)
      evidence.trace_reader_sha256 = createHash("sha256").update(traceReader).digest("hex");
    evidence.reader_sha256 = createHash("sha256").update(reader).digest("hex");
    // Same actual-ES-module stdin bootstrap already proven in the prior diagnostic.
    execution = (
      await cloud(
        [
          "run",
          "jobs",
          "execute",
          job,
          `--project=${project}`,
          `--region=${region}`,
          `--args=^~^--input-type=module~-e~${moduleBootstrap}`,
          `--update-env-vars=^~^S22_BOOKING_READ_B64=${reader.toString("base64")}~S22_BOOKING_READ_STAGE=${stage}${traceReader === null ? "" : `~S22_BOOKING_TRACE_B64=${traceReader.toString("base64")}`}`,
          "--format=value(metadata.name)",
        ],
        30000,
      )
    ).trim();
    requireSafe(
      /^lead-agent-staging-migrator-[a-z0-9]+$/.test(execution),
      "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
    );
    evidence.execution = execution;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const state = JSON.parse(
        await cloud(
          [
            "run",
            "jobs",
            "executions",
            "describe",
            execution,
            `--project=${project}`,
            `--region=${region}`,
            "--format=json",
          ],
          10000,
        ),
      );
      const completed = state.status?.conditions?.find((c) => c.type === "Completed");
      if (
        ["True", "False", "CONDITION_SUCCEEDED", "CONDITION_FAILED"].includes(
          completed?.status ?? completed?.state,
        )
      ) {
        terminal = true;
        evidence.execution_succeeded = ["True", "CONDITION_SUCCEEDED"].includes(
          completed.status ?? completed.state,
        );
        break;
      }
      await pause(2000);
    }
    requireSafe(terminal, "DIAGNOSTIC_WINDOW_ELAPSED");
    // A missing logging permission is a real blocker, never a reason to grant IAM.
    const filter = `resource.type="cloud_run_job" AND resource.labels.job_name="${job}" AND labels."run.googleapis.com/execution_name"="${execution}" AND jsonPayload.operation="s22_booking_readonly"`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let entries;
      try {
        entries = JSON.parse(
          await cloud(
            [
              "logging",
              "read",
              filter,
              `--project=${project}`,
              "--freshness=1h",
              "--limit=20",
              "--order=asc",
              "--format=json",
            ],
            20000,
          ),
        );
      } catch (error) {
        throw Object.assign(new Error(), { code: logReadFailureCode(error) });
      }
      evidence.assertions = sanitizeRows(entries);
      if (evidence.assertions.length >= assertions.size) break;
      await pause(3000);
    }
    requireSafe(evidence.execution_succeeded, "READ_ONLY_DIAGNOSTIC_FAILED");
    requireSafe(
      [...assertions].every((name) =>
        evidence.assertions.some((r) => r.assertion === name && r.outcome === "PASS"),
      ) && evidence.assertions.every((r) => r.outcome === "PASS"),
      "STRUCTURED_EVIDENCE_MISSING_OR_FAILED",
    );
    if (stage === "initial")
      requireSafe(
        evidence.assertions.some(
          (r) => r.assertion === "first_turn_readiness" && r.outcome === "PASS",
        ),
        "FIRST_TURN_NOT_READY",
      );
    if (stage === "first-turn")
      requireSafe(
        [...traceAssertions].every((name) =>
          evidence.assertions.some((r) => r.assertion === name && r.outcome === "PASS"),
        ),
        "FIRST_TURN_TRACE_INCOMPLETE",
      );
    evidence.outcome = "PASS";
  } catch (error) {
    evidence.outcome = "BLOCKED";
    evidence.code =
      typeof error?.code === "string" && /^[A-Z0-9_]{2,64}$/.test(error.code)
        ? error.code
        : "READ_ONLY_CHECK_UNAVAILABLE";
    process.exitCode = 1;
  } finally {
    if (execution && /^lead-agent-staging-migrator-[a-z0-9]+$/.test(execution) && !terminal) {
      try {
        await cloud([
          "run",
          "jobs",
          "executions",
          "cancel",
          execution,
          `--project=${project}`,
          `--region=${region}`,
          "--quiet",
        ]);
        evidence.hung_diagnostic_cancelled = true;
      } catch {
        evidence.hung_diagnostic_cancelled = false;
      }
    }
    await writeFile("s22-booking-evidence.json", JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
