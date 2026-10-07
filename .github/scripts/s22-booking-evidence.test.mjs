import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  moduleBootstrap,
  formatReadinessReport,
  recoverExistingBookingLogs,
  recoverReadinessLogs,
  readinessRecoveryExecution,
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
test("reviewed evidence pins match the exact approved continuation rollout", () => {
  assert.equal(reviewed.source, "191a9cdbb4187ad0006a5dbab04882b4f44d0e64");
  assert.equal(reviewed.timestamp, "2026-10-07T06:50:40Z");
  assert.equal(reviewed.head, "0031_s22_widget_inbound_route_management");
  assert.equal(
    reviewed.worker,
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:f654f252f802488f5ef08d3a9a8a99dbe4ccc09ca01b59c1adff88b71c124506",
  );
  assert.equal(
    reviewed.migrator,
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:e66cba1a63b620863e30eeea210ff4169daef559dfc4c2b9eae4daba32bafb16",
  );
});

test("previous deployment images remain rejected after updating the reviewed pins", () => {
  const previousWorker = worker();
  previousWorker.template.containers[0].image =
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/worker@sha256:53e36057fb1655d7efcad189d2f535cfc77b82a740603bfc0116809a10967c97";
  assert.throws(() => verifyWorker(previousWorker), { code: "WORKER_IMAGE_MISMATCH" });
  const previousJob = job();
  previousJob.spec.template.spec.template.spec.containers[0].image =
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:bdc0e4ba13051e57c29ef978e0326aa49309888cfa963ea5311a563d2e10625d";
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
    [
      "DEPLOYMENT_GIT_SHA",
      "3f6dee297bbae03be46ec2a418c6adec329a698f",
      "WORKER_PROVENANCE_MISMATCH",
    ],
    ["DEPLOYMENT_TIMESTAMP", "2026-10-06T14:07:45Z", "WORKER_PROVENANCE_MISMATCH"],
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
  for (const recover of [recoverExistingBookingLogs, recoverReadinessLogs]) {
    for (const [status, code] of [
      [401, "LOG_AUTHENTICATION_DENIED"],
      [403, "EXACT_EXECUTION_LOG_PERMISSION_DENIED"],
      [500, "LOG_API_UNAVAILABLE"],
    ]) {
      let calls = 0;
      const result = await recover("SENSITIVE_AUTH", () => {
        calls++;
        return Promise.resolve(new Response("SENSITIVE_ERROR", { status }));
      });
      assert.equal(calls, 1);
      assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
    }
  }
});
test("existing-log recovery distinguishes transport failure, timeout and invalid JSON", async () => {
  for (const recover of [recoverExistingBookingLogs, recoverReadinessLogs]) {
    for (const [name, code] of [
      ["TimeoutError", "LOG_API_TIMEOUT"],
      ["TypeError", "LOG_API_TRANSPORT_BLOCKED"],
    ]) {
      const result = await recover("SENSITIVE_AUTH", () =>
        Promise.reject(Object.assign(new Error("SENSITIVE"), { name })),
      );
      assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
    }
    assert.equal(
      (await recover("SENSITIVE_AUTH", () => Promise.resolve(new Response("invalid")))).code,
      "LOG_RESPONSE_INVALID",
    );
  }
});
test("recovery fails closed on absent, truncated, duplicate, malformed or failed assertions", async () => {
  for (const recover of [recoverExistingBookingLogs, recoverReadinessLogs]) {
    for (const [payload, code] of [
      [{}, "LOG_ASSERTIONS_INCOMPLETE"],
      [
        { entries: recoveryEntries(), nextPageToken: "SENSITIVE_PAGE_TOKEN" },
        "LOG_RESULT_TRUNCATED",
      ],
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
      const result = await recover("SENSITIVE_AUTH", () => Promise.resolve(Response.json(payload)));
      assert.equal(result.outcome, "BLOCKED");
      assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
    }
  }
});

const readinessEntries = () => {
  const observed = {
    runtime_rls_and_baseline: {
      runtime_read_only_tenant_guard: true,
      force_rls: true,
      tables: 7,
      historical_runs: 2,
      historical_null_costs_preserved: true,
    },
    synthetic_conversation: {
      rows: [
        {
          id: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
          status: "open",
          automation_mode: "ai",
          no_active_handoff: true,
          version: "24",
        },
      ],
    },
    synthetic_requests: { rows: [] },
    synthetic_delivery_metadata: { rows: [] },
    deployed_cohort_binding: {
      organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
      conversation: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
      profile: "s22-synthetic-booking.v1",
      maximum_messages: 4,
      maximum_calls: 5,
      maximum_calls_per_message: 2,
      historical_reserve_micros: "1033396",
      hard_ceiling_micros: "10000000",
    },
    cohort_reservation_accounting: {
      profile: "s22-synthetic-booking.v1",
      mode: "booking",
      blocked: false,
      reason: null,
      logicalMessages: 3,
      physicalCalls: 3,
      knownCostMicros: "6207",
      combinedExposureMicros: "1039603",
      unresolvedReserveMicros: "0",
      accountingComplete: false,
      historicalReserveMicros: "1033396",
      perCallReserveMicros: "801432",
    },
  };
  return Object.entries(observed).map(([assertion, values]) => ({
    jsonPayload: {
      operation: "s22_booking_readonly",
      assertion,
      outcome: "PASS",
      observed: { ...values, body: "SENSITIVE_BODY", token: "SENSITIVE_TOKEN" },
    },
  }));
};
const readinessResult = (entries = readinessEntries()) => ({
  outcome: "PASS",
  execution: readinessRecoveryExecution,
  assertions: sanitizeRows(entries),
});

test("readiness recovery reads only the already-completed exact execution once without auth leakage", async () => {
  let calls = 0;
  const result = await recoverReadinessLogs("SENSITIVE_AUTH", async (url, options) => {
    calls++;
    assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.signal.aborted, false);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.resourceNames, ["projects/lead-agent-stg-739284"]);
    assert.equal(body.pageSize, 20);
    assert.equal(
      body.filter,
      'resource.type="cloud_run_job" AND resource.labels.job_name="lead-agent-staging-migrator" AND labels."run.googleapis.com/execution_name"="lead-agent-staging-migrator-q2z8g" AND timestamp>="2026-10-07T00:00:00Z" AND timestamp<"2026-10-08T00:00:00Z" AND jsonPayload.operation="s22_booking_readonly"',
    );
    return Response.json({ entries: readinessEntries() });
  });
  assert.equal(calls, 1);
  assert.equal(result.execution, "lead-agent-staging-migrator-q2z8g");
  const report = formatReadinessReport(result);
  assert.match(report, /Conversation ready for a new test message: PASS/);
  assert.match(report, /Budget ready for one message \/ at most two attempts: PASS/);
  assert.match(report, /Historical costs remain unknown/);
  assert.match(report, /snapshot, not a new database read or paid-call authorization/);
  assert.doesNotMatch(JSON.stringify(result) + report, /SENSITIVE|\[object Object\]/);
});

test("collected PASS cannot hide an unresolved handoff, existing request, exhausted/inflight budget or wrong binding", () => {
  const change = (entries, name) =>
    entries.find((entry) => entry.jsonPayload.assertion === name).jsonPayload.observed;
  for (const mutate of [
    (entries) => {
      change(entries, "synthetic_conversation").rows[0].status = "awaiting_staff";
    },
    (entries) => {
      change(entries, "synthetic_conversation").rows[0].automation_mode = "paused";
    },
    (entries) => {
      change(entries, "synthetic_conversation").rows[0].no_active_handoff = false;
    },
    (entries) => {
      change(entries, "synthetic_conversation").rows[0].id = "foreign";
    },
    (entries) => {
      change(entries, "synthetic_requests").rows.push({ id: "synthetic", status: "requested" });
    },
    (entries) => {
      change(entries, "deployed_cohort_binding").maximum_messages = 3;
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").logicalMessages = 4;
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").physicalCalls = 4;
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").blocked = true;
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").unresolvedReserveMicros = "801432";
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").knownCostMicros = null;
    },
    (entries) => {
      change(entries, "cohort_reservation_accounting").combinedExposureMicros = "0";
    },
    (entries) => {
      const row = change(entries, "cohort_reservation_accounting");
      row.knownCostMicros = "8000000";
      row.combinedExposureMicros = "9033396";
    },
  ]) {
    const entries = readinessEntries();
    mutate(entries);
    const report = formatReadinessReport(readinessResult(entries));
    assert.match(report, /Result collection: PASS/);
    assert.match(report, /(?:Conversation|Budget) ready[^\n]*BLOCKED/);
    assert.doesNotMatch(report, /SENSITIVE/);
  }
});

test("readiness failures retain safe observations and name the failed assertion without another query", () => {
  const result = readinessResult();
  result.outcome = "BLOCKED";
  result.code = "LOG_ASSERTION_NOT_PASS";
  result.assertions.at(-1).outcome = "FAIL";
  const report = formatReadinessReport(result);
  assert.match(report, /Failed check: cohort_reservation_accounting/);
  assert.match(report, /Test messages already used: 3 \/ 4/);
  assert.match(report, /Provider attempts already used: 3 \/ 5/);
  assert.match(report, /Conversation ready[^\n]*BLOCKED/);
  assert.match(
    formatReadinessReport({ outcome: "BLOCKED", code: "LOG_API_TIMEOUT" }),
    /BLOCKED \(LOG_API_TIMEOUT\)/,
  );
});

test("actual readiness CLI only authenticates and reads logs; non-ready snapshot exits nonzero", () => {
  const fixture = mkdtempSync(join(tmpdir(), "s22-log-recovery-"));
  const preload = join(fixture, "controlled-preload.mjs");
  try {
    for (const ready of [true, false]) {
      const entries = readinessEntries();
      if (!ready) entries[1].jsonPayload.observed.rows[0].no_active_handoff = false;
      writeFileSync(
        preload,
        `
        import assert from "node:assert/strict";
        import childProcess from "node:child_process";
        import {syncBuiltinESMExports} from "node:module";
        import {promisify} from "node:util";
        let auth=0, reads=0;
        const controlledExec=()=>{throw Error("UNEXPECTED_PROCESS");};
        controlledExec[promisify.custom]=async(file,args,options)=>{
          auth++;
          assert.equal(file,"gcloud");
          assert.deepEqual(args,["auth","print-access-token","--quiet"]);
          assert.equal(options.timeout,30000);
          return {stdout:"SENSITIVE_AUTH\\n"};
        };
        childProcess.execFile=controlledExec;
        syncBuiltinESMExports();
        globalThis.fetch=async(url,options)=>{
          reads++;
          assert.equal(url,"https://logging.googleapis.com/v2/entries:list");
          assert.ok(JSON.parse(options.body).filter.includes("lead-agent-staging-migrator-q2z8g"));
          return Response.json({entries:${JSON.stringify(entries)}});
        };
        process.on("exit",()=>{assert.equal(auth,1);assert.equal(reads,1);});
      `,
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          fileURLToPath(new URL("./s22-booking-evidence.mjs", import.meta.url)),
          "--recover-readiness",
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      assert.equal(result.status, ready ? 0 : 1, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /Result collection: PASS/);
      assert.match(
        result.stdout,
        new RegExp(`Conversation ready for a new test message: ${ready ? "PASS" : "BLOCKED"}`),
      );
      assert.doesNotMatch(result.stdout, /SENSITIVE|job_configuration_changed/);
    }
  } finally {
    assert.equal(resolve(fixture).startsWith(resolve(tmpdir())), true);
    assert.equal(basename(fixture).startsWith("s22-log-recovery-"), true);
    rmSync(fixture, { recursive: true, force: true });
  }
});
test("a mistyped recovery flag cannot enter the diagnostic execution path", () => {
  for (const args of [
    ["--recover-log"],
    ["--recover-logs", "unexpected"],
    ["--recover-readines"],
    ["--recover-readiness", "unexpected"],
  ]) {
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
