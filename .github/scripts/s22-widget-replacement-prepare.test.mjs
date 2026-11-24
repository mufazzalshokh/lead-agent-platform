import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  replacementScope as scope,
  replacementLimits as limits,
  replacementPlan as plan,
  replacementPlanSha256,
  replacementQueries as sql,
  replacementRlsTables,
  collectReplacementBaseline,
  recoveryAccessSql,
  assessRecoveredAccess,
} from "./s22-widget-replacement-prepare.mjs";

const startedAt = "2026-10-11T15:30:00.000Z";
const budget = () => ({
  profile: "s22-synthetic-booking.v1",
  mode: "widget_booking",
  physicalCalls: 5,
  logicalMessages: 5,
  knownCostMicros: "10964",
  unresolvedReserveMicros: "0",
  historicalReserveMicros: "1033396",
  combinedExposureMicros: "1044360",
  perCallReserveMicros: "801432",
  accountingComplete: false,
  blocked: true,
  reason: "widget_binding_integrity",
  widget: { sessionId: scope.retiredSession },
});
const fixture = () => ({
  guards: Object.fromEntries(
    "runtime staging_database least_privilege read_only row_security tenant_matches fresh"
      .split(" ")
      .map((key) => [key, true]),
  ),
  rls: { count: replacementRlsTables.length, safe: true },
  historical: { count: 2, costs_still_unknown: true },
  selection: {
    selected_session_id: scope.retiredSession,
    selection_version: "1",
    expected_selection_version: "0",
    expected_session_version: "2",
    channel_connection_id: scope.channel,
    allowed_origin_id: scope.origin,
    attributed: true,
  },
  retired: {
    organization_id: scope.organization,
    session_id: scope.retiredSession,
    conversation_id: scope.retiredConversation,
    channel_connection_id: scope.channel,
    allowed_origin_id: scope.origin,
    proof_not_issued: true,
    access_expired: true,
    not_revoked: true,
    owns_conversation: true,
    request_id: scope.retiredRequest,
    request_status: "requested",
    request_version: "1",
    offer_version: 0,
    customer_messages: 1,
    message_matches: true,
  },
  binding: {
    session_id: scope.retiredSession,
    widget_session_id: scope.retiredSession,
    conversation_id: scope.retiredConversation,
  },
  run: {
    id: scope.retiredRun,
    conversation_id: scope.retiredConversation,
    trigger_message_id: scope.retiredMessage,
    status: "succeeded",
    estimated_cost_micros: "2250",
    finished: true,
    reservations: 1,
    widget_session_id: scope.retiredSession,
    widget_conversation_id: scope.retiredConversation,
    provider_id: "gemini",
    requested_model_id: "gemini-3.8-flash",
    provider_resolved_model_id: "gemini-3.8-flash",
  },
});
const collect = async (rows = fixture(), ledger = budget()) => {
  const reads = [];
  const result = await collectReplacementBaseline({
    startedAt,
    read: async (query, values) => {
      const entry = Object.entries(sql).find(([, text]) => text === query);
      assert.ok(entry, "only the finite read-only query set is permitted");
      assert.equal(values[0], scope.organization);
      reads.push(entry[0]);
      return Array.isArray(rows[entry[0]]) ? rows[entry[0]] : [rows[entry[0]]];
    },
    readBudget: async () => {
      reads.push("budget");
      return ledger;
    },
  });
  return { result, reads };
};
test("approved preparation retains all money and call limits without authorizing execution", () => {
  assert.ok([scope, limits, plan].every(Object.isFrozen));
  assert.equal(plan.newReserveBoundMicros, "2404296");
  assert.equal(plan.plannedCombinedExposureBoundMicros, "3448656");
  assert.ok(
    BigInt(plan.plannedCombinedExposureBoundMicros) < BigInt(limits.combinedExposureCapMicros),
  );
  assert.ok(BigInt(limits.combinedExposureCapMicros) < BigInt(limits.hardCeilingMicros));
  assert.equal(plan.maximumWidgetPhysicalAttemptsIncludingRetired, 4);
  assert.equal(plan.maximumWidgetCustomerMessagesIncludingRetired, 3);
  for (const key of [
    "runtimeGuardImplemented",
    "liveBaselineCollected",
    "deploymentAuthorized",
    "sessionCreationAuthorized",
    "sendAuthorized",
    "historicalAccountingComplete",
  ])
    assert.equal(plan[key], false);
  assert.equal(
    replacementPlanSha256,
    createHash("sha256").update(JSON.stringify(plan)).digest("hex"),
  );
});
test("existing runtime limits and consumed-lane refusal remain intact", () => {
  const config = readFileSync(
    new URL("../../packages/config/src/ai-journey.ts", import.meta.url),
    "utf8",
  );
  const guard = readFileSync(
    new URL("../../packages/database/src/repositories/ai-journey-budget.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /maximumMessages: 2/u);
  assert.match(config, /maximumCalls: 4/u);
  assert.match(config, /maximumCombinedExposureMicros: 4_247_838n/u);
  assert.match(config, /hardCeilingMicros: 10_000_000n/u);
  assert.match(guard, /if \(latches\.length !== 0\) reason = "widget_already_bound"/u);
});
test("CLI emits a stable, non-executing preparation packet", () => {
  const output = execFileSync(
    process.execPath,
    [".github/scripts/s22-widget-replacement-prepare.mjs", "--plan"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.deepEqual(JSON.parse(output), { plan, sha256: replacementPlanSha256 });
});
test("exact baseline is observed without calling it dispatch or customer readiness", async () => {
  const before = fixture(),
    copy = structuredClone(before);
  const { result, reads } = await collect(before);
  assert.equal(result.outcome, "BASELINE_MATCHES_PREPARED_PLAN");
  assert.equal(result.sendAuthorized, false);
  assert.equal(result.runtimeGuardImplemented, false);
  assert.equal(result.historicalAccountingComplete, false);
  assert.deepEqual(reads, [
    "guards",
    "rls",
    "historical",
    "selection",
    "retired",
    "binding",
    "run",
    "budget",
  ]);
  assert.deepEqual(before, copy);
});
for (const flag of "runtime staging_database least_privilege read_only row_security tenant_matches fresh".split(
  " ",
))
  test(`failed ${flag} guard stops before any tenant or ledger query`, async () => {
    let reads = 0;
    await assert.rejects(
      collectReplacementBaseline({
        startedAt,
        read: async (query) => {
          reads++;
          assert.equal(query, sql.guards);
          return [{ ...fixture().guards, [flag]: false }];
        },
        readBudget: async () => assert.fail("no budget query after failed guard"),
      }),
      (error) => error.code === "REPLACEMENT_RUNTIME_GUARD_FAILED" && error.message === "",
    );
    assert.equal(reads, 1);
  });
for (const [section, patch, code] of [
  ["rls", { safe: false }, "REPLACEMENT_RLS_GUARD_FAILED"],
  ["rls", { count: 8 }, "REPLACEMENT_RLS_GUARD_FAILED"],
  ["historical", { count: 1 }, "REPLACEMENT_HISTORICAL_COST_CHANGED"],
  ["historical", { costs_still_unknown: false }, "REPLACEMENT_HISTORICAL_COST_CHANGED"],
  ["selection", { attributed: false }, "REPLACEMENT_SELECTION_CHANGED"],
  ["selection", { selected_session_id: scope.anchor }, "REPLACEMENT_SELECTION_CHANGED"],
  ["retired", { organization_id: scope.anchor }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["retired", { conversation_id: scope.anchor }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["retired", { customer_messages: 2 }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["retired", { proof_not_issued: false }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["retired", { access_expired: false }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["retired", { request_status: "confirmed" }, "REPLACEMENT_RETIRED_SCOPE_CHANGED"],
  ["binding", { widget_session_id: scope.anchor }, "REPLACEMENT_BINDING_CHANGED"],
  ["run", { finished: false }, "REPLACEMENT_RETIRED_RUN_CHANGED"],
  ["run", { reservations: 2 }, "REPLACEMENT_RETIRED_RUN_CHANGED"],
  ["run", { estimated_cost_micros: null }, "REPLACEMENT_RETIRED_RUN_CHANGED"],
  ["run", { estimated_cost_micros: "0" }, "REPLACEMENT_RETIRED_RUN_CHANGED"],
  ["run", { provider_resolved_model_id: "unexpected" }, "REPLACEMENT_RETIRED_RUN_CHANGED"],
])
  test(`changed ${section}/${Object.keys(patch)[0]} fails closed`, async () => {
    const rows = fixture();
    rows[section] = { ...rows[section], ...patch };
    await assert.rejects(collect(rows), (error) => error.code === code);
  });
for (const section of ["guards", "rls", "historical", "selection", "retired", "binding", "run"])
  test(`missing or duplicated ${section} rows are never silently selected`, async () => {
    for (const entries of [[], [fixture()[section], fixture()[section]]]) {
      const rows = fixture();
      rows[section] = entries;
      await assert.rejects(collect(rows));
    }
  });
test("owner selection follows contiguous CAS order and keeps a slot for the proposed replacement", async () => {
  const rows = fixture();
  const first = { ...rows.selection, selected_session_id: scope.anchor };
  const second = { ...rows.selection, selection_version: "2", expected_selection_version: "1" };
  rows.selection = [second, first];
  assert.equal((await collect(rows)).result.sendAuthorized, false);
  rows.selection = Array.from({ length: 16 }, (_, index) => ({
    ...second,
    selection_version: String(index + 1),
    expected_selection_version: String(index),
  }));
  await assert.rejects(collect(rows), (error) => error.code === "REPLACEMENT_SELECTION_CHANGED");
});
for (const patch of [
  { physicalCalls: 6 },
  { logicalMessages: 6 },
  { knownCostMicros: "10965" },
  { unresolvedReserveMicros: "801432" },
  { historicalReserveMicros: "0" },
  { combinedExposureMicros: "0" },
  { perCallReserveMicros: null },
  { accountingComplete: true },
  { blocked: false },
  { reason: "cost_unknown" },
  { widget: { sessionId: scope.anchor } },
])
  test(`changed ledger/${Object.keys(patch)[0]} requires a new review, never zeroes history`, async () => {
    await assert.rejects(
      collect(fixture(), { ...budget(), ...patch }),
      (error) => error.code === "REPLACEMENT_LEDGER_CHANGED",
    );
  });
test("unknown extra data, bodies and credentials never appear in the prepared evidence", async () => {
  const rows = fixture();
  for (const row of Object.values(rows))
    Object.assign(row, {
      recovery_code: "PRIVATE_PROOF",
      token_hash: "PRIVATE_HASH",
      body: "PRIVATE_BODY",
    });
  const { result } = await collect(rows, { ...budget(), database_url: "PRIVATE_DB" });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/u);
});
test("finite SELECT-only queries have explicit tenant scope and bounded reads", () => {
  for (const query of [...Object.values(sql), recoveryAccessSql]) {
    assert.match(query.trim(), /^select /iu);
    assert.match(query, /limit [123]/iu);
    assert.doesNotMatch(query, /\b(?:insert|update|delete|alter|drop|grant|revoke)\b/iu);
    assert.match(query, /\$1/u);
    assert.doesNotMatch(
      query,
      /select \*|body_ciphertext|session_token_jti_hash|recovery_token_hash\s*,/iu,
    );
  }
});
const expected = {
  session: "01a12abc-1234-7456-8abc-123456789abc",
  conversation: "01a12abc-1234-7456-8abc-123456789abd",
};
const recovered = () => ({
  organization_id: scope.organization,
  session_id: expected.session,
  conversation_id: expected.conversation,
  channel_connection_id: scope.channel,
  allowed_origin_id: scope.origin,
  status: "active",
  ...Object.fromEntries(
    "not_revoked proof_exists channel_active origin_active owns_conversation conversation_nonterminal contact_active"
      .split(" ")
      .map((key) => [key, true]),
  ),
  issued_at: "2026-10-11T08:00:00.000Z",
  expires_at: "2026-10-11T10:00:00.000Z",
  recovery_issued_at: "2026-10-11T08:01:00.000Z",
  recovery_expires_at: "2026-10-12T08:01:00.000Z",
  access_issued_at: "2026-10-11T15:00:00.000Z",
  access_expires_at: "2026-10-11T17:00:00.000Z",
  last_seen_at: "2026-10-11T15:29:59.000Z",
  observed_at: startedAt,
});
test("recovered access uses its live lease while preserving the expired original identity", () => {
  assert.ok(Date.parse(recovered().expires_at) < Date.parse(startedAt));
  assert.equal(assessRecoveredAccess([recovered()], expected), true);
  assert.match(recoveryAccessSql, /s\.access_expires_at/u);
});
for (const patch of [
  { session_id: scope.retiredSession },
  { conversation_id: scope.retiredConversation },
  { organization_id: scope.anchor },
  { allowed_origin_id: scope.anchor },
  { proof_exists: false },
  { not_revoked: false },
  { channel_active: false },
  { contact_active: false },
  { conversation_nonterminal: false },
  { access_expires_at: null },
  { access_expires_at: startedAt },
  { access_expires_at: "2026-10-11T17:00:00.001Z" },
  { last_seen_at: "2026-10-11T15:00:00.000Z" },
  { last_seen_at: "2026-10-11T15:31:00.000Z" },
  { recovery_expires_at: "2026-10-12T08:01:00.001Z" },
])
  test(`invalid recovered access/${Object.keys(patch)[0]} cannot count as proof`, () => {
    assert.equal(assessRecoveredAccess([{ ...recovered(), ...patch }], expected), false);
  });
test("recovery cannot reuse the inaccessible retired session or discover an arbitrary identity", () => {
  for (const value of [
    null,
    {},
    { ...expected, session: scope.retiredSession },
    { ...expected, session: "bad" },
    { ...expected, organization: scope.organization },
  ])
    assert.throws(
      () => assessRecoveredAccess([recovered()], value),
      (error) => error.code === "RECOVERY_EXPECTATION_INVALID",
    );
  assert.equal(assessRecoveredAccess([], expected), false);
  assert.equal(assessRecoveredAccess([recovered(), recovered()], expected), false);
});
