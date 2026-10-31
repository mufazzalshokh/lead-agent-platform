import { failureExerciseBounds } from "./s22-failure-preflight.mjs";

const frozen = (value) => Object.freeze(value);
const blocked = (code, state) =>
  frozen({
    outcome: "BLOCKED",
    code,
    live_actions: 0,
    ...(state === undefined ? {} : { state }),
  });

const result = (state) => frozen({ outcome: state.phase.toUpperCase(), live_actions: 0, state });

const action = (type, values = {}) => frozen({ type, ...values });

const stateWith = (state, changes) =>
  frozen({
    ...state,
    ...changes,
    counts: frozen({ ...state.counts, ...(changes.counts ?? {}) }),
  });

const eventHasKeys = (event, keys) =>
  event !== null &&
  typeof event === "object" &&
  !Array.isArray(event) &&
  Object.getPrototypeOf(event) === Object.prototype &&
  Object.keys(event).sort().join("\0") === [...keys].sort().join("\0");

const validElapsed = (elapsed, state) =>
  Number.isSafeInteger(elapsed) && elapsed >= state.elapsed_ms;
const validStatus = (status) =>
  status === null || (Number.isInteger(status) && status >= 100 && status <= 599);

const validState = (state) =>
  state !== null &&
  typeof state === "object" &&
  state.mode === "offline_simulation" &&
  Number.isSafeInteger(state.started_at_monotonic_ms) &&
  state.started_at_monotonic_ms >= 0 &&
  Number.isSafeInteger(state.elapsed_ms) &&
  state.elapsed_ms >= 0 &&
  Number.isSafeInteger(state.counts?.baseline_probes) &&
  state.counts.baseline_probes >= 0 &&
  state.counts.baseline_probes <= failureExerciseBounds.baseline_probes &&
  Number.isSafeInteger(state.counts?.fault_probes) &&
  state.counts.fault_probes >= 0 &&
  state.counts.fault_probes <= failureExerciseBounds.fault_probes &&
  Number.isSafeInteger(state.counts?.recovery_probes) &&
  state.counts.recovery_probes >= 0 &&
  state.counts.recovery_probes <= failureExerciseBounds.recovery_probes &&
  Number.isSafeInteger(state.counts?.sql_operation_reads) &&
  state.counts.sql_operation_reads >= 0 &&
  state.counts.sql_operation_reads <= failureExerciseBounds.sql_operation_reads &&
  Number.isSafeInteger(state.counts?.stop_operation_reads) &&
  state.counts.stop_operation_reads >= 0 &&
  state.counts.stop_operation_reads <= failureExerciseBounds.stop_operation_reads &&
  Number.isSafeInteger(state.counts?.restore_operation_reads) &&
  state.counts.restore_operation_reads >= 0 &&
  state.counts.restore_operation_reads <= failureExerciseBounds.restore_operation_reads &&
  state.counts.sql_operation_reads ===
    state.counts.stop_operation_reads + state.counts.restore_operation_reads &&
  [0, 1].includes(state.counts.stop_transitions) &&
  [0, 1].includes(state.counts.restore_transitions) &&
  Number.isSafeInteger(state.recovery_success_streak) &&
  state.recovery_success_streak >= 0 &&
  state.recovery_success_streak <= 2 &&
  state.next_action !== null &&
  typeof state.next_action === "object" &&
  !Array.isArray(state.next_action) &&
  Object.getPrototypeOf(state.next_action) === Object.prototype &&
  [
    "baseline",
    "awaiting_stop",
    "stopping",
    "fault",
    "restore_required",
    "restoring",
    "recovering",
    "completed",
    "incident",
  ].includes(state.phase);

export function createFailureExerciseSimulation(preflight, startAtMonotonicMs) {
  if (
    preflight?.outcome !== "PREFLIGHT_INPUTS_MATCH" ||
    preflight.live_authorized !== false ||
    preflight.live_state_independently_verified !== false ||
    preflight.cloud_requests !== 0 ||
    !Number.isSafeInteger(startAtMonotonicMs) ||
    startAtMonotonicMs < 0
  )
    return blocked("SIMULATION_INPUT_INVALID");

  const state = frozen({
    mode: "offline_simulation",
    phase: "baseline",
    elapsed_ms: 0,
    started_at_monotonic_ms: startAtMonotonicMs,
    stop_requested_at_ms: null,
    sql_stopped_at_ms: null,
    restore_initiated_at_ms: null,
    recovery_success_streak: 0,
    counts: frozen({
      baseline_probes: 0,
      fault_probes: 0,
      recovery_probes: 0,
      stop_transitions: 0,
      restore_transitions: 0,
      sql_operation_reads: 0,
      stop_operation_reads: 0,
      restore_operation_reads: 0,
    }),
    next_action: action("probe", {
      phase: "baseline",
      sequence: 1,
      not_before_ms: 0,
      request_deadline_ms: failureExerciseBounds.probe_deadline_seconds * 1000,
    }),
  });
  return result(state);
}

export function advanceFailureExerciseSimulation(state, event) {
  if (!validState(state) || !event || typeof event !== "object")
    return blocked("SIMULATION_STATE_INVALID");
  if (state.phase === "completed" || state.phase === "incident")
    return blocked("SIMULATION_TERMINAL", state);

  const elapsed = event.elapsed_ms;
  if (!validElapsed(elapsed, state)) return blocked("EVENT_TIME_INVALID", state);
  if (
    Number.isSafeInteger(state.next_action?.not_before_ms) &&
    elapsed < state.next_action.not_before_ms
  )
    return blocked("EVENT_TOO_EARLY", state);

  if (state.phase === "baseline" || state.phase === "fault" || state.phase === "recovering") {
    if (!eventHasKeys(event, ["kind", "phase", "sequence", "status", "elapsed_ms"]))
      return blocked("PROBE_EVENT_INVALID", state);
    const phase = state.phase === "recovering" ? "recovery" : state.phase;
    if (
      state.next_action.type !== "probe" ||
      state.next_action.phase !== phase ||
      !Number.isSafeInteger(state.next_action.not_before_ms) ||
      !Number.isSafeInteger(state.next_action.request_deadline_ms) ||
      event.kind !== "probe_result" ||
      event.phase !== phase ||
      event.sequence !== state.counts[`${phase}_probes`] + 1 ||
      event.sequence > failureExerciseBounds[`${phase}_probes`] ||
      !validStatus(event.status)
    )
      return blocked("PROBE_EVENT_OUT_OF_ORDER", state);
    if (
      phase === "recovery" &&
      Number.isSafeInteger(state.next_action.phase_deadline_ms) &&
      elapsed > state.next_action.phase_deadline_ms
    )
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: { recovery_probes: event.sequence },
          next_action: action("operator_incident_review"),
        }),
      );
    if (elapsed > state.next_action.request_deadline_ms) {
      if (phase === "fault")
        return result(
          stateWith(state, {
            phase: "restore_required",
            elapsed_ms: elapsed,
            counts: { fault_probes: event.sequence },
            next_action: action("restore_sql_once", {
              deadline_ms: state.stop_requested_at_ms + 480_000,
            }),
          }),
        );
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: { [`${phase}_probes`]: event.sequence },
          next_action: action(phase === "baseline" ? "no_sql_action" : "operator_incident_review"),
        }),
      );
    }

    if (phase === "baseline" && event.status !== 200)
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: { baseline_probes: event.sequence },
          next_action: action("no_sql_action"),
        }),
      );
    if (phase === "fault" && event.status !== 500)
      return result(
        stateWith(state, {
          phase: "restore_required",
          elapsed_ms: elapsed,
          counts: { fault_probes: event.sequence },
          next_action: action("restore_sql_once", {
            deadline_ms: state.stop_requested_at_ms + 480_000,
          }),
        }),
      );

    const countKey = `${phase}_probes`;
    const count = event.sequence;
    if (phase === "baseline" && count === failureExerciseBounds.baseline_probes)
      return result(
        stateWith(state, {
          phase: "awaiting_stop",
          elapsed_ms: elapsed,
          counts: { [countKey]: count },
          next_action: action("submit_sql_stop_once"),
        }),
      );

    if (phase === "fault" && count === failureExerciseBounds.fault_probes)
      return result(
        stateWith(state, {
          phase: "restore_required",
          elapsed_ms: elapsed,
          counts: { [countKey]: count },
          next_action: action("restore_sql_once", {
            not_before_ms: Math.max(elapsed, state.sql_stopped_at_ms + 360_000),
            deadline_ms: state.stop_requested_at_ms + 480_000,
          }),
        }),
      );

    if (phase === "recovery") {
      const streak = event.status === 200 ? state.recovery_success_streak + 1 : 0;
      if (streak === 2)
        return result(
          stateWith(state, {
            phase: "completed",
            elapsed_ms: elapsed,
            recovery_success_streak: streak,
            counts: { [countKey]: count },
            next_action: action("collect_read_only_alert_evidence"),
          }),
        );
      if (count === failureExerciseBounds.recovery_probes)
        return result(
          stateWith(state, {
            phase: "incident",
            elapsed_ms: elapsed,
            recovery_success_streak: streak,
            counts: { [countKey]: count },
            next_action: action("operator_incident_review"),
          }),
        );
      return result(
        stateWith(state, {
          elapsed_ms: elapsed,
          recovery_success_streak: streak,
          counts: { [countKey]: count },
          next_action: action("probe", {
            phase,
            sequence: count + 1,
            not_before_ms: state.next_action.not_before_ms + 30_000,
            request_deadline_ms: state.next_action.not_before_ms + 45_000,
            phase_deadline_ms: state.restore_initiated_at_ms + 600_000,
          }),
        }),
      );
    }

    return result(
      stateWith(state, {
        elapsed_ms: elapsed,
        counts: { [countKey]: count },
        next_action: action("probe", {
          phase,
          sequence: count + 1,
          not_before_ms: state.next_action.not_before_ms + 15_000,
          request_deadline_ms: state.next_action.not_before_ms + 30_000,
        }),
      }),
    );
  }

  if (state.phase === "awaiting_stop") {
    if (state.next_action.type !== "submit_sql_stop_once")
      return blocked("STOP_TRANSITION_OUT_OF_ORDER", state);
    if (!eventHasKeys(event, ["kind", "result", "operation_id_known", "elapsed_ms"]))
      return blocked("STOP_EVENT_INVALID", state);
    if (event.kind !== "stop_request" || state.counts.stop_transitions !== 0)
      return blocked("STOP_TRANSITION_OUT_OF_ORDER", state);
    if (event.result !== "accepted" || event.operation_id_known !== true)
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    return result(
      stateWith(state, {
        phase: "stopping",
        elapsed_ms: elapsed,
        stop_requested_at_ms: elapsed,
        counts: { stop_transitions: 1 },
        next_action: action("observe_sql_stop_operation", {
          sequence: 1,
          not_before_ms: elapsed,
          request_deadline_ms:
            elapsed + failureExerciseBounds.sql_operation_read_deadline_seconds * 1000,
          deadline_ms: elapsed + failureExerciseBounds.stop_deadline_seconds * 1000,
        }),
      }),
    );
  }

  if (state.phase === "stopping" || state.phase === "restoring") {
    const stopping = state.phase === "stopping";
    if (
      state.next_action.type !==
      (stopping ? "observe_sql_stop_operation" : "observe_sql_restore_operation")
    )
      return blocked("SQL_OPERATION_EVENT_OUT_OF_ORDER", state);
    if (!eventHasKeys(event, ["kind", "operation", "result", "instance_state", "elapsed_ms"]))
      return blocked("SQL_OPERATION_EVENT_INVALID", state);
    const expectedOperation = stopping ? "stop" : "restore";
    const operationCountKey = stopping ? "stop_operation_reads" : "restore_operation_reads";
    const operationReads = state.counts[operationCountKey] + 1;
    const totalOperationReads = state.counts.sql_operation_reads + 1;
    const operationReadLimit = stopping
      ? failureExerciseBounds.stop_operation_reads
      : failureExerciseBounds.restore_operation_reads;
    const deadline = stopping
      ? state.stop_requested_at_ms + failureExerciseBounds.stop_deadline_seconds * 1000
      : state.restore_initiated_at_ms +
        failureExerciseBounds.recovery_observation_deadline_seconds * 1000;
    if (event.kind !== "sql_operation_result" || event.operation !== expectedOperation)
      return blocked("SQL_OPERATION_EVENT_OUT_OF_ORDER", state);
    if (
      operationReads > operationReadLimit ||
      totalOperationReads > failureExerciseBounds.sql_operation_reads ||
      elapsed > deadline ||
      !Number.isSafeInteger(state.next_action.request_deadline_ms) ||
      elapsed > state.next_action.request_deadline_ms
    )
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: {
            [operationCountKey]: Math.min(operationReads, operationReadLimit),
            sql_operation_reads: Math.min(
              totalOperationReads,
              failureExerciseBounds.sql_operation_reads,
            ),
          },
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    if (
      event.result === "succeeded" &&
      event.instance_state === (stopping ? "stopped" : "running")
    ) {
      if (stopping)
        return result(
          stateWith(state, {
            phase: "fault",
            elapsed_ms: elapsed,
            sql_stopped_at_ms: elapsed,
            counts: {
              [operationCountKey]: operationReads,
              sql_operation_reads: totalOperationReads,
            },
            next_action: action("probe", {
              phase: "fault",
              sequence: 1,
              not_before_ms: elapsed,
              request_deadline_ms: elapsed + failureExerciseBounds.probe_deadline_seconds * 1000,
            }),
          }),
        );
      return result(
        stateWith(state, {
          phase: "recovering",
          elapsed_ms: elapsed,
          counts: {
            [operationCountKey]: operationReads,
            sql_operation_reads: totalOperationReads,
          },
          next_action: action("probe", {
            phase: "recovery",
            sequence: 1,
            not_before_ms: elapsed,
            request_deadline_ms: elapsed + failureExerciseBounds.probe_deadline_seconds * 1000,
            phase_deadline_ms:
              state.restore_initiated_at_ms +
              failureExerciseBounds.recovery_observation_deadline_seconds * 1000,
          }),
        }),
      );
    }
    if (event.result !== "pending" || event.instance_state !== "unknown")
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: {
            [operationCountKey]: operationReads,
            sql_operation_reads: totalOperationReads,
          },
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    const nextReadAtMs = elapsed + 15_000;
    if (
      operationReads === operationReadLimit ||
      totalOperationReads === failureExerciseBounds.sql_operation_reads ||
      nextReadAtMs >= deadline
    )
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          counts: {
            [operationCountKey]: operationReads,
            sql_operation_reads: totalOperationReads,
          },
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    return result(
      stateWith(state, {
        elapsed_ms: elapsed,
        counts: {
          [operationCountKey]: operationReads,
          sql_operation_reads: totalOperationReads,
        },
        next_action: action(
          stopping ? "observe_sql_stop_operation" : "observe_sql_restore_operation",
          {
            sequence: operationReads + 1,
            not_before_ms: nextReadAtMs,
            request_deadline_ms: Math.min(
              nextReadAtMs + failureExerciseBounds.sql_operation_read_deadline_seconds * 1000,
              deadline,
            ),
            deadline_ms: deadline,
          },
        ),
      }),
    );
  }

  if (state.phase === "restore_required") {
    if (state.next_action.type !== "restore_sql_once")
      return blocked("RESTORE_TRANSITION_OUT_OF_ORDER", state);
    if (!eventHasKeys(event, ["kind", "result", "operation_id_known", "elapsed_ms"]))
      return blocked("RESTORE_EVENT_INVALID", state);
    if (event.kind !== "restore_request" || state.counts.restore_transitions !== 0)
      return blocked("RESTORE_TRANSITION_OUT_OF_ORDER", state);
    if (
      Number.isSafeInteger(state.next_action.deadline_ms) &&
      elapsed > state.next_action.deadline_ms
    )
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    if (event.result !== "accepted" || event.operation_id_known !== true)
      return result(
        stateWith(state, {
          phase: "incident",
          elapsed_ms: elapsed,
          next_action: action("independent_operator_takeover_no_retry"),
        }),
      );
    return result(
      stateWith(state, {
        phase: "restoring",
        elapsed_ms: elapsed,
        restore_initiated_at_ms: elapsed,
        counts: { restore_transitions: 1 },
        next_action: action("observe_sql_restore_operation", {
          sequence: state.counts.restore_operation_reads + 1,
          not_before_ms: elapsed,
          request_deadline_ms:
            elapsed + failureExerciseBounds.sql_operation_read_deadline_seconds * 1000,
          deadline_ms: elapsed + failureExerciseBounds.recovery_observation_deadline_seconds * 1000,
        }),
      }),
    );
  }

  return blocked("SIMULATION_TRANSITION_UNAVAILABLE", state);
}
