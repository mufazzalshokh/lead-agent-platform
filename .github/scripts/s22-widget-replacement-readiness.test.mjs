import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  replacementRuntime,
  prepareReplacementReadiness,
  runReplacementReadiness,
} from "./s22-widget-replacement-readiness.mjs";
import {
  readinessForceRlsTableNames,
  readinessOperation,
  readinessScope,
} from "./s22-widget-readiness-readonly.mjs";
import { moduleBootstrap, reviewedReadiness } from "./s22-widget-readiness.mjs";

const session = "01a11c00-abcd-7123-8b01-0123456789ab";
const oldTimestamp = "2026-10-08T15:08:01Z";
const pin = reviewedReadiness;
const network = [
  {
    network: `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
    subnetwork: `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
  },
];
const environment = (timestamp, extra = {}) =>
  Object.entries({
    DEPLOYMENT_ENVIRONMENT: "staging",
    DEPLOYMENT_GIT_SHA: replacementRuntime.source,
    DEPLOYMENT_TIMESTAMP: timestamp,
    DEPLOYMENT_MIGRATION_HEAD: pin.head,
    ...extra,
  }).map(([name, value]) => ({ name, value }));
const worker = (timestamp = replacementRuntime.timestamp) => ({
  name: `projects/${pin.project}/locations/${pin.region}/workerPools/lead-agent-staging-worker`,
  scaling: { manualInstanceCount: 1 },
  terminalCondition: { state: "CONDITION_SUCCEEDED" },
  template: {
    serviceAccount: `lead-agent-staging-worker@${pin.project}.iam.gserviceaccount.com`,
    vpcAccess: { egress: "PRIVATE_RANGES_ONLY", networkInterfaces: network },
    containers: [
      {
        image: replacementRuntime.worker,
        env: environment(timestamp, {
          AI_JOURNEY_MODE: "widget_booking",
          AI_JOURNEY_WIDGET_SESSION_ID: session,
          AI_REQUEST_TIMEOUT_MS: "15000",
        }),
      },
    ],
  },
});
const job = (timestamp = replacementRuntime.timestamp) => ({
  metadata: { name: pin.job, labels: { "cloud.googleapis.com/location": pin.region } },
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
            serviceAccountName: `lead-agent-staging-migrator@${pin.project}.iam.gserviceaccount.com`,
            containers: [
              {
                image: replacementRuntime.image,
                command: ["node"],
                args: ["dist/index.js"],
                env: [
                  ...environment(timestamp, { DEPLOYMENT_IMAGE_DIGEST: replacementRuntime.image }),
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
const entries = () =>
  [
    [
      "runtime_read_only_tenant_guard",
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
    ["force_rls_not_owner_guard", { count: readinessForceRlsTableNames.length, safe: true }],
    [
      "exact_widget_session",
      {
        session_id: session,
        channel_connection_id: readinessScope.channel,
        allowed_origin_id: readinessScope.origin,
        row_count: 1,
        status: "active",
        version: "2",
        issued_at: "2026-10-08T16:49:00.000Z",
        last_seen_at: "2026-10-08T16:49:01.000Z",
        expires_at: "2026-10-08T18:49:00.000Z",
        contact_unbound: true,
        conversation_unbound: true,
        not_revoked: true,
        channel_active: true,
        origin_active: true,
        absolute_valid: true,
        idle_valid: true,
        scope_matches: true,
      },
    ],
    [
      "cohort_reservation_accounting",
      {
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
          sessionId: session,
          conversationId: null,
          conversationUnbound: true,
          physicalCalls: 0,
          logicalMessages: 0,
          customerMessages: 0,
          knownCostMicros: "0",
          unresolvedReserveMicros: "0",
        },
      },
    ],
    [
      "first_message_readiness",
      {
        session_ready: true,
        budget_ready: true,
        ready: true,
        remaining_customer_messages: 2,
        remaining_physical_attempts: 4,
        no_message_or_call_triggered: true,
      },
    ],
  ].map(([assertion, observed]) => ({
    jsonPayload: { operation: readinessOperation, assertion, outcome: "PASS", observed },
  }));
const controlled = ({ workerMetadata = worker(), jobMetadata = job() } = {}) => {
  const calls = [];
  return {
    calls,
    observers: {
      now: () => Date.parse("2026-10-08T16:50:00Z"),
      wait: async () => {},
      cloud: async (args) => {
        calls.push(args);
        if (args[0] === "auth") return "controlled-not-a-live-token";
        if (args[2] === "describe") return JSON.stringify(jobMetadata);
        if (args[2] === "execute") return "lead-agent-staging-migrator-controlled";
        if (args[2] === "executions")
          return JSON.stringify({
            status: { conditions: [{ type: "Completed", status: "True" }] },
          });
        assert.fail("Unexpected command in controlled fixture");
      },
      fetch: async (url, init) => {
        if (url.includes("workerPools")) return Response.json(workerMetadata);
        assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
        const filter = JSON.parse(init.body).filter;
        return Response.json({ entries: filter.includes("execution_name") ? entries() : [] });
      },
    },
  };
};

test("replacement pins unchanged reviewed image/source and only the new prepared timestamp", () => {
  assert.equal(replacementRuntime.source, "1ecd729d856fdeff22a55cc54e1259c7adcf6472");
  assert.equal(replacementRuntime.timestamp, "2026-10-08T16:48:02Z");
  assert.match(
    replacementRuntime.worker,
    /@sha256:9bb77154a6057981b3fed82164defa222ff6b893a5fbe5563a4e06f9140ab381$/u,
  );
  assert.match(
    replacementRuntime.image,
    /@sha256:f4c6e5bdbf0e39a0fe6042e090b93ebaa21209a628bdc5cb889a49f8a03beace$/u,
  );
  assert.equal(Object.isFrozen(replacementRuntime), true);
  const inputs = prepareReplacementReadiness(["--session", session]);
  assert.equal(inputs.sessionId, session);
  assert.equal(inputs.deploymentTimestamp, replacementRuntime.timestamp);
  assert.equal(inputs.reviewedRuntime, replacementRuntime);
  assert.equal(Object.isFrozen(inputs), true);
});

for (const args of [
  [],
  ["--session"],
  ["--session", undefined],
  ["--session", "invalid"],
  ["--session", "01a11c00-abcd-4123-8b01-0123456789ab"],
  ["--session", "01a11b26-c51d-78ba-8e81-62e6e7331ab8"],
  ["--session", "01a11b7d-ddbf-759e-b4e3-1602d9e2238c"],
  ["--session", "01a11c48-dbc2-76de-a873-f41664da5ccb"],
  ["--source", replacementRuntime.source],
  ["--session", session, "--source", replacementRuntime.source],
  ["--session", session, "--deployment-timestamp", replacementRuntime.timestamp],
])
  test("malformed, expired or additional selectors reject before credentials/execution", async () => {
    let calls = 0;
    await assert.rejects(runReplacementReadiness(args, {}, async () => calls++));
    assert.equal(calls, 0);
  });

test("observers cannot override the immutable expectation packet", async () => {
  await runReplacementReadiness(
    ["--session", session],
    { sessionId: "foreign", deploymentTimestamp: "foreign", reviewedRuntime: {} },
    async (inputs) => {
      assert.equal(inputs.sessionId, session);
      assert.equal(inputs.deploymentTimestamp, replacementRuntime.timestamp);
      assert.equal(inputs.reviewedRuntime, replacementRuntime);
    },
  );
});

for (const changed of ["worker", "job"])
  test(`old ${changed} timestamp fails default runner before any diagnostic execution`, async () => {
    const fixture = controlled({
      workerMetadata: worker(changed === "worker" ? oldTimestamp : replacementRuntime.timestamp),
      jobMetadata: job(changed === "job" ? oldTimestamp : replacementRuntime.timestamp),
    });
    await assert.rejects(runReplacementReadiness(["--session", session], fixture.observers), {
      code: "PROVENANCE_MISMATCH",
    });
    assert.equal(
      fixture.calls.some((args) => args[2] === "execute"),
      false,
    );
  });

test("exact future metadata runs the existing default read-only path and reader/bootstrap without paid calls", async () => {
  const fixture = controlled();
  const result = await runReplacementReadiness(["--session", session], fixture.observers);
  assert.equal(result.ready, true);
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[3].observed.accountingComplete, false);
  const executions = fixture.calls.filter((args) => args[2] === "execute");
  assert.equal(executions.length, 1);
  const args = executions[0];
  assert.ok(args.includes(`--args=^~^--input-type=module~-e~${moduleBootstrap}`));
  assert.ok(args.includes("--tasks=1"));
  assert.ok(args.includes("--task-timeout=65s"));
  const reader = readFileSync(new URL("./s22-widget-readiness-readonly.mjs", import.meta.url));
  const variables = args.find((arg) => arg.startsWith("--update-env-vars="));
  assert.equal(
    variables,
    `--update-env-vars=^~^S22_BOOKING_READ_B64=${reader.toString("base64")}~S22_WIDGET_READINESS_READ=execute~S22_WIDGET_READINESS_STARTED_AT=2026-10-08T16:50:00.000Z~S22_WIDGET_READINESS_SESSION_ID=${session}`,
  );
  assert.equal(result.reader_sha256, createHash("sha256").update(reader).digest("hex"));
  assert.equal(
    result.reader_sha256,
    "7b45ff56c9bdf468a8ac7ace4159360f54428b818bb88140560567e4cd43a971",
  );
  assert.equal(
    fixture.calls.some((command) => command.includes("update")),
    false,
  );
});

for (const [name, change, code] of [
  [
    "missing retries",
    (value) => delete value.spec.template.spec.template.spec.maxRetries,
    "EXPLICIT_ZERO_RETRIES_REQUIRED",
  ],
  [
    "different identity",
    (value) => (value.spec.template.spec.template.spec.serviceAccountName = "foreign"),
    "DIAGNOSTIC_IDENTITY_MISMATCH",
  ],
  [
    "different VPC",
    (value) =>
      (value.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] =
        "all-traffic"),
    "DIAGNOSTIC_VPC_MISMATCH",
  ],
])
  test(`replacement default preflight preserves fail-closed ${name} guard`, async () => {
    const metadata = job();
    change(metadata);
    const fixture = controlled({ jobMetadata: metadata });
    await assert.rejects(runReplacementReadiness(["--session", session], fixture.observers), {
      code,
    });
    assert.equal(
      fixture.calls.some((args) => args[2] === "execute"),
      false,
    );
  });

for (const [name, args, code] of [
  [
    "expired scope",
    ["--session", "01a11c48-dbc2-76de-a873-f41664da5ccb"],
    "EXPIRED_SELECTION_REUSE_FORBIDDEN",
  ],
  ["unsupported selector", ["--source", replacementRuntime.source], "ENVIRONMENT_INVALID"],
])
  test(`actual CLI rejects ${name} before unavailable credential tools and emits no private data`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./s22-widget-replacement-readiness.mjs", import.meta.url)), ...args],
      { encoding: "utf8", timeout: 10000, env: { PATH: "" } },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim(), `BLOCKED: ${code}`);
    assert.equal(result.stderr, "");
  });
