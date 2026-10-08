import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  attemptAssertions,
  attemptForceRlsTableNames,
  attemptOperation,
  attemptScope,
} from "./s22-widget-attempt-readonly.mjs";
import {
  collectAttemptLogs,
  formatAttempt,
  moduleBootstrap,
  normalizeAttemptHttp,
  runAttempt,
} from "./s22-widget-attempt.mjs";
import { reviewedReadiness as pin } from "./s22-widget-readiness.mjs";

const timestamp = "2026-10-08T12:34:20Z";
const execution = "lead-agent-staging-migrator-fixture";
const privateFixture = "DO_NOT_PRINT_PRIVATE_FIXTURE_TOKEN";
const conversation = "01a11b7d-ddbf-759e-b4e3-1602d9e22380";
const inbound = "01a11b7d-ddbf-759e-b4e3-1602d9e22381";
const runId = "01a11b7d-ddbf-759e-b4e3-1602d9e22382";
const env = (extra = {}) =>
  Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: pin.source,
    DEPLOYMENT_TIMESTAMP: timestamp,
    DEPLOYMENT_MIGRATION_HEAD: pin.head,
    ...extra,
  }).map(([name, value]) => ({ name, value }));
const interfaces = [
  {
    network: `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
    subnetwork: `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
  },
];
const job = () => ({
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
                image: pin.image,
                command: ["node"],
                args: ["dist/index.js"],
                env: [
                  ...env({ DEPLOYMENT_IMAGE_DIGEST: pin.image }),
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
const worker = () => ({
  name: `projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker`,
  scaling: { manualInstanceCount: 1 },
  terminalCondition: { state: "CONDITION_SUCCEEDED" },
  template: {
    serviceAccount: `lead-agent-staging-worker@${pin.project}.iam.gserviceaccount.com`,
    vpcAccess: { egress: "PRIVATE_RANGES_ONLY", networkInterfaces: interfaces },
    containers: [
      {
        image: pin.worker,
        env: env({
          AI_JOURNEY_MODE: "widget_booking",
          AI_JOURNEY_WIDGET_SESSION_ID: attemptScope.session,
          AI_REQUEST_TIMEOUT_MS: "15000",
        }),
      },
    ],
  },
});
const session = (accepted = false) => ({
  session_id: attemptScope.session,
  channel_connection_id: attemptScope.channel,
  allowed_origin_id: attemptScope.origin,
  conversation_id: accepted ? conversation : null,
  conversation_status: accepted ? "open" : null,
  conversation_version: accepted ? "3" : null,
  automation_mode: accepted ? "ai" : null,
  no_active_handoff: accepted ? true : null,
  status: "active",
  version: accepted ? "3" : "2",
  issued_at: "2026-10-08T12:29:56.031Z",
  last_seen_at: "2026-10-08T12:29:57.129Z",
  expires_at: "2026-10-08T14:29:56.031Z",
  contact_unbound: !accepted,
  conversation_unbound: !accepted,
  not_revoked: true,
  channel_active: true,
  origin_active: true,
  absolute_valid: true,
  idle_valid: false,
  conversation_ownership_matches: true,
  observation_only: true,
});
const budget = (accepted = false) => ({
  profile: "s22-synthetic-booking.v1",
  mode: "widget_booking",
  physicalCalls: accepted ? 5 : 4,
  logicalMessages: accepted ? 5 : 4,
  knownCostMicros: accepted ? "10000" : "8714",
  unresolvedReserveMicros: "0",
  historicalReserveMicros: "1033396",
  combinedExposureMicros: accepted ? "1043396" : "1042110",
  perCallReserveMicros: "801432",
  accountingComplete: false,
  blocked: !accepted,
  reason: accepted ? null : "widget_session_unavailable",
  widget: {
    sessionId: attemptScope.session,
    conversationId: accepted ? conversation : null,
    physicalCalls: accepted ? 1 : 0,
    logicalMessages: accepted ? 1 : 0,
    customerMessages: accepted ? 1 : 0,
    knownCostMicros: accepted ? "1286" : "0",
    unresolvedReserveMicros: "0",
  },
});
const diagnosticEntries = (accepted = false) => {
  const observed = {
    runtime_read_only_tenant_guard: {
      runtime: true,
      staging_database: true,
      least_privilege: true,
      read_only: true,
      row_security: true,
      tenant_matches: true,
      collection_window_valid: true,
    },
    force_rls_not_owner_guard: { count: attemptForceRlsTableNames.length, safe: true },
    widget_attempt_session: session(accepted),
    cohort_reservation_accounting: budget(accepted),
    widget_attempt_collection: {
      windowStart: attemptScope.windowStart,
      windowEnd: attemptScope.windowEnd,
      conversation_id: accepted ? conversation : null,
      observation_only: true,
      no_message_or_call_triggered: true,
      historical_costs_not_reconciled: true,
    },
  };
  for (const assertion of attemptAssertions.filter((name) =>
    /widget_attempt_(messages|runs|actions|outbox|requests)$/u.test(name),
  ))
    observed[assertion] = {
      conversation_id: accepted ? conversation : null,
      windowStart: attemptScope.windowStart,
      windowEnd: attemptScope.windowEnd,
      query_state: accepted ? "COLLECTED" : "SKIPPED_UNBOUND_SESSION",
      rows: [],
      observation_only: true,
    };
  if (accepted) {
    observed.widget_attempt_messages.rows = [
      {
        id: inbound,
        direction: "inbound",
        sequence_no: "1",
        processing_status: "processed",
        delivery_status: "not_applicable",
        created_at: "2026-10-08T13:00:01.000Z",
      },
    ];
    observed.widget_attempt_runs.rows = [
      {
        id: runId,
        trigger_message_id: inbound,
        status: "succeeded",
        attempt_no: 1,
        schema_valid: true,
        policy_allowed: true,
        estimated_cost_micros: "1286",
        cost_currency: "USD",
        reservations: 1,
        reserved_micros: "801432",
        dispatch_authorized: "true",
        provider_id: "gemini",
        requested_model_id: "gemini-3.8-flash",
        provider_resolved_model_id: "gemini-3.8-flash",
        started_at: "2026-10-08T13:00:01.100Z",
        finished_at: "2026-10-08T13:00:02.000Z",
      },
    ];
  }
  return attemptAssertions.map((assertion) => ({
    jsonPayload: {
      operation: attemptOperation,
      assertion,
      outcome: "PASS",
      observed: observed[assertion],
    },
  }));
};
const http = (status = 400) => ({
  timestamp: "2026-10-08T13:00:00.000Z",
  resource: { labels: { service_name: "lead-agent-staging-api" } },
  httpRequest: {
    requestMethod: "POST",
    requestUrl: `https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/v1/widget/conversations?token=${privateFixture}`,
    status,
    latency: "0.050s",
  },
  jsonPayload: { body: privateFixture, cookie: privateFixture },
});

const fixture = (changes = {}) => {
  const calls = [],
    requests = [];
  let time = Date.parse("2026-10-08T13:02:00Z"),
    executed = false;
  const overrides = {
    now: () => time,
    wait: async (milliseconds) => {
      time += milliseconds;
    },
    cloud: async (args, timeout) => {
      calls.push({ args, timeout });
      if (args.includes("print-access-token")) return privateFixture;
      if (args.includes("execute")) {
        executed = true;
        return execution;
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(job());
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("workerPools")) return Response.json(worker());
      const body = JSON.parse(options.body);
      return Response.json({
        entries: body.filter.includes(attemptOperation)
          ? executed
            ? diagnosticEntries()
            : []
          : [http()],
      });
    },
    ...changes,
  };
  return { overrides, calls, requests };
};

test("attempt collection is observation-only when an exact expired session is still unbound", () => {
  const rows = collectAttemptLogs(diagnosticEntries());
  assert.equal(rows.length, attemptAssertions.length);
  assert.equal(
    rows.find((row) => row.assertion === "widget_attempt_session").observed.idle_valid,
    false,
  );
  assert.equal(
    rows.find((row) => row.assertion === "cohort_reservation_accounting").observed.blocked,
    true,
  );
  assert.equal(
    rows.find((row) => row.assertion === "widget_attempt_messages").observed.query_state,
    "SKIPPED_UNBOUND_SESSION",
  );
  assert.doesNotMatch(JSON.stringify(rows), /first_message_readiness|ready":true/u);
});

test("attempt collector requires all ten assertions and safe runtime/FORCE-RLS guards", () => {
  assert.throws(() => collectAttemptLogs(diagnosticEntries().slice(1)));
  for (const name of ["runtime_read_only_tenant_guard", "force_rls_not_owner_guard"]) {
    const values = diagnosticEntries();
    values.find((row) => row.jsonPayload.assertion === name).jsonPayload.outcome = "FAIL";
    assert.throws(() => collectAttemptLogs(values));
  }
});

for (const [name, change] of [
  ["omitted zero retries", (value) => delete value.spec.template.spec.template.spec.maxRetries],
  [
    "nonzero retries",
    (value) => {
      value.spec.template.spec.template.spec.maxRetries = 1;
    },
  ],
  [
    "wrong image",
    (value) => {
      value.spec.template.spec.template.spec.containers[0].image = "old";
    },
  ],
  [
    "wrong timestamp",
    (value) => {
      value.spec.template.spec.template.spec.containers[0].env.find(
        (row) => row.name === "DEPLOYMENT_TIMESTAMP",
      ).value = pin.timestamp;
    },
  ],
  [
    "migration secret",
    (value) => {
      value.spec.template.spec.template.spec.containers[0].env.at(-1).valueFrom.secretKeyRef.name =
        "migration-database-url";
    },
  ],
  [
    "public egress",
    (value) => {
      value.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] =
        "all-traffic";
    },
  ],
])
  test(`attempt preflight rejects ${name} before executing any job`, async () => {
    let executions = 0;
    const value = job();
    change(value);
    const f = fixture({
      cloud: async (args) => {
        if (args.includes("execute")) executions++;
        return args.includes("print-access-token") ? privateFixture : JSON.stringify(value);
      },
    });
    await assert.rejects(runAttempt(f.overrides));
    assert.equal(executions, 0);
  });

for (const status of [401, 403, 503])
  test(`attempt verifies log read ${status} before creating any execution`, async () => {
    const f = fixture({
      fetch: async (url) =>
        url.includes("workerPools")
          ? Response.json(worker())
          : new Response(privateFixture, { status }),
    });
    await assert.rejects(runAttempt(f.overrides));
    assert.equal(f.calls.filter(({ args }) => args.includes("execute")).length, 0);
  });

test("one diagnostic execution uses exact ESM stdin, a finite timeout and no job mutations", async () => {
  const f = fixture();
  const result = await runAttempt(f.overrides);
  const commands = f.calls.map(({ args }) => args);
  const execute = commands.filter((args) => args.includes("execute"));
  assert.equal(execute.length, 1);
  assert.ok(execute[0].includes(`--args=^~^--input-type=module~-e~${moduleBootstrap}`));
  assert.ok(execute[0].includes("--task-timeout=65s"));
  assert.ok(execute[0].includes("--tasks=1"));
  const environment = execute[0].find((arg) => arg.startsWith("--update-env-vars="));
  const payload = /S22_BOOKING_READ_B64=([^~]+)/u.exec(environment)?.[1];
  assert.equal(typeof payload, "string");
  assert.ok(payload.length < 32000);
  assert.deepEqual(
    gunzipSync(Buffer.from(payload, "base64")),
    readFileSync(new URL("./s22-widget-attempt-readonly.mjs", import.meta.url)),
  );
  assert.match(environment, /S22_WIDGET_ATTEMPT_READ=execute/u);
  assert.match(environment, /S22_WIDGET_ATTEMPT_STARTED_AT=2026-10-08T13:02:00\.000Z/u);
  assert.equal(
    commands.some((args) =>
      args.some((value) => ["update", "deploy", "delete", "create"].includes(value)),
    ),
    false,
  );
  assert.equal(result.execution, execution);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFixture, "u"));
  assert.doesNotMatch(JSON.stringify(formatAttempt(result)), /first-message preparation: PASS/u);
});

test("HTTP metadata is sanitized without query, tokens, message bodies or account details", () => {
  const normalized = normalizeAttemptHttp([
    http(),
    { ...http(), httpRequest: { ...http().httpRequest, requestMethod: "PUT" } },
  ]);
  assert.doesNotMatch(
    JSON.stringify(normalized),
    /private\.invalid|DO_NOT_PRINT|requestUrl|cookie|body|token=/u,
  );
  assert.match(JSON.stringify(normalized), /POST|400/u);
});

test("a successful HTTP candidate is not proof of message persistence or provider dispatch", async () => {
  let executed = false;
  const f = fixture({
    cloud: async (args) => {
      if (args.includes("print-access-token")) return privateFixture;
      if (args.includes("execute")) {
        executed = true;
        return execution;
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(job());
    },
    fetch: async (url, options) => {
      if (url.includes("workerPools")) return Response.json(worker());
      const body = JSON.parse(options.body);
      return Response.json({
        entries: body.filter.includes(attemptOperation)
          ? executed
            ? diagnosticEntries()
            : []
          : [http(201)],
      });
    },
  });
  const result = await runAttempt(f.overrides);
  assert.equal(result.http[0].status, 201);
  assert.equal(
    result.rows.find((row) => row.assertion === "widget_attempt_session").observed.conversation_id,
    null,
  );
  assert.match(formatAttempt(result).join("\n"), /not customer E2E|session is unbound/u);
  assert.doesNotMatch(
    formatAttempt(result).join("\n"),
    /generation: PASS|delivery: PASS|Booking.*PASS/u,
  );
});

test("persisted inbound and completed provider run still report absent outbound separately", () => {
  const result = {
    execution,
    rows: collectAttemptLogs(diagnosticEntries(true)),
    http: normalizeAttemptHttp([http(201)]),
    reader_sha256: "0".repeat(64),
  };
  const lines = formatAttempt(result).join("\n");
  assert.match(lines, /Persisted inbound\/outbound in attempt window: 1\/0/u);
  assert.match(lines, /AI run .*succeeded/u);
  assert.match(lines, /Persisted outbox rows \/ appointment requests in window: 0\/0/u);
  assert.doesNotMatch(lines, /generation: PASS|delivery: PASS|Booking.*PASS/u);
});

test("HTTP candidates exclude other origins, paths, methods, services and windows", () => {
  const candidate = http();
  const invalid = [
    {
      ...candidate,
      httpRequest: {
        ...candidate.httpRequest,
        requestUrl: "https://foreign.invalid/v1/widget/conversations",
      },
    },
    {
      ...candidate,
      httpRequest: {
        ...candidate.httpRequest,
        requestUrl: "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/v1/admin?token=PRIVATE",
      },
    },
    {
      ...candidate,
      httpRequest: {
        ...candidate.httpRequest,
        requestUrl:
          "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app/v1/widget/conversations/not-a-uuid/messages",
      },
    },
    { ...candidate, httpRequest: { ...candidate.httpRequest, requestMethod: "PUT" } },
    { ...candidate, resource: { labels: { service_name: "other-service" } } },
    { ...candidate, timestamp: attemptScope.windowEnd },
    { ...candidate, timestamp: "2026-10-08T12:57:59.999Z" },
  ];
  assert.deepEqual(normalizeAttemptHttp(invalid), []);
  assert.throws(() => normalizeAttemptHttp(Array.from({ length: 41 }, () => candidate)));
});

test("allowlisted diagnostic projection excludes credentials, bodies and arbitrary audit metadata", () => {
  const values = diagnosticEntries(true);
  for (const entry of values) {
    entry.jsonPayload.observed.credentials = privateFixture;
    entry.jsonPayload.observed.body_text = privateFixture;
    entry.jsonPayload.observed.metadata_redacted_jsonb = { token: privateFixture };
  }
  values.find(
    (entry) => entry.jsonPayload.assertion === "widget_attempt_messages",
  ).jsonPayload.observed.rows[0].body_text = privateFixture;
  assert.doesNotMatch(
    JSON.stringify(collectAttemptLogs(values)),
    /DO_NOT_PRINT|body_text|credentials|metadata_redacted_jsonb/u,
  );
});

test("blocked diagnostic preserves the allowlisted stage, failure code and SQLSTATE only", () => {
  assert.throws(
    () =>
      collectAttemptLogs([
        {
          jsonPayload: {
            operation: attemptOperation,
            assertion: "runtime_read_only_tenant_guard",
            outcome: "BLOCKED",
            code: "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED",
            sqlstate: "42703",
            detail: privateFixture,
            message: privateFixture,
            credentials: privateFixture,
          },
        },
      ]),
    (error) => {
      assert.equal(error.code, "READ_ONLY_DIAGNOSTIC_BLOCKED");
      assert.equal(error.assertion, "runtime_read_only_tenant_guard");
      assert.equal(error.diagnosticCode, "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED");
      assert.equal(error.sqlstate, "42703");
      assert.doesNotMatch(
        JSON.stringify(error) + error.message,
        /DO_NOT_PRINT|credentials|detail/u,
      );
      return true;
    },
  );
});

test("blocked diagnostic omits arbitrary failure stage, SQLSTATE and private error detail", () => {
  assert.throws(
    () =>
      collectAttemptLogs([
        {
          jsonPayload: {
            operation: attemptOperation,
            assertion: privateFixture,
            outcome: "BLOCKED",
            code: privateFixture,
            sqlstate: privateFixture,
            detail: privateFixture,
            message: privateFixture,
          },
        },
      ]),
    (error) => {
      assert.equal(error.code, "READ_ONLY_DIAGNOSTIC_BLOCKED");
      assert.equal(error.assertion, "collection");
      assert.notEqual(error.diagnosticCode, privateFixture);
      assert.equal(error.sqlstate, null);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /DO_NOT_PRINT|detail/u);
      return true;
    },
  );
});

test("blocked diagnostic preserves the safe early package-resolution stage", () => {
  assert.throws(
    () =>
      collectAttemptLogs([
        {
          jsonPayload: {
            operation: attemptOperation,
            assertion: "package_resolution",
            outcome: "BLOCKED",
            code: "DATABASE_OR_TOOLING_UNAVAILABLE",
            message: privateFixture,
          },
        },
      ]),
    (error) => {
      assert.equal(error.code, "READ_ONLY_DIAGNOSTIC_BLOCKED");
      assert.equal(error.assertion, "package_resolution");
      assert.equal(error.diagnosticCode, "DATABASE_OR_TOOLING_UNAVAILABLE");
      assert.doesNotMatch(JSON.stringify(error) + error.message, /DO_NOT_PRINT/u);
      return true;
    },
  );
});

test("accepted-path output separates sanitized policy, application and outbox failure metadata", () => {
  const entries = diagnosticEntries(true);
  const find = (name) =>
    entries.find((entry) => entry.jsonPayload.assertion === name).jsonPayload.observed;
  const run = find("widget_attempt_runs").rows[0];
  run.correlation_id = "01a11b7d-ddbf-759e-b4e3-1602d9e22383";
  run.status = "policy_denied";
  run.policy_allowed = false;
  run.failure_category = "untrusted_citation";
  find("widget_attempt_actions").rows = [
    {
      id: "01a11b7d-ddbf-759e-b4e3-1602d9e22384",
      ai_run_id: runId,
      action_name: "create_appointment_request",
      validation_status: "denied",
      policy_reason_code: "untrusted_citation",
      application_status: "not_applied",
      target_aggregate_type: "conversation",
      target_aggregate_id: conversation,
      body_text: privateFixture,
      metadata_redacted_jsonb: { token: privateFixture },
    },
  ];
  find("widget_attempt_outbox").rows = [
    {
      id: "01a11b7d-ddbf-759e-b4e3-1602d9e22385",
      event_type: "message.response_queued",
      aggregate_type: "conversation",
      aggregate_id: conversation,
      status: "pending",
      attempt_count: 2,
      last_error_category: "provider_timeout",
      correlation_id: run.correlation_id,
      provider_payload: privateFixture,
    },
  ];
  const result = {
    execution,
    rows: collectAttemptLogs(entries),
    http: [],
    reader_sha256: "0".repeat(64),
  };
  const printed = formatAttempt(result).join("\n");
  assert.match(printed, /open.*3.*ai/u);
  assert.match(printed, /01a11b7d-ddbf-759e-b4e3-1602d9e22383/u);
  assert.match(printed, /create_appointment_request/u);
  assert.match(printed, /untrusted_citation/u);
  assert.match(printed, /not_applied/u);
  assert.match(printed, /message\.response_queued.*pending/u);
  assert.match(printed, /provider_timeout/u);
  assert.match(printed, /Persisted inbound\/outbound in attempt window: 1\/0/u);
  assert.doesNotMatch(printed, /DO_NOT_PRINT|body_text|metadata_redacted_jsonb|provider_payload/u);
  assert.doesNotMatch(printed, /generation: PASS|delivery: PASS|Booking.*PASS/u);
});

test("missing completed-execution evidence never causes a second execution", async () => {
  let executed = false;
  const f = fixture({
    cloud: async (args) => {
      if (args.includes("print-access-token")) return privateFixture;
      if (args.includes("execute")) {
        assert.equal(executed, false);
        executed = true;
        return execution;
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(job());
    },
    fetch: async (url) =>
      url.includes("workerPools") ? Response.json(worker()) : Response.json({ entries: [] }),
  });
  await assert.rejects(
    runAttempt(f.overrides),
    (error) => error.code === "LOG_ASSERTIONS_INCOMPLETE" && error.execution === execution,
  );
  assert.equal(executed, true);
});

test("timeout preserves the announced execution and does not retry the diagnostic", async () => {
  let executed = 0,
    preserved;
  const f = fixture({
    cloud: async (args) => {
      if (args.includes("print-access-token")) return privateFixture;
      if (args.includes("execute")) {
        executed++;
        return execution;
      }
      if (args.includes("executions")) return JSON.stringify({ status: { conditions: [] } });
      return JSON.stringify(job());
    },
    onExecution: (name) => {
      preserved = name;
    },
  });
  await assert.rejects(
    runAttempt(f.overrides),
    (error) => error.code === "EXECUTION_WINDOW_ELAPSED_NO_RERUN" && error.execution === execution,
  );
  assert.equal(executed, 1);
  assert.equal(preserved, execution);
});
