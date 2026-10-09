import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { moduleBootstrap, collectAttemptLogs } from "./s22-widget-attempt.mjs";
import {
  attemptScope as scope,
  attemptForceRlsTableNames,
  attemptSessionSql,
  attemptQueries,
  collectWidgetAttempt,
  sanitizeAttemptRow,
  sanitizeAttemptValue,
  sanitizeAttemptBudget,
} from "./s22-widget-attempt-readonly.mjs";

const conversation = "01a11b80-abcd-7123-8b01-0123456789ab";
const message = "01a11b80-abce-7123-8b01-0123456789ab";
const run = "01a11b80-abcf-7123-8b01-0123456789ab";
const sessionRow = (bound = false) => ({
  organization_id: scope.organization,
  session_id: scope.session,
  channel_connection_id: scope.channel,
  allowed_origin_id: scope.origin,
  status: "active",
  version: bound ? "3" : "2",
  issued_at: "2026-10-08T12:29:56.031Z",
  last_seen_at: "2026-10-08T12:29:57.129Z",
  expires_at: "2026-10-08T14:29:56.031Z",
  conversation_id: bound ? conversation : null,
  conversation_status: bound ? "open" : null,
  conversation_version: bound ? "1" : null,
  automation_mode: bound ? "ai" : null,
  no_active_handoff: true,
  contact_unbound: !bound,
  conversation_unbound: !bound,
  not_revoked: true,
  channel_active: true,
  origin_active: true,
  absolute_valid: true,
  idle_valid: false,
  conversation_ownership_matches: true,
});
const budgetSnapshot = (bound = false) => ({
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
  blocked: true,
  reason: "widget_session_unavailable",
  widget: {
    sessionId: scope.session,
    conversationId: bound ? conversation : null,
    physicalCalls: 0,
    logicalMessages: 0,
    customerMessages: 0,
    knownCostMicros: "0",
    unresolvedReserveMicros: "0",
  },
});
const collect = async (row, queryRows = []) => {
  const reports = [],
    calls = [];
  const result = await collectWidgetAttempt(
    async (text, extra) => {
      calls.push({ text, extra });
      return text === attemptSessionSql ? [row] : queryRows;
    },
    (...args) => reports.push(args),
  );
  return { result, reports, calls };
};

test("idle expiry is an observed authorization state, not an invented persisted status or collection failure", async () => {
  const { result, reports, calls } = await collect(sessionRow());
  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].extra, [scope.session, scope.channel, scope.origin]);
  assert.equal(reports[0][2].status, "active");
  assert.equal(reports[0][2].idle_valid, false);
  assert.ok(reports.every(([, pass]) => pass));
  assert.ok(
    reports
      .slice(1)
      .every(([, , v]) => v.query_state === "SKIPPED_UNBOUND_SESSION" && v.rows.length === 0),
  );
});

test("only the exact persisted, ownership-verified session derives the downstream conversation and window", async () => {
  const { result, calls, reports } = await collect(sessionRow(true));
  assert.equal(result, conversation);
  assert.equal(calls.length, 6);
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.extra, [conversation, scope.channel, scope.windowStart, scope.windowEnd]);
    assert.match(call.text, /organization_id=\$1/u);
    assert.match(call.text, /\$4::timestamptz/u);
    assert.match(call.text, /\$5::timestamptz/u);
    assert.match(call.text, /limit (6|11|21|31)$/u);
  }
  assert.ok(reports.slice(1).every(([, , value]) => value.query_state === "COLLECTED"));
  assert.equal(reports[0][2].conversation_version, "1");
});

for (const patch of [
  { organization_id: conversation },
  { session_id: message },
  { channel_connection_id: message },
  { allowed_origin_id: message },
  { conversation_ownership_matches: false },
  { conversation_id: conversation },
  { conversation_id: "untrusted" },
])
  test(`foreign/partial binding fails closed before downstream query: ${Object.keys(patch)[0]}`, async () => {
    await assert.rejects(
      collect({ ...sessionRow(), ...patch }),
      (error) => error.code === "ATTEMPT_SESSION_SCOPE_INVALID",
    );
  });

test("bounded-row sentinels fail closed instead of silently truncating persisted evidence", async () => {
  await assert.rejects(
    collect(
      sessionRow(true),
      Array.from({ length: 21 }, () => ({ id: message })),
    ),
    (error) => error.code === "ATTEMPT_ROW_LIMIT_EXCEEDED",
  );
});

test("the SQL includes only approved metadata and never reads bodies, account identifiers, hashes, secrets or unrestricted JSON", () => {
  for (const query of [attemptSessionSql, ...Object.values(attemptQueries)]) {
    assert.match(query, /^select /u);
    assert.doesNotMatch(
      query,
      /select \*|for update|insert into|delete from|update [a-z]|body_|ciphertext|external_message_id|external_event_id|token|credential|provider_payload|payload_jsonb|metadata_redacted_jsonb\s*(?:,|from)/iu,
    );
  }
  assert.match(attemptSessionSql, /cv\.organization_id=\$1/u);
  assert.match(
    attemptSessionSql,
    /cv\.channel_connection_id=s\.channel_connection_id and cv\.contact_id=s\.contact_id/u,
  );
});

test("sanitizers retain unknown NULL costs and allowlisted dispatch fields, not extra contents", () => {
  const sanitized = sanitizeAttemptRow({
    id: run,
    estimated_cost_micros: null,
    cached_input_units: null,
    schema_valid: true,
    policy_allowed: false,
    failure_category: "policy_denied",
    dispatch_authorized: "false",
    body_ciphertext: "PRIVATE_PAYLOAD",
    customer_name: "PRIVATE_PAYLOAD",
    payload_jsonb: { secret: "PRIVATE_PAYLOAD" },
  });
  assert.equal(sanitized.estimated_cost_micros, null);
  assert.equal(sanitized.cached_input_units, null);
  assert.equal(sanitized.dispatch_authorized, "false");
  assert.equal(sanitized.policy_allowed, false);
  assert.doesNotMatch(JSON.stringify(sanitized), /PRIVATE_PAYLOAD|body_|customer_name/u);
  const observed = sanitizeAttemptValue({
    rows: [{ id: run, body: "PRIVATE_PAYLOAD" }],
    windowStart: scope.windowStart,
    blocked: true,
    credential: "PRIVATE_PAYLOAD",
  });
  assert.equal(observed.windowStart, scope.windowStart);
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE_PAYLOAD/u);
  const budget = sanitizeAttemptBudget({
    ...budgetSnapshot(),
    estimated_cost_micros: "0",
    rows: [{ id: run }],
  });
  assert.equal(budget.blocked, true);
  assert.equal(budget.accountingComplete, false);
  assert.equal(budget.historicalReserveMicros, "1033396");
  assert.equal(budget.rows, undefined);
  assert.equal(sanitizeAttemptBudget(budgetSnapshot(true)).widget.conversationId, null);
  assert.equal(
    sanitizeAttemptBudget(budgetSnapshot(true), conversation).widget.conversationId,
    conversation,
  );
});

test("persisted stale runs retain their authoritative outcome through collection and log sanitization", async () => {
  const reports = [];
  await collectWidgetAttempt(
    async (sql) => {
      if (sql === attemptSessionSql) return [sessionRow(true)];
      if (sql === attemptQueries.widget_attempt_runs)
        return [
          {
            id: run,
            status: "stale",
            schema_valid: true,
            policy_allowed: true,
            estimated_cost_micros: null,
            failure_category: "stale_conversation",
          },
        ];
      return [];
    },
    (...args) => reports.push(args),
  );
  const observed = sanitizeAttemptValue(
    reports.find(([name]) => name === "widget_attempt_runs")[2],
  );
  assert.equal(observed.rows[0].status, "stale");
  assert.equal(observed.rows[0].estimated_cost_micros, null);
  assert.equal(observed.rows[0].failure_category, "stale_conversation");
});

for (const state of [
  "expired-unbound",
  "bound-policy-denied",
  "guard-failed",
  "rls-failed",
  "sql-failed",
])
  test(`exact compressed ESM bootstrap resolves deployed-style packages/private runtime and rolls back every exit: ${state}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "s22-widget-attempt-bootstrap-"));
    try {
      const configDir = join(dir, "node_modules", "@lead-agent", "config");
      const databaseDir = join(dir, "node_modules", "@lead-agent", "database");
      mkdirSync(configDir, { recursive: true });
      mkdirSync(join(databaseDir, "runtime"), { recursive: true });
      for (const pkgDir of [configDir, databaseDir])
        writeFileSync(
          join(pkgDir, "package.json"),
          JSON.stringify({ type: "module", exports: { ".": "./index.js" } }),
        );
      writeFileSync(
        join(configDir, "index.js"),
        `export const S22_BOOKING_COHORT={organizationId:'${scope.organization}',conversationId:'01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7',historicalReserveMicros:1033396n,hardCeilingMicros:10000000n};export const withLibpqCompatibleRequireSsl=v=>v;export function createTenantDatabaseRuntimeConfig(c){const o=new URL(c.connectionString).searchParams.get('options');if(c.maxConnections!==1||c.connectionTimeoutMilliseconds!==5000||c.statementTimeoutMilliseconds!==5000||c.idleTimeoutMilliseconds!==5000||!['default_transaction_read_only=on','row_security=on','statement_timeout=5000','lock_timeout=1000','idle_in_transaction_session_timeout=10000'].every(v=>o.includes(v)))throw Error();return c;}`,
      );
      const bound = state === "bound-policy-denied";
      writeFileSync(
        join(databaseDir, "index.js"),
        `let commits=0,rollbacks=0;export function createTenantDatabaseRuntime(){return{verifyReady:async()=>{},withTenantTransaction:async(org,cb)=>{if(org!=='${scope.organization}')throw Error();try{const value=await cb({organizationId:org});commits++;return value;}catch(e){rollbacks++;throw e;}},close:async()=>console.log(JSON.stringify({fixture_cleanup:true,commits,rollbacks}))};}export function createAIJourneyBudgetGuard(runtime,c){if(c.mode!=='widget_booking'||c.widgetSessionId!=='${scope.session}'||c.historicalReserveMicros!==1033396n)throw Error();return{read:org=>runtime.withTenantTransaction(org,async()=>(${JSON.stringify(budgetSnapshot(bound))})),authorizeDispatch:()=>{throw Error('PROVIDER_FORBIDDEN');},recordStart:()=>{throw Error('PROVIDER_FORBIDDEN');}};}`,
      );
      const runRow = {
        id: run,
        trigger_message_id: message,
        status: "policy_denied",
        estimated_cost_micros: null,
        cached_input_units: null,
        schema_valid: true,
        policy_allowed: false,
        correlation_id: run,
        dispatch_authorized: "false",
        failure_category: "policy_denied",
        reservations: 0,
        started_at: "2026-10-08T13:00:00.000Z",
        finished_at: "2026-10-08T13:00:01.000Z",
        secret: "PRIVATE_PAYLOAD",
      };
      writeFileSync(
        join(databaseDir, "runtime", "tenant.js"),
        `export async function executeTenantQuery(session,build){const q=build(session.organizationId);if(q.values[0]!=='${scope.organization}'||!/^select /u.test(q.text)||/for update|insert into|delete from/iu.test(q.text))throw Error();if(q.text.includes('from pg_catalog.pg_roles r where'))return{rows:[{runtime:${state !== "guard-failed"},staging_database:true,least_privilege:true,read_only:true,row_security:true,tenant_matches:true,collection_window_valid:true,secret:'PRIVATE_PAYLOAD'}]};if(q.text.includes('from pg_catalog.pg_class')){if(q.values[1].length!==${attemptForceRlsTableNames.length})throw Error();return{rows:[{count:${attemptForceRlsTableNames.length},safe:${state !== "rls-failed"},secret:'PRIVATE_PAYLOAD'}]};}if(q.text.includes('from widget_sessions s')){if(q.values[1]!=='${scope.session}'||q.values[2]!=='${scope.channel}'||q.values[3]!=='${scope.origin}')throw Error();return{rows:[${JSON.stringify(sessionRow(bound))}]};}if('${state}'==='sql-failed')throw Object.assign(new Error('PRIVATE_PAYLOAD'),{code:'42703'});if(q.values[1]!=='${conversation}'||q.values[2]!=='${scope.channel}'||q.values[3]!=='${scope.windowStart}'||q.values[4]!=='${scope.windowEnd}')throw Error();return{rows:q.text.includes('from ai_runs r')?[${JSON.stringify(runRow)}]:[]};}`,
      );
      // Make sql-failed execute child queries rather than take the unbound shortcut.
      if (state === "sql-failed") {
        const path = join(databaseDir, "runtime", "tenant.js");
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace(
            JSON.stringify(sessionRow(false)),
            JSON.stringify(sessionRow(true)),
          ),
        );
      }
      const reader = readFileSync(new URL("./s22-widget-attempt-readonly.mjs", import.meta.url));
      const payload = gzipSync(reader).toString("base64");
      assert.ok(payload.length < 32000);
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", moduleBootstrap], {
        cwd: dir,
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          DATABASE_URL: "postgres://unused:PRIVATE_DATABASE_CREDENTIAL@localhost/unused",
          S22_BOOKING_READ_B64: payload,
          S22_WIDGET_ATTEMPT_READ: "execute",
          S22_WIDGET_ATTEMPT_STARTED_AT: "2026-10-08T13:10:00.000Z",
        },
      });
      const passing = state === "expired-unbound" || bound;
      assert.equal(result.status, passing ? 0 : 1, result.stderr);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /PRIVATE_PAYLOAD|PRIVATE_DATABASE_CREDENTIAL|PROVIDER_FORBIDDEN|Cannot use 'import.meta'|ERR_MODULE_NOT_FOUND/u,
      );
      const output = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const cleanup = output.find((row) => row.fixture_cleanup);
      assert.equal(cleanup.commits, 0);
      assert.ok(cleanup.rollbacks >= 1);
      if (passing) {
        const rows = collectAttemptLogs(output.map((jsonPayload) => ({ jsonPayload })));
        assert.equal(rows.length, 10);
        assert.equal(rows[2].observed.status, "active");
        assert.equal(rows[2].observed.idle_valid, false);
        assert.equal(rows.at(-2).observed.blocked, true);
        assert.equal(rows.at(-2).observed.reason, "widget_session_unavailable");
        if (bound) assert.equal(rows[4].observed.rows[0].estimated_cost_micros, null);
      } else {
        const error = output.find((row) => row.outcome === "BLOCKED");
        assert.ok(error);
        if (state === "sql-failed") assert.equal(error.sqlstate, "42703");
      }
    } finally {
      const target = realpathSync(dir);
      assert.equal(dirname(target), realpathSync(tmpdir()));
      assert.ok(basename(target).startsWith("s22-widget-attempt-bootstrap-"));
      rmSync(target, { recursive: true, force: true });
    }
  });
