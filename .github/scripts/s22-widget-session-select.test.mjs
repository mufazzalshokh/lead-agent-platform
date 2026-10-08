import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import test from "node:test";

import { moduleBootstrap as existingBootstrap } from "./s22-booking-evidence.mjs";
import {
  collectWidgetSessionSelection,
  parseSelectionScope,
  sanitizeSelectionFailure,
  selectionForceRlsSql,
  selectionForceRlsTableNames,
  selectionOperation,
  selectionOrganization,
} from "./s22-widget-session-select-readonly.mjs";
import {
  collectSelectionLogs,
  formatSelectionFailure,
  moduleBootstrap,
  parseSelectionArguments,
  prepareSelectionRecord,
  reviewedSelectionJob,
  runSelection,
  verifySelectionJob,
  writeSelectionFile,
} from "./s22-widget-session-select.mjs";

const origin =
  "https://8080-cs-11613c0c-52ca-4bf6-99e8-7891f5a57000.cs-europe-west4-bhnf.cloudshell.dev";
const scope = parseSelectionScope({
  origin,
  from: "2026-10-08T09:00:00.000Z",
  until: "2026-10-08T09:05:00.000Z",
});
const channel = "01a11000-0000-7000-8000-000000000001";
const allowedOrigin = "01a11000-0000-7000-8000-000000000002";
const sessionId = "01a11000-0000-7000-8000-000000000003";
const origins = [{ allowed_origin_id: allowedOrigin, channel_connection_id: channel }];
const selectedRow = () => ({
  session_id: sessionId,
  channel_connection_id: channel,
  allowed_origin_id: allowedOrigin,
  status: "active",
  version: "2",
  issued_at: new Date("2026-10-08T09:04:00.000Z"),
  last_seen_at: new Date("2026-10-08T09:04:00.500Z"),
  expires_at: new Date("2026-10-08T11:04:00.000Z"),
  contact_unbound: true,
  conversation_unbound: true,
  not_revoked: true,
  lifetime_valid: true,
});
const selectionRows = async (originRows = origins, rows = [selectedRow()]) => {
  const statements = [],
    reports = [];
  const result = await collectWidgetSessionSelection(
    async (text, values) => {
      statements.push({ text, values });
      assert.match(text.trimStart(), /^select /u);
      assert.match(text, /limit 2/u);
      assert.doesNotMatch(text, /ciphertext|token_jti|participant_lookup|body_text|password/iu);
      return text.includes("from widget_allowed_origins") ? originRows : rows;
    },
    scope,
    (assertion, observed) =>
      reports.push({ operation: selectionOperation, assertion, outcome: "PASS", observed }),
  );
  return { result, statements, reports };
};

test("selects one exact fresh unbound version-2 session with bounded parameterized metadata only", async () => {
  const row = selectedRow();
  row.secret_payload = "DO_NOT_PRINT_SYNTHETIC_SECRET";
  const { result, statements } = await selectionRows(origins, [row]);
  assert.equal(result.session_id, sessionId);
  assert.equal(result.version, "2");
  assert.match(result.redemption_evidence, /REQUIRES_OWNER_FRESH_FRAME/u);
  assert.deepEqual(statements[0].values, [scope.host, null]);
  assert.deepEqual(statements[1].values, [channel, allowedOrigin, scope.from, scope.until]);
  assert.match(statements[0].text, /o.organization_id=\$1/u);
  assert.match(statements[1].text, /s.organization_id=\$1/u);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_PRINT_SYNTHETIC_SECRET|secret_payload/u);
});

for (const [label, originRows, rows, code] of [
  ["inactive/missing exact origin", [], [selectedRow()], "EXACT_ORIGIN_NOT_ACTIVE"],
  ["ambiguous active origins", [...origins, ...origins], [selectedRow()], "EXACT_ORIGIN_AMBIGUOUS"],
  ["no fresh session", origins, [], "NO_FRESH_UNBOUND_SESSION"],
  ["ambiguous fresh sessions", origins, [selectedRow(), selectedRow()], "FRESH_SESSION_AMBIGUOUS"],
  [
    "unredeemed version 1",
    origins,
    [{ ...selectedRow(), version: "1" }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "touched version 3",
    origins,
    [{ ...selectedRow(), version: "3" }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "foreign channel",
    origins,
    [{ ...selectedRow(), channel_connection_id: sessionId }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "foreign allowed-origin record",
    origins,
    [{ ...selectedRow(), allowed_origin_id: sessionId }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "already bound contact",
    origins,
    [{ ...selectedRow(), contact_unbound: false }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "already bound conversation",
    origins,
    [{ ...selectedRow(), conversation_unbound: false }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "revoked session",
    origins,
    [{ ...selectedRow(), not_revoked: false }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "expired idle/absolute lifetime",
    origins,
    [{ ...selectedRow(), lifetime_valid: false }],
    "FRESH_SESSION_STATE_INVALID",
  ],
  [
    "outside fresh-open window",
    origins,
    [{ ...selectedRow(), issued_at: new Date("2026-10-08T08:59:59.000Z") }],
    "FRESH_SESSION_STATE_INVALID",
  ],
])
  test(`fails closed for ${label}`, async () => {
    await assert.rejects(selectionRows(originRows, rows), { code });
  });

test("scope rejects non-HTTPS, credentials, query/path, non-Cloud-Shell hosts and widened windows", () => {
  for (const invalid of [
    "http://host.cloudshell.dev",
    "https://user:password@host.cloudshell.dev",
    "https://host.cloudshell.dev/path",
    "https://host.cloudshell.dev?token=synthetic",
    "https://host.cloudshell.dev#fragment",
    "https://cloudshell.dev.attacker.invalid",
    "https://lead-agent-staging-web-uj7pjzpksq-ww.a.run.app",
  ])
    assert.throws(
      () => parseSelectionScope({ origin: invalid, from: scope.from, until: scope.until }),
      { code: "SELECTION_SCOPE_INVALID" },
    );
  assert.throws(
    () => parseSelectionScope({ origin, from: scope.from, until: "2026-10-08T09:06:00.000Z" }),
    { code: "SELECTION_SCOPE_INVALID" },
  );
  assert.throws(
    () =>
      parseSelectionScope({ origin, from: scope.from, until: scope.until, organization: "other" }),
    { code: "SELECTION_SCOPE_INVALID" },
  );
});

const jobMetadata = () => {
  const pin = reviewedSelectionJob;
  return {
    metadata: { name: pin.job, labels: { "cloud.googleapis.com/location": pin.region } },
    spec: {
      template: {
        metadata: {
          annotations: {
            "run.googleapis.com/vpc-access-egress": "private-ranges-only",
            "run.googleapis.com/network-interfaces": JSON.stringify([
              {
                network: `projects/${pin.project}/global/networks/lead-agent-staging-vpc`,
                subnetwork: `projects/${pin.project}/regions/${pin.region}/subnetworks/lead-agent-staging-cloud-run`,
              },
            ]),
          },
        },
        spec: {
          template: {
            spec: {
              serviceAccountName: `lead-agent-staging-migrator@${pin.project}.iam.gserviceaccount.com`,
              maxRetries: 0,
              containers: [
                {
                  image: pin.image,
                  command: ["node"],
                  args: ["dist/index.js"],
                  env: [
                    ...Object.entries({
                      DEPLOYMENT_ENVIRONMENT: "staging",
                      DEPLOYMENT_GIT_SHA: pin.source,
                      DEPLOYMENT_TIMESTAMP: pin.timestamp,
                      DEPLOYMENT_MIGRATION_HEAD: pin.head,
                      DEPLOYMENT_IMAGE_DIGEST: pin.image,
                    }).map(([name, value]) => ({ name, value })),
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
  };
};

test("preflight validates current exact image/provenance, runtime identity/reference, private VPC and explicit zero retries", () => {
  assert.equal(reviewedSelectionJob.source, "a2b2f708d2e804d2c3d2be66426fa7b49d8203c9");
  assert.equal(reviewedSelectionJob.timestamp, "2026-10-08T11:00:45Z");
  assert.match(
    reviewedSelectionJob.image,
    /@sha256:2aa2c94ef59b8becda3db9e731a2cd5e65b535a40b539b896b97486d67c80276$/u,
  );
  verifySelectionJob(jobMetadata());
  const badRetry = jobMetadata();
  delete badRetry.spec.template.spec.template.spec.maxRetries;
  assert.throws(() => verifySelectionJob(badRetry), { code: "EXPLICIT_ZERO_RETRIES_REQUIRED" });
  const badImage = jobMetadata();
  badImage.spec.template.spec.template.spec.containers[0].image = "old-image";
  assert.throws(() => verifySelectionJob(badImage), {
    code: "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH",
  });
  const badSecret = jobMetadata();
  badSecret.spec.template.spec.template.spec.containers[0].env.at(-1).valueFrom.secretKeyRef.name =
    "migration-database-url";
  assert.throws(() => verifySelectionJob(badSecret), { code: "RUNTIME_SECRET_REFERENCE_MISMATCH" });
  const badVpc = jobMetadata();
  badVpc.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] = "all-traffic";
  assert.throws(() => verifySelectionJob(badVpc), { code: "DIAGNOSTIC_VPC_MISMATCH" });
});

test("previous selector deployment is rejected by immutable image and provenance safeguards", () => {
  const previous = jobMetadata();
  previous.spec.template.spec.template.spec.containers[0].image =
    "me-central1-docker.pkg.dev/lead-agent-stg-739284/lead-agent/migrator@sha256:d60994941524aa00ecdd6859c3361f99e213cd0d113ea1753efd03c6caa0fa6f";
  assert.throws(() => verifySelectionJob(previous), {
    code: "DIAGNOSTIC_IMAGE_ENTRYPOINT_MISMATCH",
  });
  const previousSource = jobMetadata();
  previousSource.spec.template.spec.template.spec.containers[0].env.find(
    (entry) => entry.name === "DEPLOYMENT_GIT_SHA",
  ).value = "6a31cd8e3a37f31a7bb85329eab0aa9c4de53926";
  assert.throws(() => verifySelectionJob(previousSource), {
    code: "DIAGNOSTIC_PROVENANCE_MISMATCH",
  });
});

const completedLogs = async () => {
  const { reports } = await selectionRows();
  return [
    {
      operation: selectionOperation,
      assertion: "runtime_read_only_tenant_guard",
      outcome: "PASS",
      observed: { runtime: true },
    },
    {
      operation: selectionOperation,
      assertion: "force_rls_not_owner_guard",
      outcome: "PASS",
      observed: { count: 3, safe: true },
    },
    ...reports,
  ].map((jsonPayload) => ({ jsonPayload }));
};

const completeSelection = async () => ({
  execution: "lead-agent-staging-migrator-synthetic",
  source: reviewedSelectionJob.source,
  reader_sha256: "a".repeat(64),
  ...collectSelectionLogs(await completedLogs()),
});

test("optional output flag accepts only one new-file path and preserves existing origin-only invocation", () => {
  assert.deepEqual(parseSelectionArguments([origin]), { origin, selectionFile: undefined });
  assert.deepEqual(parseSelectionArguments([origin, "--write-selection", "selection.json"]), {
    origin,
    selectionFile: "selection.json",
  });
  assert.deepEqual(parseSelectionArguments([origin, "--preflight-only"]), {
    origin,
    selectionFile: undefined,
    preflightOnly: true,
  });
  for (const args of [
    [],
    [origin, "--write-selection"],
    [origin, "--unknown", "selection.json"],
    [origin, "--write-selection", "selection.json", "--write-selection", "another.json"],
    [origin, "--write-selection", ""],
    [origin, "--write-selection", "selection.json\nDO_NOT_PRINT"],
    [origin, "--write-selection", "--flag"],
    [origin, "--preflight-only", "--write-selection", "selection.json"],
    [origin, "--write-selection", "selection.json", "--preflight-only"],
    [origin, "--preflight-only", "--preflight-only"],
  ])
    assert.throws(() => parseSelectionArguments(args), { code: "SELECTION_SCOPE_INVALID" });
});

test("preflight-only checks actual job identity/provenance and authenticated log permission without reading or executing the reader", async () => {
  const calls = [],
    requests = [];
  const result = await runSelection(origin, {
    preflightOnly: true,
    now: () => Date.parse(scope.until),
    wait: async () => assert.fail("Preflight must not enter execution polling"),
    onExecution: () => assert.fail("Preflight must not create an execution"),
    cloud: async (args) => {
      calls.push(args);
      if (args.includes("print-access-token")) return "SYNTHETIC_PRIVATE_TOKEN";
      assert.ok(args.includes("describe"));
      assert.ok(!args.includes("executions") && !args.includes("execute"));
      return JSON.stringify(jobMetadata());
    },
    fetch: async (url, options) => {
      assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    },
  });
  assert.deepEqual(result, {
    preflight_only: true,
    ...reviewedSelectionJob,
    no_execution_triggered: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pageSize, 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_TOKEN|DATABASE_URL|bearer/u);
});

test("selection artifact contains only exact safe scope/provenance and actual idle deadline", async () => {
  const selected = await completeSelection();
  const record = prepareSelectionRecord(
    {
      ...selected,
      cookie: "DO_NOT_PRINT",
      body_text: "DO_NOT_PRINT",
      DATABASE_URL: "DO_NOT_PRINT",
    },
    origin,
    Date.parse(scope.until),
  );
  assert.equal(record.schema, "s22-widget-session-selection.v1");
  assert.equal(record.organization_id, selectionOrganization);
  assert.equal(record.origin, origin);
  assert.equal(record.source, reviewedSelectionJob.source);
  assert.equal(record.execution, selected.execution);
  assert.equal(record.session_id, selected.session_id);
  assert.equal(record.collected_at, scope.until);
  assert.equal(record.idle_deadline_at, "2026-10-08T09:34:00.500Z");
  assert.equal(record.expires_at, "2026-10-08T11:04:00.000Z");
  assert.doesNotMatch(JSON.stringify(record), /DO_NOT_PRINT|cookie|body_text|DATABASE_URL/u);
});

test("selection artifact fails closed at idle or absolute expiry and rejects forged scope/date/source", async () => {
  const selected = await completeSelection();
  for (const time of ["2026-10-08T09:34:00.500Z", "2026-10-08T11:04:00.000Z"])
    assert.throws(() => prepareSelectionRecord(selected, origin, Date.parse(time)), {
      code: "SELECTION_SNAPSHOT_EXPIRED",
    });
  assert.throws(
    () =>
      prepareSelectionRecord(
        { ...selected, expires_at: "2026-10-08T09:05:00.000Z" },
        origin,
        Date.parse(scope.until),
      ),
    { code: "SELECTION_SNAPSHOT_EXPIRED" },
  );
  for (const mutation of [
    { source: "6a31cd8e3a37f31a7bb85329eab0aa9c4de53926" },
    { session_id: "foreign" },
    { issued_at: "not-a-date" },
    { last_seen_at: "2026-10-08T09:03:00.000Z" },
    { last_seen_at: "2026-10-08T09:06:00.000Z" },
    { version: "3" },
    { contact_unbound: false },
  ])
    assert.throws(
      () => prepareSelectionRecord({ ...selected, ...mutation }, origin, Date.parse(scope.until)),
      { code: "LOG_SAFE_METADATA_INVALID" },
    );
  assert.throws(
    () => prepareSelectionRecord(selected, "https://attacker.invalid", Date.parse(scope.until)),
    { code: "SELECTION_SCOPE_INVALID" },
  );
});

test("selection file is exclusively created with owner-only permissions and never overwrites prior work", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "s22-widget-selection-file-"));
  try {
    const filename = join(fixture, "selection.json"),
      selected = await completeSelection();
    const record = await writeSelectionFile(filename, selected, origin, {
      now: () => Date.parse(scope.until),
    });
    assert.deepEqual(JSON.parse(readFileSync(filename, "utf8")), record);
    if (process.platform !== "win32") assert.equal(statSync(filename).mode & 0o777, 0o600);
    const original = readFileSync(filename, "utf8");
    await assert.rejects(
      writeSelectionFile(filename, selected, origin, { now: () => Date.parse(scope.until) }),
      { code: "SELECTION_FILE_EXISTS" },
    );
    assert.equal(readFileSync(filename, "utf8"), original);
  } finally {
    assert.equal(dirname(realpathSync(fixture)), realpathSync(tmpdir()));
    assert.ok(basename(fixture).startsWith("s22-widget-selection-file-"));
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("selection writer closes its exclusive handle even if writing fails and exposes no filesystem error details", async () => {
  let closed = false;
  await assert.rejects(
    writeSelectionFile("new-selection.json", await completeSelection(), origin, {
      now: () => Date.parse(scope.until),
      openFile: async (filename, flags, mode) => {
        assert.equal(filename, "new-selection.json");
        assert.equal(flags, "wx");
        assert.equal(mode, 0o600);
        return {
          writeFile: async () => {
            throw Object.assign(new Error("DO_NOT_PRINT"), { code: "DO_NOT_PRINT" });
          },
          close: async () => {
            closed = true;
          },
        };
      },
    }),
    (error) =>
      error.code === "SELECTION_FILE_WRITE_FAILED" && !error.message.includes("DO_NOT_PRINT"),
  );
  assert.equal(closed, true);
});

test("launcher proves log permission first, executes only one bounded reader, and sanitizes collected output", async () => {
  const calls = [],
    requests = [],
    logs = await completedLogs();
  const result = await runSelection(origin, {
    now: () => Date.parse(scope.until),
    wait: async () => {},
    cloud: async (args) => {
      calls.push(args);
      if (args.includes("print-access-token")) return "SYNTHETIC_PRIVATE_TOKEN";
      if (args.includes("execute")) {
        assert.equal(requests.length, 1, "Logging permission must be proven before execution");
        assert.ok(args.includes("--tasks=1"));
        assert.ok(args.includes("--task-timeout=65s"));
        return "lead-agent-staging-migrator-synthetic";
      }
      if (args.includes("executions"))
        return JSON.stringify({ status: { conditions: [{ type: "Completed", status: "True" }] } });
      return JSON.stringify(jobMetadata());
    },
    fetch: async (url, options) => {
      assert.equal(url, "https://logging.googleapis.com/v2/entries:list");
      assert.equal(options.redirect, "error");
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ entries: requests.length === 1 ? [] : logs }), {
        status: 200,
      });
    },
  });
  assert.equal(calls.filter((args) => args.includes("execute")).length, 1);
  assert.equal(result.session_id, sessionId);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE_TOKEN|DATABASE_URL|bearer/u);
  assert.match(requests[1].filter, /execution_name.*synthetic/u);
});

test("missing log permission stops before creating an execution or widening IAM", async () => {
  const calls = [];
  await assert.rejects(
    runSelection(origin, {
      now: () => Date.parse(scope.until),
      cloud: async (args) => {
        calls.push(args);
        return args.includes("print-access-token")
          ? "SYNTHETIC_PRIVATE_TOKEN"
          : JSON.stringify(jobMetadata());
      },
      fetch: async () => new Response("DO_NOT_PRINT", { status: 403 }),
    }),
    { code: "LOG_PERMISSION_UNAVAILABLE" },
  );
  assert.equal(
    calls.some((args) => args.includes("execute")),
    false,
  );
});

test("collector rejects missing/duplicate/failed assertions without dumping unexpected payloads", async () => {
  const logs = await completedLogs();
  assert.equal(collectSelectionLogs(logs).session_id, sessionId);
  assert.throws(() => collectSelectionLogs(logs.slice(1)), { code: "LOG_ASSERTIONS_NOT_COMPLETE" });
  assert.throws(() => collectSelectionLogs([...logs, logs[0]]), {
    code: "LOG_ASSERTIONS_NOT_COMPLETE",
  });
  assert.throws(
    () =>
      collectSelectionLogs([
        {
          jsonPayload: {
            operation: selectionOperation,
            assertion: "widget_session_selection",
            outcome: "BLOCKED",
            code: "FRESH_SESSION_AMBIGUOUS",
            unexpected_payload: "DO_NOT_PRINT",
          },
        },
      ]),
    { code: "FRESH_SESSION_AMBIGUOUS" },
  );
});

test("exact catalog guard types every bound parameter without changing the three-table requirement", () => {
  assert.deepEqual(selectionForceRlsTableNames, [
    "widget_sessions",
    "widget_allowed_origins",
    "channel_connections",
  ]);
  assert.equal(Object.isFrozen(selectionForceRlsTableNames), true);
  assert.match(selectionForceRlsSql, /c\.relname=any\(\$2::text\[\]\)/u);
  assert.match(selectionForceRlsSql, /and \$1::uuid is not null/u);
  assert.match(selectionForceRlsSql, /c\.relrowsecurity and c\.relforcerowsecurity/u);
  assert.match(selectionForceRlsSql, /c\.relowner<>/u);
});

test("finite failure details never copy messages, names, stacks or unknown codes", () => {
  const error = Object.assign(new Error("DO_NOT_PRINT_SECRET"), {
    code: "42P18",
    name: "DO_NOT_PRINT_NAME",
    stack: "DO_NOT_PRINT_STACK",
  });
  assert.deepEqual(sanitizeSelectionFailure(error, "force_rls_not_owner_guard"), {
    stage: "force_rls_not_owner_guard",
    sqlstate: "42P18",
    error_category: "database_sql",
  });
  assert.deepEqual(
    sanitizeSelectionFailure(
      { code: "DO_NOT_PRINT_SECRET", sqlstate: "ZZZZZ", error_category: "DO_NOT_PRINT_SECRET" },
      "DO_NOT_PRINT_SECRET",
    ),
    {},
  );
  for (const [code, expected] of [
    ["ERR_MODULE_NOT_FOUND", "module_resolution"],
    ["configuration_invalid", "configuration"],
    ["ECONNRESET", "database_transport"],
    ["FRESH_SESSION_AMBIGUOUS", "assertion"],
  ])
    assert.equal(sanitizeSelectionFailure({ code }, "initialize").error_category, expected);
});

test("launcher retains only allowlisted failure stage and SQLSTATE and prints readable safe diagnostics", () => {
  for (const sqlstate of ["42P18", "DO_NOT_PRINT_SECRET"]) {
    let failure;
    try {
      collectSelectionLogs([
        {
          jsonPayload: {
            operation: selectionOperation,
            assertion: "force_rls_not_owner_guard",
            stage: "force_rls_not_owner_guard",
            outcome: "BLOCKED",
            code: "DATABASE_OR_TOOLING_UNAVAILABLE",
            sqlstate,
            error_category: sqlstate === "42P18" ? "database_sql" : "DO_NOT_PRINT_SECRET",
            message: "DO_NOT_PRINT_SECRET",
            stack: "DO_NOT_PRINT_SECRET",
          },
        },
      ]);
      assert.fail("Failed assertion must not be accepted");
    } catch (error) {
      failure = error;
    }
    assert.equal(failure.code, "DATABASE_OR_TOOLING_UNAVAILABLE");
    assert.equal(failure.stage, "force_rls_not_owner_guard");
    const lines = formatSelectionFailure(failure);
    assert.deepEqual(lines, [
      "BLOCKED: DATABASE_OR_TOOLING_UNAVAILABLE",
      "Failure stage: force_rls_not_owner_guard",
      ...(sqlstate === "42P18" ? ["SQLSTATE: 42P18", "Error category: database_sql"] : []),
    ]);
    assert.doesNotMatch(JSON.stringify(failure) + lines.join("\n"), /DO_NOT_PRINT_SECRET/u);
  }
});

test("exact existing bootstrap executes actual reader with package/relative resolution, read-only rollback and cleanup", () => {
  assert.equal(moduleBootstrap, existingBootstrap);
  const fixture = mkdtempSync(join(tmpdir(), "s22-widget-selection-"));
  const packages = join(fixture, "node_modules", "@lead-agent");
  for (const name of ["config", "database"]) {
    mkdirSync(join(packages, name), { recursive: true });
    writeFileSync(
      join(packages, name, "package.json"),
      JSON.stringify({ name: `@lead-agent/${name}`, type: "module", exports: "./index.js" }),
    );
  }
  writeFileSync(
    join(packages, "config", "index.js"),
    `
    export const withLibpqCompatibleRequireSsl=v=>v;
    export const createTenantDatabaseRuntimeConfig=v=>{
      if(process.env.S22_FIXTURE_FAILURE==='configuration')throw Object.assign(Error('DO_NOT_PRINT_SECRET'),{code:'configuration_invalid'});
      const u=new URL(v.connectionString);
      if(!u.searchParams.get('options').includes('default_transaction_read_only=on')||v.maxConnections!==1||v.connectionTimeoutMilliseconds!==5000)throw Error('BAD_CONFIG');return v;
    };`,
  );
  writeFileSync(
    join(packages, "database", "index.js"),
    `
    export const createTenantDatabaseRuntime=()=>({verifyReady:async()=>{
      if(process.env.S22_FIXTURE_FAILURE==='readiness')throw Object.assign(Error('DO_NOT_PRINT_SECRET'),{code:'08006'});
    },
      withTenantTransaction:async(org,fn)=>{
        if(org!==${JSON.stringify(selectionOrganization)})throw Error('WRONG_TENANT');
        try{await fn({organizationId:org});throw Error('COMMIT_NOT_ALLOWED')}
        catch(error){console.log('FIXTURE_ROLLBACK');throw error}
      },close:async()=>{console.log('FIXTURE_CLOSED');if(process.env.S22_FIXTURE_FAILURE==='cleanup')throw Object.assign(Error('DO_NOT_PRINT_SECRET'),{code:'DO_NOT_PRINT_CODE'});}});`,
  );
  mkdirSync(join(packages, "database", "runtime"));
  writeFileSync(
    join(packages, "database", "runtime", "tenant.js"),
    `
    export const executeTenantQuery=async(session,build)=>{
      const q=build(session.organizationId), t=q.text;
      if(q.values[0]!==${JSON.stringify(selectionOrganization)}||!t.trimStart().startsWith('select '))throw Error('UNSAFE_QUERY');
      const parameters=new Set([...t.matchAll(/\\$(\\d+)/gu)].map(match=>Number(match[1])));
      if(q.values.some((_,index)=>!parameters.has(index+1)))throw Object.assign(Error('DO_NOT_PRINT_SECRET'),{code:'42P18'});
      let rows;
      if(t.includes("current_user='lead_agent_runtime'"))rows=[{runtime:process.env.S22_FIXTURE_BAD_GUARD!=='true',staging_database:true,least_privilege:true,read_only:true,row_security:true,tenant_matches:true,collection_window_valid:true}];
      else if(t.includes('pg_catalog.pg_class')){
        if(process.env.S22_FIXTURE_FAILURE==='unknown_sqlstate')throw Object.assign(Error('DO_NOT_PRINT_SECRET'),{code:'ZZZZZ',stack:'DO_NOT_PRINT_STACK'});
        rows=[{count:process.env.S22_FIXTURE_FAILURE==='missing_table'?2:3,safe:process.env.S22_FIXTURE_FAILURE==='null_safety'?null:true}];
      }
      else if(t.includes('from widget_allowed_origins'))rows=${JSON.stringify(origins)};
      else if(t.includes('from widget_sessions'))rows=${JSON.stringify([selectedRow()])};
      else throw Error('UNEXPECTED_QUERY');
      return {rows};
    };`,
  );
  try {
    const readerSource = readFileSync(
      new URL("./s22-widget-session-select-readonly.mjs", import.meta.url),
      "utf8",
    );
    for (const scenario of [
      { name: "success", status: 0, rollback: true, closed: true },
      {
        name: "bad_guard",
        status: 1,
        rollback: true,
        closed: true,
        stage: "runtime_read_only_tenant_guard",
        code: "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED",
      },
      {
        name: "original_parameter_gap",
        status: 1,
        rollback: true,
        closed: true,
        stage: "force_rls_not_owner_guard",
        code: "DATABASE_OR_TOOLING_UNAVAILABLE",
        sqlstate: "42P18",
        category: "database_sql",
      },
      {
        name: "unknown_sqlstate",
        status: 1,
        rollback: true,
        closed: true,
        stage: "force_rls_not_owner_guard",
        code: "DATABASE_OR_TOOLING_UNAVAILABLE",
      },
      {
        name: "missing_table",
        status: 1,
        rollback: true,
        closed: true,
        stage: "force_rls_not_owner_guard",
        code: "FORCE_RLS_NOT_OWNER_GUARD_FAILED",
      },
      {
        name: "null_safety",
        status: 1,
        rollback: true,
        closed: true,
        stage: "force_rls_not_owner_guard",
        code: "FORCE_RLS_NOT_OWNER_GUARD_FAILED",
      },
      {
        name: "configuration",
        status: 1,
        rollback: false,
        closed: false,
        stage: "database_runtime",
        code: "DATABASE_OR_TOOLING_UNAVAILABLE",
        category: "configuration",
      },
      {
        name: "readiness",
        status: 1,
        rollback: false,
        closed: true,
        stage: "database_readiness",
        code: "DATABASE_OR_TOOLING_UNAVAILABLE",
        sqlstate: "08006",
        category: "database_sql",
      },
      {
        name: "cleanup",
        status: 1,
        rollback: true,
        closed: true,
        stage: "cleanup",
        code: "DATABASE_CLEANUP_FAILED",
      },
    ]) {
      const source =
        scenario.name === "original_parameter_gap"
          ? readerSource.replace(" and $1::uuid is not null", "")
          : readerSource;
      if (scenario.name === "original_parameter_gap") assert.notEqual(source, readerSource);
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
        cwd: fixture,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://synthetic.invalid/test",
          S22_BOOKING_READ_B64: Buffer.from(source).toString("base64"),
          S22_WIDGET_SESSION_READ: "execute",
          S22_WIDGET_SESSION_SCOPE_B64: Buffer.from(
            JSON.stringify({ origin, from: scope.from, until: scope.until }),
          ).toString("base64"),
          S22_FIXTURE_BAD_GUARD: String(scenario.name === "bad_guard"),
          S22_FIXTURE_FAILURE: scenario.name,
        },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.status, scenario.status, scenario.name + result.stderr + result.stdout);
      assert.equal(result.stdout.includes("FIXTURE_ROLLBACK"), scenario.rollback, scenario.name);
      assert.equal(result.stdout.includes("FIXTURE_CLOSED"), scenario.closed, scenario.name);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /postgresql:\/\/|synthetic\.invalid|PASSWORD|bearer|DO_NOT_PRINT|ZZZZZ/u,
      );
      const entries = result.stdout
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("{"))
        .map((line) => ({ jsonPayload: JSON.parse(line) }));
      if (scenario.status === 1) {
        const failure = entries.find(
          (entry) => entry.jsonPayload.outcome === "BLOCKED",
        )?.jsonPayload;
        assert.equal(failure?.stage, scenario.stage, scenario.name);
        assert.equal(failure?.assertion, scenario.stage, scenario.name);
        assert.equal(failure?.code, scenario.code, scenario.name);
        assert.equal(failure?.sqlstate, scenario.sqlstate, scenario.name);
        if (scenario.category !== undefined)
          assert.equal(failure?.error_category, scenario.category, scenario.name);
        assert.throws(() => collectSelectionLogs(entries), { code: scenario.code });
      } else {
        assert.equal(collectSelectionLogs(entries).session_id, sessionId);
      }
    }
  } finally {
    assert.equal(dirname(realpathSync(fixture)), realpathSync(tmpdir()));
    assert.ok(basename(fixture).startsWith("s22-widget-selection-"));
    assert.ok(resolve(fixture).startsWith(resolve(tmpdir()) + sep));
    rmSync(fixture, { recursive: true, force: true });
  }
});
