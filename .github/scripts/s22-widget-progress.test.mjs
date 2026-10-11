import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import {
  progressScope as scope,
  progressRuntime as runtime,
  runProgress,
} from "./s22-widget-progress.mjs";
import { collectAttemptLogs } from "./s22-widget-attempt.mjs";
import {
  attemptOperation,
  attemptSessionSql,
  attemptQueries,
  attemptForceRlsTableNames,
  collectWidgetAttempt,
  copyAttemptScope,
  ownerSelectionSql,
  verifyOwnerSelection,
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
  issued_at: "2026-10-11T08:12:20.000Z",
  last_seen_at: "2026-10-11T08:25:00.000Z",
  expires_at: "2026-10-11T10:12:20.000Z",
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
      sql === ownerSelectionSql ? [selection()] : sql === attemptSessionSql ? [session()] : [],
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
    DEPLOYMENT_MIGRATION_HEAD: "0031_s22_widget_inbound_route_management",
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
    time = Date.parse("2026-10-11T10:45:00Z");
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
  assert.equal(runtime.source, "68b3011d26afe1bbb8ef0a32c4efd8f66df7c819");
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
      if (sql === attemptSessionSql) return [session()];
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
test("read-only workflow is separate from Terraform and requires exact approved branch/tooling", () => {
  const text = readFileSync(new URL("../workflows/staging-terraform.yml", import.meta.url), "utf8");
  const segment = text.split("  widget-evidence:\n")[1].split("  terraform:\n")[0];
  assert.match(segment, /"\$ACTION" == 'plan' && -z "\$APPROVAL_TOKEN"/u);
  assert.match(segment, /git merge-base --is-ancestor HEAD FETCH_HEAD/u);
  assert.match(segment, /run: node \.github\/scripts\/s22-widget-progress\.mjs/u);
  assert.match(text, /inputs.phase != 'widget-evidence'/u);
  assert.doesNotMatch(segment, /terraform apply|workflow run|jobs update|jobs deploy/u);
});
