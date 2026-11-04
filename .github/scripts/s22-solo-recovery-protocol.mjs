import {
  createSoloRequestLedger,
  hasExactKeys,
  offlineReceipt,
  opaqueId,
  soloRecoveryJob,
} from "./s22-solo-recovery-contract.mjs";
import {
  normalizeFailureSqlInstance,
  normalizeFailureSqlOperation,
} from "./s22-failure-adapters.mjs";
import { failureExerciseBounds } from "./s22-failure-preflight.mjs";

const stopWindowMs = failureExerciseBounds.stop_deadline_seconds * 1000;
const restoreWindowMs = failureExerciseBounds.restore_initiation_deadline_seconds * 1000;
const observationWindowMs = failureExerciseBounds.recovery_observation_deadline_seconds * 1000;

// A private-state, synchronous model, NOT an execution adapter. Clock and response
// events are injected by tests; descriptors are never executed. Matching a fixture
// receipt is deliberately not presented as proof of its real-world writer origin.
export function createSoloRecoverySimulation(envelope, nowUtc, clock) {
  const ledger = createSoloRequestLedger(envelope, nowUtc);
  if (!ledger.issue || typeof clock !== "function")
    return offlineReceipt("BLOCKED", { code: "SIMULATION_INPUT_INVALID" });
  const started = clock();
  if (!Number.isSafeInteger(started) || started < 0)
    return offlineReceipt("BLOCKED", { code: "CLOCK_INVALID" });
  const { manifest, manifest_hash: hash } = ledger;
  const end = Math.min(
    ...[manifest.authority.expires_at, manifest.grant_expires_at, manifest.token_expires_at].map(
      (value) => Date.parse(value) - Date.parse(nowUtc),
    ),
  );
  const state = {
    phase: "prepared",
    elapsed_ms: 0,
    execution: null,
    claim_retained: false,
    stop_claim_retained: false,
    armed_at_ms: null,
    verified_at_ms: null,
    heartbeat_sequence: 0,
    heartbeat_at_ms: null,
    stop_id: null,
    stop_at_ms: null,
    stop_done: false,
    restore_id: null,
    restore_at_ms: null,
    next_poll_ms: 0,
    recovery_due: false,
    recovery_checked: false,
    code: null,
  };
  let claim = null;
  let stopClaim = null;
  let armed = null;
  let pending = null;
  let heartbeatPending = null;
  const snapshot = () =>
    offlineReceipt(state.phase.toUpperCase(), {
      state: Object.freeze({ ...state }),
      counts: ledger.snapshot(),
    });
  const incident = (code) => {
    state.phase = "incident";
    state.code = code;
    pending = null;
    return snapshot();
  };
  const request = (actor, kind, reference, nextPhase, record = null) => {
    const deadline = Math.min(
      state.elapsed_ms + 15_000,
      kind === "stop_get" ? state.stop_at_ms + stopWindowMs : Infinity,
      kind === "restore_get" ? state.restore_at_ms + observationWindowMs : Infinity,
    );
    if (deadline <= state.elapsed_ms) return incident("NO_REQUEST_TIME_REMAINS");
    const result = ledger.issue(actor, kind, reference, record);
    if (result.outcome !== "REQUEST_DESCRIPTOR") return incident(result.code);
    pending = {
      kind,
      deadline_ms: deadline,
    };
    if (nextPhase) state.phase = nextPhase;
    return offlineReceipt("REQUEST_DESCRIPTOR", {
      ...snapshot(),
      request: Object.freeze({
        ...result.request,
        deadline_ms: deadline - state.elapsed_ms,
      }),
    });
  };
  const due = () => {
    if (state.armed_at_ms === null || state.restore_at_ms !== null) return;
    if (
      state.elapsed_ms >= state.armed_at_ms + restoreWindowMs - 60_000 ||
      state.elapsed_ms >= state.heartbeat_at_ms + 30_000
    )
      state.recovery_due = true;
  };
  const recover = () => {
    if (!state.recovery_due || state.restore_at_ms !== null) return snapshot();
    // Never infer the absence of a delayed stop from an ALWAYS instance snapshot.
    if (!state.stop_id) return incident("STOP_UNRESOLVED_OWNER_RECONCILIATION");
    if (!state.stop_done) {
      if (state.elapsed_ms >= state.armed_at_ms + restoreWindowMs - 60_000)
        return incident("STOP_PENDING_AT_RECOVERY_BOUND");
      return snapshot();
    }
    if (pending) return snapshot();
    if (
      state.elapsed_ms + (state.recovery_checked ? 15_000 : 45_000) >
      state.armed_at_ms + restoreWindowMs
    )
      return incident("RESTORE_INITIATION_WINDOW_EXPIRED");
    if (!state.recovery_checked)
      return request("watchdog", "recovery_instance", "recovery", "checking_instance");
    state.restore_at_ms = state.elapsed_ms;
    return request("watchdog", "restore", "restore", "restore_submitted");
  };

  const step = (event) => {
    if (["incident", "recovery_observation_required"].includes(state.phase))
      return offlineReceipt("BLOCKED", { code: "SIMULATION_TERMINAL", ...snapshot() });
    const now = clock();
    if (!Number.isSafeInteger(now) || now - started < state.elapsed_ms)
      return incident("CLOCK_INVALID");
    state.elapsed_ms = now - started;
    if (state.elapsed_ms + 15_000 > end) return incident("AUTHORITY_EXPIRED");
    if (state.phase === "stopping" && state.elapsed_ms > state.stop_at_ms + stopWindowMs)
      return incident("STOP_NOT_TERMINAL_IN_TIME");
    if (
      state.restore_at_ms !== null &&
      state.elapsed_ms > state.restore_at_ms + observationWindowMs
    )
      return incident("RECOVERY_OBSERVATION_EXPIRED");
    due();
    let heartbeatExpired = false;
    if (heartbeatPending && state.elapsed_ms > heartbeatPending.deadline_ms) {
      heartbeatPending = null;
      state.recovery_due = true;
      heartbeatExpired = true;
    }
    if (!event || typeof event.kind !== "string") return incident("EVENT_INVALID");
    if (event.kind === "watchdog_lost") return incident("WATCHDOG_LOST_NO_SECOND_ISSUER");
    if (
      event.kind === "abort" ||
      event.kind === "primary_cancelled" ||
      event.kind === "tick" ||
      event.kind === "storage_lost"
    ) {
      if (!hasExactKeys(event, ["kind"])) return incident("EVENT_INVALID");
      if (event.kind !== "tick") state.recovery_due = true;
      if (state.armed_at_ms === null) return incident("ABORT_BEFORE_ARM");
      if (pending && state.elapsed_ms > pending.deadline_ms)
        return incident("REQUEST_RESULT_AMBIGUOUS_NO_REPLAY");
      return recover();
    }
    if (pending && state.elapsed_ms > pending.deadline_ms)
      return incident("REQUEST_RESULT_AMBIGUOUS_NO_REPLAY");

    switch (event.kind) {
      case "baseline":
        if (
          state.phase !== "prepared" ||
          !hasExactKeys(event, [
            "kind",
            "healthy_probes",
            "activation_policy",
            "pending_operations",
          ]) ||
          event.healthy_probes !== failureExerciseBounds.baseline_probes ||
          event.activation_policy !== "ALWAYS" ||
          event.pending_operations !== 0
        )
          return incident("BASELINE_INVALID");
        state.stop_claim_retained = true;
        {
          const result = request("primary", "record_create", "stop-claim", "stop_claim_submitted");
          stopClaim = result.request.body;
          return result;
        }
      case "stop_claim_result":
        if (state.phase !== "stop_claim_submitted" || !hasExactKeys(event, ["kind", "result"]))
          return incident("EVENT_INVALID");
        if (event.result === "ambiguous")
          return request("primary", "primary_record_get", "stop-claim", "stop_claim_reconciling");
        if (event.result !== "created") return incident("STOP_CLAIM_CONFLICT_NO_LAUNCH");
        return request("primary", "launch", "launch", "launch_submitted");
      case "stop_claim_read":
        if (
          state.phase !== "stop_claim_reconciling" ||
          !hasExactKeys(event, ["kind", "record"]) ||
          !hasExactKeys(event.record, Object.keys(stopClaim)) ||
          !Object.keys(stopClaim).every((key) => event.record[key] === stopClaim[key])
        )
          return incident("STOP_CLAIM_UNRESOLVED_NO_RECREATE");
        return request("primary", "launch", "launch", "launch_submitted");
      case "launch_result":
        if (
          state.phase !== "launch_submitted" ||
          !hasExactKeys(event, ["kind", "execution"]) ||
          !opaqueId(event.execution)
        )
          return incident("LAUNCH_AMBIGUOUS_NO_RELAUNCH");
        state.execution = event.execution;
        claim = Object.freeze({
          exercise_id: manifest.exercise_id,
          generation: manifest.generation,
          manifest_hash: hash,
          execution: state.execution,
          actor: "watchdog",
        });
        state.claim_retained = true;
        return request("watchdog", "record_create", "restore-claim", "claim_submitted", claim);
      case "claim_result":
        if (state.phase !== "claim_submitted" || !hasExactKeys(event, ["kind", "result"]))
          return incident("EVENT_INVALID");
        pending = null;
        if (event.result === "ambiguous") {
          state.phase = "claim_reconciling";
          return request("watchdog", "watchdog_record_get", "restore-claim");
        }
        if (event.result !== "created") return incident("CLAIM_CONFLICT_NO_SECOND_ISSUER");
        state.claim_retained = true;
        state.phase = "claimed";
        return snapshot();
      case "claim_read":
        if (
          state.phase !== "claim_reconciling" ||
          !hasExactKeys(event, ["kind", "generation", "record"]) ||
          typeof event.generation !== "string" ||
          !/^[1-9][0-9]*$/u.test(event.generation) ||
          !hasExactKeys(event.record, Object.keys(claim)) ||
          !Object.keys(claim).every((key) => event.record[key] === claim[key])
        )
          return incident("CLAIM_UNRESOLVED_NO_RECREATE");
        pending = null;
        state.claim_retained = true;
        state.phase = "claimed";
        return snapshot();
      case "arm":
        if (
          state.phase !== "claimed" ||
          !hasExactKeys(event, [
            "kind",
            "execution",
            "job",
            "image_digest",
            "source_sha",
            "running",
          ]) ||
          event.execution !== state.execution ||
          event.image_digest !== manifest.image_digest ||
          event.source_sha !== manifest.source_sha ||
          event.running !== true ||
          !hasExactKeys(event.job, Object.keys(soloRecoveryJob)) ||
          !Object.keys(soloRecoveryJob).every((key) => event.job[key] === soloRecoveryJob[key])
        )
          return incident("ARM_EXECUTION_MISMATCH");
        if (state.elapsed_ms + restoreWindowMs + observationWindowMs > end)
          return incident("ARM_AUTHORITY_WINDOW_INSUFFICIENT");
        state.armed_at_ms = state.elapsed_ms;
        state.heartbeat_at_ms = state.elapsed_ms;
        armed = Object.freeze({ ...claim, armed_at_ms: state.elapsed_ms });
        return request("watchdog", "record_create", "armed", "arm_submitted", armed);
      case "armed_written":
        if (state.phase !== "arm_submitted" || !hasExactKeys(event, ["kind"]))
          return incident("EVENT_INVALID");
        pending = null;
        state.phase = "armed";
        return offlineReceipt("ARMED_FIXTURE", { ...snapshot(), record: armed });
      case "verify_armed":
        if (
          state.phase !== "armed" ||
          !hasExactKeys(event, ["kind", "record", "execution", "running"]) ||
          !hasExactKeys(event.record, Object.keys(armed)) ||
          !Object.keys(armed).every((key) => event.record[key] === armed[key]) ||
          event.execution !== state.execution ||
          event.running !== true ||
          state.elapsed_ms - state.armed_at_ms > 60_000
        )
          return incident("ARM_ACK_INVALID_OR_STALE");
        state.verified_at_ms = state.elapsed_ms;
        state.phase = "verified";
        return snapshot();
      case "stop":
        if (
          state.phase !== "verified" ||
          !hasExactKeys(event, ["kind"]) ||
          state.recovery_due ||
          state.elapsed_ms - state.verified_at_ms > 15_000
        )
          return incident("STOP_ADMISSION_CLOSED");
        state.stop_at_ms = state.elapsed_ms;
        return request("primary", "stop", "stop", "stop_submitted");
      case "patch_result": {
        if (
          !["stop_submitted", "restore_submitted"].includes(state.phase) ||
          !hasExactKeys(event, ["kind", "operation_id"]) ||
          !opaqueId(event.operation_id)
        )
          return incident("PATCH_AMBIGUOUS_NO_REPLAY");
        const restoring = state.phase === "restore_submitted";
        state[restoring ? "restore_id" : "stop_id"] = event.operation_id;
        state.phase = restoring ? "restoring" : "stopping";
        state.next_poll_ms = state.elapsed_ms;
        pending = null;
        return recover();
      }
      case "poll": {
        if (
          !["stopping", "restoring"].includes(state.phase) ||
          pending ||
          !hasExactKeys(event, ["kind"]) ||
          state.elapsed_ms < state.next_poll_ms
        )
          return incident("POLL_OUT_OF_ORDER");
        const restoring = state.phase === "restoring";
        return request(
          "watchdog",
          restoring ? "restore_get" : "stop_get",
          restoring ? state.restore_id : state.stop_id,
        );
      }
      case "operation_result": {
        if (
          !pending ||
          !["stop_get", "restore_get"].includes(pending.kind) ||
          !hasExactKeys(event, ["kind", "operation"])
        )
          return incident("OPERATION_OUT_OF_ORDER");
        const restoring = pending.kind === "restore_get";
        const normalized = normalizeFailureSqlOperation(event.operation);
        pending = null;
        if (
          !["PENDING", "SUCCEEDED"].includes(normalized.outcome) ||
          normalized.operation_id !== (restoring ? state.restore_id : state.stop_id)
        )
          return incident("OPERATION_FOREIGN_OR_FAILED");
        if (normalized.outcome === "PENDING") {
          state.next_poll_ms = state.elapsed_ms + 15_000;
          return recover();
        }
        if (restoring) {
          state.phase = "recovery_observation_required";
          return snapshot();
        }
        state.stop_done = true;
        state.phase = "fault";
        return recover();
      }
      case "instance_result": {
        if (
          state.phase !== "checking_instance" ||
          pending?.kind !== "recovery_instance" ||
          !hasExactKeys(event, ["kind", "instance"])
        )
          return incident("INSTANCE_OUT_OF_ORDER");
        const normalized = normalizeFailureSqlInstance(event.instance);
        if (normalized.outcome !== "INSTANCE_SNAPSHOT" || normalized.activation_policy !== "NEVER")
          return incident("RECOVERY_INSTANCE_CHANGED_OR_UNKNOWN");
        return request("watchdog", "operation_list", "recovery", "checking_operations");
      }
      case "operations_result":
        if (
          state.phase !== "checking_operations" ||
          pending?.kind !== "operation_list" ||
          !hasExactKeys(event, ["kind", "operations", "next_page_token"]) ||
          !Array.isArray(event.operations) ||
          event.operations.length > 16 ||
          event.next_page_token !== null ||
          !event.operations.every((op) =>
            ["SUCCEEDED", "FAILED"].includes(normalizeFailureSqlOperation(op).outcome),
          )
        )
          return incident("RECOVERY_OPERATIONS_UNRESOLVED");
        pending = null;
        state.recovery_checked = true;
        return recover();
      case "heartbeat":
        if (
          state.armed_at_ms === null ||
          state.restore_at_ms !== null ||
          heartbeatPending ||
          !hasExactKeys(event, ["kind", "sequence"]) ||
          event.sequence !== state.heartbeat_sequence + 1 ||
          state.elapsed_ms < state.armed_at_ms + event.sequence * 15_000
        )
          return incident("HEARTBEAT_INVALID");
        if (state.recovery_due) return recover();
        state.heartbeat_sequence = event.sequence;
        {
          const result = ledger.issue("primary", "heartbeat_create", `heartbeat-${event.sequence}`);
          if (result.outcome !== "REQUEST_DESCRIPTOR")
            return incident("HEARTBEAT_BUDGET_EXHAUSTED");
          heartbeatPending = { sequence: event.sequence, deadline_ms: state.elapsed_ms + 15_000 };
          return offlineReceipt("REQUEST_DESCRIPTOR", { ...snapshot(), request: result.request });
        }
      case "heartbeat_result":
        if (heartbeatExpired && hasExactKeys(event, ["kind", "result"])) return recover();
        if (
          !heartbeatPending ||
          !hasExactKeys(event, ["kind", "result"]) ||
          !["created", "failed", "ambiguous"].includes(event.result)
        )
          return incident("HEARTBEAT_RESULT_INVALID");
        if (event.result === "created") {
          state.heartbeat_at_ms = state.armed_at_ms + heartbeatPending.sequence * 15_000;
        } else state.recovery_due = true;
        heartbeatPending = null;
        return recover();
      default:
        return incident("EVENT_INVALID");
    }
  };
  return Object.freeze({ step, snapshot });
}
