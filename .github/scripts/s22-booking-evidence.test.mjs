import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  moduleBootstrap,
  recoverExistingBookingLogs,
  recoveryExecution,
  reviewed,
  sanitizeRows,
  verifyJob,
  verifyWorker,
} from "./s22-booking-evidence.mjs";

const project = "lead-agent-stg-739284";
const network = [
  {
    network: `projects/${project}/global/networks/lead-agent-staging-vpc`,
    subnetwork: `projects/${project}/regions/me-central1/subnetworks/lead-agent-staging-cloud-run`,
  },
];
const worker = () => ({
  name: `projects/${project}/locations/me-central1/workerPools/lead-agent-staging-worker`,
  terminalCondition: { state: "CONDITION_SUCCEEDED" },
  scaling: { manualInstanceCount: 1 },
  template: {
    serviceAccount: `lead-agent-staging-worker@${project}.iam.gserviceaccount.com`,
    vpcAccess: { egress: "PRIVATE_RANGES_ONLY", networkInterfaces: network },
    containers: [
      {
        image: reviewed.worker,
        env: Object.entries({
          DEPLOYMENT_ENVIRONMENT: "staging",
          AI_JOURNEY_MODE: "booking",
          DEPLOYMENT_GIT_SHA: reviewed.source,
          DEPLOYMENT_TIMESTAMP: reviewed.timestamp,
          DEPLOYMENT_MIGRATION_HEAD: reviewed.head,
        }).map(([name, value]) => ({ name, value })),
      },
    ],
  },
});
const job = () => ({
  spec: {
    template: {
      metadata: {
        annotations: {
          "run.googleapis.com/network-interfaces": JSON.stringify(network),
          "run.googleapis.com/vpc-access-egress": "private-ranges-only",
        },
      },
      spec: {
        template: {
          spec: {
            serviceAccountName: `lead-agent-staging-migrator@${project}.iam.gserviceaccount.com`,
            maxRetries: 0,
            containers: [
              {
                image: reviewed.migrator,
                command: ["node"],
                args: ["dist/index.js"],
                env: [
                  {
                    name: "DATABASE_URL",
                    valueFrom: {
                      secretKeyRef: { name: "lead-agent-staging-runtime-database-url" },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
});

test("matches only reviewed worker/source/cohort gate and immutable diagnostic", () => {
  assert.equal(verifyWorker(worker()).mode, "booking");
  assert.equal(verifyJob(job()).explicit_zero_retries, true);
});
test("reviewed evidence pins match the exact approved extraction rollout", () => {
  assert.equal(reviewed.source, "3f6dee297bbae03be46ec2a418c6adec329a698f");
  assert.equal(reviewed.timestamp, "2026-10-06T14:07:45Z");
  assert.equal(reviewed.head, "0031_s22_widget_inbound_route_management");
  assert.equal(
    reviewed.worker,
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:53e36057fb1655d7efcad189d2f535cfc77b82a740603bfc0116809a10967c97",
  );
  assert.equal(
    reviewed.migrator,
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:bdc0e4ba13051e57c29ef978e0326aa49309888cfa963ea5311a563d2e10625d",
  );
});

test("previous deployment images remain rejected after updating the reviewed pins", () => {
  const previousWorker = worker();
  previousWorker.template.containers[0].image =
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:9013c4f4303255678151bd5ab6907da3877bc7e76fe80c81ad554b50b4845beb";
  assert.throws(() => verifyWorker(previousWorker), { code: "WORKER_IMAGE_MISMATCH" });
  const previousJob = job();
  previousJob.spec.template.spec.template.spec.containers[0].image =
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:fc9d7e383d7ae569546a383266919ee49a65c41e2a09078e4cad9f86cd68fe0c";
  assert.throws(() => verifyJob(previousJob), { code: "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH" });
});

test("missing/string retry is never implicitly zero", () => {
  for (const retry of [undefined, "0", 1]) {
    const value = job();
    value.spec.template.spec.template.spec.maxRetries = retry;
    assert.throws(() => verifyJob(value), { code: "EXPLICIT_ZERO_RETRIES_REQUIRED" });
  }
});
test("worker manual-instance REST shape requires an explicit numeric one and rejects service-only fields", () => {
  for (const count of [undefined, 0, "1", 2]) {
    const value = worker();
    value.scaling.manualInstanceCount = count;
    assert.throws(() => verifyWorker(value), { code: "WORKER_SCALING_MISMATCH" });
  }
  const serviceShape = worker();
  serviceShape.scaling.scalingMode = "MANUAL";
  assert.throws(() => verifyWorker(serviceShape), { code: "WORKER_SCALING_MISMATCH" });
});
test("wrong secret, identity or network fails closed", () => {
  const secret = job();
  secret.spec.template.spec.template.spec.containers[0].env[0].valueFrom.secretKeyRef.name =
    "migration-database-url";
  assert.throws(() => verifyJob(secret), { code: "RUNTIME_SECRET_REFERENCE_MISMATCH" });
  const identity = worker();
  identity.template.serviceAccount = "other";
  assert.throws(() => verifyWorker(identity), { code: "WORKER_IDENTITY_MISMATCH" });
  const publicNetwork = worker();
  publicNetwork.template.vpcAccess.egress = "ALL_TRAFFIC";
  assert.throws(() => verifyWorker(publicNetwork), { code: "WORKER_VPC_MISMATCH" });
});
test("stale source, paused gate or duplicate settings cannot pass", () => {
  for (const [name, value, code] of [
    ["DEPLOYMENT_GIT_SHA", "other", "WORKER_PROVENANCE_MISMATCH"],
    ["AI_JOURNEY_MODE", "paused", "WORKER_GATE_MISMATCH"],
  ]) {
    const metadata = worker();
    metadata.template.containers[0].env.find((e) => e.name === name).value = value;
    assert.throws(() => verifyWorker(metadata), { code });
  }
  const duplicate = worker();
  duplicate.template.containers[0].env.push({ name: "AI_JOURNEY_MODE", value: "booking" });
  assert.throws(() => verifyWorker(duplicate), { code: "DUPLICATE_ENVIRONMENT" });
});
test("structured evidence drops credentials, bodies and foreign operations", () => {
  const result = sanitizeRows([
    {
      jsonPayload: {
        operation: "s22_booking_readonly",
        assertion: "cohort_reservation_accounting",
        outcome: "PASS",
        observed: {
          knownCostMicros: "0",
          accountingComplete: false,
          credentials: "not-allowed",
          rows: [{ id: "synthetic", body: "not-allowed" }],
        },
      },
    },
    {
      jsonPayload: {
        operation: "other",
        assertion: "cohort_reservation_accounting",
        outcome: "PASS",
        observed: { body: "not-allowed" },
      },
    },
  ]);
  assert.deepEqual(result, [
    {
      assertion: "cohort_reservation_accounting",
      outcome: "PASS",
      observed: { knownCostMicros: "0", accountingComplete: false, rows: [{ id: "synthetic" }] },
    },
  ]);
});
const recoveryEntries = () =>
  [
    "runtime_rls_and_baseline",
    "synthetic_conversation",
    "synthetic_requests",
    "synthetic_delivery_metadata",
    "deployed_cohort_binding",
    "cohort_reservation_accounting",
  ].map((assertion) => ({
    jsonPayload: {
      operation: "s22_booking_readonly",
      assertion,
      outcome: "PASS",
      observed: {
        knownCostMicros: "1950",
        accountingComplete: false,
        body: "SENSITIVE_BODY",
        token: "SENSITIVE_TOKEN",
      },
    },
  }));
test("existing-log recovery makes one bounded read, pins scope and preserves unknown accounting", async () => {
  let calls = 0;
  const result = await recoverExistingBookingLogs("SENSITIVE_AUTH", async (url, options) => {
    calls++;
    assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.signal.aborted, false);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.resourceNames, ["projects/lead-agent-stg-739284"]);
    assert.equal(body.pageSize, 20);
    assert.equal(body.orderBy, "timestamp desc");
    assert.ok(body.filter.includes(`execution_name"="${recoveryExecution}"`));
    assert.ok(body.filter.includes('timestamp<"2026-10-07T00:00:00Z"'));
    assert.ok(body.filter.includes('jsonPayload.operation="s22_booking_readonly"'));
    return Response.json({ entries: recoveryEntries() });
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.assertions.length, 6);
  assert.equal(result.assertions[5].observed.accountingComplete, false);
  assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
});
test("existing-log recovery distinguishes HTTP failures without printing provider error bodies", async () => {
  for (const [status, code] of [
    [401, "LOG_AUTHENTICATION_DENIED"],
    [403, "EXACT_EXECUTION_LOG_PERMISSION_DENIED"],
    [500, "LOG_API_UNAVAILABLE"],
  ]) {
    let calls = 0;
    const result = await recoverExistingBookingLogs("SENSITIVE_AUTH", () => {
      calls++;
      return Promise.resolve(new Response("SENSITIVE_ERROR", { status }));
    });
    assert.equal(calls, 1);
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
  }
});
test("existing-log recovery distinguishes transport failure, timeout and invalid JSON", async () => {
  for (const [name, code] of [
    ["TimeoutError", "LOG_API_TIMEOUT"],
    ["TypeError", "LOG_API_TRANSPORT_BLOCKED"],
  ]) {
    const result = await recoverExistingBookingLogs("SENSITIVE_AUTH", () =>
      Promise.reject(Object.assign(new Error("SENSITIVE"), { name })),
    );
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
  }
  assert.equal(
    (
      await recoverExistingBookingLogs("SENSITIVE_AUTH", () =>
        Promise.resolve(new Response("invalid")),
      )
    ).code,
    "LOG_RESPONSE_INVALID",
  );
});
test("recovery fails closed on absent, truncated, duplicate, malformed or failed assertions", async () => {
  for (const [payload, code] of [
    [{}, "LOG_ASSERTIONS_INCOMPLETE"],
    [{ entries: recoveryEntries(), nextPageToken: "SENSITIVE_PAGE_TOKEN" }, "LOG_RESULT_TRUNCATED"],
    [{ entries: [...recoveryEntries(), recoveryEntries()[0]] }, "LOG_ASSERTIONS_DUPLICATED"],
    [{ entries: [null] }, "LOG_RESPONSE_INVALID"],
    [{ entries: {} }, "LOG_RESPONSE_INVALID"],
    [
      {
        entries: recoveryEntries().map((entry, index) =>
          index === 0 ? { jsonPayload: { ...entry.jsonPayload, outcome: "FAIL" } } : entry,
        ),
      },
      "LOG_ASSERTION_NOT_PASS",
    ],
  ]) {
    const result = await recoverExistingBookingLogs("SENSITIVE_AUTH", () =>
      Promise.resolve(Response.json(payload)),
    );
    assert.equal(result.outcome, "BLOCKED");
    assert.equal(result.code, code);
    assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
  }
});
test("a mistyped recovery flag cannot enter the diagnostic execution path", () => {
  for (const args of [["--recover-log"], ["--recover-logs", "unexpected"]]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./s22-booking-evidence.mjs", import.meta.url)), ...args],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { outcome: "BLOCKED", code: "READ_MODE_INVALID" });
    assert.equal(result.stderr, "");
  }
});
test("exact subprocess bootstrap resolves bare packages and relative runtime module in a controlled application fixture without DB/model calls", () => {
  const fixture = mkdtempSync(join(tmpdir(), "s22-readonly-module-"));
  const packages = join(fixture, "node_modules", "@lead-agent");
  for (const name of ["config", "database"]) {
    const directory = join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: `@lead-agent/${name}`, type: "module", exports: "./index.js" }),
    );
    writeFileSync(
      join(directory, "index.js"),
      name === "config"
        ? "export function loadAIJourneyCohortConfig() { throw Error('MUST_NOT_CALL'); }"
        : "export function createAIJourneyBudgetGuard() { throw Error('MUST_NOT_CALL'); }",
    );
  }
  mkdirSync(join(packages, "database", "runtime"));
  writeFileSync(
    join(packages, "database", "runtime", "tenant.js"),
    "export function executeTenantQuery() { throw Error('MUST_NOT_CALL'); }",
  );
  const source =
    'const c=await import("@lead-agent/config");const d=await import("@lead-agent/database");const t=await import(new URL("./runtime/tenant.js",import.meta.resolve("@lead-agent/database")).href);if(typeof c.loadAIJourneyCohortConfig!=="function"||typeof d.createAIJourneyBudgetGuard!=="function"||typeof t.executeTenantQuery!=="function")throw Error("MODULE_RESOLUTION_FAILED");console.log("MODULE_RESOLUTION_PASS");';
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
      cwd: fixture,
      env: { ...process.env, S22_BOOKING_READ_B64: Buffer.from(source).toString("base64") },
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MODULE_RESOLUTION_PASS/);
  } finally {
    assert.equal(resolve(fixture).startsWith(resolve(tmpdir())), true);
    assert.equal(basename(fixture).startsWith("s22-readonly-module-"), true);
    rmSync(fixture, { recursive: true, force: true });
  }
});
