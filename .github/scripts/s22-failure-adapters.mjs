import { failureExerciseTarget } from "./s22-failure-preflight.mjs";

const frozen = (value) => Object.freeze(value);
const isRecord = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const blocked = (code) => frozen({ outcome: "BLOCKED", code });

const validOperationId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/u.test(value);

export function normalizeFailureSqlInstance(raw) {
  if (!isRecord(raw) || !isRecord(raw.settings)) return blocked("INSTANCE_RESPONSE_INVALID");
  if (
    raw.name !== failureExerciseTarget.sql_instance ||
    raw.project !== failureExerciseTarget.project_id ||
    raw.region !== failureExerciseTarget.region
  )
    return blocked("INSTANCE_TARGET_MISMATCH");
  if (!("activationPolicy" in raw.settings)) return blocked("INSTANCE_POLICY_MISSING");
  if (!("ALWAYS" === raw.settings.activationPolicy || "NEVER" === raw.settings.activationPolicy))
    return blocked("INSTANCE_POLICY_UNSUPPORTED");

  return frozen({
    outcome: "INSTANCE_SNAPSHOT",
    target: frozen({
      project_id: failureExerciseTarget.project_id,
      region: failureExerciseTarget.region,
      instance: failureExerciseTarget.sql_instance,
    }),
    activation_policy: raw.settings.activationPolicy,
  });
}

export function normalizeFailureSqlOperation(raw) {
  if (!isRecord(raw)) return blocked("OPERATION_RESPONSE_INVALID");
  if (
    raw.targetProject !== failureExerciseTarget.project_id ||
    raw.targetId !== failureExerciseTarget.sql_instance
  )
    return blocked("OPERATION_TARGET_MISMATCH");
  if (raw.operationType !== "UPDATE") return blocked("OPERATION_TYPE_UNSUPPORTED");
  if (!validOperationId(raw.name)) return blocked("OPERATION_ID_INVALID");
  if (!(raw.status === "PENDING" || raw.status === "DONE"))
    return blocked("OPERATION_STATUS_UNSUPPORTED");

  if (raw.status === "PENDING") {
    if (raw.error !== undefined && raw.error !== null)
      return blocked("PENDING_OPERATION_HAS_ERROR");
    return frozen({ outcome: "PENDING", operation_id: raw.name });
  }

  if (raw.error === undefined || raw.error === null)
    return frozen({ outcome: "SUCCEEDED", operation_id: raw.name });
  if (isRecord(raw.error) && Array.isArray(raw.error.errors) && raw.error.errors.length > 0)
    return frozen({ outcome: "FAILED", operation_id: raw.name, error_present: true });
  return blocked("OPERATION_RESULT_AMBIGUOUS");
}

export function normalizeFailureBrowserProbe(raw) {
  if (!isRecord(raw) || !Number.isSafeInteger(raw.elapsed_ms) || raw.elapsed_ms < 0)
    return blocked("PROBE_RESULT_INVALID");
  if (raw.redirected === true) return blocked("PROBE_REDIRECT");
  if (raw.redirected !== false) return blocked("PROBE_REDIRECT_STATE_UNKNOWN");

  if (raw.transport_error !== undefined && raw.transport_error !== null) {
    if (raw.status !== null) return blocked("PROBE_RESULT_AMBIGUOUS");
    if (raw.transport_error === "opaque_redirect") return blocked("PROBE_REDIRECT");
    if (!["timeout", "network_error", "aborted"].includes(raw.transport_error))
      return blocked("PROBE_TRANSPORT_ERROR_UNSUPPORTED");
    return frozen({
      outcome: "TRANSPORT_FAILURE",
      elapsed_ms: raw.elapsed_ms,
      failure: raw.transport_error,
      status: null,
    });
  }

  if (!Number.isInteger(raw.status) || raw.status < 100 || raw.status > 599)
    return blocked("PROBE_STATUS_INVALID");
  return frozen({ outcome: "HTTP_RESPONSE", elapsed_ms: raw.elapsed_ms, status: raw.status });
}
