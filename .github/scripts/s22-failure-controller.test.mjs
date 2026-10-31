import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  advanceFailureExerciseSimulation,
  createFailureExerciseSimulation,
} from "./s22-failure-controller.mjs";
import { failureExerciseBounds } from "./s22-failure-preflight.mjs";

const preflight = Object.freeze({
  outcome: "PREFLIGHT_INPUTS_MATCH",
  live_authorized: false,
  live_state_independently_verified: false,
  cloud_requests: 0,
});

const baseline = () => {
  let result = createFailureExerciseSimulation(preflight, 10_000);
  assert.equal(result.outcome, "BASELINE");
  for (let sequence = 1; sequence <= 4; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "probe_result",
      phase: "baseline",
      sequence,
      status: 200,
      elapsed_ms: (sequence - 1) * 15_000,
    });
  return result;
};

const stopped = () => {
  let result = baseline();
  assert.equal(result.outcome, "AWAITING_STOP");
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "stop_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 45_000,
  });
  assert.equal(result.outcome, "STOPPING");
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "sql_operation_result",
    operation: "stop",
    result: "succeeded",
    instance_state: "stopped",
    elapsed_ms: 45_000,
  });
  assert.equal(result.outcome, "FAULT");
  return result;
};

const restoring = () => {
  let result = stopped();
  for (let sequence = 1; sequence <= 24; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "probe_result",
      phase: "fault",
      sequence,
      status: 500,
      elapsed_ms: 45_000 + (sequence - 1) * 15_000,
    });
  assert.equal(result.outcome, "RESTORE_REQUIRED");
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "restore_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 405_000,
  });
  assert.equal(result.outcome, "RESTORING");
  return result;
};

const restored = () => {
  let result = restoring();
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "sql_operation_result",
    operation: "restore",
    result: "succeeded",
    instance_state: "running",
    elapsed_ms: 405_000,
  });
  assert.equal(result.outcome, "RECOVERING");
  return result;
};

test("requires the offline preflight receipt and never grants live execution", () => {
  for (const input of [
    undefined,
    { ...preflight, live_authorized: true },
    { ...preflight, cloud_requests: 1 },
  ])
    assert.equal(createFailureExerciseSimulation(input, 0).code, "SIMULATION_INPUT_INVALID");
  const result = createFailureExerciseSimulation(preflight, 10_000);
  assert.equal(result.live_actions, 0);
  assert.equal(result.state.mode, "offline_simulation");
  assert.equal(result.state.started_at_monotonic_ms, 10_000);
});

test("requires four spaced healthy probes before it models a single stop request", () => {
  const early = createFailureExerciseSimulation(preflight, 10_000);
  const first = advanceFailureExerciseSimulation(early.state, {
    kind: "probe_result",
    phase: "baseline",
    sequence: 1,
    status: 200,
    elapsed_ms: 0,
  });
  const tooFast = advanceFailureExerciseSimulation(first.state, {
    kind: "probe_result",
    phase: "baseline",
    sequence: 2,
    status: 200,
    elapsed_ms: 1,
  });
  assert.equal(tooFast.code, "EVENT_TOO_EARLY");
  assert.equal(tooFast.state.counts.baseline_probes, 1);

  let result = baseline();
  assert.equal(result.state.counts.baseline_probes, 4);
  assert.equal(result.state.next_action.type, "submit_sql_stop_once");
  assert.equal(result.live_actions, 0);
});

test("aborts before any SQL action when the healthy baseline probe fails", () => {
  const start = createFailureExerciseSimulation(preflight, 0).state;
  const failed = advanceFailureExerciseSimulation(start, {
    kind: "probe_result",
    phase: "baseline",
    sequence: 1,
    status: 401,
    elapsed_ms: 0,
  });
  assert.equal(failed.outcome, "INCIDENT");
  assert.equal(failed.state.next_action.type, "no_sql_action");
  assert.equal(failed.state.counts.stop_transitions, 0);
});

test("does not retry an uncertain stop request and calls for independent operator takeover", () => {
  const start = baseline().state;
  const uncertain = advanceFailureExerciseSimulation(start, {
    kind: "stop_request",
    result: "uncertain",
    operation_id_known: false,
    elapsed_ms: 45_000,
  });
  assert.equal(uncertain.outcome, "INCIDENT");
  assert.equal(uncertain.state.next_action.type, "independent_operator_takeover_no_retry");
  assert.equal(uncertain.state.counts.stop_transitions, 0);
});

test("schedules 24 single-flight 500 probes then delays one restore until the six-minute observation", () => {
  let result = stopped();
  for (let sequence = 1; sequence <= 24; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "probe_result",
      phase: "fault",
      sequence,
      status: 500,
      elapsed_ms: 45_000 + (sequence - 1) * 15_000,
    });
  assert.equal(result.state.counts.fault_probes, 24);
  assert.equal(result.state.next_action.not_before_ms, 405_000);
  assert.equal(result.state.next_action.deadline_ms, 525_000);
  const earlyRestore = advanceFailureExerciseSimulation(result.state, {
    kind: "restore_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 390_000,
  });
  assert.equal(earlyRestore.code, "EVENT_TOO_EARLY");
  assert.equal(result.live_actions, 0);
});

test("routes unexpected fault responses to immediate restoration", () => {
  const start = stopped().state;
  const result = advanceFailureExerciseSimulation(start, {
    kind: "probe_result",
    phase: "fault",
    sequence: 1,
    status: 401,
    elapsed_ms: 45_000,
  });
  assert.equal(result.outcome, "RESTORE_REQUIRED");
  assert.equal(result.state.next_action.type, "restore_sql_once");
  assert.equal(result.state.counts.fault_probes, 1);
});

test("restores after an API response misses its one-slot deadline without sending another probe", () => {
  const start = stopped().state;
  const result = advanceFailureExerciseSimulation(start, {
    kind: "probe_result",
    phase: "fault",
    sequence: 1,
    status: 500,
    elapsed_ms: 60_001,
  });
  assert.equal(result.outcome, "RESTORE_REQUIRED");
  assert.equal(result.state.counts.fault_probes, 1);
  assert.equal(result.state.next_action.type, "restore_sql_once");
});

test("restores once, counts SQL operation reads independently and requires two healthy recovery probes", () => {
  const complete = advanceFailureExerciseSimulation(restored().state, {
    kind: "probe_result",
    phase: "recovery",
    sequence: 1,
    status: 200,
    elapsed_ms: 405_000,
  });
  assert.equal(complete.outcome, "RECOVERING");
  const done = advanceFailureExerciseSimulation(complete.state, {
    kind: "probe_result",
    phase: "recovery",
    sequence: 2,
    status: 200,
    elapsed_ms: 435_000,
  });
  assert.equal(done.outcome, "COMPLETED");
  assert.equal(done.state.counts.stop_transitions, 1);
  assert.equal(done.state.counts.restore_transitions, 1);
  assert.equal(done.state.counts.stop_operation_reads, 1);
  assert.equal(done.state.counts.restore_operation_reads, 1);
  assert.equal(done.state.counts.sql_operation_reads, 2);
  assert.equal(done.state.next_action.type, "collect_read_only_alert_evidence");
  assert.equal(done.live_actions, 0);
});

test("turns unknown operation results into operator takeover without suggesting a retry", () => {
  const result = advanceFailureExerciseSimulation(baseline().state, {
    kind: "stop_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 45_000,
  });
  const uncertain = advanceFailureExerciseSimulation(result.state, {
    kind: "sql_operation_result",
    operation: "stop",
    result: "failed",
    instance_state: "unknown",
    elapsed_ms: 45_000,
  });
  assert.equal(uncertain.outcome, "INCIDENT");
  assert.equal(uncertain.state.next_action.type, "independent_operator_takeover_no_retry");
});

test("bounds stop-operation polling and hands off after eight unresolved reads", () => {
  let result = advanceFailureExerciseSimulation(baseline().state, {
    kind: "stop_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 45_000,
  });
  for (let sequence = 1; sequence <= 8; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "sql_operation_result",
      operation: "stop",
      result: "pending",
      instance_state: "unknown",
      elapsed_ms: 45_000 + (sequence - 1) * 15_000,
    });
  assert.equal(result.outcome, "INCIDENT");
  assert.equal(result.state.counts.stop_operation_reads, 8);
  assert.equal(result.state.next_action.type, "independent_operator_takeover_no_retry");
});

for (const operation of ["stop", "restore"]) {
  const beginOperation = () =>
    operation === "stop"
      ? advanceFailureExerciseSimulation(baseline().state, {
          kind: "stop_request",
          result: "accepted",
          operation_id_known: true,
          elapsed_ms: 45_000,
        })
      : restoring();
  const pending = (result, elapsed) =>
    advanceFailureExerciseSimulation(result.state, {
      kind: "sql_operation_result",
      operation,
      result: "pending",
      instance_state: "unknown",
      elapsed_ms: elapsed,
    });

  test("allows nonzero response latency on subsequent " + operation + " operation reads", () => {
    for (const latency of [1, 7_500, 15_000]) {
      const started = beginOperation();
      const first = pending(started, started.state.elapsed_ms + 1);
      const nextRead = first.state.next_action;
      assert.equal(nextRead.not_before_ms, first.state.elapsed_ms + 15_000);
      assert.equal(nextRead.request_deadline_ms, nextRead.not_before_ms + 15_000);
      const complete = advanceFailureExerciseSimulation(first.state, {
        kind: "sql_operation_result",
        operation,
        result: "succeeded",
        instance_state: operation === "stop" ? "stopped" : "running",
        elapsed_ms: nextRead.not_before_ms + latency,
      });
      assert.equal(complete.outcome, operation === "stop" ? "FAULT" : "RECOVERING");
      assert.equal(complete.state.counts[operation + "_operation_reads"], 2);
      assert.equal(complete.live_actions, 0);
    }
  });

  test(
    "rejects a subsequent " + operation + " operation response after its full read window",
    () => {
      const started = beginOperation();
      const first = pending(started, started.state.elapsed_ms + 1);
      const late = pending(first, first.state.next_action.not_before_ms + 15_001);
      assert.equal(late.outcome, "INCIDENT");
      assert.equal(late.state.counts[operation + "_operation_reads"], 2);
      assert.equal(late.state.next_action.type, "independent_operator_takeover_no_retry");
      assert.equal(late.live_actions, 0);
    },
  );

  test("clips " + operation + " read windows to the absolute phase deadline", () => {
    let current = beginOperation();
    const phaseDeadline = current.state.next_action.deadline_ms;
    const lastPendingAt = phaseDeadline - 20_000;
    while (current.state.elapsed_ms < lastPendingAt) {
      current = pending(
        current,
        Math.min(current.state.next_action.request_deadline_ms, lastPendingAt),
      );
      assert.equal(current.outcome, operation === "stop" ? "STOPPING" : "RESTORING");
    }
    assert.equal(current.state.next_action.not_before_ms, phaseDeadline - 5_000);
    assert.equal(current.state.next_action.request_deadline_ms, phaseDeadline);
    const exhausted = pending(current, phaseDeadline);
    assert.equal(exhausted.outcome, "INCIDENT");
    assert.equal(exhausted.state.next_action.type, "independent_operator_takeover_no_retry");
    assert.equal(exhausted.live_actions, 0);
  });
}

test("hands off without another read when a stop or restore operation read misses its deadline", () => {
  const stop = advanceFailureExerciseSimulation(
    advanceFailureExerciseSimulation(baseline().state, {
      kind: "stop_request",
      result: "accepted",
      operation_id_known: true,
      elapsed_ms: 45_000,
    }).state,
    {
      kind: "sql_operation_result",
      operation: "stop",
      result: "pending",
      instance_state: "unknown",
      elapsed_ms: 60_001,
    },
  );
  assert.equal(stop.outcome, "INCIDENT");
  assert.equal(stop.state.next_action.type, "independent_operator_takeover_no_retry");
  assert.equal(stop.state.counts.stop_operation_reads, 1);

  let restore = stopped();
  for (let sequence = 1; sequence <= 24; sequence += 1)
    restore = advanceFailureExerciseSimulation(restore.state, {
      kind: "probe_result",
      phase: "fault",
      sequence,
      status: 500,
      elapsed_ms: 45_000 + (sequence - 1) * 15_000,
    });
  restore = advanceFailureExerciseSimulation(restore.state, {
    kind: "restore_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 405_000,
  });
  restore = advanceFailureExerciseSimulation(restore.state, {
    kind: "sql_operation_result",
    operation: "restore",
    result: "pending",
    instance_state: "unknown",
    elapsed_ms: 420_001,
  });
  assert.equal(restore.outcome, "INCIDENT");
  assert.equal(restore.state.next_action.type, "independent_operator_takeover_no_retry");
  assert.equal(restore.state.counts.restore_operation_reads, 1);
});

test("stops at the combined 8 stop plus 40 restore operation-read ceiling", () => {
  let result = baseline();
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "stop_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 45_000,
  });
  for (let sequence = 1; sequence <= 8; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "sql_operation_result",
      operation: "stop",
      result: sequence === 8 ? "succeeded" : "pending",
      instance_state: sequence === 8 ? "stopped" : "unknown",
      elapsed_ms: 45_000 + (sequence - 1) * 15_000,
    });
  assert.equal(result.outcome, "FAULT");

  for (let sequence = 1; sequence <= 24; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "probe_result",
      phase: "fault",
      sequence,
      status: 500,
      elapsed_ms: 150_000 + (sequence - 1) * 15_000,
    });
  result = advanceFailureExerciseSimulation(result.state, {
    kind: "restore_request",
    result: "accepted",
    operation_id_known: true,
    elapsed_ms: 510_000,
  });
  for (let sequence = 1; sequence <= 40; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "sql_operation_result",
      operation: "restore",
      result: "pending",
      instance_state: "unknown",
      elapsed_ms: 510_000 + (sequence - 1) * 15_000,
    });

  assert.equal(result.outcome, "INCIDENT");
  assert.equal(result.state.counts.stop_operation_reads, 8);
  assert.equal(result.state.counts.restore_operation_reads, 40);
  assert.equal(result.state.counts.sql_operation_reads, 48);
  assert.equal(result.state.next_action.type, "independent_operator_takeover_no_retry");
});

test("ends with an incident after the fixed recovery-probe budget is exhausted", () => {
  let result = restored();
  for (let sequence = 1; sequence <= 16; sequence += 1)
    result = advanceFailureExerciseSimulation(result.state, {
      kind: "probe_result",
      phase: "recovery",
      sequence,
      status: 500,
      elapsed_ms: 405_000 + (sequence - 1) * 30_000,
    });
  assert.equal(result.outcome, "INCIDENT");
  assert.equal(result.state.counts.recovery_probes, 16);
  assert.equal(result.state.next_action.type, "operator_incident_review");
});

test("rejects extra event fields and keeps all modeled limits at or below the proposal", () => {
  const start = createFailureExerciseSimulation(preflight, 0).state;
  const result = advanceFailureExerciseSimulation(start, {
    kind: "probe_result",
    phase: "baseline",
    sequence: 1,
    status: 200,
    elapsed_ms: 0,
    cookie: "synthetic-sensitive-value",
  });
  assert.equal(result.code, "PROBE_EVENT_INVALID");
  assert.equal(JSON.stringify(result).includes("synthetic-sensitive-value"), false);
  assert.equal(failureExerciseBounds.total_probes, 44);
  assert.equal(failureExerciseBounds.sql_operation_reads, 48);
  assert.equal(result.live_actions, 0);
});

test("contains no network or cloud adapter and only computes next-step suggestions", () => {
  const source = readFileSync(".github/scripts/s22-failure-controller.mjs", "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|execFile|spawnSync|gcloud|googleapis)\b/u);
  assert.match(source, /live_actions: 0/u);
  assert.match(source, /offline_simulation/u);
});
