import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  failureExerciseDeployment,
  failureExerciseBounds,
  validateFailureExercisePreflight,
} from "./s22-failure-preflight.mjs";

const now = "2026-10-22T12:00:00.000Z";
const valid = () => ({
  now_utc: now,
  target: {
    project_id: "lead-agent-stg-739284",
    region: "me-central1",
    sql_instance: "lead-agent-staging-postgres17",
    api_service: "lead-agent-staging-api",
    activation_policy: "ALWAYS",
  },
  deployment: { ...failureExerciseDeployment },
  authority: {
    approval_ref: "S22-OUTAGE-APPROVED-01",
    outage: true,
    session_metadata: true,
    notification: true,
    expires_at: "2026-10-22T12:08:00.000Z",
  },
  primary_operator_id: "operator-primary",
  observed_sql: {
    activation_policy: "ALWAYS",
    pending_operation: false,
    control_permissions_verified: true,
  },
  recovery_operator: {
    operator_id: "operator-recovery",
    control_path: "independent_console",
    ready: true,
    attested_at: "2026-10-22T11:59:00.000Z",
    approval_ref: "S22-OUTAGE-APPROVED-01",
  },
  quiet_window: {
    exclusive_synthetic_window: true,
    no_paid_dispatch_in_flight: true,
    no_eligible_delivery_in_flight: true,
    no_other_exercise: true,
  },
  probe: {
    same_origin_gateway_verified: true,
    fresh_valid_session: true,
    rotation_due: false,
    background_polling_paused: true,
  },
  monitoring: {
    existing_email_channel_enabled: true,
    no_matching_incident_open: true,
    recipient_control_confirmed: true,
  },
});

test("matches the fixed proposal while explicitly withholding live authority", () => {
  const result = validateFailureExercisePreflight(valid());
  assert.equal(result.outcome, "PREFLIGHT_INPUTS_MATCH");
  assert.equal(result.live_authorized, false);
  assert.equal(result.live_state_independently_verified, false);
  assert.equal(result.cloud_requests, 0);
  assert.deepEqual(result.limits, failureExerciseBounds);
});

test("fails closed on foreign project, region, SQL instance or API service", () => {
  for (const [key, value] of [
    ["project_id", "another-project"],
    ["region", "us-central1"],
    ["sql_instance", "production-db"],
    ["api_service", "another-api"],
  ]) {
    const input = valid();
    input.target[key] = value;
    assert.equal(validateFailureExercisePreflight(input).code, "TARGET_MISMATCH");
  }
});

test("requires each separately scoped effect and enough time to initiate recovery", () => {
  for (const effect of ["outage", "session_metadata", "notification"]) {
    const input = valid();
    input.authority[effect] = false;
    assert.equal(validateFailureExercisePreflight(input).code, "AUTHORITY_INCOMPLETE");
  }
  const expired = valid();
  expired.authority.expires_at = "2026-10-22T12:07:59.999Z";
  assert.equal(validateFailureExercisePreflight(expired).code, "AUTHORITY_EXPIRED");
});

test("requires preserved application provenance and current SQL baseline", () => {
  for (const [key, value] of [
    ["app_source_sha", "f".repeat(40)],
    ["api_image_digest", "0".repeat(64)],
    ["web_image_digest", "0".repeat(64)],
    ["worker_image_digest", "0".repeat(64)],
    ["migrator_image_digest", "0".repeat(64)],
    ["migration_head", "unreviewed"],
  ]) {
    const input = valid();
    input.deployment[key] = value;
    assert.equal(validateFailureExercisePreflight(input).code, "DEPLOYMENT_MISMATCH");
  }
  const sql = valid();
  sql.observed_sql.pending_operation = true;
  assert.equal(validateFailureExercisePreflight(sql).code, "SQL_BASELINE_INVALID");
});

test("requires a recent acknowledgement from a different recovery operator", () => {
  for (const update of [
    (input) => (input.recovery_operator.operator_id = input.primary_operator_id),
    (input) => (input.recovery_operator.ready = false),
    (input) => (input.recovery_operator.attested_at = "2026-10-22T11:54:59.999Z"),
    (input) => (input.recovery_operator.approval_ref = "OTHER-APPROVAL"),
  ]) {
    const input = valid();
    update(input);
    assert.equal(validateFailureExercisePreflight(input).code, "RECOVERY_PATH_UNAVAILABLE");
  }
});

test("blocks any missing quiet-window, session, gateway or monitoring condition", () => {
  const cases = [
    ["quiet_window", "exclusive_synthetic_window", "QUIET_WINDOW_UNAVAILABLE"],
    ["quiet_window", "no_eligible_delivery_in_flight", "QUIET_WINDOW_UNAVAILABLE"],
    ["probe", "rotation_due", "PROBE_NOT_READY"],
    ["probe", "background_polling_paused", "PROBE_NOT_READY"],
    ["monitoring", "no_matching_incident_open", "MONITORING_NOT_READY"],
  ];
  for (const [section, key, expected] of cases) {
    const input = valid();
    input[section][key] = section === "probe" && key === "rotation_due";
    assert.equal(validateFailureExercisePreflight(input).code, expected);
  }
});

test("rejects unknown fields so tokens, contacts and customer data cannot enter its receipt", () => {
  const input = valid();
  input.cookie = "synthetic-sensitive-value";
  const result = validateFailureExercisePreflight(input);
  assert.equal(result.code, "PREFLIGHT_INPUT_INVALID");
  assert.ok(!JSON.stringify(result).includes("synthetic-sensitive-value"));
});

test("keeps hard request, transition, recovery and zero-provider limits in one exported contract", () => {
  assert.equal(failureExerciseBounds.stop_transitions, 1);
  assert.equal(failureExerciseBounds.restore_transitions, 1);
  assert.equal(failureExerciseBounds.total_probes, 4 + 24 + 16);
  assert.equal(failureExerciseBounds.sql_operation_reads, 48);
  assert.equal(failureExerciseBounds.ai_attempts + failureExerciseBounds.provider_attempts, 0);
});

test("has no cloud or network adapter and labels all positive results as offline attestations", () => {
  const source = readFileSync(".github/scripts/s22-failure-preflight.mjs", "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|execFile|spawnSync|gcloud|googleapis)\b/u);
  assert.match(source, /live_authorized: false/u);
  assert.match(source, /live_state_independently_verified: false/u);
});
