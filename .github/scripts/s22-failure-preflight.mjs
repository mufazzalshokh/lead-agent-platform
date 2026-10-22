import { monitoringProfile } from "./s22-monitoring-plan-check.mjs";

const fixedTarget = Object.freeze({
  project_id: "lead-agent-stg-739284",
  region: "me-central1",
  sql_instance: "lead-agent-staging-postgres17",
  api_service: "lead-agent-staging-api",
  activation_policy: "ALWAYS",
});

export const failureExerciseDeployment = Object.freeze({
  app_source_sha: monitoringProfile.git_commit_sha,
  api_image_digest: monitoringProfile.api_image.split("@sha256:")[1],
  web_image_digest: monitoringProfile.web_image.split("@sha256:")[1],
  worker_image_digest: monitoringProfile.worker_image.split("@sha256:")[1],
  migrator_image_digest: monitoringProfile.migrator_image.split("@sha256:")[1],
  migration_head: monitoringProfile.runtime_migration_head,
});

export const failureExerciseBounds = Object.freeze({
  stop_transitions: 1,
  restore_transitions: 1,
  baseline_probes: 4,
  fault_probes: 24,
  recovery_probes: 16,
  total_probes: 44,
  probe_deadline_seconds: 15,
  stop_deadline_seconds: 120,
  restore_initiation_deadline_seconds: 480,
  recovery_observation_deadline_seconds: 600,
  sql_operation_reads: 48,
  sql_operation_read_deadline_seconds: 15,
  ai_attempts: 0,
  provider_attempts: 0,
});

class PreflightDenial extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const deny = (condition, code) => {
  if (!condition) throw new PreflightDenial(code);
};

const recordWithKeys = (value, keys, code) => {
  deny(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"),
    code,
  );
};

const validTime = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  )
    return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const canonical = new Date(timestamp).toISOString();
  return canonical === value || canonical.replace(/\.000Z$/u, "Z") === value;
};

const opaqueReference = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,63}$/iu.test(value);

const sameRecord = (value, expected, code) => {
  recordWithKeys(value, Object.keys(expected), code);
  deny(
    Object.keys(expected).every((key) => value[key] === expected[key]),
    code,
  );
};

export function validateFailureExercisePreflight(input) {
  try {
    recordWithKeys(
      input,
      [
        "now_utc",
        "target",
        "deployment",
        "authority",
        "primary_operator_id",
        "observed_sql",
        "recovery_operator",
        "quiet_window",
        "probe",
        "monitoring",
      ],
      "PREFLIGHT_INPUT_INVALID",
    );
    deny(validTime(input.now_utc), "PREFLIGHT_TIME_INVALID");
    sameRecord(input.target, fixedTarget, "TARGET_MISMATCH");
    sameRecord(input.deployment, failureExerciseDeployment, "DEPLOYMENT_MISMATCH");

    recordWithKeys(
      input.authority,
      ["approval_ref", "outage", "session_metadata", "notification", "expires_at"],
      "AUTHORITY_INCOMPLETE",
    );
    deny(opaqueReference(input.authority.approval_ref), "AUTHORITY_INCOMPLETE");
    deny(
      input.authority.outage === true &&
        input.authority.session_metadata === true &&
        input.authority.notification === true,
      "AUTHORITY_INCOMPLETE",
    );
    deny(validTime(input.authority.expires_at), "AUTHORITY_EXPIRED");
    deny(
      Date.parse(input.authority.expires_at) >=
        Date.parse(input.now_utc) +
          failureExerciseBounds.restore_initiation_deadline_seconds * 1000,
      "AUTHORITY_EXPIRED",
    );

    deny(opaqueReference(input.primary_operator_id), "OPERATOR_ID_INVALID");
    recordWithKeys(
      input.observed_sql,
      ["activation_policy", "pending_operation", "control_permissions_verified"],
      "SQL_BASELINE_INVALID",
    );
    deny(
      input.observed_sql.activation_policy === fixedTarget.activation_policy &&
        input.observed_sql.pending_operation === false &&
        input.observed_sql.control_permissions_verified === true,
      "SQL_BASELINE_INVALID",
    );

    recordWithKeys(
      input.recovery_operator,
      ["operator_id", "control_path", "ready", "attested_at", "approval_ref"],
      "RECOVERY_PATH_UNAVAILABLE",
    );
    deny(
      opaqueReference(input.recovery_operator.operator_id) &&
        input.recovery_operator.operator_id !== input.primary_operator_id &&
        input.recovery_operator.control_path === "independent_console" &&
        input.recovery_operator.ready === true &&
        input.recovery_operator.approval_ref === input.authority.approval_ref &&
        validTime(input.recovery_operator.attested_at),
      "RECOVERY_PATH_UNAVAILABLE",
    );
    deny(
      Date.parse(input.recovery_operator.attested_at) <= Date.parse(input.now_utc) &&
        Date.parse(input.now_utc) - Date.parse(input.recovery_operator.attested_at) <= 300_000,
      "RECOVERY_PATH_UNAVAILABLE",
    );

    recordWithKeys(
      input.quiet_window,
      [
        "exclusive_synthetic_window",
        "no_paid_dispatch_in_flight",
        "no_eligible_delivery_in_flight",
        "no_other_exercise",
      ],
      "QUIET_WINDOW_UNAVAILABLE",
    );
    deny(
      Object.values(input.quiet_window).every((value) => value === true),
      "QUIET_WINDOW_UNAVAILABLE",
    );

    recordWithKeys(
      input.probe,
      [
        "same_origin_gateway_verified",
        "fresh_valid_session",
        "rotation_due",
        "background_polling_paused",
      ],
      "PROBE_NOT_READY",
    );
    deny(
      input.probe.same_origin_gateway_verified === true &&
        input.probe.fresh_valid_session === true &&
        input.probe.rotation_due === false &&
        input.probe.background_polling_paused === true,
      "PROBE_NOT_READY",
    );

    recordWithKeys(
      input.monitoring,
      [
        "existing_email_channel_enabled",
        "no_matching_incident_open",
        "recipient_control_confirmed",
      ],
      "MONITORING_NOT_READY",
    );
    deny(
      Object.values(input.monitoring).every((value) => value === true),
      "MONITORING_NOT_READY",
    );

    return Object.freeze({
      outcome: "PREFLIGHT_INPUTS_MATCH",
      live_authorized: false,
      live_state_independently_verified: false,
      cloud_requests: 0,
      limits: failureExerciseBounds,
    });
  } catch (error) {
    if (error instanceof PreflightDenial)
      return Object.freeze({ outcome: "BLOCKED", code: error.code, live_authorized: false });
    return Object.freeze({
      outcome: "BLOCKED",
      code: "PREFLIGHT_INPUT_INVALID",
      live_authorized: false,
    });
  }
}
