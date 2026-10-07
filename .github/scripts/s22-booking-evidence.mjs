import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const execute = promisify(execFile);
const project = "lead-agent-stg-739284",
  region = "me-central1",
  job = "lead-agent-staging-migrator";
export const reviewed = Object.freeze({
  // Exact owner-approved apply 37593007330; post-apply verification 37596517708.
  // Updating diagnostic pins does not authorize another runtime rollout.
  source: "191a9cdbb4187ad0006a5dbab04882b4f44d0e64",
  timestamp: "2026-10-07T06:50:40Z",
  head: "0031_s22_widget_inbound_route_management",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:f654f252f802488f5ef08d3a9a8a99dbe4ccc09ca01b59c1adff88b71c124506",
  migrator:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e66cba1a63b620863e30eeea210ff4169daef559dfc4c2b9eae4daba32bafb16",
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
export const finalTraceAssertions = new Set([
  "final_turn_context",
  "final_turn_messages",
  "final_turn_discovery",
  "final_turn_runs",
  "final_turn_actions",
  "final_turn_outbox",
  "final_turn_audits",
  "final_turn_receipts",
  "final_turn_queue_access",
]);
export const completionTraceAssertions = new Set([
  "completion_request",
  "completion_transitions",
  "completion_customer_evidence",
  "completion_offer_delivery",
  "completion_confirmation_delivery",
  "completion_audits",
  "completion_lead",
  "completion_provider_runs",
]);
const optionalAssertions = new Set([
  "first_turn_readiness",
  "first_turn_trace",
  "initialize",
  "pool_error",
  "cleanup",
  ...traceAssertions,
  "final_turn_trace",
  ...finalTraceAssertions,
  "completion_trace",
  ...completionTraceAssertions,
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
  "cost_currency",
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
  "channel_connection_id",
  "channel_type",
  "connection_status",
  "connection_version",
  "has_credential",
  "token_expires_at",
  "thread_control_id",
  "eligibility_state",
  "eligibility_version",
  "eligibility_reason",
  "eligibility_updated_at",
  "last_activity_at",
  "message_id",
  "inbound_count",
  "processed_message_id",
  "first_received_at",
  "last_received_at",
  "offered_time_zone",
  "staff_decided_at",
  "from_status",
  "to_status",
  "command",
  "actor_type",
  "source_message_id",
  "actor_binding",
  "outcome",
  "source",
  "customer_acted_at",
  "recorded_at",
  "customer_bound",
  "channel_bound",
  "source_bound",
  "offer_bound",
  "within_window",
  "customer_after_prompt",
  "confirmation_kind",
  "staff_operation",
  "expected_version",
  "transition_bound",
  "owner_active",
  "owner_unique",
  "converted_at",
  "appointment_bound",
  "reservations",
  "journey_starts",
  "reserved_micros",
  "approved_limits",
  "confirmation_run_count",
  "request_count",
  "continuation_cost_micros",
  "confirmation_calls",
  "total_runs",
  "booking_trigger",
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
  if (
    typeof value === "string" &&
    (value === "Asia/Tashkent" || /^[a-zA-Z0-9_.:+-]{1,100}$/.test(value))
  )
    return value;
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
export async function readRecoveryToken(authenticate = cloud) {
  let raw;
  try {
    // One attempt, matching the owner's successful bounded CLI check. Never
    // print stdout/stderr or propagate an exception carrying credential output.
    raw = await authenticate(["auth", "print-access-token", "--quiet"], 30000);
  } catch (error) {
    const code =
      error?.killed === true || error?.code === "ETIMEDOUT"
        ? "LOG_AUTHENTICATION_TIMEOUT"
        : error?.code === "ENOENT"
          ? "LOG_AUTH_CLI_UNAVAILABLE"
          : "LOG_AUTHENTICATION_UNAVAILABLE";
    throw Object.assign(new Error(), { code });
  }
  requireSafe(
    typeof raw === "string" && raw.trim().length > 0 && !/\s/u.test(raw.trim()),
    "LOG_TOKEN_RESPONSE_INVALID",
  );
  return raw.trim();
}
// Recovery reads ONLY the completed observation whose result collection failed.
// It never enters main(), executes a job, changes IAM or retries an API call.
export const recoveryExecution = "lead-agent-staging-migrator-n2vs5";
export const readinessRecoveryExecution = "lead-agent-staging-migrator-q2z8g";
async function recoverExecutionLogs(execution, from, until, token, request, required = assertions) {
  let stage = "logging_api";
  try {
    const response = await request("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        resourceNames: [`projects/${project}`],
        filter: `resource.type="cloud_run_job" AND resource.labels.job_name="${job}" AND labels."run.googleapis.com/execution_name"="${execution}" AND timestamp>="${from}" AND timestamp<"${until}" AND jsonPayload.operation="s22_booking_readonly"`,
        orderBy: "timestamp desc",
        pageSize: 20,
      }),
    });
    if (!response.ok)
      return {
        outcome: "BLOCKED",
        stage,
        code:
          response.status === 403
            ? "EXACT_EXECUTION_LOG_PERMISSION_DENIED"
            : response.status === 401
              ? "LOG_AUTHENTICATION_DENIED"
              : "LOG_API_UNAVAILABLE",
        http_status: response.status,
      };
    stage = "logging_response";
    const payload = await response.json();
    if (
      payload === null ||
      typeof payload !== "object" ||
      (payload.entries !== undefined &&
        (!Array.isArray(payload.entries) || payload.entries.length > 20)) ||
      (payload.entries ?? []).some((entry) => entry === null || typeof entry !== "object")
    )
      return { outcome: "BLOCKED", stage, code: "LOG_RESPONSE_INVALID" };
    const rows = sanitizeRows(payload.entries ?? []);
    const counts = new Map();
    for (const row of rows) counts.set(row.assertion, (counts.get(row.assertion) ?? 0) + 1);
    const code = payload.nextPageToken
      ? "LOG_RESULT_TRUNCATED"
      : [...counts.values()].some((count) => count > 1)
        ? "LOG_ASSERTIONS_DUPLICATED"
        : [...required].some((name) => !counts.has(name))
          ? "LOG_ASSERTIONS_INCOMPLETE"
          : rows.some((row) => row.outcome !== "PASS")
            ? "LOG_ASSERTION_NOT_PASS"
            : null;
    return {
      execution,
      outcome: code === null ? "PASS" : "BLOCKED",
      stage,
      ...(code === null ? {} : { code }),
      assertions: rows,
    };
  } catch (error) {
    return {
      outcome: "BLOCKED",
      stage,
      code:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "LOG_API_TIMEOUT"
          : stage === "logging_response"
            ? "LOG_RESPONSE_INVALID"
            : "LOG_API_TRANSPORT_BLOCKED",
    };
  }
}
export const recoverExistingBookingLogs = (token, request = fetch) =>
  recoverExecutionLogs(
    recoveryExecution,
    "2026-10-06T00:00:00Z",
    "2026-10-07T00:00:00Z",
    token,
    request,
  );
export const recoverReadinessLogs = (token, request = fetch) =>
  recoverExecutionLogs(
    readinessRecoveryExecution,
    "2026-10-07T00:00:00Z",
    "2026-10-08T00:00:00Z",
    token,
    request,
  );
export const recoverCompletionLogs = (execution, token, request = fetch) => {
  requireSafe(
    typeof execution === "string" && /^lead-agent-staging-migrator-[a-z0-9]+$/.test(execution),
    "COMPLETION_EXECUTION_INVALID",
  );
  return recoverExecutionLogs(
    execution,
    "2026-10-07T00:00:00Z",
    "2026-10-10T00:00:00Z",
    token,
    request,
    new Set([...assertions, ...completionTraceAssertions]),
  );
};
export function formatCompletionReport(result) {
  const observation = (name) =>
    result.assertions?.find((item) => item.assertion === name)?.observed ?? {};
  const request = observation("completion_request").rows?.[0];
  const budget = observation("cohort_reservation_accounting");
  const provider = observation("completion_provider_runs");
  const lines = [
    `Persisted booking collection: ${result.outcome === "PASS" ? "PASS" : "BLOCKED"}${result.code ? ` (${result.code})` : ""}`,
    ...(result.execution ? [`Read-only execution: ${result.execution}`] : []),
    ...[...assertions, ...completionTraceAssertions].map((name) => {
      const row = result.assertions?.find((item) => item.assertion === name);
      return `${name.replaceAll("_", " ")}: ${row?.outcome ?? "NOT COLLECTED"}${row?.code ? ` (${row.code})` : ""}`;
    }),
    `Booking state / version / offer: ${request?.status ?? "unknown"} / ${request?.version ?? "unknown"} / ${request?.offer_version ?? "unknown"}`,
    `Customer confirmation source: ${request?.confirmation_source ?? "unknown"}`,
    `Offered start / end (UTC): ${request?.start_at ?? "unknown"} / ${request?.end_at ?? "unknown"}`,
    `Paid messages / physical attempts: ${budget.logicalMessages ?? "unknown"} / ${budget.physicalCalls ?? "unknown"}`,
    `Continuation cost (USD micros): ${provider.continuation_cost_micros ?? "unknown"}`,
    `Known total cost / reserved exposure (USD micros): ${budget.knownCostMicros ?? "unknown"} / ${budget.combinedExposureMicros ?? "unknown"}`,
    `Unresolved reserve (USD micros): ${budget.unresolvedReserveMicros ?? "unknown"}`,
    `Further paid dispatch: ${budget.blocked === true ? `BLOCKED (${budget.reason ?? "unknown"})` : "NOT PROVEN BLOCKED"}`,
    "Historical NULL costs remain unknown; the budget exception is not exact accounting.",
    "No customer message, model call, migration, IAM or job-configuration change was performed by this check.",
    "This completed-check snapshot is not S22 acceptance or new paid-call authorization.",
  ];
  for (const row of result.assertions ?? [])
    if (row.outcome !== "PASS")
      lines.push(
        `Failed check: ${row.assertion}${row.code ? ` (${row.code})` : ""}; safe metadata: ${JSON.stringify(row.observed ?? {})}`,
      );
  return lines.join("\n");
}
function readinessChecks(result) {
  const observed = (name) =>
    result.assertions?.find((item) => item.assertion === name)?.observed ?? {};
  const current = observed("synthetic_conversation").rows;
  const requests = observed("synthetic_requests").rows;
  const budget = observed("cohort_reservation_accounting");
  const binding = observed("deployed_cohort_binding");
  const unsigned = (value) => typeof value === "string" && /^[0-9]{1,16}$/u.test(value);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const chatReady =
    result.outcome === "PASS" &&
    Array.isArray(current) &&
    current.length === 1 &&
    current[0]?.id === "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7" &&
    current[0].status === "open" &&
    current[0].automation_mode === "ai" &&
    current[0].no_active_handoff === true &&
    Array.isArray(requests) &&
    requests.length === 0;
  const bindingReady =
    result.outcome === "PASS" &&
    binding.organization === "01a0ee39-91a9-7293-82c0-5b7046c10115" &&
    binding.conversation === "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7" &&
    binding.profile === "s22-synthetic-booking.v1" &&
    binding.maximum_messages === 4 &&
    binding.maximum_calls === 5 &&
    binding.maximum_calls_per_message === 2 &&
    binding.historical_reserve_micros === "1033396" &&
    binding.hard_ceiling_micros === "10000000";
  const budgetReady =
    bindingReady &&
    budget.profile === binding.profile &&
    budget.mode === "booking" &&
    budget.blocked === false &&
    budget.reason === null &&
    budget.accountingComplete === false &&
    budget.historicalReserveMicros === "1033396" &&
    budget.perCallReserveMicros === "801432" &&
    budget.unresolvedReserveMicros === "0" &&
    count(budget.logicalMessages) &&
    budget.logicalMessages === 3 &&
    count(budget.physicalCalls) &&
    budget.physicalCalls === 3 &&
    unsigned(budget.knownCostMicros) &&
    unsigned(budget.combinedExposureMicros) &&
    BigInt(budget.combinedExposureMicros) === 1033396n + BigInt(budget.knownCostMicros) &&
    BigInt(budget.combinedExposureMicros) + 2n * 801432n < 10000000n;
  return { chatReady, bindingReady, budgetReady, current, requests, budget, count, unsigned };
}
export function formatReadinessReport(result) {
  const { chatReady, bindingReady, budgetReady, current, requests, budget, count, unsigned } =
    readinessChecks(result);
  const state = Array.isArray(current) && current.length === 1 ? current[0] : null;
  const safeState = (value, allowed) => (allowed.includes(value) ? value : "unknown");
  const failed = (result.assertions ?? []).filter((item) => item.outcome !== "PASS");
  return [
    `Result collection: ${result.outcome === "PASS" ? "PASS" : `BLOCKED (${result.code ?? "RESULT_UNAVAILABLE"})`}`,
    ...failed.map((item) => `Failed check: ${item.assertion}${item.code ? ` (${item.code})` : ""}`),
    `Conversation ready for a new test message: ${chatReady ? "PASS" : "BLOCKED"}`,
    `Chat state: ${safeState(state?.status, ["open", "awaiting_staff", "closed"])}; automation: ${safeState(state?.automation_mode, ["ai", "paused", "staff"])}`,
    `Active handoff: ${state?.no_active_handoff === true ? "no" : state?.no_active_handoff === false ? "yes" : "unknown"}`,
    `Existing booking requests: ${Array.isArray(requests) ? requests.length : "unknown"}`,
    `Reviewed cohort binding: ${bindingReady ? "PASS" : "BLOCKED"}`,
    `Budget ready for one message / at most two attempts: ${budgetReady ? "PASS" : "BLOCKED"}`,
    `Test messages already used: ${count(budget.logicalMessages) ? budget.logicalMessages : "unknown"} / 4`,
    `Provider attempts already used: ${count(budget.physicalCalls) ? budget.physicalCalls : "unknown"} / 5`,
    `Pending reserve (USD micros): ${unsigned(budget.unresolvedReserveMicros) ? budget.unresolvedReserveMicros : "unknown"}; expected: 0`,
    `Known cost / reserved exposure (USD micros): ${unsigned(budget.knownCostMicros) ? budget.knownCostMicros : "unknown"} / ${unsigned(budget.combinedExposureMicros) ? budget.combinedExposureMicros : "unknown"}`,
    "Historical costs remain unknown; collection does not reconcile them.",
    "This is the completed check's snapshot, not a new database read or paid-call authorization.",
    "No message, AI call, migration or diagnostic execution was triggered.",
  ].join("\n");
}
async function recoverMain(
  recover = recoverExistingBookingLogs,
  format = (result) => JSON.stringify(result, null, 2),
  ready = (result) => result.outcome === "PASS",
) {
  let token;
  try {
    token = await readRecoveryToken();
  } catch (error) {
    console.log(
      format({
        outcome: "BLOCKED",
        stage: "authentication",
        code: error.code,
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ stage: "authentication", outcome: "PASS" }));
  const result = await recover(token);
  console.log(format(result));
  if (!ready(result)) process.exitCode = 1;
}
// Narrow result recovery for the one new final-turn read, using owner auth only.
// This path cannot execute a job. No retry, unbounded query or raw error output.
export async function recoverFinalTurnLogs(execution, token, request = fetch) {
  if (!/^lead-agent-staging-migrator-[a-z0-9]{5}$/.test(execution))
    return { outcome: "BLOCKED", code: "EXECUTION_SCOPE_INVALID" };
  try {
    const response = await request("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        resourceNames: [`projects/${project}`],
        filter: `resource.type="cloud_run_job" AND resource.labels.job_name="${job}" AND labels."run.googleapis.com/execution_name"="${execution}" AND timestamp>="2026-10-06T00:00:00Z" AND timestamp<"2026-10-08T00:00:00Z" AND jsonPayload.operation="s22_booking_readonly"`,
        orderBy: "timestamp desc",
        pageSize: 30,
      }),
    });
    if (!response.ok)
      return {
        outcome: "BLOCKED",
        code:
          response.status === 403
            ? "EXACT_EXECUTION_LOG_PERMISSION_DENIED"
            : response.status === 401
              ? "LOG_AUTHENTICATION_DENIED"
              : "LOG_API_UNAVAILABLE",
      };
    const payload = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      (payload.entries !== undefined &&
        (!Array.isArray(payload.entries) || payload.entries.length > 30)) ||
      (payload.entries ?? []).some((entry) => !entry || typeof entry !== "object")
    )
      return { outcome: "BLOCKED", code: "LOG_RESPONSE_INVALID" };
    const rows = sanitizeRows(payload.entries ?? []);
    const expected = [...assertions, ...finalTraceAssertions];
    const counts = new Map();
    for (const row of rows) counts.set(row.assertion, (counts.get(row.assertion) ?? 0) + 1);
    const code = payload.nextPageToken
      ? "LOG_RESULT_TRUNCATED"
      : [...counts.values()].some((count) => count > 1)
        ? "LOG_ASSERTIONS_DUPLICATED"
        : expected.some((name) => !counts.has(name))
          ? "LOG_ASSERTIONS_INCOMPLETE"
          : rows.some((row) => row.outcome !== "PASS")
            ? "LOG_ASSERTION_NOT_PASS"
            : null;
    return {
      execution,
      outcome: code === null ? "PASS" : "BLOCKED",
      ...(code ? { code } : {}),
      assertions: rows,
    };
  } catch (error) {
    return {
      outcome: "BLOCKED",
      code:
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "LOG_API_TIMEOUT"
          : "LOG_RESPONSE_OR_TRANSPORT_BLOCKED",
    };
  }
}
export function formatFinalTurnReport(result) {
  const lines = [`23:00 message trace: ${result.outcome}${result.code ? ` (${result.code})` : ""}`];
  if (result.execution) lines.push(`Read-only execution: ${result.execution}`);
  for (const item of result.assertions ?? []) {
    const label = item.assertion.replaceAll("_", " ");
    lines.push(`\n${label}: ${item.outcome}${item.code ? ` (${item.code})` : ""}`);
    const observed = item.observed ?? {};
    const show = (row) =>
      Object.entries(row)
        .filter(([key]) => key !== "collection_only")
        .map(
          ([key, value]) =>
            `${key.replaceAll("_", " ")}: ${value === null ? "unknown" : String(value)}`,
        )
        .join("; ");
    const scalar = Object.fromEntries(Object.entries(observed).filter(([key]) => key !== "rows"));
    if (Object.keys(scalar).some((key) => key !== "collection_only")) lines.push(show(scalar));
    if (Array.isArray(observed.rows)) {
      if (observed.rows.length === 0) lines.push("No records in this exact scope.");
      else for (const row of observed.rows) lines.push(`- ${show(row)}`);
    }
  }
  lines.push(
    "\nCollection PASS is not a claim of successful AI generation or delivery. No new message/call was sent.",
  );
  return lines.join("\n");
}
async function recoverFinalMain(execution) {
  // Validate before even accessing authentication; malformed args never run main.
  if (!/^lead-agent-staging-migrator-[a-z0-9]{5}$/.test(execution)) {
    console.log("BLOCKED: EXECUTION_SCOPE_INVALID");
    process.exitCode = 1;
    return;
  }
  let token;
  try {
    token = await readRecoveryToken();
  } catch (error) {
    console.log(`BLOCKED: ${error.code}`);
    process.exitCode = 1;
    return;
  }
  const result = await recoverFinalTurnLogs(execution, token);
  console.log(formatFinalTurnReport(result));
  if (result.outcome !== "PASS") process.exitCode = 1;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const moduleBootstrap =
  'import{spawnSync}from"node:child_process";const r=spawnSync(process.execPath,["--input-type=module"],{input:Buffer.from(process.env.S22_BOOKING_READ_B64,"base64"),cwd:process.cwd(),env:process.env,stdio:["pipe","inherit","inherit"],timeout:60000,killSignal:"SIGTERM"});process.exitCode=r.error||r.signal?1:Number.isInteger(r.status)?r.status:1;';

async function main(stage = process.env.BOOKING_EVIDENCE_STAGE ?? "initial") {
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
    requireSafe(
      ["initial", "observe", "first-turn", "final-turn", "completion"].includes(stage),
      "READ_STAGE_INVALID",
    );
    const token =
      stage === "completion"
        ? await readRecoveryToken()
        : (await cloud(["auth", "print-access-token"])).trim();
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
    if (stage === "completion")
      console.log(
        "Preflight: PASS (reviewed image/source, runtime role reference, private VPC, zero retries)",
      );
    const reader = await readFile(new URL("./s22-booking-evidence-readonly.mjs", import.meta.url));
    const traceReader =
      stage === "first-turn"
        ? await readFile(new URL("./s22-booking-first-turn-readonly.mjs", import.meta.url))
        : stage === "final-turn"
          ? await readFile(new URL("./s22-booking-final-turn-readonly.mjs", import.meta.url))
          : stage === "completion"
            ? await readFile(new URL("./s22-booking-completion-readonly.mjs", import.meta.url))
            : null;
    if (traceReader !== null)
      evidence.trace_reader_sha256 = createHash("sha256").update(traceReader).digest("hex");
    evidence.reader_sha256 = createHash("sha256").update(reader).digest("hex");
    const readerPayload = reader.toString("base64");
    const tracePayload =
      traceReader === null
        ? null
        : (stage === "completion" ? gzipSync(traceReader) : traceReader).toString("base64");
    requireSafe(
      readerPayload.length < 32000 && (tracePayload === null || tracePayload.length < 32000),
      "DIAGNOSTIC_PAYLOAD_TOO_LARGE",
    );
    const traceVariable =
      stage === "completion" ? "S22_BOOKING_TRACE_GZIP_B64" : "S22_BOOKING_TRACE_B64";
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
          `--update-env-vars=^~^S22_BOOKING_READ_B64=${readerPayload}~S22_BOOKING_READ_STAGE=${stage}${tracePayload === null ? "" : `~${traceVariable}=${tracePayload}`}`,
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
    if (stage === "completion") console.log(`Read-only execution started: ${execution}`);
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
    if (stage === "completion") {
      // The owner's Logging REST path is already proven. No hanging CLI log
      // polling, retry, IAM change or automatic diagnostic rerun is justified.
      await pause(2000); // Bounded ingestion allowance; still exactly one read.
      const collected = await recoverCompletionLogs(execution, token);
      evidence.assertions = collected.assertions ?? [];
      requireSafe(collected.outcome === "PASS", collected.code ?? "COMPLETION_LOG_READ_BLOCKED");
    } else
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
    if (stage === "final-turn")
      requireSafe(
        [...finalTraceAssertions].every((name) =>
          evidence.assertions.some((r) => r.assertion === name && r.outcome === "PASS"),
        ),
        "FINAL_TURN_TRACE_INCOMPLETE",
      );
    if (stage === "completion")
      requireSafe(
        [...completionTraceAssertions].every((name) =>
          evidence.assertions.some((row) => row.assertion === name && row.outcome === "PASS"),
        ),
        "COMPLETION_TRACE_INCOMPLETE",
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
    console.log(
      stage === "completion" ? formatCompletionReport(evidence) : JSON.stringify(evidence),
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === "--recover-logs") await recoverMain();
  else if (process.argv.length === 3 && process.argv[2] === "--recover-readiness")
    await recoverMain(recoverReadinessLogs, formatReadinessReport, (result) => {
      const checks = readinessChecks(result);
      return checks.chatReady && checks.budgetReady;
    });
  else if (process.argv.length === 4 && process.argv[2] === "--recover-final-turn")
    await recoverFinalMain(process.argv[3]);
  else if (process.argv.length === 3 && process.argv[2] === "--complete-booking")
    await main("completion");
  else if (process.argv.length === 4 && process.argv[2] === "--recover-completion") {
    const execution = process.argv[3];
    if (/^lead-agent-staging-migrator-[a-z0-9]+$/.test(execution))
      await recoverMain((token) => recoverCompletionLogs(execution, token), formatCompletionReport);
    else {
      console.log("BLOCKED: COMPLETION_EXECUTION_INVALID");
      process.exitCode = 1;
    }
  } else if (process.argv.length === 2) await main();
  else {
    console.log(JSON.stringify({ outcome: "BLOCKED", code: "READ_MODE_INVALID" }));
    process.exitCode = 1;
  }
}
