import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAttempt, formatAttempt, safeFailures } from "./s22-widget-attempt.mjs";
import { copyAttemptScope, attemptFailureCodes } from "./s22-widget-attempt-readonly.mjs";

// Owner-selected session already received its first reply. No fresh selection,
// browser bearer, Send permission or session renewal is created by this reader.
export const progressScope = copyAttemptScope({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  session: "01a12a04-d2ae-7cba-aded-0c48a410be0c",
  channel: "01a11771-2c02-7240-86f7-19f95690d22e",
  origin: "01a11771-2c02-7765-b999-7dc9895ee49d",
  anchor: "01a11c48-dbc2-76de-a873-f41664da5ccb",
  // Owner screenshot: opened 13:12, absolute expiry 15:12 Asia/Tashkent.
  // Minute-rounded boundary covers the first reply, never an unrestricted scan.
  windowStart: "2026-10-11T08:12:00.000Z",
  windowEnd: "2026-10-11T10:13:00.000Z",
});
// Independently reviewed plan 38128355452, apply 38129053516 and verification
// 38129147318. Never learn expected images/provenance from the resources checked.
export const progressRuntime = Object.freeze({
  source: "68b3011d26afe1bbb8ef0a32c4efd8f66df7c819",
  timestamp: "2026-10-11T09:26:04Z",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:d3fa54d67b455b9287e453c6dd1d111f336d7c2e609aea39857d32bbfaeb50b9",
  image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:95841b30404b3605b3cee9a457bb83b0d29731c5ab3b97aac5dfd78c35c8e260",
});
export const runProgress = (overrides = {}) =>
  runAttempt({
    ...overrides,
    scope: progressScope,
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
    if (process.argv.length !== 2)
      throw Object.assign(new Error(), { code: "ATTEMPT_SCOPE_INVALID" });
    const result = await runProgress({
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
      ...(attemptFailureCodes.has(error?.diagnosticCode)
        ? { diagnostic_code: error.diagnosticCode }
        : {}),
    });
    console.log(`BLOCKED: ${code}`);
    if (execution) console.log(`Preserved execution: ${execution}; do not rerun blindly.`);
    process.exitCode = 1;
  } finally {
    await writeFile("s22-widget-progress.json", JSON.stringify(evidence, null, 2) + "\n");
  }
}
