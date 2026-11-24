import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAttempt,
  formatAttempt,
  safeFailures,
  cloudFailureDetails,
} from "./s22-widget-attempt.mjs";
import {
  copyAttemptScope,
  attemptFailureCodes,
  continuationReadBoundary,
} from "./s22-widget-attempt-readonly.mjs";

// Owner-selected session already received its first reply. No fresh selection,
// browser bearer, Send permission or session renewal is created by this reader.
export const progressScope = copyAttemptScope({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  session: "01a12c02-3e50-7663-99f4-c35024796c23",
  channel: "01a11771-2c02-7240-86f7-19f95690d22e",
  origin: "01a11771-2c02-7765-b999-7dc9895ee49d",
  anchor: "01a11c48-dbc2-76de-a873-f41664da5ccb",
  // Candidate window from this UUIDv7's creation timestamp, not proof of receipt.
  // The persisted issued_at must match this window before child reads proceed.
  windowStart: "2026-10-11T17:28:00.000Z",
  windowEnd: "2026-10-11T19:29:00.000Z",
});
// PREPARED plan 38172305694: not deployment or Send authority. Before apply,
// old runtime provenance must fail closed. Never learn expected pins live.
export const progressRuntime = Object.freeze({
  source: "abc3071fb81777068f5adfb98f6144d9081077eb",
  timestamp: "2026-10-11T20:27:12Z",
  migrationHead: "0032_s22_widget_recovery",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:b6d550af4f2c071f00b7ae8388dddd7d8ef7efc3be8923aebd5c168140f75c5a",
  image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:223f1cb22f12a082c147c001d12690c491ca01cf63aa265afeaaa62bd7b69ce5",
});
export const runProgress = (overrides = {}) =>
  runAttempt({
    ...overrides,
    scope: progressScope,
    reviewedRuntime: progressRuntime,
  });

export const continuationProgressScope = (now = new Date()) => {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw Object.assign(new Error(), { code: "ATTEMPT_SCOPE_INVALID" });
  const end = Math.min(now.getTime(), Date.parse(continuationReadBoundary.recoveryDeadline));
  const start = Math.max(end - 120 * 60000, Date.parse(continuationReadBoundary.issuedWindowEnd));
  return copyAttemptScope({
    ...progressScope,
    continuation: continuationReadBoundary.profile,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
  });
};
export const runContinuationProgress = ({ clock = () => new Date(), ...overrides } = {}) =>
  runAttempt({
    ...overrides,
    scope: continuationProgressScope(clock()),
    reviewedRuntime: progressRuntime,
  });

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let execution;
  const evidence = {
    outcome: "BLOCKED",
    runtime_source: progressRuntime.source,
    session: progressScope.session,
    provider_calls_triggered: 0,
    session_mutations: 0,
    migration_execution: false,
    job_configuration_changed: false,
  };
  try {
    if (
      process.argv.length !== 2 &&
      !(process.argv.length === 3 && process.argv[2] === "--continuation")
    )
      throw Object.assign(new Error(), { code: "ATTEMPT_SCOPE_INVALID" });
    const collect = process.argv[2] === "--continuation" ? runContinuationProgress : runProgress;
    const result = await collect({
      onPreflight: () =>
        console.log(
          "Widget trace preflight: PASS (exact runtime, stable envelope, least-privilege DB reference, private VPC, zero retries, authenticated logging)",
        ),
      onExecution: (name) => {
        execution = name;
        console.log(`Read-only execution: ${name}`);
      },
    });
    Object.assign(evidence, result, { outcome: "PASS", collection_only: true });
    console.log(formatAttempt(result).join("\n"));
  } catch (error) {
    const code = safeFailures.has(error?.code) ? error.code : "WIDGET_TRACE_UNAVAILABLE";
    Object.assign(evidence, {
      code,
      ...(execution ? { execution } : {}),
      ...cloudFailureDetails(error),
      ...(attemptFailureCodes.has(error?.diagnosticCode)
        ? { diagnostic_code: error.diagnosticCode }
        : {}),
    });
    console.log(`BLOCKED: ${code}`);
    if (evidence.read_boundary) console.log(`Read boundary: ${evidence.read_boundary}`);
    if (evidence.failure_category) console.log(`Failure category: ${evidence.failure_category}`);
    if (execution) console.log(`Preserved execution: ${execution}; do not rerun blindly.`);
    process.exitCode = 1;
  } finally {
    await writeFile("s22-widget-progress.json", JSON.stringify(evidence, null, 2) + "\n");
  }
}
