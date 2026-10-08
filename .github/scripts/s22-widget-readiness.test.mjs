import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import { moduleBootstrap as existingBootstrap } from "./s22-widget-session-select.mjs";
import {
  readinessOperation,
  readinessScope,
  readinessForceRlsTableNames,
  parseReadinessScope,
} from "./s22-widget-readiness-readonly.mjs";
import {
  collectReadinessLogs,
  formatReadiness,
  moduleBootstrap,
  parseReadinessArguments,
  reviewedReadiness as pin,
  runReadiness,
  verifyReadinessJob,
  verifyReadinessWorker,
} from "./s22-widget-readiness.mjs";

const env = (extra = {}) =>
  Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: pin.source,
    DEPLOYMENT_TIMESTAMP: pin.timestamp,
    DEPLOYMENT_MIGRATION_HEAD: pin.head,
    ...extra,
  }).map(([name, value]) => ({ name, value }));
const interfaces = [
  {
    network: `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
    subnetwork: `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
  },
];
const job = (inputs = {}, reviewed = pin) => ({
  metadata: { name: pin.job, labels: { "cloud.googleapis.com/location": pin.region } },
  spec: {
    template: {
      metadata: {
        annotations: {
          "run.googleapis.com/network-interfaces": JSON.stringify(interfaces),
          "run.googleapis.com/vpc-access-egress": "private-ranges-only",
        },
      },
      spec: {
        template: {
          spec: {
            maxRetries: 0,
            serviceAccountName: `lead-agent-staging-migrator@${pin.project}.iam.gserviceaccount.com`,
            containers: [
              {
                image: reviewed.image,
                command: ["node"],
                args: ["dist/index.js"],
                env: [
                  ...env({
                    DEPLOYMENT_IMAGE_DIGEST: reviewed.image,
                    DEPLOYMENT_GIT_SHA: reviewed.source,
                    DEPLOYMENT_TIMESTAMP: inputs.deploymentTimestamp ?? pin.timestamp,
                  }),
                  {
                    name: "DATABASE_URL",
                    valueFrom: {
                      secretKeyRef: {
                        name: "lead-agent-staging-runtime-database-url",
                        key: "latest",
                      },
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
const worker = (inputs = {}, reviewed = pin) => ({
  name: `projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker`,
  scaling: { manualInstanceCount: 1 },
  terminalCondition: { state: "CONDITION_SUCCEEDED" },
  template: {
    serviceAccount: `lead-agent-staging-worker@${pin.project}.iam.gserviceaccount.com`,
    vpcAccess: { egress: "PRIVATE_RANGES_ONLY", networkInterfaces: interfaces },
    containers: [
      {
        image: reviewed.worker,
        env: env({
          DEPLOYMENT_GIT_SHA: reviewed.source,
          AI_JOURNEY_MODE: "widget_booking",
          AI_JOURNEY_WIDGET_SESSION_ID: inputs.sessionId ?? readinessScope.session,
          DEPLOYMENT_TIMESTAMP: inputs.deploymentTimestamp ?? pin.timestamp,
          AI_REQUEST_TIMEOUT_MS: "15000",
        }),
      },
    ],
  },
});
const sessionRow = (scope = readinessScope) => ({
  organization_id: readinessScope.organization,
  session_id: scope.session,
  channel_connection_id: readinessScope.channel,
  allowed_origin_id: readinessScope.origin,
  status: "active",
  version: "2",
  issued_at: "2026-10-08T10:54:48.093Z",
  last_seen_at: "2026-10-08T10:54:49.000Z",
  expires_at: "2026-10-08T12:54:48.093Z",
  contact_unbound: true,
  conversation_unbound: true,
  not_revoked: true,
  channel_active: true,
  origin_active: true,
  absolute_valid: true,
  idle_valid: true,
  scope_matches: true,
});
const snapshot = (scope = readinessScope) => ({
  profile: "s22-synthetic-booking.v1",
  mode: "widget_booking",
  physicalCalls: 4,
  logicalMessages: 4,
  knownCostMicros: "8714",
  unresolvedReserveMicros: "0",
  historicalReserveMicros: "1033396",
  combinedExposureMicros: "1042110",
  perCallReserveMicros: "801432",
  accountingComplete: false,
  blocked: false,
  reason: null,
  widget: {
    sessionId: scope.session,
    conversationId: null,
    conversationUnbound: true,
    physicalCalls: 0,
    logicalMessages: 0,
    customerMessages: 0,
    knownCostMicros: "0",
    unresolvedReserveMicros: "0",
  },
});
const entries = (expired = false, scope = readinessScope) =>
  [
    [
      "runtime_read_only_tenant_guard",
      true,
      {
        runtime: true,
        staging_database: true,
        least_privilege: true,
        read_only: true,
        row_security: true,
        tenant_matches: true,
        collection_window_valid: true,
      },
    ],
    ["force_rls_not_owner_guard", true, { count: 6, safe: true }],
    [
      "exact_widget_session",
      !expired,
      { ...sessionRow(scope), row_count: 1, idle_valid: !expired },
    ],
    [
      "cohort_reservation_accounting",
      !expired,
      {
        ...snapshot(scope),
        blocked: expired,
        reason: expired ? "widget_session_unavailable" : null,
      },
    ],
    [
      "first_message_readiness",
      !expired,
      {
        session_ready: !expired,
        budget_ready: !expired,
        ready: !expired,
        remaining_customer_messages: expired ? 0 : 2,
        remaining_physical_attempts: expired ? 0 : 4,
        no_message_or_call_triggered: true,
      },
    ],
  ].map(([assertion, pass, observed]) => ({
    jsonPayload: {
      operation: readinessOperation,
      assertion,
      outcome: pass ? "PASS" : "FAIL",
      observed,
    },
  }));

test("exact current deployment preflight preserves runtime role, immutable images, private VPC and explicit retries", () => {
  verifyReadinessJob(job());
  verifyReadinessWorker(worker());
});

const replacement = {
  sessionId: "01a11b26-c51d-78ba-8e81-62e6e7331ab9",
  deploymentTimestamp: "2026-10-08T13:00:00Z",
};
test("explicit replacement expectations retain exact images/source and require matching reviewed SID/timestamp", () => {
  assert.deepEqual(parseReadinessArguments([]), {});
  assert.deepEqual(
    parseReadinessArguments([
      "--session",
      replacement.sessionId,
      "--deployment-timestamp",
      replacement.deploymentTimestamp,
    ]),
    replacement,
  );
  verifyReadinessJob(job(replacement), replacement);
  verifyReadinessWorker(worker(replacement), replacement);
  assert.throws(() => verifyReadinessJob(job(), replacement), { code: "PROVENANCE_MISMATCH" });
  const wrongSession = worker(replacement);
  wrongSession.template.containers[0].env.find(
    (v) => v.name === "AI_JOURNEY_WIDGET_SESSION_ID",
  ).value = readinessScope.session;
  assert.throws(() => verifyReadinessWorker(wrongSession, replacement), {
    code: "WORKER_BINDING_MISMATCH",
  });
  const scope = parseReadinessScope(replacement.sessionId);
  assert.equal(collectReadinessLogs(entries(false, scope), scope).at(-1).outcome, "PASS");
  assert.throws(() => collectReadinessLogs(entries(), scope), { code: "LOG_METADATA_INVALID" });
});

// Controlled fixtures only; real wrapper literals come from verified build/plan artifacts.
const futureRuntime = Object.freeze({
  source: "b".repeat(40),
  worker: `me-central1-docker.pkg.dev/${pin.project}/lead-agent/worker@sha256:${"c".repeat(64)}`,
  image: `me-central1-docker.pkg.dev/${pin.project}/lead-agent/migrator@sha256:${"d".repeat(64)}`,
  timestamp: "2026-10-08T15:00:00Z",
});
const futureInputs = Object.freeze({
  sessionId: replacement.sessionId,
  deploymentTimestamp: futureRuntime.timestamp,
});
test("explicit reviewed runtime uses exact future images/source/time without changing historical defaults", () => {
  verifyReadinessJob(job(futureInputs, futureRuntime), futureInputs, futureRuntime);
  verifyReadinessWorker(worker(futureInputs, futureRuntime), futureInputs, futureRuntime);
  verifyReadinessJob(job());
  verifyReadinessWorker(worker());
  assert.throws(() => verifyReadinessJob(job(futureInputs), futureInputs, futureRuntime), {
    code: "DIAGNOSTIC_IMAGE_MISMATCH",
  });
  assert.throws(() => verifyReadinessWorker(worker(futureInputs), futureInputs, futureRuntime), {
    code: "WORKER_SCOPE_OR_IMAGE_MISMATCH",
  });
  const wrongSource = job(futureInputs, futureRuntime);
  wrongSource.spec.template.spec.template.spec.containers[0].env.find(
    (v) => v.name === "DEPLOYMENT_GIT_SHA",
  ).value = pin.source;
  assert.throws(() => verifyReadinessJob(wrongSource, futureInputs, futureRuntime), {
    code: "PROVENANCE_MISMATCH",
  });
  const wrongTime = worker(futureInputs, futureRuntime);
  wrongTime.template.containers[0].env.find((v) => v.name === "DEPLOYMENT_TIMESTAMP").value =
    pin.timestamp;
  assert.throws(() => verifyReadinessWorker(wrongTime, futureInputs, futureRuntime), {
    code: "PROVENANCE_MISMATCH",
  });
  const wrongHead = job(futureInputs, futureRuntime);
  wrongHead.spec.template.spec.template.spec.containers[0].env.find(
    (v) => v.name === "DEPLOYMENT_MIGRATION_HEAD",
  ).value = "0032_unapproved";
  assert.throws(() => verifyReadinessJob(wrongHead, futureInputs, futureRuntime), {
    code: "PROVENANCE_MISMATCH",
  });
});
for (const [name, reviewedRuntime] of [
  ["null", null],
  ["array", []],
  ["string", "unreviewed"],
  [
    "missing key",
    { source: futureRuntime.source, worker: futureRuntime.worker, image: futureRuntime.image },
  ],
  ["extra project selector", { ...futureRuntime, project: "foreign" }],
  ["extra migration selector", { ...futureRuntime, head: "0032_unapproved" }],
  ["uppercase source", { ...futureRuntime, source: "B".repeat(40) }],
  ["abbreviated source", { ...futureRuntime, source: "bbbbbbb" }],
  [
    "mutable worker tag",
    { ...futureRuntime, worker: futureRuntime.worker.split("@")[0] + ":latest" },
  ],
  [
    "wrong registry",
    { ...futureRuntime, worker: futureRuntime.worker.replace(pin.project, "foreign-project") },
  ],
  ["wrong image component", { ...futureRuntime, image: futureRuntime.worker }],
  [
    "wrong region",
    { ...futureRuntime, image: futureRuntime.image.replace("me-central1", "europe-west1") },
  ],
  ["non-string image", { ...futureRuntime, image: 0 }],
  ["timestamp offset", { ...futureRuntime, timestamp: "2026-10-08T15:00:00+00:00" }],
  ["invalid calendar date", { ...futureRuntime, timestamp: "2026-02-30T15:00:00Z" }],
  ["timestamp precision", { ...futureRuntime, timestamp: "2026-10-08T15:00:00.000Z" }],
])
  test(`reviewed runtime rejects ${name} before credentials or diagnostic execution`, async () => {
    let calls = 0;
    await assert.rejects(
      runReadiness({
        ...futureInputs,
        reviewedRuntime,
        cloud: async () => {
          calls++;
          return "PRIVATE_FIXTURE_TOKEN";
        },
      }),
      { code: "REVIEWED_RUNTIME_INVALID" },
    );
    assert.equal(calls, 0);
  });
for (const inputs of [
  {},
  { sessionId: futureInputs.sessionId },
  { deploymentTimestamp: futureInputs.deploymentTimestamp },
  { ...futureInputs, deploymentTimestamp: replacement.deploymentTimestamp },
])
  test(`reviewed runtime requires explicit exact SID/time: ${JSON.stringify(inputs)}`, async () => {
    let calls = 0;
    await assert.rejects(
      runReadiness({
        ...inputs,
        reviewedRuntime: futureRuntime,
        cloud: async () => {
          calls++;
          return "PRIVATE_FIXTURE_TOKEN";
        },
      }),
      { code: "READINESS_EXPECTATION_INVALID" },
    );
    assert.equal(calls, 0);
  });
for (const args of [
  ["--session", replacement.sessionId],
  ["--session", replacement.sessionId, "--session", replacement.sessionId],
  ["--source", pin.source, "--deployment-timestamp", replacement.deploymentTimestamp],
  ["--session", "not-a-session", "--deployment-timestamp", replacement.deploymentTimestamp],
  ["--session", readinessScope.session, "--deployment-timestamp", replacement.deploymentTimestamp],
  ["--session", replacement.sessionId, "--deployment-timestamp", pin.timestamp],
  ["--session", replacement.sessionId, "--deployment-timestamp", "2026-02-30T13:00:00Z"],
  ["--session", replacement.sessionId, "--deployment-timestamp", "2026-10-08T13:00:00+00:00"],
])
  test(`reject incomplete, unreviewed or expired replacement arguments: ${JSON.stringify(args)}`, () => {
    assert.throws(() => parseReadinessArguments(args));
  });
test("invalid replacement expectation stops before credentials or Cloud Run execution", async () => {
  let cloudCalls = 0;
  await assert.rejects(
    runReadiness({
      sessionId: replacement.sessionId,
      cloud: async () => {
        cloudCalls++;
        return "PRIVATE_FIXTURE_TOKEN";
      },
    }),
    { code: "READINESS_EXPECTATION_INVALID" },
  );
  assert.equal(cloudCalls, 0);
});
for (const [name, change, code] of [
  [
    "omitted retries",
    (x) => delete x.spec.template.spec.template.spec.maxRetries,
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  ],
  [
    "string retries",
    (x) => (x.spec.template.spec.template.spec.maxRetries = "0"),
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  ],
  [
    "nonzero retries",
    (x) => (x.spec.template.spec.template.spec.maxRetries = 1),
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  ],
  [
    "old image",
    (x) => (x.spec.template.spec.template.spec.containers[0].image = "old"),
    "DIAGNOSTIC_IMAGE_MISMATCH",
  ],
  [
    "migration role",
    (x) =>
      (x.spec.template.spec.template.spec.containers[0].env.at(-1).valueFrom.secretKeyRef.name =
        "migration-database-url"),
    "RUNTIME_SECRET_REFERENCE_MISMATCH",
  ],
  [
    "all traffic",
    (x) =>
      (x.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] =
        "all-traffic"),
    "DIAGNOSTIC_VPC_MISMATCH",
  ],
  [
    "foreign tenant project network",
    (x) =>
      (x.spec.template.metadata.annotations["run.googleapis.com/network-interfaces"] =
        '[{"network":"foreign","subnetwork":"foreign"}]'),
    "DIAGNOSTIC_VPC_MISMATCH",
  ],
])
  test(`job rejects ${name}`, () => {
    const x = job();
    change(x);
    assert.throws(() => verifyReadinessJob(x), { code });
  });
for (const [name, change, code] of [
  [
    "wrong session",
    (x) =>
      (x.template.containers[0].env.find((v) => v.name === "AI_JOURNEY_WIDGET_SESSION_ID").value =
        "other"),
    "WORKER_BINDING_MISMATCH",
  ],
  [
    "wrong mode",
    (x) =>
      (x.template.containers[0].env.find((v) => v.name === "AI_JOURNEY_MODE").value = "booking"),
    "WORKER_BINDING_MISMATCH",
  ],
  [
    "wrong timeout",
    (x) =>
      (x.template.containers[0].env.find((v) => v.name === "AI_REQUEST_TIMEOUT_MS").value =
        "60000"),
    "WORKER_BINDING_MISMATCH",
  ],
  [
    "duplicate environment",
    (x) => x.template.containers[0].env.push(x.template.containers[0].env[0]),
    "ENVIRONMENT_INVALID",
  ],
  [
    "wrong source",
    (x) =>
      (x.template.containers[0].env.find((v) => v.name === "DEPLOYMENT_GIT_SHA").value = "other"),
    "PROVENANCE_MISMATCH",
  ],
])
  test(`worker rejects ${name}`, () => {
    const x = worker();
    change(x);
    assert.throws(() => verifyReadinessWorker(x), { code });
  });

test("safe collection distinguishes expired-session assertion from collection failure and strips unexpected data", () => {
  const rows = entries(true);
  rows[2].jsonPayload.observed.secret = "DO_NOT_PRINT_PRIVATE_FIXTURE";
  rows[3].jsonPayload.observed.widget.customer_text = "DO_NOT_PRINT_PRIVATE_FIXTURE";
  const safe = collectReadinessLogs(rows);
  const out = formatReadiness(safe).join("\n");
  assert.match(out, /idle valid: false/u);
  assert.match(out, /widget_session_unavailable/u);
  assert.doesNotMatch(
    JSON.stringify(safe) + out,
    /DO_NOT_PRINT_PRIVATE_FIXTURE|customer_text|secret/u,
  );
  assert.throws(() => collectReadinessLogs(rows.slice(1)), { code: "LOG_ASSERTIONS_INCOMPLETE" });
  assert.throws(() => collectReadinessLogs([...rows, rows[0]]), {
    code: "LOG_ASSERTIONS_INCOMPLETE",
  });
});
test("read-only failures preserve allowlisted stage and SQLSTATE without error or credential text", () => {
  assert.throws(
    () =>
      collectReadinessLogs([
        {
          jsonPayload: {
            operation: readinessOperation,
            assertion: "force_rls_not_owner_guard",
            outcome: "BLOCKED",
            code: "DATABASE_OR_TOOLING_UNAVAILABLE",
            sqlstate: "42P18",
            error: "DO_NOT_PRINT_PRIVATE_FIXTURE",
          },
        },
      ]),
    (e) =>
      e.code === "READ_ONLY_DIAGNOSTIC_BLOCKED" &&
      e.diagnostic_stage === "force_rls_not_owner_guard" &&
      e.sqlstate === "42P18" &&
      !JSON.stringify(e).includes("DO_NOT_PRINT_PRIVATE_FIXTURE"),
  );
});

for (const [name, change] of [
  [
    "empty guard",
    (rows) => {
      rows[0].jsonPayload.observed = {};
    },
  ],
  [
    "foreign selected session",
    (rows) => {
      rows[2].jsonPayload.observed.session_id = "01a11b26-c51d-78ba-8e81-62e6e7331ab9";
    },
  ],
  [
    "bound conversation",
    (rows) => {
      rows[3].jsonPayload.observed.widget.conversationUnbound = false;
    },
  ],
  [
    "missing known cost",
    (rows) => {
      rows[3].jsonPayload.observed.knownCostMicros = null;
    },
  ],
  [
    "false first-message readiness",
    (rows) => {
      rows[4].jsonPayload.observed.ready = false;
    },
  ],
])
  test(`collection rejects claimed PASS with ${name}`, () => {
    const rows = entries();
    change(rows);
    assert.throws(() => collectReadinessLogs(rows), { code: "LOG_METADATA_INVALID" });
  });
test("money output uses exact integer dollars and never converts unknown into zero", () => {
  const rows = collectReadinessLogs(entries());
  assert.match(formatReadiness(rows).join("\n"), /USD0\.008714 \/ USD1\.042110/u);
  rows[3].observed.knownCostMicros = null;
  assert.match(
    formatReadiness(rows).join("\n"),
    /Known cost \/ total reserved exposure: unknown \/ USD1\.042110/u,
  );
});

test("one exact diagnostic, preflight log permission first, expired response is readable not generic LOG_ASSERTION_NOT_PASS", async () => {
  const calls = [],
    reads = [];
  let executed = false;
  const r = await runReadiness({
    now: () => Date.parse("2026-10-08T11:35:00.000Z"),
    wait: async () => {},
    cloud: async (args) => {
      calls.push(args);
      if (args.includes("print-access-token")) return "PRIVATE_FIXTURE_TOKEN";
      if (args.includes("execute")) {
        assert.equal(reads.length, 2);
        executed = true;
        assert.ok(args.includes("--tasks=1"));
        assert.ok(args.includes("--task-timeout=65s"));
        const payload = args.find((a) => a.startsWith("--args="));
        assert.ok(payload.includes(moduleBootstrap));
        return "lead-agent-staging-migrator-fake";
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "False" }] } });
      return JSON.stringify(job());
    },
    fetch: async (url, options) => {
      reads.push(url);
      assert.equal(options.redirect, "error");
      assert.match(options.headers.Authorization, /^Bearer /u);
      if (url.includes("workerPools")) return Response.json(worker());
      if (!executed) return Response.json({ entries: [] });
      const body = JSON.parse(options.body);
      assert.match(body.filter, /execution_name.*lead-agent-staging-migrator-fake/u);
      return Response.json({ entries: entries(true) });
    },
  });
  assert.equal(r.ready, false);
  assert.equal(calls.filter((a) => a.includes("execute")).length, 1);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_FIXTURE_TOKEN/u);
});
for (const status of [401, 403, 503])
  test(`log permission/transport ${status} causes no diagnostic execution`, async () => {
    let executions = 0;
    await assert.rejects(
      runReadiness({
        cloud: async (a) => {
          if (a.includes("execute")) executions++;
          return a.includes("print-access-token") ? "fixture-token" : JSON.stringify(job());
        },
        fetch: async (url) =>
          url.includes("workerPools")
            ? Response.json(worker())
            : new Response("DO_NOT_PRINT_PRIVATE_FIXTURE", { status }),
      }),
      (e) => ["CLOUD_READ_PERMISSION_UNAVAILABLE", "CLOUD_READ_UNAVAILABLE"].includes(e.code),
    );
    assert.equal(executions, 0);
  });

test("new reviewed expectation is forwarded to one reader execution and mismatched old logs are not accepted", async () => {
  let executed = false;
  const scope = parseReadinessScope(replacement.sessionId);
  const result = await runReadiness({
    ...replacement,
    wait: async () => {},
    cloud: async (args) => {
      if (args.includes("print-access-token")) return "PRIVATE_FIXTURE_TOKEN";
      if (args.includes("execute")) {
        assert.equal(executed, false);
        executed = true;
        assert.ok(args.some((a) => a.includes("S22_WIDGET_READINESS_SESSION_ID=" + scope.session)));
        return "lead-agent-staging-migrator-replacement";
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(job(replacement));
    },
    fetch: async (url) =>
      url.includes("workerPools")
        ? Response.json(worker(replacement))
        : Response.json({ entries: executed ? entries(false, scope) : [] }),
  });
  assert.equal(result.ready, true);
  assert.equal(result.rows[2].observed.session_id, scope.session);
});

test("reviewed future runtime is snapshotted before reads and scopes one existing read-only execution", async () => {
  const reviewed = { ...futureRuntime };
  const calls = [];
  let executed = false;
  const scope = parseReadinessScope(futureInputs.sessionId);
  const result = await runReadiness({
    ...futureInputs,
    reviewedRuntime: reviewed,
    wait: async () => {},
    cloud: async (args) => {
      calls.push(args);
      if (args.includes("print-access-token")) {
        reviewed.source = "e".repeat(40);
        reviewed.image = pin.image;
        return "PRIVATE_FIXTURE_TOKEN";
      }
      if (args.includes("execute")) {
        assert.equal(executed, false);
        executed = true;
        assert.ok(args.some((a) => a.includes("S22_WIDGET_READINESS_SESSION_ID=" + scope.session)));
        assert.ok(args.includes("--tasks=1"));
        assert.ok(args.includes("--task-timeout=65s"));
        return "lead-agent-staging-migrator-future";
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(job(futureInputs, futureRuntime));
    },
    fetch: async (url) =>
      url.includes("workerPools")
        ? Response.json(worker(futureInputs, futureRuntime))
        : Response.json({ entries: executed ? entries(false, scope) : [] }),
  });
  assert.equal(result.ready, true);
  assert.equal(result.rows[2].observed.session_id, scope.session);
  assert.equal(calls.filter((args) => args.includes("execute")).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE_TOKEN/u);
});

test("reviewed future runtime rejects matching-image wrong-source metadata before execution", async () => {
  let executions = 0;
  const wrongSource = worker(futureInputs, futureRuntime);
  wrongSource.template.containers[0].env.find(
    (entry) => entry.name === "DEPLOYMENT_GIT_SHA",
  ).value = pin.source;
  await assert.rejects(
    runReadiness({
      ...futureInputs,
      reviewedRuntime: futureRuntime,
      cloud: async (args) => {
        if (args.includes("execute")) executions++;
        return args.includes("print-access-token")
          ? "PRIVATE_FIXTURE_TOKEN"
          : JSON.stringify(job(futureInputs, futureRuntime));
      },
      fetch: async () => Response.json(wrongSource),
    }),
    { code: "PROVENANCE_MISMATCH" },
  );
  assert.equal(executions, 0);
});

for (const state of ["ready", "expired", "guard-failure", "replacement"])
  test(`exact generated ESM bootstrap resolves application packages/relative runtime and cleans up: ${state}`, () => {
    assert.equal(moduleBootstrap, existingBootstrap);
    const dir = mkdtempSync(join(tmpdir(), "s22-widget-readiness-bootstrap-"));
    try {
      const scope =
        state === "replacement" ? parseReadinessScope(replacement.sessionId) : readinessScope;
      const config = join(dir, "node_modules", "@lead-agent", "config"),
        database = join(dir, "node_modules", "@lead-agent", "database");
      mkdirSync(config, { recursive: true });
      mkdirSync(join(database, "runtime"), { recursive: true });
      const pkg = JSON.stringify({ type: "module", exports: { ".": "./index.js" } });
      writeFileSync(join(config, "package.json"), pkg);
      writeFileSync(join(database, "package.json"), pkg);
      writeFileSync(
        join(config, "index.js"),
        `export const S22_BOOKING_COHORT={organizationId:'${readinessScope.organization}',conversationId:'01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7',historicalReserveMicros:1033396n,hardCeilingMicros:10000000n};export const withLibpqCompatibleRequireSsl=v=>v;export function createTenantDatabaseRuntimeConfig(c){if(c.maxConnections!==1||c.connectionTimeoutMilliseconds!==5000||c.statementTimeoutMilliseconds!==5000||!new URL(c.connectionString).searchParams.get('options').includes('default_transaction_read_only=on'))throw Error();return c;}`,
      );
      const snap = {
        ...snapshot(scope),
        ...(state === "expired" ? { blocked: true, reason: "widget_session_unavailable" } : {}),
      };
      writeFileSync(
        join(database, "index.js"),
        `let commits=0,rollbacks=0;export function createTenantDatabaseRuntime(){return{verifyReady:async()=>{},withTenantTransaction:async(org,callback)=>{if(org!=='${readinessScope.organization}')throw Error();try{const v=await callback({organizationId:org});commits++;return v;}catch(e){rollbacks++;throw e;}},close:async()=>console.log(JSON.stringify({fixture_cleanup:true,commits,rollbacks}))};}export function createAIJourneyBudgetGuard(runtime,c){if(c.mode!=='widget_booking'||c.widgetSessionId!=='${scope.session}'||c.historicalReserveMicros!==1033396n)throw Error();return{read:async org=>runtime.withTenantTransaction(org,async()=>(${JSON.stringify(snap)})),authorizeDispatch:()=>{throw Error('PROVIDER_FORBIDDEN');},recordStart:()=>{throw Error('PROVIDER_FORBIDDEN');}};}`,
      );
      const row = { ...sessionRow(scope), idle_valid: state !== "expired" };
      writeFileSync(
        join(database, "runtime", "tenant.js"),
        `export async function executeTenantQuery(session,build){const q=build(session.organizationId);if(q.values[0]!=='${readinessScope.organization}'||!/^[ ]*select /i.test(q.text.trimStart()))throw Error();if(q.text.includes('from pg_catalog.pg_roles r where'))return{rows:[{runtime:${state !== "guard-failure"},staging_database:true,least_privilege:true,read_only:true,row_security:true,tenant_matches:true,collection_window_valid:true}]};if(q.text.includes('from pg_catalog.pg_class')){if(!q.text.includes('$1::uuid')||q.values[1].length!==${readinessForceRlsTableNames.length})throw Error();return{rows:[{count:${readinessForceRlsTableNames.length},safe:true}]};}if(q.text.includes('from widget_sessions s')){if(q.values[1]!=='${scope.session}')throw Error();return{rows:[${JSON.stringify(row)}]};}throw Error();}`,
      );
      const reader = readFileSync(new URL("./s22-widget-readiness-readonly.mjs", import.meta.url));
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          DATABASE_URL: "postgres://unused:DO_NOT_PRINT_PRIVATE_FIXTURE@localhost/unused",
          S22_BOOKING_READ_B64: reader.toString("base64"),
          S22_WIDGET_READINESS_READ: "execute",
          S22_WIDGET_READINESS_STARTED_AT: "2026-10-08T11:35:00.000Z",
          S22_WIDGET_READINESS_SESSION_ID: scope.session,
        },
      });
      const ready = state === "ready" || state === "replacement";
      assert.equal(r.status, ready ? 0 : 1, r.stderr);
      assert.doesNotMatch(
        r.stdout + r.stderr,
        /Cannot use 'import.meta'|ERR_MODULE_NOT_FOUND|DO_NOT_PRINT_PRIVATE_FIXTURE|PROVIDER_FORBIDDEN/u,
      );
      const output = r.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const cleanup = output.find((v) => v.fixture_cleanup);
      assert.equal(cleanup.commits, 0);
      assert.ok(cleanup.rollbacks >= 1);
      if (state !== "guard-failure") {
        const rows = collectReadinessLogs(
          output
            .filter((v) => v.operation === readinessOperation)
            .map((jsonPayload) => ({ jsonPayload })),
          scope,
        );
        assert.equal(rows.length, 5);
        assert.equal(rows.at(-1).outcome, ready ? "PASS" : "FAIL");
      } else assert.ok(output.some((v) => v.code === "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED"));
    } finally {
      const target = realpathSync(dir);
      assert.equal(dirname(target), realpathSync(tmpdir()));
      assert.ok(basename(target).startsWith("s22-widget-readiness-bootstrap-"));
      rmSync(target, { recursive: true, force: true });
    }
  });
