import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  budgetReadinessPass,
  collectWidgetReadiness,
  parseReadinessScope,
  readinessForceRlsSql,
  readinessForceRlsTableNames,
  readinessScope,
  readinessSessionSql,
  runReadOnlyReadiness,
  sanitizeReadinessBudget,
  sessionReadinessPass,
} from "./s22-widget-readiness-readonly.mjs";

const session = (scope = readinessScope) => ({
  organization_id: scope.organization,
  session_id: scope.session,
  channel_connection_id: scope.channel,
  allowed_origin_id: scope.origin,
  status: "active",
  version: "2",
  issued_at: "2026-10-08T10:54:48.093Z",
  last_seen_at: "2026-10-08T10:55:00.000Z",
  expires_at: "2026-10-08T12:54:48.093Z",
  contact_unbound: true,
  conversation_unbound: true,
  not_revoked: true,
  channel_active: true,
  origin_active: true,
  absolute_valid: true,
  idle_valid: true,
});
const budget = (scope = readinessScope) => ({
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
    physicalCalls: 0,
    logicalMessages: 0,
    customerMessages: 0,
    knownCostMicros: "0",
    unresolvedReserveMicros: "0",
  },
});
const replacementSessionId = "01a11ba0-1234-7456-8abc-123456789abc";
test("an explicit canonical UUIDv7 changes only the diagnostic session scope; omission preserves old diagnostic", () => {
  assert.equal(parseReadinessScope(), readinessScope);
  assert.equal(parseReadinessScope(undefined), readinessScope);
  const scope = parseReadinessScope(replacementSessionId);
  assert.equal(Object.isFrozen(scope), true);
  assert.deepEqual(scope, { ...readinessScope, session: replacementSessionId });
  assert.equal(parseReadinessScope(readinessScope.session).session, readinessScope.session);
});
for (const value of [
  null,
  123,
  {},
  [],
  "",
  "PRIVATE_VALUE",
  " " + replacementSessionId,
  replacementSessionId.toUpperCase(),
  "01a11ba0-1234-4456-8abc-123456789abc",
  "01a11ba0-1234-7456-7abc-123456789abc",
  replacementSessionId + "\n",
])
  test(`explicit invalid session scope is never normalized or discovered (${JSON.stringify(value)})`, () => {
    assert.throws(
      () => parseReadinessScope(value),
      (error) => error.code === "READINESS_SCOPE_INVALID" && error.message === "",
    );
  });
test("explicit replacement collection uses one exact parameterized session with unchanged ledger and tenant boundaries", async () => {
  const scope = parseReadinessScope(replacementSessionId);
  const reports = [];
  let reads = 0,
    budgetReads = 0;
  const result = await collectWidgetReadiness(
    async (sql, values) => {
      reads++;
      assert.equal(sql, readinessSessionSql);
      assert.deepEqual(values, [
        replacementSessionId,
        readinessScope.channel,
        readinessScope.origin,
      ]);
      return [session(scope)];
    },
    async () => {
      budgetReads++;
      return budget(scope);
    },
    (...report) => reports.push(report),
    scope,
  );
  assert.deepEqual(result, { sessionReady: true, budgetReady: true });
  assert.equal(reads, 1);
  assert.equal(budgetReads, 1);
  assert.equal(reports[0][2].session_id, replacementSessionId);
  assert.equal(reports[1][2].widget.sessionId, replacementSessionId);
  assert.equal(reports[1][2].knownCostMicros, "8714");
  assert.equal(reports[1][2].historicalReserveMicros, "1033396");
  assert.equal(reports[1][2].combinedExposureMicros, "1042110");
  assert.equal(reports[1][2].physicalCalls, 4);
  assert.equal(reports[1][2].logicalMessages, 4);
  assert.equal(reports[1][2].accountingComplete, false);
  assert.equal(reports[2][2].no_message_or_call_triggered, true);
});
test("explicit scope does not accept old session rows, old budget binding or foreign tenant metadata", () => {
  const scope = parseReadinessScope(replacementSessionId);
  assert.equal(sessionReadinessPass([session()], scope), false);
  assert.equal(budgetReadinessPass(budget(), scope), false);
  assert.equal(sanitizeReadinessBudget(budget(), scope).widget.sessionId, null);
  assert.equal(
    sessionReadinessPass([{ ...session(scope), organization_id: replacementSessionId }], scope),
    false,
  );
  assert.equal(
    budgetReadinessPass({ ...budget(scope), historicalReserveMicros: "0" }, scope),
    false,
  );
  assert.equal(
    budgetReadinessPass({ ...budget(scope), physicalCalls: 0, logicalMessages: 0 }, scope),
    false,
  );
});
for (const changes of [
  { organization: replacementSessionId },
  { channel: replacementSessionId },
  { origin: replacementSessionId },
  { session: "PRIVATE_VALUE" },
])
  test(`caller cannot widen approved scope (${Object.keys(changes)[0]})`, async () => {
    const scope = { ...readinessScope, ...changes };
    let reads = 0;
    assert.equal(sessionReadinessPass([session(scope)], scope), false);
    assert.equal(budgetReadinessPass(budget(scope), scope), false);
    assert.equal(sanitizeReadinessBudget(budget(scope), scope).widget.sessionId, null);
    await assert.rejects(
      collectWidgetReadiness(
        async () => {
          reads++;
          return [session(scope)];
        },
        async () => {
          reads++;
          return budget(scope);
        },
        () => assert.fail("invalid scope must not emit PASS"),
        scope,
      ),
      (error) => error.code === "READINESS_SCOPE_INVALID",
    );
    assert.equal(reads, 0);
  });
test("invalid execution-only override is reported safely before imports or database configuration", async () => {
  const previousOverride = process.env.S22_WIDGET_READINESS_SESSION_ID;
  const previousExit = process.exitCode;
  const previousLog = console.log;
  const output = [];
  try {
    process.env.S22_WIDGET_READINESS_SESSION_ID = "PRIVATE_INVALID_OVERRIDE";
    console.log = (value) => output.push(JSON.parse(value));
    await runReadOnlyReadiness();
    assert.equal(process.exitCode, 1);
    assert.deepEqual(output, [
      {
        operation: "s22_widget_readiness",
        assertion: "selection_scope",
        outcome: "BLOCKED",
        code: "READINESS_SCOPE_INVALID",
      },
    ]);
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE_INVALID_OVERRIDE|DATABASE_URL/u);
  } finally {
    console.log = previousLog;
    process.exitCode = previousExit;
    if (previousOverride === undefined) delete process.env.S22_WIDGET_READINESS_SESSION_ID;
    else process.env.S22_WIDGET_READINESS_SESSION_ID = previousOverride;
  }
});
test("fresh exact redeemed/unbound session and intact separate ledger are ready, not authorization", async () => {
  const reports = [];
  let reads = 0,
    budgetReads = 0;
  const result = await collectWidgetReadiness(
    async (sql, values) => {
      reads++;
      assert.equal(sql, readinessSessionSql);
      assert.deepEqual(values, [
        readinessScope.session,
        readinessScope.channel,
        readinessScope.origin,
      ]);
      return [session()];
    },
    async () => {
      budgetReads++;
      return budget();
    },
    (...report) => reports.push(report),
  );
  assert.deepEqual(result, { sessionReady: true, budgetReady: true });
  assert.equal(reads, 1);
  assert.equal(budgetReads, 1);
  assert.deepEqual(
    reports.map(([name, pass]) => [name, pass]),
    [
      ["exact_widget_session", true],
      ["cohort_reservation_accounting", true],
      ["first_message_readiness", true],
    ],
  );
  assert.equal(reports[2][2].no_message_or_call_triggered, true);
});
for (const [name, changes] of [
  ["idle expiry despite future absolute expiry", { idle_valid: false }],
  ["absolute expiry", { absolute_valid: false }],
  ["revocation", { not_revoked: false }],
  ["non-active state", { status: "revoked" }],
  ["foreign tenant", { organization_id: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7" }],
  ["foreign session", { session_id: readinessScope.channel }],
  ["different origin", { allowed_origin_id: readinessScope.channel }],
  ["different channel", { channel_connection_id: readinessScope.origin }],
  ["unredeemed version", { version: "1" }],
  ["unexpected state/version advancement", { version: "3" }],
  ["contact already bound", { contact_unbound: false }],
  ["conversation already bound", { conversation_unbound: false }],
  ["channel inactive", { channel_active: false }],
  ["origin inactive", { origin_active: false }],
  ["last-seen before issuance", { last_seen_at: "2026-10-08T10:53:00.000Z" }],
  ["invalid timestamp", { last_seen_at: "bad" }],
  ["missing timestamp", { last_seen_at: null }],
])
  test(`fail closed on ${name}`, () =>
    assert.equal(sessionReadinessPass([{ ...session(), ...changes }]), false));
test("missing/duplicate rows fail, foreign metadata is not printed", async () => {
  assert.equal(sessionReadinessPass([]), false);
  assert.equal(sessionReadinessPass([session(), session()]), false);
  const reports = [];
  await collectWidgetReadiness(
    async () => [{ ...session(), organization_id: "FOREIGN_PRIVATE", token: "SECRET" }],
    async () => budget(),
    (...row) => reports.push(row),
  );
  assert.equal(reports[0][1], false);
  assert.equal(reports[0][2].scope_matches, false);
  assert.equal(reports[2][1], false);
  assert.doesNotMatch(JSON.stringify(reports), /FOREIGN_PRIVATE|SECRET/u);
});
test("expired session still collects budget and distinguishes readiness failure", async () => {
  const reports = [];
  let budgetReads = 0;
  await collectWidgetReadiness(
    async () => [{ ...session(), idle_valid: false }],
    async () => {
      budgetReads++;
      return { ...budget(), blocked: true, reason: "widget_session_unavailable" };
    },
    (...row) => reports.push(row),
  );
  assert.equal(budgetReads, 1);
  assert.equal(reports[0][1], false);
  assert.equal(reports[0][2].absolute_valid, true);
  assert.equal(reports[0][2].idle_valid, false);
  assert.equal(reports[1][2].reason, "widget_session_unavailable");
  assert.equal(reports[2][2].ready, false);
});
for (const [name, changes] of [
  [
    "unknown/reserved money",
    { unresolvedReserveMicros: "801432", blocked: true, reason: "cost_unknown" },
  ],
  ["known cost drift", { knownCostMicros: "8715" }],
  ["historical reserve drift", { historicalReserveMicros: "0" }],
  ["historical exact accounting falsely claimed", { accountingComplete: true }],
  ["original attempt count drift", { physicalCalls: 5 }],
  ["original logical count drift", { logicalMessages: 3 }],
  ["missing current pricing", { perCallReserveMicros: null }],
  ["paused mode", { mode: "paused" }],
  ["blocked without allowed cause", { blocked: true }],
])
  test(`budget rejects ${name}`, () =>
    assert.equal(budgetReadinessPass({ ...budget(), ...changes }), false));
for (const [name, changes] of [
  ["wrong selected session", { sessionId: readinessScope.origin }],
  ["unexpected conversation binding", { conversationId: readinessScope.origin }],
  ["previous Widget attempt", { physicalCalls: 1 }],
  ["previous Widget paid message", { logicalMessages: 1 }],
  ["previous nonpaid customer message", { customerMessages: 1 }],
  ["Widget cost drift", { knownCostMicros: "1" }],
  ["unresolved Widget reservation", { unresolvedReserveMicros: "801432" }],
])
  test(`first-message baseline rejects ${name}`, () => {
    const value = budget();
    assert.equal(budgetReadinessPass({ ...value, widget: { ...value.widget, ...changes } }), false);
  });
test("metadata sanitization excludes unexpected fields, account/contact IDs, entire blobs", () => {
  const value = budget();
  const sanitized = sanitizeReadinessBudget({
    ...value,
    token: "SECRET",
    reason: "PRIVATE MESSAGE",
    widget: {
      ...value.widget,
      contactId: "CONTACT_SECRET",
      conversationId: "OTHER_SECRET",
      metadata: { credential: "SECRET" },
    },
  });
  assert.equal(sanitized.widget.conversationUnbound, false);
  assert.equal(sanitized.reason, null);
  assert.equal(sanitizeReadinessBudget({ ...value, reason: "private_account" }).reason, null);
  assert.doesNotMatch(
    JSON.stringify(sanitized),
    /SECRET|PRIVATE MESSAGE|credential|contactId|metadata/u,
  );
});
test("SQL catalog guard types tenant parameter, limits rows, exact tenant routing and six FORCE-RLS tables", () => {
  assert.match(readinessForceRlsSql, /\$1::uuid/u);
  assert.match(readinessForceRlsSql, /relforcerowsecurity/u);
  assert.equal(readinessForceRlsTableNames.length, 6);
  assert.match(readinessSessionSql, /s\.organization_id=\$1 and s\.id=\$2::uuid/u);
  assert.match(readinessSessionSql, /s\.channel_connection_id=\$3::uuid/u);
  assert.match(readinessSessionSql, /s\.widget_allowed_origin_id=\$4::uuid limit 2/u);
  assert.match(readinessSessionSql, /s\.expires_at>now\(\)/u);
  assert.match(readinessSessionSql, /s\.last_seen_at>now\(\)-interval '30 minutes'/u);
  assert.doesNotMatch(
    readinessSessionSql,
    /token|credential|body|ciphertext|jti|provider_account/u,
  );
});
test("reader uses actual guard.read only, bounded read-only options, module resolution and rollback cleanup", () => {
  const source = readFileSync(
    new URL("./s22-widget-readiness-readonly.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /budget\.read\(scope\.organization\)/u);
  assert.match(source, /parseReadinessScope\(process\.env\.S22_WIDGET_READINESS_SESSION_ID\)/u);
  assert.match(source, /widgetSessionId: scope\.session/u);
  assert.doesNotMatch(source, /\.authorizeDispatch\(|\.recordStart\(|\b(insert|update|delete)\b/iu);
  assert.match(
    source,
    /default_transaction_read_only=on -c row_security=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000/u,
  );
  assert.match(source, /maxConnections: 1/u);
  assert.match(source, /connectionTimeoutMilliseconds: 5000/u);
  assert.match(source, /throw rollback/u);
  assert.match(source, /await runtime\.close\(\)/u);
  assert.match(source, /import\.meta\.resolve\("@lead-agent\/database"\)/u);
  assert.match(source, /process\.env\.S22_WIDGET_READINESS_READ === "execute"/u);
  assert.match(source, /import\.meta\.url\.endsWith\("\/\[eval1\]"\)/u);
});
