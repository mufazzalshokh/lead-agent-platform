import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeFailureBrowserProbe,
  normalizeFailureSqlInstance,
  normalizeFailureSqlOperation,
} from "./s22-failure-adapters.mjs";
import { failureExerciseTarget } from "./s22-failure-preflight.mjs";

const instance = () => ({
  name: failureExerciseTarget.sql_instance,
  project: failureExerciseTarget.project_id,
  region: failureExerciseTarget.region,
  state: "RUNNABLE",
  settings: { activationPolicy: "ALWAYS", databaseFlags: [{ name: "private" }] },
  rootPassword: "synthetic-secret",
});

const operation = (values = {}) => ({
  name: "op_01-abc",
  targetId: failureExerciseTarget.sql_instance,
  targetProject: failureExerciseTarget.project_id,
  operationType: "UPDATE",
  status: "PENDING",
  ...values,
});

test("projects only the exact Cloud SQL target and activation policy", () => {
  const result = normalizeFailureSqlInstance(instance());
  assert.deepEqual(result, {
    outcome: "INSTANCE_SNAPSHOT",
    target: {
      project_id: failureExerciseTarget.project_id,
      region: failureExerciseTarget.region,
      instance: failureExerciseTarget.sql_instance,
    },
    activation_policy: "ALWAYS",
  });
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(Object.isFrozen(result.target), true);
});

test("fails closed on foreign SQL project, instance, region or missing policy", () => {
  for (const [key, value] of [
    ["project", "foreign-project"],
    ["name", "production-db"],
    ["region", "us-central1"],
  ]) {
    const raw = instance();
    raw[key] = value;
    assert.equal(normalizeFailureSqlInstance(raw).code, "INSTANCE_TARGET_MISMATCH");
  }
  const missing = instance();
  delete missing.settings.activationPolicy;
  assert.equal(normalizeFailureSqlInstance(missing).code, "INSTANCE_POLICY_MISSING");
  const unknown = instance();
  unknown.settings.activationPolicy = "ON_DEMAND";
  assert.equal(normalizeFailureSqlInstance(unknown).code, "INSTANCE_POLICY_UNSUPPORTED");
});

test("retains the exact asynchronous operation ID and exposes no unrelated fields", () => {
  const result = normalizeFailureSqlOperation({ ...operation(), user: "person@example.test" });
  assert.deepEqual(result, { outcome: "PENDING", operation_id: "op_01-abc" });
  assert.equal(JSON.stringify(result).includes("person@example.test"), false);
});

test("classifies completed operation success or failure without exposing API error text", () => {
  assert.deepEqual(normalizeFailureSqlOperation(operation({ status: "DONE" })), {
    outcome: "SUCCEEDED",
    operation_id: "op_01-abc",
  });
  const failed = normalizeFailureSqlOperation(
    operation({ status: "DONE", error: { errors: [{ message: "synthetic-private-detail" }] } }),
  );
  assert.deepEqual(failed, {
    outcome: "FAILED",
    operation_id: "op_01-abc",
    error_present: true,
  });
  assert.equal(JSON.stringify(failed).includes("synthetic-private-detail"), false);
});

test("blocks foreign, malformed, unsupported and ambiguous SQL operations", () => {
  const cases = [
    [operation({ targetProject: "foreign-project" }), "OPERATION_TARGET_MISMATCH"],
    [operation({ targetId: "other-instance" }), "OPERATION_TARGET_MISMATCH"],
    [operation({ operationType: "BACKUP" }), "OPERATION_TYPE_UNSUPPORTED"],
    [operation({ name: "../other-operation" }), "OPERATION_ID_INVALID"],
    [operation({ status: "UNKNOWN" }), "OPERATION_STATUS_UNSUPPORTED"],
    [operation({ status: "DONE", error: { detail: "unknown" } }), "OPERATION_RESULT_AMBIGUOUS"],
    [operation({ error: { errors: [] } }), "PENDING_OPERATION_HAS_ERROR"],
  ];
  for (const [raw, code] of cases) assert.equal(normalizeFailureSqlOperation(raw).code, code);
});

test("records only browser HTTP status and elapsed time, dropping headers and body", () => {
  const result = normalizeFailureBrowserProbe({
    status: 500,
    elapsed_ms: 42,
    redirected: false,
    headers: { cookie: "synthetic-cookie" },
    body: "synthetic-private-body",
  });
  assert.deepEqual(result, { outcome: "HTTP_RESPONSE", elapsed_ms: 42, status: 500 });
  assert.equal(JSON.stringify(result).includes("synthetic-cookie"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-private-body"), false);
});

test("sanitizes browser transport errors and rejects redirects or malformed status", () => {
  assert.deepEqual(
    normalizeFailureBrowserProbe({
      status: null,
      elapsed_ms: 15_000,
      redirected: false,
      transport_error: "timeout",
      detail: "synthetic-secret",
    }),
    { outcome: "TRANSPORT_FAILURE", elapsed_ms: 15_000, failure: "timeout", status: null },
  );
  assert.equal(
    normalizeFailureBrowserProbe({ status: 302, elapsed_ms: 2, redirected: true }).code,
    "PROBE_REDIRECT",
  );
  assert.equal(
    normalizeFailureBrowserProbe({ status: 0, elapsed_ms: 2, redirected: false }).code,
    "PROBE_STATUS_INVALID",
  );
  assert.equal(
    normalizeFailureBrowserProbe({ status: null, elapsed_ms: 2, redirected: false }).code,
    "PROBE_STATUS_INVALID",
  );
});

test("contains no Cloud SDK, network call or credential handling", () => {
  const source = readFileSync(".github/scripts/s22-failure-adapters.mjs", "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|execFile|spawnSync|gcloud|googleapis|Authorization)\b/iu);
  assert.match(source, /failureExerciseTarget/u);
});
