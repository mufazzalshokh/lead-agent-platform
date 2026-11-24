import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { failureExerciseDeployment, failureExerciseTarget } from "./s22-failure-preflight.mjs";
import {
  createSoloRequestLedger,
  soloRecoveryJob,
  validateSoloRecoveryEnvelope,
} from "./s22-solo-recovery-contract.mjs";
import { createSoloRecoverySimulation } from "./s22-solo-recovery-protocol.mjs";

const now = "2026-10-29T12:00:00.000Z";
const fixture = () => ({
  exercise_id: "offline-fixture-01",
  generation: "123",
  source_sha: "a".repeat(40),
  image_digest: "b".repeat(64),
  target: { ...failureExerciseTarget },
  deployment: { ...failureExerciseDeployment },
  job: { ...soloRecoveryJob },
  authority: {
    approval_ref: "offline-only-not-live-approval",
    not_before: now,
    expires_at: "2026-10-29T13:00:00.000Z",
    effects: { outage: true, session_metadata: true, notification: true },
  },
  grant_expires_at: "2026-10-29T13:00:00.000Z",
  token_expires_at: "2026-10-29T13:00:00.000Z",
});
const harness = (envelope = fixture()) => {
  let time = 10_000;
  const simulation = createSoloRecoverySimulation(envelope, now, () => time);
  return {
    ...simulation,
    at: (elapsed) => {
      time = elapsed + 10_000;
    },
  };
};
const operation = (id, status = "DONE") => ({
  name: id,
  status,
  operationType: "UPDATE",
  targetProject: failureExerciseTarget.project_id,
  targetId: failureExerciseTarget.sql_instance,
});
const baseline = (h) => {
  h.step({
    kind: "baseline",
    healthy_probes: 4,
    activation_policy: "ALWAYS",
    pending_operations: 0,
  });
  return h.step({ kind: "stop_claim_result", result: "created" });
};
const claim = (h) => {
  baseline(h);
  h.step({ kind: "launch_result", execution: "execution-01" });
  return h.step({ kind: "claim_result", result: "created" });
};
const arm = (h) => {
  claim(h);
  h.step({
    kind: "arm",
    execution: "execution-01",
    job: { ...soloRecoveryJob },
    source_sha: fixture().source_sha,
    image_digest: fixture().image_digest,
    running: true,
  });
  return h.step({ kind: "armed_written" }).record;
};
const stop = (h) => {
  const record = arm(h);
  h.step({ kind: "verify_armed", record, execution: "execution-01", running: true });
  return h.step({ kind: "stop" });
};
const fault = (h) => {
  stop(h);
  h.step({ kind: "patch_result", operation_id: "stop-01" });
  h.step({ kind: "poll" });
  return h.step({ kind: "operation_result", operation: operation("stop-01") });
};
const checkedRecovery = (h) => {
  h.step({
    kind: "instance_result",
    instance: {
      name: failureExerciseTarget.sql_instance,
      project: failureExerciseTarget.project_id,
      region: failureExerciseTarget.region,
      settings: { activationPolicy: "NEVER" },
    },
  });
  return h.step({ kind: "operations_result", operations: [], next_page_token: null });
};

test("validates an exact immutable authority envelope without granting live eligibility", () => {
  const input = fixture();
  const result = validateSoloRecoveryEnvelope(input, now);
  assert.equal(result.outcome, "ENVELOPE_MATCH");
  assert.equal(result.live_authorized, false);
  assert.equal(result.cloud_requests, 0);
  assert.equal(result.unresolved_live_gates.length, 3);
  input.authority.approval_ref = "changed";
  assert.equal(result.manifest.authority.approval_ref, "offline-only-not-live-approval");
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());
  assert.equal(validateSoloRecoveryEnvelope(reordered, now).manifest_hash, result.manifest_hash);
});

test("rejects foreign target, job overrides, identity, app drift and extra sensitive fields", () => {
  for (const mutate of [
    (f) => {
      f.target.project_id = "foreign";
    },
    (f) => {
      f.target.region = "foreign";
    },
    (f) => {
      f.target.sql_instance = "foreign";
    },
    (f) => {
      f.job.identity = "owner";
    },
    (f) => {
      f.job.max_retries = 1;
    },
    (f) => {
      f.job.overrides = {};
    },
    (f) => {
      f.deployment.app_source_sha = "c".repeat(40);
    },
    (f) => {
      f.token = "sensitive-fixture";
    },
  ]) {
    const input = fixture();
    mutate(input);
    const receipt = validateSoloRecoveryEnvelope(input, now);
    assert.equal(receipt.outcome, "BLOCKED");
    assert.ok(!JSON.stringify(receipt).includes("sensitive-fixture"));
  }
});

test("requires canonical UTC and enough token, grant and authority lifetime", () => {
  for (const key of ["grant_expires_at", "token_expires_at", "authority"]) {
    const input = fixture();
    if (key === "authority") input.authority.expires_at = "2026-10-29T12:19:59.999Z";
    else input[key] = "2026-10-29T12:19:59.999Z";
    assert.equal(validateSoloRecoveryEnvelope(input, now).code, "AUTHORITY_WINDOW_INSUFFICIENT");
  }
  const input = fixture();
  input.authority.not_before = "2026-10-29T12:00:00+00:00";
  assert.equal(validateSoloRecoveryEnvelope(input, now).code, "AUTHORITY_INVALID");
});

test("requires every scoped effect even in a non-authorizing fixture envelope", () => {
  for (const effect of ["outage", "session_metadata", "notification"]) {
    const input = fixture();
    input.authority.effects[effect] = false;
    assert.equal(validateSoloRecoveryEnvelope(input, now).code, "AUTHORITY_INVALID");
  }
});

test("constructs pinned one-issuer mutations and immutable bounded records", () => {
  const ledger = createSoloRequestLedger(fixture(), now);
  assert.equal(ledger.issue("primary", "restore").code, "REQUEST_SCOPE_INVALID");
  assert.equal(ledger.issue("watchdog", "stop").code, "REQUEST_SCOPE_INVALID");
  const restore = ledger.issue("watchdog", "restore").request;
  assert.deepEqual(restore.body, { settings: { activationPolicy: "ALWAYS" } });
  assert.equal(restore.retries, 0);
  assert.equal(restore.redirects, "error");
  assert.equal(restore.deadline_ms, 15_000);
  assert.equal(ledger.issue("watchdog", "restore").code, "REQUEST_BUDGET_EXHAUSTED");
  const record = ledger.issue("watchdog", "record_create", "restore-claim", {
    exercise_id: ledger.manifest.exercise_id,
    generation: ledger.manifest.generation,
    manifest_hash: ledger.manifest_hash,
    execution: "execution-01",
    actor: "watchdog",
  }).request;
  assert.equal(record.ifGenerationMatch, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(record.body)) < 4096);
  assert.equal(ledger.issue("watchdog", "record_create", "../../secret").outcome, "BLOCKED");
  assert.equal(ledger.issue("primary", "launch").request.body.overrides, undefined);
  assert.equal(ledger.issue("primary", "launch").code, "REQUEST_BUDGET_EXHAUSTED");
  assert.equal(ledger.issue("primary", "record_create", "armed").code, "RECORD_WRITER_MISMATCH");
  assert.equal(ledger.issue("watchdog", "record_create", "armed").code, "RECORD_INVALID");
  assert.match(
    ledger.issue("primary", "primary_record_get", "armed").request.path,
    /\/watchdog\/armed$/u,
  );
  assert.equal(
    ledger.issue("watchdog", "record_create", "armed", { token: "private-fixture" }).code,
    "RECORD_INVALID",
  );
});

test("a primary claim conflict or lost claim response never causes an unguarded replacement", () => {
  for (const result of ["conflict", "ambiguous"]) {
    const h = harness();
    const claimed = h.step({
      kind: "baseline",
      healthy_probes: 4,
      activation_policy: "ALWAYS",
      pending_operations: 0,
    });
    let receipt = h.step({ kind: "stop_claim_result", result });
    if (result === "ambiguous")
      receipt = h.step({ kind: "stop_claim_read", record: claimed.request.body });
    assert.equal(receipt.counts.record_create, 1);
    assert.equal(receipt.counts.launch, result === "conflict" ? 0 : 1);
    assert.equal(receipt.state.stop_claim_retained, true);
  }
});

test("charges every attempted read; diagnostics cannot consume reserved recovery reads", () => {
  const ledger = createSoloRequestLedger(fixture(), now);
  for (const [kind, actor, max] of [
    ["stop_get", "watchdog", 8],
    ["restore_get", "watchdog", 40],
    ["diagnostic_instance", "watchdog", 4],
    ["recovery_instance", "watchdog", 3],
    ["operation_list", "watchdog", 4],
    ["primary_record_get", "primary", 64],
    ["watchdog_record_get", "watchdog", 64],
    ["record_create", "watchdog", 16],
    ["heartbeat_create", "primary", 32],
    ["execution_get", "primary", 40],
    ["metadata_get", "watchdog", 2],
    ["baseline_instance", "primary", 1],
  ]) {
    for (let i = 0; i < max; i++)
      assert.equal(ledger.issue(actor, kind).outcome, "REQUEST_DESCRIPTOR");
    assert.equal(ledger.issue(actor, kind).code, "REQUEST_BUDGET_EXHAUSTED");
    assert.equal(ledger.snapshot()[kind], max);
  }
});

test("refuses a missing baseline or ambiguous launch without relaunching", () => {
  const h = harness();
  assert.equal(
    h.step({ kind: "launch_result", execution: "execution-01" }).state.phase,
    "incident",
  );
  const lost = harness();
  baseline(lost);
  assert.equal(
    lost.step({ kind: "launch_result", execution: null }).state.code,
    "LAUNCH_AMBIGUOUS_NO_RELAUNCH",
  );
  assert.equal(lost.snapshot().counts.launch, 1);
  assert.equal(lost.snapshot().counts.stop, 0);
});

test("reconciles a lost claim response using the exact record, never recreating it", () => {
  const h = harness();
  baseline(h);
  const request = h.step({ kind: "launch_result", execution: "execution-01" });
  h.step({ kind: "claim_result", result: "ambiguous" });
  const reconciled = h.step({
    kind: "claim_read",
    generation: "200",
    record: request.request.body,
  });
  assert.equal(reconciled.state.phase, "claimed");
  assert.equal(reconciled.counts.record_create, 2);
  assert.equal(reconciled.counts.watchdog_record_get, 1);
  assert.equal(reconciled.state.claim_retained, true);
});

test("duplicate claimants and unresolved claim reads cannot become restore issuers", () => {
  for (const result of ["conflict", "ambiguous"]) {
    const h = harness();
    baseline(h);
    h.step({ kind: "launch_result", execution: "duplicate" });
    let receipt = h.step({ kind: "claim_result", result });
    if (result === "ambiguous")
      receipt = h.step({ kind: "claim_read", generation: "201", record: {} });
    assert.equal(receipt.state.phase, "incident");
    assert.equal(receipt.state.claim_retained, true);
    assert.equal(receipt.counts.restore, 0);
  }
});

test("a watchdog crash after claiming retains ownership and requires the emergency path", () => {
  const h = harness();
  claim(h);
  const result = h.step({ kind: "watchdog_lost" });
  assert.equal(result.state.code, "WATCHDOG_LOST_NO_SECOND_ISSUER");
  assert.equal(result.state.claim_retained, true);
  assert.equal(result.counts.restore, 0);
  assert.equal(h.step({ kind: "arm" }).outcome, "BLOCKED");
});

test("rejects wrong execution, source, image, identity and exited arming fixtures", () => {
  for (const change of [
    { execution: "foreign" },
    { image_digest: "c".repeat(64) },
    { source_sha: "c".repeat(40) },
    { job: { ...soloRecoveryJob, identity: "foreign" } },
    { running: false },
  ]) {
    const h = harness();
    claim(h);
    const result = h.step({
      kind: "arm",
      execution: "execution-01",
      source_sha: fixture().source_sha,
      image_digest: fixture().image_digest,
      job: { ...soloRecoveryJob },
      running: true,
      ...change,
    });
    assert.equal(result.state.code, "ARM_EXECUTION_MISMATCH");
    assert.equal(result.counts.stop, 0);
  }
});

test("rejects forged or stale acknowledgements and stop dispatch after 15 seconds", () => {
  for (const mutate of [
    (r) => ({ ...r, execution: "foreign" }),
    (r) => ({ ...r, manifest_hash: "c".repeat(64) }),
    (r) => ({ ...r, generation: "124" }),
    (r) => ({ ...r, actor: "primary" }),
  ]) {
    const h = harness();
    const record = arm(h);
    assert.equal(
      h.step({
        kind: "verify_armed",
        record: mutate(record),
        execution: "execution-01",
        running: true,
      }).state.code,
      "ARM_ACK_INVALID_OR_STALE",
    );
  }
  const stale = harness();
  const record = arm(stale);
  stale.at(60_001);
  assert.equal(
    stale.step({ kind: "verify_armed", record, execution: "execution-01", running: true }).state
      .code,
    "ARM_ACK_INVALID_OR_STALE",
  );
  const late = harness();
  const ack = arm(late);
  late.step({ kind: "verify_armed", record: ack, execution: "execution-01", running: true });
  late.at(15_001);
  assert.equal(late.step({ kind: "stop" }).state.code, "STOP_ADMISSION_CLOSED");
});

for (const trigger of ["abort", "primary_cancelled", "storage_lost", "tick"]) {
  test(`cached recovery proceeds on ${trigger}, independent of further storage writes`, () => {
    const h = harness();
    fault(h);
    h.at(trigger === "tick" ? 30_000 : 1);
    const result = h.step({ kind: trigger });
    assert.equal(result.state.phase, "checking_instance");
    const restored = checkedRecovery(h);
    assert.equal(restored.state.phase, "restore_submitted");
    assert.equal(restored.request.body.settings.activationPolicy, "ALWAYS");
    assert.equal(restored.counts.restore, 1);
    assert.equal(h.step({ kind: "abort" }).counts.restore, 1);
    assert.equal(result.state.claim_retained, true);
  });
}

test("numbered heartbeats cannot extend the conservative arm deadline", () => {
  const h = harness();
  fault(h);
  for (let n = 1; n <= 27; n++) {
    h.at(n * 15_000);
    h.step({ kind: "heartbeat", sequence: n });
    h.step({ kind: "heartbeat_result", result: "created" });
  }
  h.at(420_000);
  const result = h.step({ kind: "abort" });
  const restored = checkedRecovery(h);
  assert.equal(restored.counts.restore, 1);
  assert.equal(h.step({ kind: "tick" }).counts.restore, 1);
  assert.equal(restored.state.restore_at_ms, 420_000);
  assert.equal(result.state.phase, "checking_instance");
});

test("failed, ambiguous or late heartbeat writes count but do not refresh the cached timer", () => {
  for (const result of ["failed", "ambiguous", "late"]) {
    const h = harness();
    fault(h);
    h.at(15_000);
    h.step({ kind: "heartbeat", sequence: 1 });
    h.at(result === "late" ? 30_001 : 15_001);
    const receipt = h.step({
      kind: "heartbeat_result",
      result: result === "late" ? "created" : result,
    });
    assert.equal(receipt.counts.heartbeat_create, 1);
    assert.equal(receipt.state.heartbeat_at_ms, 0);
    assert.equal(receipt.state.phase, "checking_instance");
    assert.equal(checkedRecovery(h).counts.restore, 1);
  }
});

test("a silent heartbeat write timeout independently triggers recovery", () => {
  const h = harness();
  fault(h);
  h.at(15_000);
  h.step({ kind: "heartbeat", sequence: 1 });
  h.at(30_001);
  assert.equal(h.step({ kind: "tick" }).state.phase, "checking_instance");
  assert.equal(checkedRecovery(h).counts.restore, 1);
});

test("recovery rejects foreign or pending operations and pagination without chasing another page", () => {
  for (const response of [
    { operations: [operation("pending", "RUNNING")], next_page_token: null },
    { operations: [{ ...operation("foreign"), targetProject: "foreign" }], next_page_token: null },
    { operations: [], next_page_token: "more" },
  ]) {
    const h = harness();
    fault(h);
    h.step({ kind: "abort" });
    h.step({
      kind: "instance_result",
      instance: {
        name: failureExerciseTarget.sql_instance,
        project: failureExerciseTarget.project_id,
        region: failureExerciseTarget.region,
        settings: { activationPolicy: "NEVER" },
      },
    });
    const receipt = h.step({ kind: "operations_result", ...response });
    assert.equal(receipt.state.code, "RECOVERY_OPERATIONS_UNRESOLVED");
    assert.equal(receipt.counts.operation_list, 1);
    assert.equal(receipt.counts.restore, 0);
  }
});

test("an unexpected ALWAYS snapshot is not treated as late-stop fencing or recovery proof", () => {
  const h = harness();
  fault(h);
  h.step({ kind: "abort" });
  const result = h.step({
    kind: "instance_result",
    instance: {
      name: failureExerciseTarget.sql_instance,
      project: failureExerciseTarget.project_id,
      region: failureExerciseTarget.region,
      settings: { activationPolicy: "ALWAYS" },
    },
  });
  assert.equal(result.state.code, "RECOVERY_INSTANCE_CHANGED_OR_UNKNOWN");
  assert.equal(result.counts.restore, 0);
});

test("unknown or late stop remains an incident, never inferred absent from ALWAYS", () => {
  const h = harness();
  stop(h);
  const result = h.step({ kind: "patch_result", operation_id: null });
  assert.equal(result.state.code, "PATCH_AMBIGUOUS_NO_REPLAY");
  assert.equal(result.counts.stop, 1);
  assert.equal(result.counts.restore, 0);
  assert.equal(result.state.claim_retained, true);
  const noStop = harness();
  arm(noStop);
  noStop.at(30_000);
  assert.equal(noStop.step({ kind: "tick" }).state.code, "STOP_UNRESOLVED_OWNER_RECONCILIATION");
  assert.equal(h.step({ kind: "instance", activation_policy: "ALWAYS" }).outcome, "BLOCKED");
});

test("pending stop blocks a competing restore; foreign operations fail closed", () => {
  const h = harness();
  stop(h);
  h.step({ kind: "patch_result", operation_id: "stop-01" });
  h.step({ kind: "poll" });
  h.at(7_500);
  assert.equal(
    h.step({ kind: "operation_result", operation: operation("stop-01", "RUNNING") }).state
      .stop_done,
    false,
  );
  assert.equal(h.step({ kind: "abort" }).counts.restore, 0);
  h.at(22_500);
  h.step({ kind: "poll" });
  h.at(22_501);
  assert.equal(
    h.step({ kind: "operation_result", operation: operation("foreign") }).state.code,
    "OPERATION_FOREIGN_OR_FAILED",
  );
});

test("accepts nonzero poll latency, but clips reads to absolute phase deadlines", () => {
  const h = harness();
  stop(h);
  h.step({ kind: "patch_result", operation_id: "stop-01" });
  h.step({ kind: "poll" });
  h.at(15_000);
  h.step({ kind: "operation_result", operation: operation("stop-01", "PENDING") });
  h.at(30_000);
  h.step({ kind: "poll" });
  h.at(30_001);
  assert.equal(
    h.step({ kind: "operation_result", operation: operation("stop-01") }).state.phase,
    "checking_instance",
  );
  const expired = harness();
  stop(expired);
  expired.step({ kind: "patch_result", operation_id: "stop-01" });
  expired.at(120_001);
  assert.equal(expired.step({ kind: "tick" }).state.code, "STOP_NOT_TERMINAL_IN_TIME");
});

test("a failed or lost restore response is charged once and never replayed", () => {
  const h = harness();
  fault(h);
  h.step({ kind: "abort" });
  checkedRecovery(h);
  h.at(15_001);
  const result = h.step({ kind: "patch_result", operation_id: "restore-01" });
  assert.equal(result.state.code, "REQUEST_RESULT_AMBIGUOUS_NO_REPLAY");
  assert.equal(result.counts.restore, 1);
  assert.equal(h.step({ kind: "abort" }).counts.restore, 1);
});

test("restore polling preserves positive response windows and the 40-read ceiling", () => {
  const h = harness();
  fault(h);
  h.step({ kind: "abort" });
  checkedRecovery(h);
  h.step({ kind: "patch_result", operation_id: "restore-01" });
  for (let n = 0; n < 40; n++) {
    h.at(n * 15_001);
    const poll = h.step({ kind: "poll" });
    assert.equal(poll.request.deadline_ms, Math.min(15_000, 600_000 - n * 15_001));
    h.at(n * 15_001 + 1);
    const receipt = h.step({
      kind: "operation_result",
      operation: operation("restore-01", "RUNNING"),
    });
    assert.equal(receipt.state.phase, "restoring");
  }
  h.at(600_000);
  const result = h.step({ kind: "poll" });
  assert.equal(result.state.phase, "incident");
  assert.equal(result.counts.restore_get, 40);
  assert.equal(result.counts.restore, 1);
});

test("a near-deadline poll cannot advertise more time than the absolute phase allows", () => {
  const h = harness();
  stop(h);
  h.step({ kind: "patch_result", operation_id: "stop-01" });
  h.at(119_000);
  const result = h.step({ kind: "poll" });
  assert.equal(result.request.deadline_ms, 1_000);
  h.at(120_001);
  assert.equal(
    h.step({ kind: "operation_result", operation: operation("stop-01") }).state.phase,
    "incident",
  );
});

test("restore DONE requires separate SQL/app recovery evidence, never reports acceptance", () => {
  const h = harness();
  fault(h);
  h.step({ kind: "abort" });
  checkedRecovery(h);
  h.step({ kind: "patch_result", operation_id: "restore-01" });
  h.step({ kind: "poll" });
  h.at(1);
  const result = h.step({ kind: "operation_result", operation: operation("restore-01") });
  assert.equal(result.state.phase, "recovery_observation_required");
  assert.equal(result.live_authorized, false);
  assert.equal(result.live_actions, 0);
});

test("expired grants, backward clocks and unknown data yield redacted incidents", () => {
  const h = harness();
  fault(h);
  h.at(3_600_000);
  assert.equal(h.step({ kind: "abort" }).state.code, "AUTHORITY_EXPIRED");
  const backwards = harness();
  claim(backwards);
  backwards.at(-1);
  assert.equal(backwards.step({ kind: "tick" }).state.code, "CLOCK_INVALID");
  const secret = harness();
  arm(secret);
  const result = secret.step({ kind: "tick", token: "sensitive-fixture" });
  assert.equal(result.state.code, "EVENT_INVALID");
  assert.ok(!JSON.stringify(result).includes("sensitive-fixture"));
});

test("protocol and constructors have no live transport, process runner or credential reads", () => {
  for (const file of ["contract", "protocol"]) {
    const source = readFileSync(`.github/scripts/s22-solo-recovery-${file}.mjs`, "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|execFile|spawnSync|gcloud|googleapis|process\.env)\b/u);
  }
});
