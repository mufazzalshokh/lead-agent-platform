import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import {
  reviewedReadiness,
  verifyReadinessJob,
  verifyReadinessWorker,
} from "./s22-widget-readiness.mjs";
import {
  attemptAssertions,
  attemptFailureCodes,
  attemptForceRlsTableNames,
  attemptOperation,
  attemptScope,
  sanitizeAttemptValue,
} from "./s22-widget-attempt-readonly.mjs";

// Compressed transport only: decoded source is still real ESM stdin in /app.
// Built-in zlib avoids an environment-size failure without changing package resolution.
export const moduleBootstrap =
  'import{spawnSync}from"node:child_process";import{gunzipSync}from"node:zlib";const r=spawnSync(process.execPath,["--input-type=module"],{input:gunzipSync(Buffer.from(process.env.S22_BOOKING_READ_B64,"base64")),cwd:process.cwd(),env:process.env,stdio:["pipe","inherit","inherit"],timeout:60000,killSignal:"SIGTERM"});process.exitCode=r.error||r.signal?1:Number.isInteger(r.status)?r.status:1;';

export const reviewedAttempt = Object.freeze({
  ...reviewedReadiness,
  session: "01a11b7d-ddbf-759e-b4e3-1602d9e2238c",
  timestamp: "2026-10-08T12:34:20Z",
  windowStart: "2026-10-08T12:58:00.000Z",
  windowEnd: "2026-10-08T13:03:00.000Z",
});
const pin = reviewedAttempt;
const attemptStages = new Set([
  ...attemptAssertions,
  "initialize",
  "collection_window",
  "package_resolution",
  "cohort_scope",
  "database_configuration",
  "database_readiness",
  "pool_error",
  "cleanup",
]);
const requireSafe = (condition, code) => {
  if (!condition) throw Object.assign(new Error(), { code });
};
const execute = promisify(execFile);
const cloud = async (args, timeout = 10000) => {
  try {
    return (await execute("gcloud", args, { encoding: "utf8", timeout, maxBuffer: 262144 })).stdout;
  } catch {
    throw Object.assign(new Error(), { code: "CLOUD_ACCESS_UNAVAILABLE" });
  }
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const httpPath = (raw) => {
  if (typeof raw !== "string") return null;
  let path;
  try {
    const url = new URL(raw, "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app");
    if (
      ![
        "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app",
        "https://lead-agent-staging-api-uj7pjzpksq-ww.a.run.app",
      ].includes(url.origin)
    )
      return null;
    path = url.pathname;
  } catch {
    return null;
  }
  if (path === "/v1/widget/conversations") return path;
  const match = /^\/v1\/widget\/conversations\/([^/]+)(\/messages)?$/u.exec(path);
  return match && uuid.test(match[1]) ? path : null;
};

// HTTP candidates are time/path scoped, not bearer/session-correlated proof.
export function normalizeAttemptHttp(entries) {
  requireSafe(Array.isArray(entries) && entries.length <= 40, "HTTP_LOG_METADATA_INVALID");
  return entries.flatMap((entry) => {
    const service = entry?.resource?.labels?.service_name;
    if (!["lead-agent-staging-web", "lead-agent-staging-api"].includes(service)) return [];
    const timestamp = entry.timestamp;
    if (
      typeof timestamp !== "string" ||
      !Number.isFinite(Date.parse(timestamp)) ||
      Date.parse(timestamp) < Date.parse(pin.windowStart) ||
      Date.parse(timestamp) >= Date.parse(pin.windowEnd)
    )
      return [];
    const path = httpPath(entry.httpRequest?.requestUrl ?? entry.jsonPayload?.path);
    const method = entry.httpRequest?.requestMethod ?? entry.jsonPayload?.method;
    if (path === null || !["POST", "GET", "OPTIONS"].includes(method)) return [];
    const status = entry.httpRequest?.status;
    const requestId = entry.jsonPayload?.requestId;
    return [
      {
        timestamp,
        service,
        method,
        path,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        request_id:
          typeof requestId === "string" && /^req-[a-z0-9]{1,40}$/u.test(requestId)
            ? requestId
            : null,
      },
    ];
  });
}

export function collectAttemptLogs(entries) {
  requireSafe(Array.isArray(entries) && entries.length <= 12, "LOG_METADATA_INVALID");
  const payloads = entries
    .map((entry) => entry?.jsonPayload)
    .filter((row) => row?.operation === attemptOperation);
  const blocked = payloads.find((row) => row.outcome === "BLOCKED");
  if (blocked)
    throw Object.assign(new Error(), {
      code: "READ_ONLY_DIAGNOSTIC_BLOCKED",
      assertion: attemptStages.has(blocked.assertion) ? blocked.assertion : "collection",
      diagnosticCode: attemptFailureCodes.has(blocked.code) ? blocked.code : null,
      sqlstate: new Set(
        "08001 08004 08006 25006 25P02 28000 28P01 42501 42601 42703 42P01 42P18 53300 53400 55P03 57014 57P01".split(
          " ",
        ),
      ).has(blocked.sqlstate)
        ? blocked.sqlstate
        : null,
    });
  requireSafe(
    payloads.length === attemptAssertions.length &&
      attemptAssertions.every(
        (name) => payloads.filter((row) => row.assertion === name).length === 1,
      ),
    "LOG_ASSERTIONS_INCOMPLETE",
  );
  const rows = attemptAssertions.map((name) => {
    const row = payloads.find((candidate) => candidate.assertion === name);
    requireSafe(row.outcome === "PASS", "LOG_ASSERTION_NOT_PASS");
    return { assertion: name, outcome: row.outcome, observed: sanitizeAttemptValue(row.observed) };
  });
  const find = (name) => rows.find((row) => row.assertion === name)?.observed;
  const runtime = find("runtime_read_only_tenant_guard"),
    rls = find("force_rls_not_owner_guard");
  requireSafe(
    runtime &&
      [
        "runtime",
        "staging_database",
        "least_privilege",
        "read_only",
        "row_security",
        "tenant_matches",
        "collection_window_valid",
      ].every((key) => runtime[key] === true) &&
      rls?.count === attemptForceRlsTableNames.length &&
      rls.safe === true,
    "LOG_METADATA_INVALID",
  );
  const session = find("widget_attempt_session");
  requireSafe(
    session?.session_id === pin.session &&
      session.channel_connection_id === attemptScope.channel &&
      session.allowed_origin_id === attemptScope.origin &&
      session.conversation_ownership_matches === true &&
      ((session.conversation_id === null &&
        session.contact_unbound === true &&
        session.conversation_unbound === true) ||
        (typeof session.conversation_id === "string" &&
          uuid.test(session.conversation_id) &&
          session.contact_unbound === false &&
          session.conversation_unbound === false)),
    "LOG_METADATA_INVALID",
  );
  for (const name of attemptAssertions.filter((name) =>
    /^widget_attempt_(messages|runs|actions|outbox|requests)$/u.test(name),
  )) {
    const observed = find(name);
    requireSafe(
      observed?.conversation_id === session.conversation_id &&
        Array.isArray(observed.rows) &&
        observed.windowStart === pin.windowStart &&
        observed.windowEnd === pin.windowEnd &&
        observed.query_state ===
          (session.conversation_id === null ? "SKIPPED_UNBOUND_SESSION" : "COLLECTED") &&
        (session.conversation_id !== null || observed.rows.length === 0),
      "LOG_METADATA_INVALID",
    );
  }
  requireSafe(
    find("widget_attempt_collection")?.no_message_or_call_triggered === true,
    "LOG_METADATA_INVALID",
  );
  return rows;
}

const dollars = (value) => {
  if (typeof value !== "string" || !/^\d{1,20}$/u.test(value)) return "unknown";
  const micros = BigInt(value);
  return `USD${micros / 1000000n}.${(micros % 1000000n).toString().padStart(6, "0")}`;
};
export function formatAttempt(result) {
  const find = (name) => result.rows.find((row) => row.assertion === name)?.observed;
  const session = find("widget_attempt_session"),
    budget = find("cohort_reservation_accounting");
  const messages = find("widget_attempt_messages"),
    runs = find("widget_attempt_runs");
  const actions = find("widget_attempt_actions");
  const outbox = find("widget_attempt_outbox"),
    requests = find("widget_attempt_requests");
  return [
    "Widget attempt collection: PASS (read-only metadata, not customer E2E)",
    `Read-only execution: ${result.execution}`,
    "Runtime / tenant / read-only / FORCE-RLS / non-owner guards: PASS",
    `Selected session: ${session.session_id}; status/version: ${session.status ?? "unknown"}/${session.version ?? "unknown"}`,
    `Idle valid: ${session.idle_valid}; absolute valid: ${session.absolute_valid}; last activity: ${session.last_seen_at ?? "unknown"}`,
    `Persisted conversation: ${session.conversation_id ?? "unbound"}`,
    ...(session.conversation_id === null
      ? []
      : [
          `Conversation state/version: ${session.conversation_status ?? "unknown"}/${session.conversation_version ?? "unknown"}; automation: ${session.automation_mode ?? "unknown"}; no active handoff: ${session.no_active_handoff ?? "unknown"}`,
        ]),
    `Bounded HTTP candidates: ${result.http.map((row) => `${row.timestamp} ${row.service} ${row.method} ${row.path} ${row.status ?? "status not logged"}`).join("; ") || "none collected"}`,
    "HTTP candidates are not independently correlated to a private session bearer.",
    ...(session.conversation_id === null
      ? ["Child message/run/outbox/request queries: skipped; exact session is unbound."]
      : [
          `Persisted inbound/outbound in attempt window: ${messages.rows.filter((row) => row.direction === "inbound").length}/${messages.rows.filter((row) => row.direction === "outbound").length}`,
          ...messages.rows.map(
            (row) =>
              `Message ${row.id}: ${row.direction}; processing ${row.processing_status ?? "unknown"}; delivery ${row.delivery_status ?? "unknown"}; created ${row.created_at ?? "unknown"}`,
          ),
          ...runs.rows.map(
            (row) =>
              `AI run ${row.id}: ${row.status ?? "unknown"}; failure ${row.failure_category ?? "none or uncollected"}; policy ${row.policy_allowed ?? "unknown"}; dispatch authorization ${row.dispatch_authorized ?? "unproven"}; reservations ${row.reservations ?? "unknown"}; cost ${dollars(row.estimated_cost_micros)}`,
          ),
          ...runs.rows.map(
            (row) =>
              `Run correlation: ${row.correlation_id ?? "unknown"}; trigger: ${row.trigger_message_id ?? "unknown"}; schema valid: ${row.schema_valid ?? "unknown"}`,
          ),
          ...actions.rows.map(
            (row) =>
              `Action ${row.id}: ${row.action_name ?? "unknown"}; validation: ${row.validation_status ?? "unknown"}; policy reason: ${row.policy_reason_code ?? "none or uncollected"}; application: ${row.application_status ?? "unknown"}`,
          ),
          `Persisted outbox rows / appointment requests in window: ${outbox.rows.length}/${requests.rows.length}`,
          ...outbox.rows.map(
            (row) =>
              `Outbox ${row.id}: ${row.event_type ?? "unknown"}; status: ${row.status ?? "unknown"}; attempts: ${row.attempt_count ?? "unknown"}; error: ${row.last_error_category ?? "none or uncollected"}; correlation: ${row.correlation_id ?? "unknown"}`,
          ),
          ...requests.rows.map(
            (row) =>
              `Request ${row.id}: ${row.status ?? "unknown"}; version: ${row.version ?? "unknown"}; offer: ${row.offer_version ?? "unknown"}`,
          ),
        ]),
    `Actual cohort block: ${budget.blocked ?? "unknown"}; reason: ${budget.reason ?? "none or uncollected"}`,
    `Known cost / reserved exposure: ${dollars(budget.knownCostMicros)} / ${dollars(budget.combinedExposureMicros)}; pending reserve: ${dollars(budget.unresolvedReserveMicros)}`,
    `Widget customer messages / provider reservations: ${budget.widget?.customerMessages ?? "not enumerated"}/${budget.widget?.physicalCalls ?? "not enumerated"}`,
    `Reader SHA256: ${result.reader_sha256}`,
    "No message, provider call, replay, renewal, replacement, migration or job configuration change was performed.",
    "Do not start a new chat or resend. Historical NULL costs remain unknown; S22 remains unaccepted.",
  ];
}

export async function runAttempt(overrides = {}) {
  requireSafe(
    attemptScope.session === pin.session &&
      attemptScope.windowStart === pin.windowStart &&
      attemptScope.windowEnd === pin.windowEnd,
    "ATTEMPT_SCOPE_INVALID",
  );
  const runCloud = overrides.cloud ?? cloud,
    runFetch = overrides.fetch ?? fetch;
  const now = overrides.now ?? (() => Date.now()),
    wait = overrides.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
    requireSafe(response.ok && response.body !== null, "CLOUD_READ_UNAVAILABLE");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      requireSafe(size <= 262144, "CLOUD_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error(), { code: "CLOUD_RESPONSE_INVALID" });
    }
  };
  const expectations = { sessionId: pin.session, deploymentTimestamp: pin.timestamp };
  verifyReadinessWorker(
    await request(
      `https://run.googleapis.com/v2/projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker`,
    ),
    expectations,
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
  );
  const logging = (execution) =>
    request("https://logging.googleapis.com/v2/entries:list", {
      resourceNames: [`projects/${pin.project}`],
      pageSize: execution ? 12 : 1,
      orderBy: "timestamp asc",
      filter: `resource.type="cloud_run_job" AND resource.labels.job_name="${pin.job}" AND timestamp>="${started}" AND jsonPayload.operation="${attemptOperation}"${execution ? ` AND labels."run.googleapis.com/execution_name"="${execution}"` : ""}`,
    });
  await logging(); // Verify authenticated permission before any one-off read execution.
  const httpLogs = await request("https://logging.googleapis.com/v2/entries:list", {
    resourceNames: [`projects/${pin.project}`],
    pageSize: 40,
    orderBy: "timestamp asc",
    filter: `resource.type="cloud_run_revision" AND timestamp>="${pin.windowStart}" AND timestamp<"${pin.windowEnd}" AND (resource.labels.service_name="lead-agent-staging-api" OR resource.labels.service_name="lead-agent-staging-web") AND (httpRequest.requestUrl:"/v1/widget/conversations" OR jsonPayload.path:"/v1/widget/conversations")`,
  });
  requireSafe(!httpLogs.nextPageToken, "HTTP_LOG_ROW_LIMIT_EXCEEDED");
  const http = normalizeAttemptHttp(httpLogs.entries ?? []);
  overrides.onPreflight?.();
  const reader = await readFile(new URL("./s22-widget-attempt-readonly.mjs", import.meta.url));
  const payload = gzipSync(reader).toString("base64");
  requireSafe(payload.length < 32000, "DIAGNOSTIC_PAYLOAD_TOO_LARGE");
  let execution;
  try {
    execution = (
      await runCloud(
        [
          "run",
          "jobs",
          "execute",
          pin.job,
          `--project=${pin.project}`,
          `--region=${pin.region}`,
          `--args=^~^--input-type=module~-e~${moduleBootstrap}`,
          `--update-env-vars=^~^S22_BOOKING_READ_B64=${payload}~S22_WIDGET_ATTEMPT_READ=execute~S22_WIDGET_ATTEMPT_STARTED_AT=${started}`,
          "--tasks=1",
          "--task-timeout=65s",
          "--format=value(metadata.name)",
        ],
        30000,
      )
    ).trim();
  } catch {
    throw Object.assign(new Error(), { code: "EXECUTION_ID_UNAVAILABLE_NO_RERUN" });
  }
  requireSafe(
    /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(execution),
    "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
  );
  overrides.onExecution?.(execution);
  try {
    let terminal = false,
      succeeded = false;
    const deadline = now() + 90000;
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
      const completed = state.status?.conditions?.find(
        (condition) => condition.type === "Completed",
      );
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
    for (let attempt = 0; attempt < 3; attempt++) {
      const logs = await logging(execution);
      requireSafe(!logs.nextPageToken, "LOG_METADATA_INVALID");
      try {
        rows = collectAttemptLogs(logs.entries ?? []);
        break;
      } catch (error) {
        if (error.code !== "LOG_ASSERTIONS_INCOMPLETE" || attempt === 2) throw error;
        await wait(2000);
      }
    }
    requireSafe(succeeded, "DIAGNOSTIC_TASK_FAILED");
    return {
      execution,
      rows,
      http,
      reader_sha256: createHash("sha256").update(reader).digest("hex"),
    };
  } catch (error) {
    error.execution = execution;
    throw error;
  }
}

const safeFailures = new Set([
  "ATTEMPT_SCOPE_INVALID",
  "AUTHENTICATION_UNAVAILABLE",
  "CLOUD_ACCESS_UNAVAILABLE",
  "CLOUD_READ_PERMISSION_UNAVAILABLE",
  "CLOUD_READ_UNAVAILABLE",
  "CLOUD_RESPONSE_TOO_LARGE",
  "CLOUD_RESPONSE_INVALID",
  "HTTP_LOG_METADATA_INVALID",
  "HTTP_LOG_ROW_LIMIT_EXCEEDED",
  "LOG_METADATA_INVALID",
  "LOG_ASSERTIONS_INCOMPLETE",
  "LOG_ASSERTION_NOT_PASS",
  "READ_ONLY_DIAGNOSTIC_BLOCKED",
  "DIAGNOSTIC_PAYLOAD_TOO_LARGE",
  "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
  "EXECUTION_WINDOW_ELAPSED_NO_RERUN",
  "DIAGNOSTIC_TASK_FAILED",
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
  "ENVIRONMENT_INVALID",
]);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let execution;
  try {
    requireSafe(process.argv.length === 2, "ATTEMPT_SCOPE_INVALID");
    const result = await runAttempt({
      onPreflight: () =>
        console.log(
          "Preflight: PASS (reviewed images/binding, runtime role reference, private VPC, explicit zero retries)",
        ),
      onExecution: (name) => {
        execution = name;
        console.log(`Read-only execution: ${name}`);
      },
    });
    for (const line of formatAttempt(result)) console.log(line);
  } catch (error) {
    console.log(
      `BLOCKED: ${safeFailures.has(error?.code) ? error.code : "CLOUD_OR_TOOLING_UNAVAILABLE"}`,
    );
    if (error?.code === "READ_ONLY_DIAGNOSTIC_BLOCKED") {
      console.log(`Failure stage: ${error.assertion}`);
      if (error.diagnosticCode !== null) console.log(`Diagnostic reason: ${error.diagnosticCode}`);
      if (error.sqlstate !== null) console.log(`SQLSTATE: ${error.sqlstate}`);
    }
    const preserved = execution ?? error?.execution;
    if (typeof preserved === "string" && /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(preserved))
      console.log(`Preserved execution: ${preserved}; do not rerun blindly.`);
    process.exitCode = 1;
  }
}
