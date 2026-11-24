import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const project = "lead-agent-stg-739284";
const job = "lead-agent-staging-migrator";
const counts = new Map([
  ["0031_s22_widget_inbound_route_management", 32],
  ["0032_s22_widget_recovery", 33],
  ["0033_first_owner_signup", 34],
]);
const args = [
  "--input-type=module",
  "-e",
  'eval((await import("node:zlib")).gunzipSync(Buffer.from(process.env.S22_VALIDATOR_GZIP_B64,"base64")).toString())',
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireMatch = (condition, code) => {
  if (!condition) throw new Error(code);
};

export function databaseValidatorReceipt(execution, expected) {
  const { executionId, projectNumber, image, source, packagedHead, schemaHead, validatorSha } =
    expected;
  requireMatch(
    /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(executionId) &&
      /^[1-9][0-9]+$/u.test(projectNumber) &&
      /^me-central1-docker\.pkg\.dev\/lead-agent-stg-739284\/lead-agent\/migrator@sha256:[0-9a-f]{64}$/u.test(
        image,
      ) &&
      /^[0-9a-f]{40}$/u.test(source) &&
      /^[0-9a-f]{64}$/u.test(validatorSha) &&
      counts.has(packagedHead) &&
      (schemaHead === packagedHead ||
        (packagedHead === "0033_first_owner_signup" && schemaHead === "0032_s22_widget_recovery")),
    "S22V090_VALIDATOR_EXPECTATION",
  );
  requireMatch(
    [project, projectNumber].some(
      (id) =>
        execution?.name ===
        `projects/${id}/locations/me-central1/jobs/${job}/executions/${executionId}`,
    ),
    "S22V091_VALIDATOR_EXECUTION_ID",
  );
  const template = execution.template;
  const container = template?.containers?.[0];
  requireMatch(
    execution.taskCount === 1 &&
      template?.maxRetries === 0 &&
      template?.serviceAccount === `${job}@${project}.iam.gserviceaccount.com` &&
      template?.containers?.length === 1 &&
      container?.image === image &&
      JSON.stringify(container.command) === '["node"]' &&
      JSON.stringify(container.args) === JSON.stringify(args),
    "S22V092_VALIDATOR_EXECUTION_TEMPLATE",
  );
  const env = new Map();
  for (const entry of container.env ?? []) {
    requireMatch(!env.has(entry.name), "S22V093_VALIDATOR_ENVIRONMENT");
    env.set(entry.name, entry.value);
  }
  requireMatch(
    env.get("DEPLOYMENT_ENVIRONMENT") === "staging" &&
      env.get("DEPLOYMENT_GIT_SHA") === source &&
      env.get("DEPLOYMENT_MIGRATION_HEAD") === packagedHead &&
      env.get("S22_VALIDATOR_SCHEMA_HEAD") === schemaHead,
    "S22V093_VALIDATOR_ENVIRONMENT",
  );
  const payload = env.get("S22_VALIDATOR_GZIP_B64");
  requireMatch(typeof payload === "string" && payload.length < 32_000, "S22V094_VALIDATOR_PAYLOAD");
  const payloadSha = sha256(
    gunzipSync(Buffer.from(payload, "base64"), { maxOutputLength: 65_536 }),
  );
  requireMatch(payloadSha === validatorSha, "S22V094_VALIDATOR_PAYLOAD");

  const completed = execution.conditions?.filter((condition) => condition.type === "Completed");
  requireMatch(
    completed?.length === 1 &&
      completed[0].state === "CONDITION_SUCCEEDED" &&
      execution.reconciling !== true &&
      typeof execution.completionTime === "string" &&
      Number.isFinite(Date.parse(execution.completionTime)) &&
      execution.succeededCount === 1 &&
      ["runningCount", "failedCount", "cancelledCount", "retriedCount"].every(
        (key) => (execution[key] ?? 0) === 0,
      ),
    "S22V095_VALIDATOR_EXECUTION_FAILED",
  );

  // The pinned validator exits nonzero if any database assertion fails.
  return {
    operation: "staging_database_validation",
    evidence_source: "cloud_run_execution_status",
    execution_id: executionId,
    image,
    image_source: source,
    validator_sha256: validatorSha,
    packaged_migration_head: packagedHead,
    applied_migration_head: schemaHead,
    applied_migration_count: counts.get(schemaHead),
    ...(schemaHead === "0033_first_owner_signup" && { first_owner_signup_boundary: "PASS" }),
    outcome: "PASS",
    summary: true,
  };
}

if (process.argv[2] === "--receipt") {
  const [, , , executionPath, executionId, projectNumber, validatorPath] = process.argv;
  try {
    console.log(
      JSON.stringify(
        databaseValidatorReceipt(JSON.parse(readFileSync(executionPath, "utf8")), {
          executionId,
          projectNumber,
          image: process.env.TF_VAR_migrator_image,
          source: process.env.S22_VALIDATOR_IMAGE_SOURCE,
          packagedHead: process.env.TF_VAR_migration_head,
          schemaHead: process.env.S22_VALIDATOR_SCHEMA_HEAD,
          validatorSha: sha256(readFileSync(validatorPath)),
        }),
      ),
    );
  } catch (error) {
    const code =
      error instanceof Error && /^S22V09[0-5]_[A-Z_]+$/u.test(error.message)
        ? error.message
        : "S22V096_VALIDATOR_HARNESS";
    console.log(
      JSON.stringify({
        operation: "staging_database_validation",
        assertion: "validator_execution_receipt",
        execution_id: /^lead-agent-staging-migrator-[a-z0-9]+$/u.test(executionId)
          ? executionId
          : undefined,
        failure_code: code,
        outcome: "FAIL",
        summary: true,
      }),
    );
    process.exitCode = 1;
  }
}
