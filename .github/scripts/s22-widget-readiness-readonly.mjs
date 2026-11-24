// Actual ES-module stdin in /app. Only metadata SELECTs; no Send or provider construction.
export const readinessOperation = "s22_widget_readiness";
export const readinessScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  session: "01a11b26-c51d-78ba-8e81-62e6e7331ab8",
  channel: "01a11771-2c02-7240-86f7-19f95690d22e",
  origin: "01a11771-2c02-7765-b999-7dc9895ee49d",
});
const canonicalUuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const parseReadinessScope = (sessionId = undefined) => {
  if (sessionId === undefined) return readinessScope;
  if (typeof sessionId !== "string" || !canonicalUuidV7.test(sessionId))
    throw Object.assign(new Error(), { code: "READINESS_SCOPE_INVALID" });
  return Object.freeze({ ...readinessScope, session: sessionId });
};
const validScope = (scope) =>
  scope?.organization === readinessScope.organization &&
  scope.channel === readinessScope.channel &&
  scope.origin === readinessScope.origin &&
  typeof scope.session === "string" &&
  canonicalUuidV7.test(scope.session);
export const readinessForceRlsTableNames = Object.freeze([
  "widget_sessions",
  "widget_allowed_origins",
  "channel_connections",
  "messages",
  "ai_runs",
  "audit_events",
]);
export const readinessForceRlsSql = `select count(*)::integer as count,
  bool_and(c.relrowsecurity and c.relforcerowsecurity
    and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any($2::text[]) and $1::uuid is not null limit 1`;
export const readinessSessionSql = `select s.organization_id::text,s.id::text as session_id,
  s.channel_connection_id::text,s.widget_allowed_origin_id::text as allowed_origin_id,
  s.status,s.version::text,s.issued_at,s.last_seen_at,s.expires_at,
  s.contact_id is null as contact_unbound,s.conversation_id is null as conversation_unbound,
  s.revoked_at is null as not_revoked,
  c.status='active' and c.channel_type='widget' as channel_active,
  o.status='active' and o.match_type='exact' and o.scheme='https' as origin_active,
  s.expires_at>now() as absolute_valid,
  s.last_seen_at>now()-interval '30 minutes' as idle_valid
  from widget_sessions s
  join channel_connections c on c.organization_id=$1 and c.id=s.channel_connection_id
  join widget_allowed_origins o on o.organization_id=$1 and o.id=s.widget_allowed_origin_id
    and o.channel_connection_id=s.channel_connection_id
  where s.organization_id=$1 and s.id=$2::uuid and s.channel_connection_id=$3::uuid
    and s.widget_allowed_origin_id=$4::uuid limit 2`;
const timestamp = (value) => {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const scopeMatches = (row, scope) =>
  validScope(scope) &&
  row?.organization_id === scope.organization &&
  row.session_id === scope.session &&
  row.channel_connection_id === scope.channel &&
  row.allowed_origin_id === scope.origin;
export const sessionReadinessPass = (rows, scope = readinessScope) => {
  if (!validScope(scope) || !Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  const issued = timestamp(row?.issued_at),
    seen = timestamp(row?.last_seen_at),
    expires = timestamp(row?.expires_at);
  return (
    scopeMatches(row, scope) &&
    row.status === "active" &&
    row.version === "2" &&
    [
      "contact_unbound",
      "conversation_unbound",
      "not_revoked",
      "channel_active",
      "origin_active",
      "absolute_valid",
      "idle_valid",
    ].every((key) => row[key] === true) &&
    issued !== null &&
    seen !== null &&
    expires !== null &&
    seen >= issued &&
    expires > seen
  );
};
export const budgetReadinessPass = (snapshot, scope = readinessScope) =>
  validScope(scope) &&
  snapshot?.profile === "s22-synthetic-booking.v1" &&
  snapshot.mode === "widget_booking" &&
  snapshot.physicalCalls === 4 &&
  snapshot.logicalMessages === 4 &&
  snapshot.knownCostMicros === "8714" &&
  snapshot.unresolvedReserveMicros === "0" &&
  snapshot.historicalReserveMicros === "1033396" &&
  snapshot.combinedExposureMicros === "1042110" &&
  snapshot.perCallReserveMicros === "801432" &&
  snapshot.accountingComplete === false &&
  snapshot.blocked === false &&
  snapshot.reason === null &&
  snapshot.widget?.sessionId === scope.session &&
  snapshot.widget.conversationId === null &&
  snapshot.widget.physicalCalls === 0 &&
  snapshot.widget.logicalMessages === 0 &&
  snapshot.widget.customerMessages === 0 &&
  snapshot.widget.knownCostMicros === "0" &&
  snapshot.widget.unresolvedReserveMicros === "0";
const safeInteger = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const safeMoney = (value) =>
  typeof value === "string" && /^[0-9]{1,20}$/u.test(value) ? value : null;
export const readinessBudgetReasons = Object.freeze([
  "pricing_unavailable",
  "ledger_overflow",
  "dispatch_marker_integrity",
  "historical_scope_mismatch",
  "historical_cost_mutated",
  "unrecognized_run",
  "missing_dispatch_marker",
  "model_mismatch",
  "scope_mismatch",
  "dispatch_in_flight",
  "cost_unknown",
  "invalid_cost",
  "usage_limit",
  "historical_baseline_missing",
  "attempt_limit",
  "hard_ceiling",
  "widget_baseline_mismatch",
  "widget_session_unavailable",
  "widget_binding_integrity",
  "widget_allowance",
  "message_limit",
  "paused",
]);
const safeCode = (value) => (readinessBudgetReasons.includes(value) ? value : null);
export const sanitizeReadinessBudget = (snapshot, scope = readinessScope) => ({
  profile: snapshot?.profile === "s22-synthetic-booking.v1" ? snapshot.profile : null,
  mode: snapshot?.mode === "widget_booking" ? snapshot.mode : null,
  physicalCalls: safeInteger(snapshot?.physicalCalls),
  logicalMessages: safeInteger(snapshot?.logicalMessages),
  knownCostMicros: safeMoney(snapshot?.knownCostMicros),
  unresolvedReserveMicros: safeMoney(snapshot?.unresolvedReserveMicros),
  historicalReserveMicros: safeMoney(snapshot?.historicalReserveMicros),
  combinedExposureMicros: safeMoney(snapshot?.combinedExposureMicros),
  perCallReserveMicros: safeMoney(snapshot?.perCallReserveMicros),
  accountingComplete: snapshot?.accountingComplete === false ? false : null,
  blocked: typeof snapshot?.blocked === "boolean" ? snapshot.blocked : null,
  reason: safeCode(snapshot?.reason),
  widget: {
    sessionId:
      validScope(scope) && snapshot?.widget?.sessionId === scope.session ? scope.session : null,
    // First readiness must be unbound; do not print a contact or unexpected conversation ID.
    conversationId: null,
    conversationUnbound: snapshot?.widget?.conversationId === null,
    physicalCalls: safeInteger(snapshot?.widget?.physicalCalls),
    logicalMessages: safeInteger(snapshot?.widget?.logicalMessages),
    customerMessages: safeInteger(snapshot?.widget?.customerMessages),
    knownCostMicros: safeMoney(snapshot?.widget?.knownCostMicros),
    unresolvedReserveMicros: safeMoney(snapshot?.widget?.unresolvedReserveMicros),
  },
});
export const collectWidgetReadiness = async (read, readBudget, report, scope = readinessScope) => {
  if (!validScope(scope)) throw Object.assign(new Error(), { code: "READINESS_SCOPE_INVALID" });
  const rows = await read(readinessSessionSql, [scope.session, scope.channel, scope.origin]);
  const row = rows.length === 1 && scopeMatches(rows[0], scope) ? rows[0] : undefined;
  const sessionReady = sessionReadinessPass(rows, scope);
  report("exact_widget_session", sessionReady, {
    session_id: scope.session,
    channel_connection_id: scope.channel,
    allowed_origin_id: scope.origin,
    row_count: rows.length,
    scope_matches: row !== undefined,
    status: ["active", "expired", "revoked"].includes(row?.status) ? row.status : null,
    version:
      typeof row?.version === "string" && /^[0-9]{1,10}$/u.test(row.version) ? row.version : null,
    issued_at: timestamp(row?.issued_at),
    last_seen_at: timestamp(row?.last_seen_at),
    expires_at: timestamp(row?.expires_at),
    ...Object.fromEntries(
      [
        "contact_unbound",
        "conversation_unbound",
        "not_revoked",
        "channel_active",
        "origin_active",
        "absolute_valid",
        "idle_valid",
      ].map((key) => [key, row?.[key] === true]),
    ),
  });
  // An expired session is not an exception: collect the budget too, without renewing/reselecting it.
  const snapshot = await readBudget();
  const budgetReady = budgetReadinessPass(snapshot, scope);
  report("cohort_reservation_accounting", budgetReady, sanitizeReadinessBudget(snapshot, scope));
  report("first_message_readiness", sessionReady && budgetReady, {
    session_ready: sessionReady,
    budget_ready: budgetReady,
    ready: sessionReady && budgetReady,
    remaining_customer_messages: budgetReady ? 2 : 0,
    remaining_physical_attempts: budgetReady ? 4 : 0,
    no_message_or_call_triggered: true,
  });
  return { sessionReady, budgetReady };
};
export const readinessFailureCodes = new Set([
  "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED",
  "FORCE_RLS_NOT_OWNER_GUARD_FAILED",
  "READINESS_START_INVALID",
  "READINESS_SCOPE_INVALID",
  "COHORT_SCOPE_INVALID",
  "TENANT_MISMATCH",
  "DATABASE_UNAVAILABLE",
  "DATABASE_OR_TOOLING_UNAVAILABLE",
  "DATABASE_CLEANUP_FAILED",
]);
const rollback = new Error("EXPECTED_READ_ONLY_ROLLBACK");
const fail = (code) => {
  throw Object.assign(new Error(), { code });
};
export const runReadOnlyReadiness = async () => {
  let runtime,
    failures = 0,
    stage = "initialize",
    reportedGuards = false;
  const report = (assertion, pass, observed) => {
    if (!pass) failures++;
    console.log(
      JSON.stringify({
        operation: readinessOperation,
        assertion,
        outcome: pass ? "PASS" : "FAIL",
        observed,
      }),
    );
  };
  const blocked = (assertion, error, fallback = "DATABASE_OR_TOOLING_UNAVAILABLE") => {
    failures++;
    const code = readinessFailureCodes.has(error?.code) ? error.code : fallback;
    const sqlstate = [
      "08001",
      "08004",
      "08006",
      "25006",
      "25P02",
      "28000",
      "28P01",
      "42501",
      "42601",
      "42703",
      "42P01",
      "42P18",
      "53300",
      "53400",
      "55P03",
      "57014",
      "57P01",
    ].includes(error?.code)
      ? error.code
      : null;
    console.log(
      JSON.stringify({
        operation: readinessOperation,
        assertion,
        outcome: "BLOCKED",
        code,
        ...(sqlstate === null ? {} : { sqlstate }),
      }),
    );
  };
  try {
    stage = "selection_scope";
    const scope = parseReadinessScope(process.env.S22_WIDGET_READINESS_SESSION_ID);
    stage = "collection_window";
    const startedAt = process.env.S22_WIDGET_READINESS_STARTED_AT;
    if (timestamp(startedAt) !== startedAt) fail("READINESS_START_INVALID");
    stage = "package_resolution";
    const config = await import("@lead-agent/config");
    const db = await import("@lead-agent/database");
    const internal = await import(
      new URL("./runtime/tenant.js", import.meta.resolve("@lead-agent/database")).href
    );
    stage = "cohort_scope";
    if (
      config.S22_BOOKING_COHORT.organizationId !== scope.organization ||
      config.S22_BOOKING_COHORT.conversationId !== "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7" ||
      config.S22_BOOKING_COHORT.historicalReserveMicros !== 1_033_396n ||
      config.S22_BOOKING_COHORT.hardCeilingMicros !== 10_000_000n
    )
      fail("COHORT_SCOPE_INVALID");
    stage = "database_configuration";
    const url = new URL(config.withLibpqCompatibleRequireSsl(process.env.DATABASE_URL));
    url.searchParams.set(
      "options",
      "-c default_transaction_read_only=on -c row_security=on -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000",
    );
    runtime = db.createTenantDatabaseRuntime(
      config.createTenantDatabaseRuntimeConfig({
        connectionString: url.toString(),
        maxConnections: 1,
        connectionTimeoutMilliseconds: 5000,
        statementTimeoutMilliseconds: 5000,
        idleTimeoutMilliseconds: 5000,
      }),
      { onUnexpectedPoolError: (error) => blocked("pool_error", error, "DATABASE_UNAVAILABLE") },
    );
    stage = "database_readiness";
    await runtime.verifyReady();
    const readOnly = async (tenant, callback) => {
      if (tenant !== scope.organization) fail("TENANT_MISMATCH");
      const callbackStage = stage;
      let result;
      try {
        await runtime.withTenantTransaction(tenant, async (session) => {
          const read = async (text, extra = []) =>
            (
              await internal.executeTenantQuery(session, (org) => ({
                text,
                values: [org, ...extra],
              }))
            ).rows;
          stage = "runtime_read_only_tenant_guard";
          const guards = await read(
            `select current_user='lead_agent_runtime' and session_user=current_user as runtime,
            current_database()='lead_agent_staging' as staging_database,
            not r.rolsuper and not r.rolbypassrls as least_privilege,
            current_setting('transaction_read_only')='on' as read_only,
            current_setting('row_security')='on' as row_security,
            current_setting('app.organization_id')=$1 as tenant_matches,
            now()>=$2::timestamptz-interval '30 seconds' and now()<=$2::timestamptz+interval '5 minutes' as collection_window_valid
            from pg_catalog.pg_roles r where r.rolname=current_user limit 1`,
            [startedAt],
          );
          if (
            guards.length !== 1 ||
            ![
              "runtime",
              "staging_database",
              "least_privilege",
              "read_only",
              "row_security",
              "tenant_matches",
              "collection_window_valid",
            ].every((key) => guards[0][key] === true)
          )
            fail("READ_ONLY_RUNTIME_TENANT_GUARD_FAILED");
          if (!reportedGuards) report(stage, true, guards[0]);
          stage = "force_rls_not_owner_guard";
          const rls = await read(readinessForceRlsSql, [readinessForceRlsTableNames]);
          if (
            rls.length !== 1 ||
            rls[0].count !== readinessForceRlsTableNames.length ||
            rls[0].safe !== true
          )
            fail("FORCE_RLS_NOT_OWNER_GUARD_FAILED");
          if (!reportedGuards) report(stage, true, rls[0]);
          reportedGuards = true;
          stage = callbackStage;
          result = await callback(session);
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return result;
    };
    const readOnlyRuntime = {
      withTenantTransaction: readOnly,
      verifyReady: () => runtime.verifyReady(),
      close: () => runtime.close(),
    };
    const budget = db.createAIJourneyBudgetGuard(readOnlyRuntime, {
      ...config.S22_BOOKING_COHORT,
      mode: "widget_booking",
      widgetSessionId: scope.session,
    });
    await collectWidgetReadiness(
      (text, extra) =>
        readOnly(scope.organization, async (session) => {
          stage = "exact_widget_session";
          return (
            await internal.executeTenantQuery(session, (org) => ({ text, values: [org, ...extra] }))
          ).rows;
        }),
      () => {
        stage = "cohort_reservation_accounting";
        return budget.read(scope.organization);
      },
      report,
      scope,
    );
  } catch (error) {
    blocked(stage, error);
  } finally {
    if (runtime !== undefined)
      try {
        await runtime.close();
      } catch (error) {
        blocked("cleanup", error, "DATABASE_CLEANUP_FAILED");
      }
    if (failures > 0) process.exitCode = 1;
  }
};
if (process.env.S22_WIDGET_READINESS_READ === "execute" && import.meta.url.endsWith("/[eval1]"))
  await runReadOnlyReadiness();
