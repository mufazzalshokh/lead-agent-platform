import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  budgetReadinessPass,
  parseReadinessScope,
  readinessBudgetReasons,
  readinessFailureCodes,
  readinessForceRlsTableNames,
  readinessOperation,
  readinessScope,
  sessionReadinessPass,
} from "./s22-widget-readiness-readonly.mjs";

// Only the owner-approved apply 37768798066 / verification 37769024360.
export const reviewedReadiness = Object.freeze({
  project: "lead-agent-stg-739284",
  region: "me-central1",
  job: "lead-agent-staging-migrator",
  source: "a2b2f708d2e804d2c3d2be66426fa7b49d8203c9",
  timestamp: "2026-10-08T11:00:45Z",
  head: "0031_s22_widget_inbound_route_management",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:c2c31c5643938aaae945ff0906f99522f6573fc562cd0568be7594049409580b",
  image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:2aa2c94ef59b8becda3db9e731a2cd5e65b535a40b539b896b97486d67c80276",
});
// Verbatim existing subprocess-tested bootstrap: real ESM stdin in /app, never eval.
export const moduleBootstrap =
  'import{spawnSync}from"node:child_process";const r=spawnSync(process.execPath,["--input-type=module"],{input:Buffer.from(process.env.S22_BOOKING_READ_B64,"base64"),cwd:process.cwd(),env:process.env,stdio:["pipe","inherit","inherit"],timeout:60000,killSignal:"SIGTERM"});process.exitCode=r.error||r.signal?1:Number.isInteger(r.status)?r.status:1;';
const requireSafe = (value, code) => {
  if (!value) throw Object.assign(new Error(), { code });
};
const pin = reviewedReadiness;
const environment = (container) => {
  requireSafe(Array.isArray(container?.env), "ENVIRONMENT_INVALID");
  const values = new Map();
  for (const entry of container.env) {
    requireSafe(typeof entry.name === "string" && !values.has(entry.name), "ENVIRONMENT_INVALID");
    values.set(entry.name, entry);
  }
  return values;
};
const provenance = (
  values,
  image,
  includeDigest,
  timestamp = pin.timestamp,
  source = pin.source,
) => {
  for (const [name, expected] of Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: source,
    DEPLOYMENT_TIMESTAMP: timestamp,
    DEPLOYMENT_MIGRATION_HEAD: pin.head,
    ...(includeDigest ? { DEPLOYMENT_IMAGE_DIGEST: image } : {}),
  }))
    requireSafe(values.get(name)?.value === expected, "PROVENANCE_MISMATCH");
};
const networkMatches = (interfaces) =>
  Array.isArray(interfaces) &&
  interfaces.length === 1 &&
  [
    "lead-agent-staging-vpc",
    `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
  ].includes(interfaces[0].network) &&
  [
    "lead-agent-staging-cloud-run",
    `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
  ].includes(interfaces[0].subnetwork);

const canonicalTimestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value.replace(/Z$/u, ".000Z");

// A reviewed wrapper supplies these literals from verified build/plan evidence.
// They are never inferred from the job/Worker being checked or exposed as CLI selectors.
const copyReviewedRuntime = (value) => {
  if (value === undefined) return undefined;
  requireSafe(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join() === "image,source,timestamp,worker",
    "REVIEWED_RUNTIME_INVALID",
  );
  const reviewed = Object.freeze({
    source: value.source,
    worker: value.worker,
    image: value.image,
    timestamp: value.timestamp,
  });
  requireSafe(
    typeof reviewed.source === "string" &&
      /^[0-9a-f]{40}$/u.test(reviewed.source) &&
      typeof reviewed.worker === "string" &&
      /^me-central1-docker\.pkg\.dev\/lead-agent-stg-739284\/lead-agent\/worker@sha256:[0-9a-f]{64}$/u.test(
        reviewed.worker,
      ) &&
      typeof reviewed.image === "string" &&
      /^me-central1-docker\.pkg\.dev\/lead-agent-stg-739284\/lead-agent\/migrator@sha256:[0-9a-f]{64}$/u.test(
        reviewed.image,
      ) &&
      canonicalTimestamp(reviewed.timestamp),
    "REVIEWED_RUNTIME_INVALID",
  );
  return reviewed;
};
const prepareReadinessInputs = (sessionId, deploymentTimestamp, reviewedRuntime = undefined) => {
  const reviewed = copyReviewedRuntime(reviewedRuntime);
  const runtime = reviewed === undefined ? pin : Object.freeze({ ...pin, ...reviewed });
  if (reviewed !== undefined)
    requireSafe(
      sessionId !== undefined && deploymentTimestamp !== undefined,
      "READINESS_EXPECTATION_INVALID",
    );
  if (sessionId === undefined && deploymentTimestamp === undefined)
    return { scope: readinessScope, timestamp: pin.timestamp, runtime, reviewedRuntime: reviewed };
  const scope = parseReadinessScope(sessionId);
  requireSafe(
    sessionId !== undefined && scope.session !== readinessScope.session,
    "EXPIRED_SELECTION_REUSE_FORBIDDEN",
  );
  requireSafe(
    canonicalTimestamp(deploymentTimestamp) &&
      (reviewed === undefined
        ? deploymentTimestamp > pin.timestamp
        : deploymentTimestamp === reviewed.timestamp),
    "READINESS_EXPECTATION_INVALID",
  );
  return { scope, timestamp: deploymentTimestamp, runtime, reviewedRuntime: reviewed };
};

// Only exact, explicitly supplied replacement expectation; never learn it from live metadata.
export function parseReadinessArguments(args) {
  requireSafe(Array.isArray(args), "ENVIRONMENT_INVALID");
  if (args.length === 0) return {};
  requireSafe(args.length === 4, "ENVIRONMENT_INVALID");
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    requireSafe(
      ["--session", "--deployment-timestamp"].includes(name) && !values.has(name),
      "ENVIRONMENT_INVALID",
    );
    values.set(name, args[index + 1]);
  }
  const inputs = {
    sessionId: values.get("--session"),
    deploymentTimestamp: values.get("--deployment-timestamp"),
  };
  prepareReadinessInputs(inputs.sessionId, inputs.deploymentTimestamp);
  return inputs;
}

export function verifyReadinessJob(metadata, inputs = {}, reviewedRuntime = undefined) {
  const { timestamp, runtime } = prepareReadinessInputs(
    inputs.sessionId,
    inputs.deploymentTimestamp,
    reviewedRuntime,
  );
  const task = metadata?.spec?.template?.spec?.template?.spec;
  const container = task?.containers?.[0];
  requireSafe(
    metadata?.metadata?.name === pin.job &&
      metadata.metadata.labels?.["cloud.googleapis.com/location"] === pin.region,
    "DIAGNOSTIC_SCOPE_MISMATCH",
  );
  requireSafe(
    task?.containers?.length === 1 &&
      container.image === runtime.image &&
      JSON.stringify(container.command) === '["node"]' &&
      JSON.stringify(container.args) === '["dist/index.js"]',
    "DIAGNOSTIC_IMAGE_MISMATCH",
  );
  requireSafe(
    task.serviceAccountName ===
      `lead-agent-staging-migrator@${pin.project}.iam.gserviceaccount.com`,
    "DIAGNOSTIC_IDENTITY_MISMATCH",
  );
  requireSafe(
    Object.hasOwn(task, "maxRetries") &&
      typeof task.maxRetries === "number" &&
      task.maxRetries === 0,
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  );
  const values = environment(container);
  provenance(values, runtime.image, true, timestamp, runtime.source);
  const database = values.get("DATABASE_URL");
  requireSafe(
    database?.value === undefined &&
      database?.valueFrom?.secretKeyRef?.name?.split("/").at(-1) ===
        "lead-agent-staging-runtime-database-url" &&
      database.valueFrom.secretKeyRef.key === "latest",
    "RUNTIME_SECRET_REFERENCE_MISMATCH",
  );
  const annotations = metadata.spec.template.metadata?.annotations;
  let network;
  try {
    network = JSON.parse(annotations?.["run.googleapis.com/network-interfaces"]);
  } catch {
    requireSafe(false, "DIAGNOSTIC_VPC_MISMATCH");
  }
  requireSafe(
    annotations?.["run.googleapis.com/vpc-access-egress"] === "private-ranges-only" &&
      networkMatches(network),
    "DIAGNOSTIC_VPC_MISMATCH",
  );
}

export function verifyReadinessWorker(metadata, inputs = {}, reviewedRuntime = undefined) {
  const { scope, timestamp, runtime } = prepareReadinessInputs(
    inputs.sessionId,
    inputs.deploymentTimestamp,
    reviewedRuntime,
  );
  const template = metadata?.template;
  const container = template?.containers?.[0];
  requireSafe(
    metadata?.name ===
      `projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker` &&
      template?.containers?.length === 1 &&
      container.image === runtime.worker,
    "WORKER_SCOPE_OR_IMAGE_MISMATCH",
  );
  const values = environment(container);
  provenance(values, runtime.worker, false, timestamp, runtime.source);
  requireSafe(
    values.get("AI_JOURNEY_MODE")?.value === "widget_booking" &&
      values.get("AI_JOURNEY_WIDGET_SESSION_ID")?.value === scope.session &&
      values.get("AI_REQUEST_TIMEOUT_MS")?.value === "15000",
    "WORKER_BINDING_MISMATCH",
  );
  requireSafe(
    template.serviceAccount ===
      `lead-agent-staging-worker@${pin.project}.iam.gserviceaccount.com` &&
      metadata.scaling?.manualInstanceCount === 1 &&
      Object.keys(metadata.scaling).every((name) => name === "manualInstanceCount") &&
      metadata.terminalCondition?.state === "CONDITION_SUCCEEDED",
    "WORKER_IDENTITY_SCALING_OR_READINESS_MISMATCH",
  );
  requireSafe(
    template.vpcAccess?.egress === "PRIVATE_RANGES_ONLY" &&
      networkMatches(template.vpcAccess.networkInterfaces),
    "WORKER_VPC_MISMATCH",
  );
}

const assertions = [
  "runtime_read_only_tenant_guard",
  "force_rls_not_owner_guard",
  "exact_widget_session",
  "cohort_reservation_accounting",
  "first_message_readiness",
];
const diagnosticStages = new Set([
  ...assertions,
  "collection_window",
  "selection_scope",
  "package_resolution",
  "cohort_scope",
  "database_configuration",
  "database_readiness",
  "pool_error",
  "cleanup",
]);
const diagnosticSqlstates = new Set([
  "08001",
  "08004",
  "08006",
  "25006",
  "25P02",
  "28000",
  "28P01",
  "42501",
  "42601",
  "42703",
  "42P01",
  "42P18",
  "53300",
  "53400",
  "55P03",
  "57014",
  "57P01",
]);
const safeFields = new Set([
  "runtime",
  "staging_database",
  "least_privilege",
  "read_only",
  "row_security",
  "tenant_matches",
  "collection_window_valid",
  "count",
  "safe",
  "row_count",
  "status",
  "version",
  "issued_at",
  "last_seen_at",
  "expires_at",
  "contact_unbound",
  "conversation_unbound",
  "not_revoked",
  "channel_active",
  "origin_active",
  "absolute_valid",
  "idle_valid",
  "scope_matches",
  "session_ready",
  "budget_ready",
  "ready",
  "no_message_or_call_triggered",
  "remaining_customer_messages",
  "remaining_physical_attempts",
  "physicalCalls",
  "logicalMessages",
  "customerMessages",
  "knownCostMicros",
  "unresolvedReserveMicros",
  "historicalReserveMicros",
  "combinedExposureMicros",
  "perCallReserveMicros",
  "accountingComplete",
  "blocked",
  "reason",
  "mode",
  "profile",
  "session_id",
  "channel_connection_id",
  "conversationUnbound",
  "allowed_origin_id",
  "sessionId",
  "conversationId",
]);
const reasons = new Set(readinessBudgetReasons);
const projectSafe = (value) => {
  requireSafe(value && typeof value === "object" && !Array.isArray(value), "LOG_METADATA_INVALID");
  const result = {};
  for (const [name, field] of Object.entries(value)) {
    if (name === "widget") {
      result.widget = projectSafe(field);
      continue;
    }
    if (!safeFields.has(name)) continue;
    if (field === null || typeof field === "boolean") result[name] = field;
    else if (typeof field === "number" && Number.isSafeInteger(field) && field >= 0 && field <= 65)
      result[name] = field;
    else if (
      typeof field === "string" &&
      (/^\d{1,20}$/u.test(field) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(field) ||
        (/^(issued_at|last_seen_at|expires_at)$/u.test(name) &&
          Number.isFinite(Date.parse(field)) &&
          new Date(field).toISOString() === field) ||
        ["active", "revoked", "expired", "widget_booking", "s22-synthetic-booking.v1"].includes(
          field,
        ) ||
        (name === "reason" && reasons.has(field)))
    )
      result[name] = field;
  }
  return result;
};

export function collectReadinessLogs(entries, scope = readinessScope) {
  requireSafe(Array.isArray(entries) && entries.length <= 12, "LOG_METADATA_INVALID");
  const rows = entries
    .map((entry) => entry?.jsonPayload)
    .filter((row) => row?.operation === readinessOperation);
  const blocked = rows.find((row) => row.outcome === "BLOCKED");
  if (blocked)
    throw Object.assign(new Error(), {
      code: "READ_ONLY_DIAGNOSTIC_BLOCKED",
      diagnostic_stage: diagnosticStages.has(blocked.assertion) ? blocked.assertion : "unknown",
      diagnostic_code: readinessFailureCodes.has(blocked.code)
        ? blocked.code
        : "DATABASE_OR_TOOLING_UNAVAILABLE",
      sqlstate: diagnosticSqlstates.has(blocked.sqlstate) ? blocked.sqlstate : null,
    });
  requireSafe(
    rows.length === assertions.length &&
      assertions.every((name) => rows.filter((row) => row.assertion === name).length === 1),
    "LOG_ASSERTIONS_INCOMPLETE",
  );
  const result = assertions.map((name) => {
    const row = rows.find((item) => item.assertion === name);
    requireSafe(["PASS", "FAIL"].includes(row.outcome), "LOG_METADATA_INVALID");
    return { assertion: name, outcome: row.outcome, observed: projectSafe(row.observed) };
  });
  const [runtime, rls, session, budget, first] = result;
  const sessionPass =
    session.observed.row_count === 1 &&
    session.observed.scope_matches === true &&
    sessionReadinessPass(
      [{ organization_id: readinessScope.organization, ...session.observed }],
      scope,
    );
  const budgetPass =
    budgetReadinessPass(budget.observed, scope) &&
    budget.observed.widget.conversationUnbound === true;
  requireSafe(
    runtime.outcome === "PASS" &&
      [
        "runtime",
        "staging_database",
        "least_privilege",
        "read_only",
        "row_security",
        "tenant_matches",
        "collection_window_valid",
      ].every((key) => runtime.observed[key] === true) &&
      rls.outcome === "PASS" &&
      rls.observed.count === readinessForceRlsTableNames.length &&
      rls.observed.safe === true &&
      (session.outcome === "PASS") === sessionPass &&
      (budget.outcome === "PASS") === budgetPass &&
      first.observed.session_ready === sessionPass &&
      first.observed.budget_ready === budgetPass &&
      first.observed.ready === (sessionPass && budgetPass) &&
      first.observed.no_message_or_call_triggered === true &&
      first.observed.remaining_customer_messages === (budgetPass ? 2 : 0) &&
      first.observed.remaining_physical_attempts === (budgetPass ? 4 : 0) &&
      (first.outcome === "PASS") === (sessionPass && budgetPass),
    "LOG_METADATA_INVALID",
  );
  return result;
}

const dollars = (micros) => {
  if (typeof micros !== "string" || !/^\d{1,20}$/u.test(micros)) return "unknown";
  const value = BigInt(micros);
  return `USD${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
};
export function formatReadiness(rows) {
  const session = rows.find((row) => row.assertion === "exact_widget_session");
  const budget = rows.find((row) => row.assertion === "cohort_reservation_accounting");
  const first = rows.find((row) => row.assertion === "first_message_readiness");
  return [
    `Runtime / tenant / read-only guard: ${rows[0].outcome}`,
    `FORCE RLS / non-owner guard: ${rows[1].outcome}`,
    `Selected Widget session: ${session.observed.session_id ?? "not collected"}`,
    `Selected session: ${session.outcome}; idle valid: ${session.observed.idle_valid ?? "unknown"}; absolute lifetime valid: ${session.observed.absolute_valid ?? "unknown"}`,
    `Last session activity (UTC): ${session.observed.last_seen_at ?? "not collected"}`,
    `Absolute expiry (UTC): ${session.observed.expires_at ?? "not collected"}`,
    `Budget readiness: ${budget.outcome}; reason: ${budget.observed.reason ?? (budget.outcome === "PASS" ? "none" : "unavailable")}`,
    `Known cost / total reserved exposure: ${dollars(budget.observed.knownCostMicros)} / ${dollars(budget.observed.combinedExposureMicros)}`,
    `Pending reserve: ${dollars(budget.observed.unresolvedReserveMicros)}`,
    `First-message preparation: ${first.outcome}`,
    "No message, AI call, renewal, replacement, migration or job configuration change was performed.",
    "This check does not authorize Send or reconcile historical NULL costs.",
  ];
}

const execute = promisify(execFile);
const cloud = async (args, timeout = 10000) => {
  try {
    return (await execute("gcloud", args, { encoding: "utf8", timeout, maxBuffer: 262144 })).stdout;
  } catch {
    throw Object.assign(new Error(), { code: "CLOUD_ACCESS_UNAVAILABLE" });
  }
};
export async function runReadiness(overrides = {}) {
  const expectations = Object.freeze({
    sessionId: overrides.sessionId,
    deploymentTimestamp: overrides.deploymentTimestamp,
  });
  const { scope, reviewedRuntime } = prepareReadinessInputs(
    expectations.sessionId,
    expectations.deploymentTimestamp,
    overrides.reviewedRuntime,
  );
  const runCloud = overrides.cloud ?? cloud,
    runFetch = overrides.fetch ?? fetch;
  const now = overrides.now ?? (() => Date.now()),
    wait = overrides.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = new Date(now()).toISOString();
  const token = (await runCloud(["auth", "print-access-token", "--quiet"])).trim();
  requireSafe(token.length > 0 && !/\s/u.test(token), "AUTHENTICATION_UNAVAILABLE");
  const request = async (url, body) => {
    const response = await runFetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    requireSafe(
      response.status !== 401 && response.status !== 403,
      "CLOUD_READ_PERMISSION_UNAVAILABLE",
    );
    requireSafe(response.ok, "CLOUD_READ_UNAVAILABLE");
    requireSafe(response.body !== null, "CLOUD_RESPONSE_INVALID");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      requireSafe(size <= 262144, "CLOUD_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      return JSON.parse(raw);
    } catch {
      throw Object.assign(new Error(), { code: "CLOUD_RESPONSE_INVALID" });
    }
  };
  verifyReadinessWorker(
    await request(
      `https://run.googleapis.com/v2/projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker`,
    ),
    expectations,
    reviewedRuntime,
  );
  verifyReadinessJob(
    JSON.parse(
      await runCloud([
        "run",
        "jobs",
        "describe",
        pin.job,
        `--project=${pin.project}`,
        `--region=${pin.region}`,
        "--format=json",
      ]),
    ),
    expectations,
    reviewedRuntime,
  );
  const logging = (execution) =>
    request("https://logging.googleapis.com/v2/entries:list", {
      resourceNames: [`projects/${pin.project}`],
      filter: `resource.type="cloud_run_job" AND resource.labels.job_name="${pin.job}" AND timestamp>="${started}" AND jsonPayload.operation="${readinessOperation}"${execution ? ` AND labels."run.googleapis.com/execution_name"="${execution}"` : ""}`,
      pageSize: execution ? 12 : 1,
      orderBy: "timestamp asc",
    });
  await logging(); // Verify log-read permission before creating ONE execution.
  overrides.onPreflight?.();
  const reader = await readFile(new URL("./s22-widget-readiness-readonly.mjs", import.meta.url));
  const payload = reader.toString("base64");
  requireSafe(payload.length < 32000, "DIAGNOSTIC_PAYLOAD_TOO_LARGE");
  const execution = (
    await runCloud(
      [
        "run",
        "jobs",
        "execute",
        pin.job,
        `--project=${pin.project}`,
        `--region=${pin.region}`,
        `--args=^~^--input-type=module~-e~${moduleBootstrap}`,
        `--update-env-vars=^~^S22_BOOKING_READ_B64=${payload}~S22_WIDGET_READINESS_READ=execute~S22_WIDGET_READINESS_STARTED_AT=${started}~S22_WIDGET_READINESS_SESSION_ID=${scope.session}`,
        "--tasks=1",
        "--task-timeout=65s",
        "--format=value(metadata.name)",
      ],
      30000,
    )
  ).trim();
  requireSafe(
    /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(execution),
    "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
  );
  overrides.onExecution?.(execution);
  const deadline = now() + 90000;
  let succeeded = false,
    terminal = false;
  while (now() < deadline) {
    const state = JSON.parse(
      await runCloud([
        "run",
        "jobs",
        "executions",
        "describe",
        execution,
        `--project=${pin.project}`,
        `--region=${pin.region}`,
        "--format=json",
      ]),
    );
    const completed = state.status?.conditions?.find((condition) => condition.type === "Completed");
    const status = completed?.status ?? completed?.state;
    if (["True", "False", "CONDITION_SUCCEEDED", "CONDITION_FAILED"].includes(status)) {
      terminal = true;
      succeeded = ["True", "CONDITION_SUCCEEDED"].includes(status);
      break;
    }
    await wait(2000);
  }
  requireSafe(terminal, "EXECUTION_WINDOW_ELAPSED_NO_RERUN");
  await wait(2000);
  let rows;
  // Read only the same completed execution; tolerate finite log ingestion delay.
  for (let attempt = 0; attempt < 3; attempt++) {
    const logs = await logging(execution);
    requireSafe(!logs.nextPageToken, "LOG_METADATA_INVALID");
    try {
      rows = collectReadinessLogs(logs.entries ?? [], scope);
      break;
    } catch (error) {
      if (error.code !== "LOG_ASSERTIONS_INCOMPLETE" || attempt === 2) throw error;
      await wait(2000);
    }
  }
  const ready = rows.every((row) => row.outcome === "PASS");
  requireSafe(!ready || succeeded, "DIAGNOSTIC_TASK_FAILED");
  return {
    execution,
    ready,
    rows,
    reader_sha256: createHash("sha256").update(reader).digest("hex"),
  };
}

const failureCodes = new Set([
  "ENVIRONMENT_INVALID",
  "READINESS_SCOPE_INVALID",
  "READINESS_EXPECTATION_INVALID",
  "REVIEWED_RUNTIME_INVALID",
  "EXPIRED_SELECTION_REUSE_FORBIDDEN",
  "PROVENANCE_MISMATCH",
  "DIAGNOSTIC_SCOPE_MISMATCH",
  "DIAGNOSTIC_IMAGE_MISMATCH",
  "DIAGNOSTIC_IDENTITY_MISMATCH",
  "EXPLICIT_ZERO_RETRIES_REQUIRED",
  "RUNTIME_SECRET_REFERENCE_MISMATCH",
  "DIAGNOSTIC_VPC_MISMATCH",
  "WORKER_SCOPE_OR_IMAGE_MISMATCH",
  "WORKER_BINDING_MISMATCH",
  "WORKER_IDENTITY_SCALING_OR_READINESS_MISMATCH",
  "WORKER_VPC_MISMATCH",
  "LOG_METADATA_INVALID",
  "READ_ONLY_DIAGNOSTIC_BLOCKED",
  "LOG_ASSERTIONS_INCOMPLETE",
  "CLOUD_ACCESS_UNAVAILABLE",
  "AUTHENTICATION_UNAVAILABLE",
  "CLOUD_READ_PERMISSION_UNAVAILABLE",
  "CLOUD_READ_UNAVAILABLE",
  "CLOUD_RESPONSE_TOO_LARGE",
  "CLOUD_RESPONSE_INVALID",
  "DIAGNOSTIC_PAYLOAD_TOO_LARGE",
  "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
  "EXECUTION_WINDOW_ELAPSED_NO_RERUN",
  "DIAGNOSTIC_TASK_FAILED",
]);
export function formatReadinessFailure(error, execution = undefined) {
  const lines = [
    `BLOCKED: ${failureCodes.has(error?.code) ? error.code : "CLOUD_OR_TOOLING_UNAVAILABLE"}`,
  ];
  if (error?.code === "READ_ONLY_DIAGNOSTIC_BLOCKED") {
    const stage = diagnosticStages.has(error.diagnostic_stage) ? error.diagnostic_stage : "unknown";
    const code = readinessFailureCodes.has(error.diagnostic_code)
      ? error.diagnostic_code
      : "DATABASE_OR_TOOLING_UNAVAILABLE";
    lines.push(`Failure stage: ${stage}; reason: ${code}`);
    if (diagnosticSqlstates.has(error.sqlstate)) lines.push(`SQLSTATE: ${error.sqlstate}`);
  }
  if (typeof execution === "string" && /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(execution))
    lines.push(`Preserved execution: ${execution}; do not rerun blindly.`);
  return lines;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let execution;
  try {
    const inputs = parseReadinessArguments(process.argv.slice(2));
    const result = await runReadiness({
      ...inputs,
      onPreflight: () =>
        console.log(
          "Preflight: PASS (exact deployed images/binding, runtime role reference, private VPC, explicit zero retries)",
        ),
      onExecution: (name) => {
        execution = name;
        console.log(`Read-only execution: ${name}`);
      },
    });
    for (const line of formatReadiness(result.rows)) console.log(line);
    console.log(`Reader SHA256: ${result.reader_sha256}`);
    process.exitCode = result.ready ? 0 : 1;
  } catch (error) {
    for (const line of formatReadinessFailure(error, execution)) console.log(line);
    process.exitCode = 1;
  }
}
