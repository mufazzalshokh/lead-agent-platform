// Prepared replacement binding only. Run after exact-plan-approved apply, never as Send approval.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseReadinessScope } from "./s22-widget-readiness-readonly.mjs";
import { formatReadiness, formatReadinessFailure, runReadiness } from "./s22-widget-readiness.mjs";

// Reuse verified image build 37797125277 / manifest SHA256
// 8a3632682b5a4d1982746aee5002ea4d176e4b46fe92172bffae433ed92d7193.
// The timestamp is a prepared expectation, not a claim that replacement apply has occurred.
export const replacementRuntime = Object.freeze({
  source: "1ecd729d856fdeff22a55cc54e1259c7adcf6472",
  timestamp: "2026-10-08T16:48:02Z",
  worker:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:9bb77154a6057981b3fed82164defa222ff6b893a5fbe5563a4e06f9140ab381",
  image:
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:f4c6e5bdbf0e39a0fe6042e090b93ebaa21209a628bdc5cb889a49f8a03beace",
});

export function prepareReplacementReadiness(args) {
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== "--session")
    throw Object.assign(new Error(), { code: "ENVIRONMENT_INVALID" });
  const scope = parseReadinessScope(args[1]);
  if (
    args[1] === undefined ||
    [
      "01a11b26-c51d-78ba-8e81-62e6e7331ab8",
      "01a11b7d-ddbf-759e-b4e3-1602d9e2238c",
      "01a11c48-dbc2-76de-a873-f41664da5ccb",
    ].includes(scope.session)
  )
    throw Object.assign(new Error(), { code: "EXPIRED_SELECTION_REUSE_FORBIDDEN" });
  return Object.freeze({
    sessionId: scope.session,
    deploymentTimestamp: replacementRuntime.timestamp,
    reviewedRuntime: replacementRuntime,
  });
}

export async function runReplacementReadiness(args, observers = {}, execute = runReadiness) {
  const inputs = prepareReplacementReadiness(args);
  return execute({ ...observers, ...inputs });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let execution;
  try {
    const result = await runReplacementReadiness(process.argv.slice(2), {
      onPreflight: () =>
        console.log(
          "Preflight: PASS (exact replacement images/source/binding, runtime role reference, private VPC, explicit zero retries)",
        ),
      onExecution: (name) => {
        execution = name;
        console.log(`Read-only execution: ${name}`);
      },
    });
    for (const line of formatReadiness(result.rows)) console.log(line);
    console.log(`Reader SHA256: ${result.reader_sha256}`);
    console.log(
      "This read does not authorize Send, renew the session or reconcile historical costs.",
    );
    process.exitCode = result.ready ? 0 : 1;
  } catch (error) {
    for (const line of formatReadinessFailure(error, execution)) console.log(line);
    process.exitCode = 1;
  }
}
