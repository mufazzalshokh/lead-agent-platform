import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  parseSelectionScope,
  sanitizeSelectionFailure,
  selectionFailureCodes,
  selectionOperation,
  selectionOrganization,
} from "./s22-widget-session-select-readonly.mjs";

const execute = promisify(execFile);
export const reviewedSelectionJob = Object.freeze({
  project: "lead-agent-stg-739284",
  region: "me-central1",
  job: "lead-agent-staging-migrator",
  source: "a2b2f708d2e804d2c3d2be66426fa7b49d8203c9",
  timestamp: "2026-10-08T12:34:20Z",
  head: "0031_s22_widget_inbound_route_management",
  image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:2aa2c94ef59b8becda3db9e731a2cd5e65b535a40b539b896b97486d67c80276",
});
// Verbatim existing, subprocess-tested ES-module stdin bootstrap. No eval reader.
export const moduleBootstrap =
  'import{spawnSync}from"node:child_process";const r=spawnSync(process.execPath,["--input-type=module"],{input:Buffer.from(process.env.S22_BOOKING_READ_B64,"base64"),cwd:process.cwd(),env:process.env,stdio:["pipe","inherit","inherit"],timeout:60000,killSignal:"SIGTERM"});process.exitCode=r.error||r.signal?1:Number.isInteger(r.status)?r.status:1;';
const requireSafe = (value, code) => {
  if (!value) throw Object.assign(new Error(), { code });
};
const errorCodes = new Set([
  "SELECTION_SCOPE_INVALID",
  "DIAGNOSTIC_JOB_SCOPE_MISMATCH",
  "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH",
  "DIAGNOSTIC_IDENTITY_MISMATCH",
  "DIAGNOSTIC_PROVENANCE_MISMATCH",
  "EXPLICIT_ZERO_RETRIES_REQUIRED",
  "RUNTIME_SECRET_REFERENCE_MISMATCH",
  "DIAGNOSTIC_VPC_MISMATCH",
  "AUTHENTICATION_UNAVAILABLE",
  "DIAGNOSTIC_PAYLOAD_TOO_LARGE",
  "EXECUTION_ID_UNAVAILABLE_NO_RERUN",
  "DIAGNOSTIC_WINDOW_ELAPSED_NO_RERUN",
  "LOG_PERMISSION_UNAVAILABLE",
  "LOG_READ_UNAVAILABLE",
  "LOG_ASSERTIONS_NOT_COMPLETE",
  "LOG_ASSERTION_NOT_PASS",
  "LOG_SAFE_METADATA_INVALID",
  "DIAGNOSTIC_EXECUTION_FAILED",
  "SELECTION_FILE_EXISTS",
  "SELECTION_FILE_WRITE_FAILED",
  "SELECTION_SNAPSHOT_EXPIRED",
  ...selectionFailureCodes,
]);
export const verifySelectionJob = (metadata) => {
  const pin = reviewedSelectionJob;
  requireSafe(
    metadata?.metadata?.name === pin.job &&
      String(metadata.metadata.labels?.["cloud.googleapis.com/location"]) === pin.region,
    "DIAGNOSTIC_JOB_SCOPE_MISMATCH",
  );
  const task = metadata?.spec?.template?.spec?.template?.spec;
  const container = task?.containers?.[0];
  requireSafe(
    task?.containers?.length === 1 &&
      container.image === pin.image &&
      JSON.stringify(container.command) === '["node"]' &&
      JSON.stringify(container.args) === '["dist/index.js"]',
    "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH",
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
  const namedEnvironment = (name) => container.env?.filter((entry) => entry.name === name);
  for (const [name, expected] of Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: pin.source,
    DEPLOYMENT_TIMESTAMP: pin.timestamp,
    DEPLOYMENT_MIGRATION_HEAD: pin.head,
    DEPLOYMENT_IMAGE_DIGEST: pin.image,
  })) {
    const values = namedEnvironment(name);
    requireSafe(
      values?.length === 1 && values[0].value === expected,
      "DIAGNOSTIC_PROVENANCE_MISMATCH",
    );
  }
  const database = namedEnvironment("DATABASE_URL");
  requireSafe(
    database?.length === 1 &&
      database[0].value === undefined &&
      database[0].valueFrom?.secretKeyRef?.name?.split("/").at(-1) ===
        "lead-agent-staging-runtime-database-url" &&
      database[0].valueFrom?.secretKeyRef?.key === "latest",
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
      Array.isArray(network) &&
      network.length === 1 &&
      [
        "lead-agent-staging-vpc",
        `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
      ].includes(network[0].network) &&
      [
        "lead-agent-staging-cloud-run",
        `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
      ].includes(network[0].subnetwork),
    "DIAGNOSTIC_VPC_MISMATCH",
  );
};

const safeIdentifier = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const safeTimestamp = (value) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const collectSelectionLogs = (entries) => {
  requireSafe(Array.isArray(entries) && entries.length <= 10, "LOG_SAFE_METADATA_INVALID");
  const wanted = [
    "runtime_read_only_tenant_guard",
    "force_rls_not_owner_guard",
    "exact_active_widget_origin",
    "fresh_unbound_widget_session",
  ];
  const rows = entries
    .map((entry) => entry?.jsonPayload)
    .filter((row) => row?.operation === selectionOperation);
  const blocked = rows.find((row) => row.outcome !== "PASS");
  if (blocked !== undefined)
    throw Object.assign(new Error(), {
      code: selectionFailureCodes.has(blocked.code) ? blocked.code : "LOG_ASSERTION_NOT_PASS",
      ...sanitizeSelectionFailure(blocked, blocked.stage ?? blocked.assertion),
    });
  requireSafe(
    rows.length === wanted.length &&
      wanted.every((name) => rows.filter((row) => row.assertion === name).length === 1),
    "LOG_ASSERTIONS_NOT_COMPLETE",
  );
  const observed = rows.find((row) => row.assertion === "fresh_unbound_widget_session").observed;
  const names = ["session_id", "channel_connection_id", "allowed_origin_id"];
  requireSafe(
    names.every((name) => safeIdentifier(observed?.[name])),
    "LOG_SAFE_METADATA_INVALID",
  );
  requireSafe(
    observed.count === 1 &&
      observed.status === "active" &&
      observed.version === "2" &&
      observed.contact_unbound === true &&
      observed.conversation_unbound === true &&
      observed.lifetime_valid === true &&
      observed.redemption_evidence === "VERSION_2_REQUIRES_OWNER_FRESH_FRAME_CORROBORATION",
    "LOG_SAFE_METADATA_INVALID",
  );
  const result = Object.fromEntries(names.map((name) => [name, observed[name]]));
  for (const name of ["issued_at", "last_seen_at", "expires_at"])
    requireSafe(safeTimestamp(observed[name]), "LOG_SAFE_METADATA_INVALID");
  requireSafe(
    Date.parse(observed.issued_at) <= Date.parse(observed.last_seen_at) &&
      Date.parse(observed.last_seen_at) < Date.parse(observed.expires_at),
    "LOG_SAFE_METADATA_INVALID",
  );
  return {
    ...result,
    issued_at: observed.issued_at,
    last_seen_at: observed.last_seen_at,
    expires_at: observed.expires_at,
    version: "2",
    status: "active",
    contact_unbound: true,
    conversation_unbound: true,
  };
};

export const parseSelectionArguments = (args) => {
  requireSafe(Array.isArray(args), "SELECTION_SCOPE_INVALID");
  requireSafe(
    args.length === 1 ||
      (args.length === 2 && args[1] === "--preflight-only") ||
      (args.length === 3 && args[1] === "--write-selection"),
    "SELECTION_SCOPE_INVALID",
  );
  requireSafe(typeof args[0] === "string", "SELECTION_SCOPE_INVALID");
  if (args.length === 3)
    requireSafe(
      typeof args[2] === "string" &&
        args[2].length > 0 &&
        args[2].length <= 4096 &&
        !/[\r\n\0]/u.test(args[2]) &&
        !args[2].startsWith("--"),
      "SELECTION_SCOPE_INVALID",
    );
  return {
    origin: args[0],
    selectionFile: args[2],
    ...(args[1] === "--preflight-only" ? { preflightOnly: true } : {}),
  };
};

export const prepareSelectionRecord = (selected, origin, nowMilliseconds = Date.now()) => {
  requireSafe(Number.isFinite(nowMilliseconds), "LOG_SAFE_METADATA_INVALID");
  const collectedAt = new Date(nowMilliseconds).toISOString();
  const scope = parseSelectionScope({
    origin,
    from: new Date(nowMilliseconds - 300000).toISOString(),
    until: collectedAt,
  });
  requireSafe(
    selected?.source === reviewedSelectionJob.source &&
      /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(selected.execution) &&
      /^[0-9a-f]{64}$/u.test(selected.reader_sha256) &&
      ["session_id", "channel_connection_id", "allowed_origin_id"].every((name) =>
        safeIdentifier(selected[name]),
      ) &&
      ["issued_at", "last_seen_at", "expires_at"].every((name) => safeTimestamp(selected[name])) &&
      selected.status === "active" &&
      selected.version === "2" &&
      selected.contact_unbound === true &&
      selected.conversation_unbound === true,
    "LOG_SAFE_METADATA_INVALID",
  );
  const issued = Date.parse(selected.issued_at),
    lastSeen = Date.parse(selected.last_seen_at),
    expires = Date.parse(selected.expires_at),
    idleDeadline = lastSeen + 1800000;
  requireSafe(
    issued <= lastSeen && lastSeen <= nowMilliseconds && lastSeen < expires,
    "LOG_SAFE_METADATA_INVALID",
  );
  requireSafe(
    nowMilliseconds < idleDeadline && nowMilliseconds < expires,
    "SELECTION_SNAPSHOT_EXPIRED",
  );
  return {
    schema: "s22-widget-session-selection.v1",
    organization_id: selectionOrganization,
    origin: scope.origin,
    execution: selected.execution,
    source: selected.source,
    reader_sha256: selected.reader_sha256,
    session_id: selected.session_id,
    channel_connection_id: selected.channel_connection_id,
    allowed_origin_id: selected.allowed_origin_id,
    issued_at: selected.issued_at,
    last_seen_at: selected.last_seen_at,
    expires_at: selected.expires_at,
    idle_deadline_at: new Date(idleDeadline).toISOString(),
    collected_at: collectedAt,
    status: "active",
    version: "2",
    contact_unbound: true,
    conversation_unbound: true,
  };
};

export const writeSelectionFile = async (filename, selected, origin, overrides = {}) => {
  const args = parseSelectionArguments([origin, "--write-selection", filename]);
  const record = prepareSelectionRecord(selected, args.origin, (overrides.now ?? Date.now)());
  let handle, failureCode;
  try {
    handle = await (overrides.openFile ?? open)(args.selectionFile, "wx", 0o600);
    await handle.writeFile(JSON.stringify(record, null, 2) + "\n", { encoding: "utf8" });
  } catch (error) {
    failureCode =
      error?.code === "EEXIST" ? "SELECTION_FILE_EXISTS" : "SELECTION_FILE_WRITE_FAILED";
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        failureCode ??= "SELECTION_FILE_WRITE_FAILED";
      }
    }
  }
  if (failureCode !== undefined) throw Object.assign(new Error(), { code: failureCode });
  return record;
};

export const formatSelectionFailure = (error) => {
  const details = sanitizeSelectionFailure(error, error?.stage);
  return [
    `BLOCKED: ${errorCodes.has(error?.code) ? error.code : "CLOUD_OR_TOOLING_UNAVAILABLE"}`,
    ...(details.stage === undefined ? [] : [`Failure stage: ${details.stage}`]),
    ...(details.sqlstate === undefined ? [] : [`SQLSTATE: ${details.sqlstate}`]),
    ...(details.error_category === undefined ? [] : [`Error category: ${details.error_category}`]),
  ];
};

const cloud = async (args, timeout = 10000) => {
  try {
    const result = await execute("gcloud", args, { encoding: "utf8", timeout, maxBuffer: 262144 });
    return result.stdout;
  } catch {
    throw Object.assign(new Error(), { code: "CLOUD_METADATA_OR_EXECUTION_UNAVAILABLE" });
  }
};
const pause = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
export const runSelection = async (origin, overrides = {}) => {
  const pin = reviewedSelectionJob,
    runCloud = overrides.cloud ?? cloud,
    runFetch = overrides.fetch ?? fetch,
    now = overrides.now ?? (() => Date.now()),
    wait = overrides.wait ?? pause;
  const until = new Date(now()).toISOString();
  const scope = parseSelectionScope({
    origin,
    from: new Date(Date.parse(until) - 300000).toISOString(),
    until,
  });
  const metadata = JSON.parse(
    await runCloud([
      "run",
      "jobs",
      "describe",
      pin.job,
      `--project=${pin.project}`,
      `--region=${pin.region}`,
      "--format=json",
    ]),
  );
  verifySelectionJob(metadata);
  const token = (await runCloud(["auth", "print-access-token", "--quiet"])).trim();
  requireSafe(token.length > 0 && !/\s/u.test(token), "AUTHENTICATION_UNAVAILABLE");
  // Prove Logging read permission BEFORE creating an execution. No IAM workaround.
  const loggingRead = async (filter, pageSize) => {
    const response = await runFetch("https://logging.googleapis.com/v2/entries:list", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceNames: [`projects/${pin.project}`],
        filter,
        pageSize,
        orderBy: "timestamp asc",
      }),
    });
    requireSafe(response.status !== 401 && response.status !== 403, "LOG_PERMISSION_UNAVAILABLE");
    requireSafe(response.ok, "LOG_READ_UNAVAILABLE");
    return response.json();
  };
  await loggingRead(
    `resource.type="cloud_run_job" AND resource.labels.job_name="${pin.job}" AND timestamp>="${until}" AND jsonPayload.operation="${selectionOperation}"`,
    1,
  );
  if (overrides.preflightOnly === true)
    return {
      preflight_only: true,
      project: pin.project,
      region: pin.region,
      job: pin.job,
      source: pin.source,
      timestamp: pin.timestamp,
      image: pin.image,
      head: pin.head,
      no_execution_triggered: true,
    };
  const reader = await readFile(
    new URL("./s22-widget-session-select-readonly.mjs", import.meta.url),
  );
  const readerPayload = reader.toString("base64");
  requireSafe(readerPayload.length < 32000, "DIAGNOSTIC_PAYLOAD_TOO_LARGE");
  const scopePayload = Buffer.from(
    JSON.stringify({ origin: scope.origin, from: scope.from, until: scope.until }),
  ).toString("base64");
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
        `--update-env-vars=^~^S22_BOOKING_READ_B64=${readerPayload}~S22_WIDGET_SESSION_READ=execute~S22_WIDGET_SESSION_SCOPE_B64=${scopePayload}`,
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
  let terminal = false,
    succeeded = false;
  const deadline = now() + 90000;
  while (now() < deadline) {
    const result = JSON.parse(
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
    const completed = result.status?.conditions?.find(
      (condition) => condition.type === "Completed",
    );
    if (
      ["True", "False", "CONDITION_SUCCEEDED", "CONDITION_FAILED"].includes(
        completed?.status ?? completed?.state,
      )
    ) {
      terminal = true;
      succeeded = ["True", "CONDITION_SUCCEEDED"].includes(completed.status ?? completed.state);
      break;
    }
    await wait(2000);
  }
  requireSafe(terminal, "DIAGNOSTIC_WINDOW_ELAPSED_NO_RERUN");
  await wait(2000);
  const logs = await loggingRead(
    `resource.type="cloud_run_job" AND resource.labels.job_name="${pin.job}" AND labels."run.googleapis.com/execution_name"="${execution}" AND timestamp>="${until}" AND jsonPayload.operation="${selectionOperation}"`,
    10,
  );
  requireSafe(!logs.nextPageToken, "LOG_SAFE_METADATA_INVALID");
  const selected = collectSelectionLogs(logs.entries ?? []);
  requireSafe(succeeded, "DIAGNOSTIC_EXECUTION_FAILED");
  return {
    execution,
    source: pin.source,
    reader_sha256: createHash("sha256").update(reader).digest("hex"),
    ...selected,
  };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let execution;
  try {
    const args = parseSelectionArguments(process.argv.slice(2));
    const selected = await runSelection(args.origin, {
      preflightOnly: args.preflightOnly,
      onExecution: (name) => {
        execution = name;
        console.log(`Read-only execution: ${name}`);
      },
    });
    if (selected.preflight_only === true) {
      console.log(
        "Preflight-only: PASS (reviewed image/provenance, runtime identity/reference, private VPC, explicit zero retries, authenticated log access)",
      );
      console.log(
        "No session selected, diagnostic execution, message, AI call, migration or job configuration change. Prepare the fresh frame only when instructed.",
      );
    } else {
      const record =
        args.selectionFile === undefined
          ? prepareSelectionRecord(selected, args.origin)
          : await writeSelectionFile(args.selectionFile, selected, args.origin);
      console.log("Session selection: PASS (runtime/read-only/tenant/FORCE-RLS guards)");
      console.log(`Widget session: ${selected.session_id}`);
      console.log(`Widget channel: ${selected.channel_connection_id}`);
      console.log(`Allowed origin record: ${selected.allowed_origin_id}`);
      console.log(
        `State: active; version 2; contact/conversation unbound; expires ${selected.expires_at}`,
      );
      console.log(`Idle deadline (UTC): ${record.idle_deadline_at}`);
      if (args.selectionFile !== undefined) console.log(`Selection file: ${args.selectionFile}`);
      console.log(
        "Correlate this version-2 snapshot with your fresh real-frame opening. No message/call was sent.",
      );
      console.log(`Reader SHA256: ${selected.reader_sha256}`);
      console.log("This read does not activate the budget or authorize Send; stop here.");
    }
  } catch (error) {
    for (const line of formatSelectionFailure(error)) console.log(line);
    if (execution !== undefined)
      console.log(`Preserved execution: ${execution}; do not rerun blindly.`);
    process.exitCode = 1;
  }
}
