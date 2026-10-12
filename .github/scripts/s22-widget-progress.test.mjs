import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  progressScope as scope,
  progressRuntime as runtime,
  runProgress,
  continuationProgressScope,
} from "./s22-widget-progress.mjs";
import { collectAttemptLogs } from "./s22-widget-attempt.mjs";
import {
  attemptOperation,
  progressSessionSql,
  attemptQueries,
  attemptForceRlsTableNames,
  collectWidgetAttempt,
  copyAttemptScope,
  ownerSelectionSql,
  verifyOwnerSelection,
  continuationReadBoundary,
} from "./s22-widget-attempt-readonly.mjs";

const conversation = "01a12a04-d2ae-7cba-aded-0c48a410be01";
const selection = () => ({
  selected_session_id: scope.session,
  selection_version: "1",
  expected_selection_version: "0",
  expected_session_version: "2",
  channel_connection_id: scope.channel,
  allowed_origin_id: scope.origin,
  attributed: true,
});
const session = () => ({
  organization_id: scope.organization,
  session_id: scope.session,
  channel_connection_id: scope.channel,
  allowed_origin_id: scope.origin,
  conversation_id: conversation,
  conversation_status: "open",
  conversation_version: "3",
  automation_mode: "ai",
  no_active_handoff: true,
  status: "active",
  version: "3",
  issued_at: "2026-10-11T17:28:26.960Z",
  last_seen_at: "2026-10-11T17:45:00.000Z",
  expires_at: "2026-10-11T19:28:26.960Z",
  effective_expires_at: "2026-10-11T19:28:26.960Z",
  recovery_expires_at: "2026-10-12T17:45:00.000Z",
  contact_unbound: false,
  conversation_unbound: false,
  not_revoked: true,
  channel_active: true,
  origin_active: true,
  absolute_valid: false,
  idle_valid: false,
  conversation_ownership_matches: true,
});
const wrap = (assertion, observed) => ({
  jsonPayload: { operation: attemptOperation, assertion, outcome: "PASS", observed },
});
const fixtureRows = async () => {
  const reports = [];
  await collectWidgetAttempt(
    async (sql) =>
      sql === ownerSelectionSql ? [selection()] : sql === progressSessionSql ? [session()] : [],
    (name, pass, observed) => {
      assert.equal(pass, true);
      reports.push(wrap(name, observed));
    },
    scope,
  );
  return [
    wrap(
      "runtime_read_only_tenant_guard",
      Object.fromEntries(
        "runtime staging_database least_privilege read_only row_security tenant_matches collection_window_valid"
          .split(" ")
          .map((key) => [key, true]),
      ),
    ),
    wrap("force_rls_not_owner_guard", { count: attemptForceRlsTableNames.length, safe: true }),
    ...reports,
    wrap("cohort_reservation_accounting", {
      knownCostMicros: "10000",
      combinedExposureMicros: "1043396",
      blocked: true,
      reason: "widget_session_unavailable",
      unresolvedReserveMicros: "0",
      widget: {
        sessionId: scope.session,
        conversationId: conversation,
        physicalCalls: 1,
        customerMessages: 1,
      },
    }),
    wrap("widget_attempt_collection", {
      windowStart: scope.windowStart,
      windowEnd: scope.windowEnd,
      conversation_id: conversation,
      owner_selection_matches: true,
      no_message_or_call_triggered: true,
    }),
  ];
};
const env = (extra) =>
  Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: runtime.source,
    DEPLOYMENT_TIMESTAMP: runtime.timestamp,
    DEPLOYMENT_MIGRATION_HEAD: runtime.migrationHead,
    ...extra,
  }).map(([name, value]) => ({ name, value }));
const network = [{ network: "lead-agent-staging-vpc", subnetwork: "lead-agent-staging-cloud-run" }];
const worker = () => ({
  name: "projects/lead-agent-stg-739284/locations/me-central1/workerPools/lead-agent-staging-worker",
  scaling: { manualInstanceCount: 1 },
  terminalCondition: { state: "CONDITION_SUCCEEDED" },
  template: {
    serviceAccount: "lead-agent-staging-worker@lead-agent-stg-739284.iam.gserviceaccount.com",
    vpcAccess: { egress: "PRIVATE_RANGES_ONLY", networkInterfaces: network },
    containers: [
      {
        image: runtime.worker,
        env: env({
          AI_JOURNEY_MODE: "widget_booking",
          AI_JOURNEY_WIDGET_SESSION_ID: scope.anchor,
          AI_REQUEST_TIMEOUT_MS: "15000",
        }),
      },
    ],
  },
});
const job = () => ({
  metadata: {
    name: "lead-agent-staging-migrator",
    labels: { "cloud.googleapis.com/location": "me-central1" },
  },
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
            maxRetries: 0,
            serviceAccountName:
              "lead-agent-staging-migrator@lead-agent-stg-739284.iam.gserviceaccount.com",
            containers: [
              {
                image: runtime.image,
                command: ["node"],
                args: ["dist/index.js"],
                env: [
                  ...env({ DEPLOYMENT_IMAGE_DIGEST: runtime.image }),
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
const fixture = async (changedWorker = worker()) => {
  const rows = await fixtureRows(),
    calls = [],
    requests = [];
  let executed = false,
    time = Date.parse("2026-10-11T19:45:00Z");
  return {
    calls,
    requests,
    overrides: {
      now: () => time,
      wait: async (ms) => {
        time += ms;
      },
      cloud: async (args) => {
        calls.push(args);
        if (args.includes("print-access-token")) return "PRIVATE_TOKEN_FIXTURE";
        if (args.includes("execute")) {
          executed = true;
          return "lead-agent-staging-migrator-fixture";
        }
        if (args.includes("executions"))
          return JSON.stringify({
            status: { conditions: [{ type: "Completed", status: "True" }] },
          });
        return JSON.stringify(job());
      },
      fetch: async (url, options) => {
        requests.push({ url, options });
        if (url.includes("workerPools")) return Response.json(changedWorker);
        return Response.json({ entries: executed ? rows : [] });
      },
    },
  };
};

test("progress is pinned to the received chat, not its stable deployment anchor", () => {
  assert.notEqual(scope.session, scope.anchor);
  assert.equal(scope.session, "01a12c02-3e50-7663-99f4-c35024796c23");
  assert.equal(runtime.source, "abc3071fb81777068f5adfb98f6144d9081077eb");
  assert.equal(runtime.migrationHead, "0032_s22_widget_recovery");
  assert.ok(Object.isFrozen(scope) && Object.isFrozen(runtime));
});
for (const patch of [
  { organization: conversation },
  { channel: conversation },
  { origin: conversation },
  { anchor: conversation },
  { session: "invalid" },
  { windowStart: "invalid" },
  { windowEnd: "2026-10-11T10:14:00.000Z" },
  { windowEnd: scope.windowStart },
  { budget: 100 },
])
  test(`scope rejects ${Object.keys(patch)[0]} before cloud or DB access`, () => {
    assert.throws(
      () => copyAttemptScope({ ...scope, ...patch }),
      (error) => error.code === "ATTEMPT_SCOPE_INVALID",
    );
  });
test("owner selection uses CAS order, not wall clock, and checks exact latest identity", async () => {
  const older = { ...selection(), selected_session_id: conversation };
  const newer = { ...selection(), selection_version: "2", expected_selection_version: "1" };
  assert.equal(
    await verifyOwnerSelection(async (sql, args) => {
      assert.equal(sql, ownerSelectionSql);
      assert.deepEqual(args, [scope.anchor]);
      return [newer, older];
    }, scope),
    true,
  );
});
for (const patch of [
  { attributed: false },
  { selected_session_id: conversation },
  { selection_version: "2" },
  { expected_selection_version: "1" },
  { expected_session_version: "3" },
  { allowed_origin_id: conversation },
])
  test(`invalid owner selection stops before session/child queries: ${Object.keys(patch)[0]}`, async () => {
    let calls = 0;
    await assert.rejects(
      collectWidgetAttempt(
        async (sql) => {
          calls++;
          assert.equal(sql, ownerSelectionSql);
          return [{ ...selection(), ...patch }];
        },
        () => assert.fail("no report expected"),
        scope,
      ),
      (error) => error.code === "ATTEMPT_OWNER_SELECTION_INVALID",
    );
    assert.equal(calls, 1);
  });
test("expired bound chat is observable without renewal, with tenant/window/row limits preserved", async () => {
  let children = 0;
  const id = await collectWidgetAttempt(
    async (sql, args) => {
      if (sql === ownerSelectionSql) return [selection()];
      if (sql === progressSessionSql) return [session()];
      children++;
      assert.deepEqual(args, [conversation, scope.channel, scope.windowStart, scope.windowEnd]);
      assert.ok(Object.values(attemptQueries).includes(sql));
      assert.match(sql, /organization_id=\$1/u);
      return [];
    },
    () => {},
    scope,
  );
  assert.equal(id, conversation);
  assert.equal(children, 5);
});

test("candidate UUID window is checked against persisted issuance before child reads", async () => {
  let calls = 0;
  await assert.rejects(
    collectWidgetAttempt(
      async (sql) => {
        calls++;
        return sql === ownerSelectionSql
          ? [selection()]
          : [{ ...session(), issued_at: "2026-10-11T16:00:00.000Z" }];
      },
      () => {},
      scope,
    ),
    { code: "ATTEMPT_SESSION_SCOPE_INVALID" },
  );
  assert.equal(calls, 2);
});

const continuationScope = copyAttemptScope({
  ...scope,
  continuation: continuationReadBoundary.profile,
  windowStart: "2026-10-12T12:00:00.000Z",
  windowEnd: "2026-10-12T14:00:00.000Z",
});
test("continuation observation clock creates at most a two-hour window inside the fixed recovery family", () => {
  const recent = continuationProgressScope(new Date("2026-10-12T14:00:00.000Z"));
  assert.deepEqual(recent, continuationScope);
  const early = continuationProgressScope(new Date("2026-10-11T19:30:00.000Z"));
  assert.equal(early.windowStart, continuationReadBoundary.issuedWindowEnd);
  const expired = continuationProgressScope(new Date("2026-10-12T18:00:00.000Z"));
  assert.equal(expired.windowEnd, continuationReadBoundary.recoveryDeadline);
  assert.equal(Date.parse(expired.windowEnd) - Date.parse(expired.windowStart), 120 * 60000);
  assert.ok(Object.isFrozen(recent) && Object.isFrozen(expired));
});
for (const now of [new Date(NaN), new Date("2026-10-11T19:29:00.000Z")])
  test(`invalid/early continuation clock stops before access: ${String(now)}`, () => {
    assert.throws(() => continuationProgressScope(now), { code: "ATTEMPT_SCOPE_INVALID" });
  });
test("later continuation window retains original issuance, exact conversation and bounded metadata SELECTs", async () => {
  let children = 0;
  const id = await collectWidgetAttempt(
    async (sql, args) => {
      if (sql === ownerSelectionSql) return [selection()];
      if (sql === progressSessionSql)
        return [{ ...session(), conversation_id: continuationReadBoundary.conversation }];
      children++;
      assert.deepEqual(args, [
        continuationReadBoundary.conversation,
        scope.channel,
        continuationScope.windowStart,
        continuationScope.windowEnd,
      ]);
      assert.ok(Object.values(attemptQueries).includes(sql));
      assert.match(sql, /organization_id=\$1/u);
      return [];
    },
    () => {},
    continuationScope,
  );
  assert.equal(id, continuationReadBoundary.conversation);
  assert.equal(children, 5);
});
for (const patch of [
  { continuation: "unknown-profile" },
  { session: conversation },
  { anchor: undefined },
  { windowStart: "2026-10-11T19:28:59.999Z", windowEnd: "2026-10-11T19:30:00.000Z" },
  { windowStart: "2026-10-12T17:48:00.000Z", windowEnd: "2026-10-12T17:49:03.354Z" },
  { windowEnd: "2026-10-12T14:01:00.001Z" },
  { extra: true },
])
  test(`continuation rejects out-of-scope preparation: ${JSON.stringify(patch)}`, () => {
    assert.throws(() => copyAttemptScope({ ...continuationScope, ...patch }), {
      code: "ATTEMPT_SCOPE_INVALID",
    });
  });
for (const patch of [
  { issued_at: "2026-10-11T17:27:59.999Z" },
  { issued_at: "2026-10-11T19:29:00.000Z" },
  { conversation_id: conversation },
  { conversation_ownership_matches: false },
])
  test(`continuation denies changed identity before child reads: ${JSON.stringify(patch)}`, async () => {
    let calls = 0;
    await assert.rejects(
      collectWidgetAttempt(
        async (sql) => {
          calls++;
          if (sql === ownerSelectionSql) return [selection()];
          assert.equal(sql, progressSessionSql);
          return [
            { ...session(), conversation_id: continuationReadBoundary.conversation, ...patch },
          ];
        },
        () => assert.fail("no report expected"),
        continuationScope,
      ),
      { code: "ATTEMPT_SESSION_SCOPE_INVALID" },
    );
    assert.equal(calls, 2);
  });

test("old migration provenance stops before any diagnostic execution", async () => {
  const value = worker();
  value.template.containers[0].env.find(
    (entry) => entry.name === "DEPLOYMENT_MIGRATION_HEAD",
  ).value = "0031_s22_widget_inbound_route_management";
  const f = await fixture(value);
  await assert.rejects(runProgress(f.overrides), { code: "PROVENANCE_MISMATCH" });
  assert.ok(!f.calls.some((args) => args.includes("execute")));
});
test("scope/owner guard is required when collecting execution logs", async () => {
  const rows = await fixtureRows();
  assert.equal(collectAttemptLogs(rows, scope).length, 10);
  rows.at(-1).jsonPayload.observed.owner_selection_matches = false;
  assert.throws(
    () => collectAttemptLogs(rows, scope),
    (error) => error.code === "LOG_METADATA_INVALID",
  );
});
test("one exact read execution, no HTTP candidate scan, provider call or job update", async () => {
  const f = await fixture();
  const result = await runProgress(f.overrides);
  assert.equal(result.rows.length, 10);
  assert.deepEqual(result.http, []);
  const executions = f.calls.filter((args) => args.includes("execute"));
  assert.equal(executions.length, 1);
  assert.ok(!f.calls.some((args) => args.includes("update") || args.includes("deploy")));
  const variables = executions[0].find((value) => value.startsWith("--update-env-vars="));
  assert.match(variables, /S22_WIDGET_ATTEMPT_READ=progress/u);
  const payload = gunzipSync(
    Buffer.from(/S22_BOOKING_READ_B64=([^~]+)/u.exec(variables)[1], "base64"),
  ).toString("utf8");
  assert.ok(payload.endsWith(`await runReadOnlyWidgetAttempt(${JSON.stringify(scope)});\n`));
  assert.ok(
    f.requests.every(
      ({ url, options }) =>
        url.startsWith("https://logging.googleapis.com/") ||
        (url.startsWith("https://run.googleapis.com/") && options.method === "GET"),
    ),
  );
  assert.ok(
    f.requests
      .filter(({ options }) => options.body)
      .every(({ options }) => JSON.parse(options.body).filter.includes(attemptOperation)),
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN_FIXTURE/u);
});
test("wrong current image stops before creating any diagnostic execution", async () => {
  const value = worker();
  value.template.containers[0].image = runtime.image;
  const f = await fixture(value);
  await assert.rejects(
    runProgress(f.overrides),
    (error) => error.code === "WORKER_SCOPE_OR_IMAGE_MISMATCH",
  );
  assert.ok(!f.calls.some((args) => args.includes("execute")));
});

for (const boundary of ["authenticated_logging", "worker_metadata"])
  test(`permission denial identifies ${boundary} without executing a job`, async () => {
    const f = await fixture();
    const original = f.overrides.fetch;
    f.overrides.fetch = (url, options) =>
      url.includes(boundary === "authenticated_logging" ? "logging.googleapis.com" : "workerPools")
        ? Promise.resolve(new Response("PRIVATE_PERMISSION_DETAIL", { status: 403 }))
        : original(url, options);
    await assert.rejects(runProgress(f.overrides), {
      code: "CLOUD_READ_PERMISSION_UNAVAILABLE",
      readBoundary: boundary,
    });
    assert.ok(!f.calls.some((args) => args.includes("execute")));
  });
for (const boundary of [
  "cloud_authentication",
  "job_metadata",
  "diagnostic_execution",
  "execution_metadata",
])
  test(`actual progress CLI preserves sanitized ${boundary} evidence and never retries`, () => {
    const directory = mkdtempSync(join(tmpdir(), "s22-progress-cloud-failure-"));
    const preload = join(directory, "controlled-preload.mjs");
    const execution = "lead-agent-staging-migrator-controlled";
    try {
      writeFileSync(
        preload,
        `
        import assert from "node:assert/strict";
        import childProcess from "node:child_process";
        import {syncBuiltinESMExports} from "node:module";
        import {promisify} from "node:util";
        const failedBoundary=${JSON.stringify(boundary)};
        let auth=0, metadata=0, executed=0, polls=0, logs=0;
        const fail=()=>{throw Object.assign(new Error("PRIVATE_CLI_FAILURE"),{killed:true,stderr:"PRIVATE_CLI_FAILURE",stdout:"PRIVATE_CLI_FAILURE"});};
        const controlledExec=()=>{throw Error("UNEXPECTED_PROCESS");};
        controlledExec[promisify.custom]=async(file,args,options)=>{
          assert.equal(file,"gcloud");assert.equal(options.timeout,30000);assert.equal(options.maxBuffer,262144);
          if(args[0]==="auth"){
            auth++;assert.deepEqual(args,["auth","print-access-token","--quiet"]);
            if(failedBoundary==="cloud_authentication")fail();
            return {stdout:"PRIVATE_CLI_FAILURE\\n"};
          }
          if(args.slice(0,3).join(" ")==="run jobs describe"){
            metadata++;if(failedBoundary==="job_metadata")fail();
            return {stdout:JSON.stringify(${JSON.stringify(job())})};
          }
          if(args.slice(0,3).join(" ")==="run jobs execute"){
            executed++;assert.ok(args.includes("--tasks=1"));assert.ok(args.includes("--task-timeout=65s"));
            if(failedBoundary==="diagnostic_execution")fail();
            return {stdout:${JSON.stringify(execution)}};
          }
          if(args.slice(0,4).join(" ")==="run jobs executions describe"){
            polls++;assert.equal(args[4],${JSON.stringify(execution)});fail();
          }
          throw Error("UNEXPECTED_PROCESS");
        };
        childProcess.execFile=controlledExec;syncBuiltinESMExports();
        globalThis.fetch=async(url,options)=>{
          assert.equal(options.headers.Authorization,"Bearer PRIVATE_CLI_FAILURE");
          if(url.includes("/workerPools/"))return Response.json(${JSON.stringify(worker())});
          assert.equal(url,"https://logging.googleapis.com/v2/entries:list");logs++;
          return Response.json({entries:[]});
        };
        process.on("exit",()=>{
          assert.equal(auth,1);assert.equal(metadata,failedBoundary==="cloud_authentication"?0:1);
          assert.equal(executed,["diagnostic_execution","execution_metadata"].includes(failedBoundary)?1:0);
          assert.equal(polls,failedBoundary==="execution_metadata"?1:0);
          assert.equal(logs,["diagnostic_execution","execution_metadata"].includes(failedBoundary)?1:0);
        });
      `,
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          fileURLToPath(new URL("./s22-widget-progress.mjs", import.meta.url)),
        ],
        { cwd: directory, encoding: "utf8", timeout: 5000 },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, new RegExp(`Read boundary: ${boundary}`, "u"));
      assert.match(result.stdout, /Failure category: timeout/u);
      assert.doesNotMatch(result.stdout, /PRIVATE_CLI_FAILURE/u);
      const code =
        boundary === "diagnostic_execution"
          ? "EXECUTION_ID_UNAVAILABLE_NO_RERUN"
          : "CLOUD_ACCESS_UNAVAILABLE";
      assert.deepEqual(
        JSON.parse(readFileSync(join(directory, "s22-widget-progress.json"), "utf8")),
        {
          outcome: "BLOCKED",
          runtime_source: runtime.source,
          session: scope.session,
          provider_calls_triggered: 0,
          session_mutations: 0,
          migration_execution: false,
          job_configuration_changed: false,
          code,
          read_boundary: boundary,
          failure_category: "timeout",
          ...(boundary === "execution_metadata" ? { execution } : {}),
        },
      );
      if (boundary === "execution_metadata")
        assert.match(
          result.stdout,
          /Preserved execution: lead-agent-staging-migrator-controlled; do not rerun blindly\./u,
        );
      else assert.doesNotMatch(result.stdout, /Read-only execution:|Preserved execution:/u);
    } finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith("s22-progress-cloud-failure-"));
      rmSync(directory, { recursive: true, force: true });
    }
  });

test("read-only workflow is separate from Terraform and requires exact approved branch/tooling", () => {
  const text = readFileSync(new URL("../workflows/staging-terraform.yml", import.meta.url), "utf8");
  const segment = text.split("  widget-evidence:\n")[1].split("  terraform:\n")[0];
  assert.match(segment, /"\$ACTION" == 'plan' && -z "\$APPROVAL_TOKEN"/u);
  assert.match(segment, /git merge-base --is-ancestor HEAD FETCH_HEAD/u);
  assert.match(segment, /run: node \.github\/scripts\/s22-widget-progress\.mjs/u);
  assert.match(text, /inputs.phase != 'widget-evidence'/u);
  assert.doesNotMatch(segment, /terraform apply|workflow run|jobs update|jobs deploy/u);
});
