import { createHash } from "node:crypto";

import {
  failureExerciseBounds,
  failureExerciseDeployment,
  failureExerciseTarget,
} from "./s22-failure-preflight.mjs";

export const soloRecoveryJob = Object.freeze({
  name: "lead-agent-staging-recovery-watchdog",
  identity: "lead-agent-staging-recovery@lead-agent-stg-739284.iam.gserviceaccount.com",
  task_count: 1,
  parallelism: 1,
  max_retries: 0,
  timeout_seconds: 1200,
  cpu: 1,
  memory_mib: 512,
});

export const soloRecoveryLiveGates = Object.freeze([
  "WRITER_ORIGIN_NOT_VERIFIED",
  "LATE_STOP_FENCING_NOT_ESTABLISHED",
  "DEPLOYMENT_IAM_AND_CANARY_NOT_VERIFIED",
]);

export const hasExactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");

const same = (value, expected) =>
  hasExactKeys(value, Object.keys(expected)) &&
  Object.keys(expected).every((key) => value[key] === expected[key]);
const digest = (value, length) =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value);
const utc = (value) =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const opaqueId = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);

export const offlineReceipt = (outcome, values = {}) =>
  Object.freeze({
    ...values,
    outcome,
    mode: "offline_simulation",
    live_authorized: false,
    live_actions: 0,
    cloud_requests: 0,
    unresolved_live_gates: soloRecoveryLiveGates,
  });

// Caller-supplied envelope assertions are fixtures, never proof of live authority.
export function validateSoloRecoveryEnvelope(input, nowUtc) {
  const deny = (code) => offlineReceipt("BLOCKED", { code });
  if (
    !hasExactKeys(input, [
      "exercise_id",
      "generation",
      "source_sha",
      "image_digest",
      "target",
      "deployment",
      "job",
      "authority",
      "grant_expires_at",
      "token_expires_at",
    ]) ||
    !opaqueId(input.exercise_id) ||
    typeof input.generation !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(input.generation) ||
    !digest(input.source_sha, 40) ||
    !digest(input.image_digest, 64) ||
    !utc(nowUtc)
  )
    return deny("ENVELOPE_INVALID");
  if (!same(input.target, failureExerciseTarget)) return deny("TARGET_MISMATCH");
  if (!same(input.deployment, failureExerciseDeployment)) return deny("DEPLOYMENT_MISMATCH");
  if (!same(input.job, soloRecoveryJob)) return deny("JOB_CONFIG_MISMATCH");
  if (
    !hasExactKeys(input.authority, ["approval_ref", "not_before", "expires_at", "effects"]) ||
    !same(input.authority.effects, { outage: true, session_metadata: true, notification: true }) ||
    !opaqueId(input.authority.approval_ref) ||
    !utc(input.authority.not_before) ||
    !utc(input.authority.expires_at) ||
    !utc(input.grant_expires_at) ||
    !utc(input.token_expires_at)
  )
    return deny("AUTHORITY_INVALID");
  if (
    Date.parse(input.authority.not_before) > Date.parse(nowUtc) ||
    [input.authority.expires_at, input.grant_expires_at, input.token_expires_at].some(
      (expiry) => Date.parse(expiry) < Date.parse(nowUtc) + soloRecoveryJob.timeout_seconds * 1000,
    )
  )
    return deny("AUTHORITY_WINDOW_INSUFFICIENT");
  // Fixed key order makes fixture hashes independent of incoming property order.
  const manifest = Object.freeze({
    exercise_id: input.exercise_id,
    generation: input.generation,
    source_sha: input.source_sha,
    image_digest: input.image_digest,
    target: failureExerciseTarget,
    deployment: failureExerciseDeployment,
    job: soloRecoveryJob,
    authority: Object.freeze({
      approval_ref: input.authority.approval_ref,
      not_before: input.authority.not_before,
      expires_at: input.authority.expires_at,
      effects: Object.freeze({ outage: true, session_metadata: true, notification: true }),
    }),
    grant_expires_at: input.grant_expires_at,
    token_expires_at: input.token_expires_at,
  });
  return offlineReceipt("ENVELOPE_MATCH", {
    manifest,
    manifest_hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  });
}

// This ledger constructs descriptions only. It never sends a request. Attempts are
// charged at issue, including a subsequent failure, timeout or lost response.
const requestLimits = Object.freeze({
  launch: ["primary", 1],
  execution_get: ["primary", 40],
  stop: ["primary", failureExerciseBounds.stop_transitions],
  restore: ["watchdog", failureExerciseBounds.restore_transitions],
  stop_get: ["watchdog", failureExerciseBounds.stop_operation_reads],
  restore_get: ["watchdog", failureExerciseBounds.restore_operation_reads],
  baseline_instance: ["primary", 1],
  diagnostic_instance: ["watchdog", 4],
  recovery_instance: ["watchdog", 3],
  operation_list: ["watchdog", 4],
  primary_record_get: ["primary", 64],
  watchdog_record_get: ["watchdog", 64],
  record_create: ["either", 16],
  heartbeat_create: ["primary", 32],
  metadata_get: ["watchdog", 2],
});

export function createSoloRequestLedger(envelope, nowUtc) {
  const validated = validateSoloRecoveryEnvelope(envelope, nowUtc);
  if (validated.outcome !== "ENVELOPE_MATCH") return validated;
  const { manifest, manifest_hash: manifestHash } = validated;
  const counts = Object.fromEntries(Object.keys(requestLimits).map((key) => [key, 0]));
  const snapshot = () => Object.freeze({ ...counts });
  const issue = (actor, kind, reference = "control", record = null) => {
    const writer = ["armed", "restore-claim"].includes(reference)
      ? "watchdog"
      : ["stop-claim", "abort"].includes(reference) || /^heartbeat-[0-9]+$/u.test(reference)
        ? "primary"
        : actor;
    const limit = Object.hasOwn(requestLimits, kind) ? requestLimits[kind] : null;
    if (
      !limit ||
      !["primary", "watchdog"].includes(actor) ||
      (limit[0] !== "either" && limit[0] !== actor) ||
      !opaqueId(reference)
    )
      return offlineReceipt("BLOCKED", { code: "REQUEST_SCOPE_INVALID" });
    if (kind.endsWith("create") && writer !== actor)
      return offlineReceipt("BLOCKED", { code: "RECORD_WRITER_MISMATCH" });
    if (
      kind === "record_create" &&
      ["armed", "restore-claim"].includes(reference) &&
      record === null
    )
      return offlineReceipt("BLOCKED", { code: "RECORD_INVALID" });
    if (
      record !== null &&
      (kind !== "record_create" ||
        !hasExactKeys(record, [
          "exercise_id",
          "generation",
          "manifest_hash",
          "execution",
          "actor",
          ...(reference === "armed" ? ["armed_at_ms"] : []),
        ]) ||
        record.exercise_id !== manifest.exercise_id ||
        record.generation !== manifest.generation ||
        record.manifest_hash !== manifestHash ||
        record.actor !== actor ||
        !opaqueId(record.execution) ||
        (reference === "armed" &&
          (!Number.isSafeInteger(record.armed_at_ms) || record.armed_at_ms < 0)))
    )
      return offlineReceipt("BLOCKED", { code: "RECORD_INVALID" });
    if (counts[kind] >= limit[1])
      return offlineReceipt("BLOCKED", { code: "REQUEST_BUDGET_EXHAUSTED" });
    counts[kind] += 1;
    const instance = `projects/${failureExerciseTarget.project_id}/instances/${failureExerciseTarget.sql_instance}`;
    let api = "sqladmin";
    let method = "GET";
    let path = instance;
    let body = null;
    if (kind === "stop" || kind === "restore") {
      method = "PATCH";
      body = Object.freeze({
        settings: Object.freeze({ activationPolicy: kind === "restore" ? "ALWAYS" : "NEVER" }),
      });
    } else if (kind === "stop_get" || kind === "restore_get") {
      path = `projects/${failureExerciseTarget.project_id}/operations/${reference}`;
    } else if (kind === "operation_list") {
      path = `projects/${failureExerciseTarget.project_id}/operations?instance=${failureExerciseTarget.sql_instance}&maxResults=16`;
    } else if (kind === "launch" || kind === "execution_get") {
      api = "run";
      path = `projects/${failureExerciseTarget.project_id}/locations/${failureExerciseTarget.region}/jobs/${soloRecoveryJob.name}`;
      if (kind === "launch") {
        method = "POST";
        path += ":run";
        body = Object.freeze({});
      } else path += `/executions/${reference}`;
    } else if (kind === "metadata_get") {
      api = "runtime_metadata";
      path = "instance/service-accounts/default/token";
    } else if (kind.includes("record") || kind === "heartbeat_create") {
      api = "storage";
      path = `lead-agent-stg-739284-s22-recovery/${manifest.exercise_id}/${writer}/${reference}`;
      if (kind.endsWith("create")) {
        method = "CREATE";
        body = Object.freeze(
          record
            ? { ...record }
            : {
                exercise_id: manifest.exercise_id,
                generation: manifest.generation,
                manifest_hash: manifestHash,
                actor,
                reference,
              },
        );
      }
    }
    return offlineReceipt("REQUEST_DESCRIPTOR", {
      request: Object.freeze({
        api,
        method,
        path,
        body,
        ...(method === "CREATE" ? { ifGenerationMatch: 0 } : {}),
        deadline_ms: 15_000,
        retries: 0,
        redirects: "error",
      }),
    });
  };
  return Object.freeze({ issue, snapshot, manifest, manifest_hash: manifestHash });
}
