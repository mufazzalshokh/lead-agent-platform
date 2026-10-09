// Actual ESM stdin in /app: metadata SELECTs only, no provider or session renewal.
export const attemptOperation = "s22_widget_attempt_read";
export const attemptScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  session: "01a11b7d-ddbf-759e-b4e3-1602d9e2238c",
  channel: "01a11771-2c02-7240-86f7-19f95690d22e",
  origin: "01a11771-2c02-7765-b999-7dc9895ee49d",
  windowStart: "2026-10-08T12:58:00.000Z",
  windowEnd: "2026-10-08T13:03:00.000Z",
});
export const attemptAssertions = Object.freeze([
  "runtime_read_only_tenant_guard",
  "force_rls_not_owner_guard",
  "widget_attempt_session",
  "widget_attempt_messages",
  "widget_attempt_runs",
  "widget_attempt_actions",
  "widget_attempt_outbox",
  "widget_attempt_requests",
  "cohort_reservation_accounting",
  "widget_attempt_collection",
]);
export const attemptForceRlsTableNames = Object.freeze([
  "widget_sessions",
  "widget_allowed_origins",
  "channel_connections",
  "contacts",
  "conversations",
  "messages",
  "ai_runs",
  "ai_action_evaluations",
  "audit_events",
  "outbox_events",
  "appointment_requests",
]);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    ? value
    : null;
const digits = (value) =>
  typeof value === "string" && /^[0-9]{1,20}$/u.test(value) ? value : null;
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const date = (value) => {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
const bool = (value) => (typeof value === "boolean" ? value : null);
const oneOf = (value, values) => (values.includes(value) ? value : null);
const code = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(value) && value.length <= 100
    ? value
    : null;
const fail = (failure) => {
  throw Object.assign(new Error(), { code: failure });
};
export const attemptSessionSql = `select s.organization_id::text,s.id::text as session_id,
  s.channel_connection_id::text,s.widget_allowed_origin_id::text as allowed_origin_id,
  s.status,s.version::text,s.issued_at,s.last_seen_at,s.expires_at,s.conversation_id::text,
  cv.status as conversation_status,cv.version::text as conversation_version,
  cv.automation_mode,cv.active_handoff_id is null as no_active_handoff,
  s.contact_id is null as contact_unbound,s.conversation_id is null as conversation_unbound,
  s.revoked_at is null as not_revoked,
  c.status='active' and c.channel_type='widget' as channel_active,
  o.status='active' and o.match_type='exact' and o.scheme='https' as origin_active,
  s.expires_at>now() as absolute_valid,s.last_seen_at>now()-interval '30 minutes' as idle_valid,
  (s.conversation_id is null and s.contact_id is null) or cv.id is not null as conversation_ownership_matches
  from widget_sessions s
  join channel_connections c on c.organization_id=$1 and c.id=s.channel_connection_id
  join widget_allowed_origins o on o.organization_id=$1 and o.id=s.widget_allowed_origin_id
    and o.channel_connection_id=s.channel_connection_id
  left join conversations cv on cv.organization_id=$1 and cv.id=s.conversation_id
    and cv.channel_connection_id=s.channel_connection_id and cv.contact_id=s.contact_id
  where s.organization_id=$1 and s.id=$2::uuid and s.channel_connection_id=$3::uuid
    and s.widget_allowed_origin_id=$4::uuid limit 2`;
const triggerJoin = `join messages m on m.organization_id=$1 and m.id=r.trigger_message_id
  and m.conversation_id=r.conversation_id and m.channel_connection_id=$3::uuid`;
const triggerFilter = `r.organization_id=$1 and r.conversation_id=$2::uuid and m.direction='inbound'
  and m.created_at >= $4::timestamptz and m.created_at < $5::timestamptz`;
export const attemptQueries = Object.freeze({
  widget_attempt_messages: `select m.id::text,m.direction,m.sequence_no::text,m.processing_status,
    m.delivery_status,m.reply_to_message_id::text,m.ai_run_id::text,m.created_at
    from messages m where m.organization_id=$1 and m.conversation_id=$2::uuid
      and m.channel_connection_id=$3::uuid and m.created_at >= $4::timestamptz
      and m.created_at < $5::timestamptz order by m.created_at,m.id limit 21`,
  widget_attempt_runs: `select r.id::text,r.trigger_message_id::text,r.status,r.attempt_no,
    r.expected_conversation_version::text,r.schema_valid,r.policy_allowed,r.failure_category,
    r.input_units::text,r.output_units::text,r.cached_input_units::text,r.total_units::text,
    r.estimated_cost_micros::text,r.cost_currency,r.cost_catalog_version,
    r.provider_id,r.requested_model_id,r.provider_resolved_model_id,
    r.started_at,r.finished_at,r.correlation_id::text,
    (select count(*)::integer from (select a.id from audit_events a where a.organization_id=$1
      and a.target_type='ai_run' and a.target_id=r.id and a.action='ai_run.dispatch_reserved'
      limit 3) slots) as reservations,
    (select a.metadata_redacted_jsonb->>'reservation_micros' from audit_events a
      where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id
        and a.action='ai_run.dispatch_reserved' order by a.occurred_at,a.id limit 1) as reserved_micros,
    (select a.metadata_redacted_jsonb->>'dispatch_authorized' from audit_events a
      where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id
        and a.action in ('ai_run.completed','ai_run.failed','ai_run.schema_rejected','ai_run.policy_denied')
      order by a.occurred_at desc,a.id desc limit 1) as dispatch_authorized
    from ai_runs r ${triggerJoin} where ${triggerFilter}
    order by r.started_at,r.id limit 11`,
  widget_attempt_actions: `select a.id::text,a.ai_run_id::text,a.action_name,a.validation_status,
    a.policy_reason_code,a.application_status,a.target_aggregate_type,a.target_aggregate_id::text,
    a.started_at,a.finished_at from ai_action_evaluations a
    join ai_runs r on r.organization_id=$1 and r.id=a.ai_run_id
    ${triggerJoin} where a.organization_id=$1 and ${triggerFilter}
    order by a.started_at,a.id limit 11`,
  widget_attempt_outbox: `select o.id::text,o.event_type,o.aggregate_type,o.aggregate_id::text,
    o.aggregate_version::text,o.status,o.attempt_count,o.available_at,o.published_at,
    o.last_error_category,o.correlation_id::text,o.causation_id::text,o.occurred_at
    from outbox_events o where o.organization_id=$1 and o.occurred_at >= $4::timestamptz
      and o.occurred_at < $5::timestamptz and $3::uuid is not null and (
        (o.aggregate_type='conversation' and o.aggregate_id=$2::uuid)
        or (o.aggregate_type='ai_run' and exists(select 1 from ai_runs r
          where r.organization_id=$1 and r.id=o.aggregate_id and r.conversation_id=$2::uuid))
        or (o.aggregate_type='appointment_request' and exists(select 1 from appointment_requests ar
          where ar.organization_id=$1 and ar.id=o.aggregate_id and ar.conversation_id=$2::uuid))
      ) order by o.occurred_at,o.id limit 31`,
  widget_attempt_requests: `select r.id::text,r.source_message_id::text,r.status,r.version::text,
    r.offer_version,r.created_at from appointment_requests r
    where r.organization_id=$1 and r.conversation_id=$2::uuid and $3::uuid is not null
      and r.created_at >= $4::timestamptz and r.created_at < $5::timestamptz
    order by r.created_at,r.id limit 6`,
});
const fieldSanitizers = {
  ...Object.fromEntries(
    "id trigger_message_id reply_to_message_id ai_run_id target_aggregate_id aggregate_id source_message_id correlation_id causation_id"
      .split(" ")
      .map((key) => [key, uuid]),
  ),
  direction: (v) => oneOf(v, ["inbound", "outbound", "staff_internal"]),
  sequence_no: digits,
  version: digits,
  conversation_version: digits,
  conversation_status: (v) =>
    oneOf(v, ["open", "awaiting_lead", "awaiting_staff", "resolved", "closed"]),
  automation_mode: (v) => oneOf(v, ["ai", "paused", "staff"]),
  no_active_handoff: bool,
  expected_conversation_version: digits,
  aggregate_version: digits,
  processing_status: (v) =>
    oneOf(v, ["accepted", "processing", "processed", "failed", "suppressed"]),
  delivery_status: (v) => oneOf(v, ["not_applicable", "queued", "sent", "delivered", "failed"]),
  status: (v) =>
    oneOf(v, [
      "started",
      "succeeded",
      "failed",
      "schema_rejected",
      "policy_denied",
      "stale",
      "cancelled",
      "pending",
      "processing",
      "published",
      "dead_lettered",
      "requested",
      "staff_accepted",
      "awaiting_customer_confirmation",
      "confirmed",
      "rejected",
      "expired",
    ]),
  attempt_no: count,
  attempt_count: count,
  offer_version: count,
  reservations: count,
  schema_valid: bool,
  policy_allowed: bool,
  failure_category: code,
  input_units: digits,
  output_units: digits,
  cached_input_units: digits,
  total_units: digits,
  estimated_cost_micros: digits,
  reserved_micros: digits,
  cost_currency: (v) => oneOf(v, ["USD"]),
  cost_catalog_version: (v) => oneOf(v, ["ai-provider-prices.2026-09-17.v1", "not-priced.v1"]),
  provider_id: (v) => oneOf(v, ["gemini"]),
  requested_model_id: (v) => oneOf(v, ["gemini-3.8-flash"]),
  provider_resolved_model_id: (v) => oneOf(v, ["gemini-3.8-flash"]),
  dispatch_authorized: (v) => oneOf(v, ["true", "false"]),
  action_name: (v) =>
    oneOf(v, [
      "none",
      "request_information",
      "create_appointment_request",
      "confirm_appointment",
      "decline_appointment",
      "request_handoff",
    ]),
  validation_status: (v) => oneOf(v, ["pending", "allowed", "denied", "malformed"]),
  policy_reason_code: code,
  application_status: (v) => oneOf(v, ["not_applied", "applied", "failed", "stale"]),
  target_aggregate_type: (v) => oneOf(v, ["conversation", "appointment_request", "handoff"]),
  aggregate_type: (v) => oneOf(v, ["conversation", "appointment_request", "ai_run"]),
  event_type: (v) =>
    oneOf(v, [
      "conversation.started",
      "message.received",
      "message.response_queued",
      "message.sent",
      "conversation.status_changed",
      "conversation.automation_mode_changed",
      "conversation.active_handoff_changed",
      "conversation.resolved",
      "conversation.closed",
      "ai_run.completed",
      "ai_run.failed",
      "ai_run.schema_rejected",
      "ai_run.policy_denied",
      "appointment_request.created",
      "appointment_request.staff_accepted",
      "appointment_request.customer_confirmation_requested",
      "appointment_request.confirmed",
      "appointment_request.rejected",
      "appointment_request.cancelled",
      "appointment_request.expired",
    ]),
  last_error_category: code,
  ...Object.fromEntries(
    "created_at started_at finished_at available_at published_at occurred_at"
      .split(" ")
      .map((key) => [key, date]),
  ),
};
export const sanitizeAttemptRow = (row) =>
  Object.fromEntries(
    Object.keys(row)
      .filter((key) => Object.hasOwn(fieldSanitizers, key))
      .map((key) => [key, fieldSanitizers[key](row[key])]),
  );
export const sanitizeAttemptValue = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const scalarFields = {
    ...fieldSanitizers,
    session_id: uuid,
    channel_connection_id: uuid,
    allowed_origin_id: uuid,
    conversation_id: uuid,
    issued_at: date,
    last_seen_at: date,
    expires_at: date,
    windowStart: date,
    windowEnd: date,
    sessionId: uuid,
    conversationId: uuid,
    physicalCalls: count,
    logicalMessages: count,
    customerMessages: count,
    count,
    knownCostMicros: digits,
    unresolvedReserveMicros: digits,
    historicalReserveMicros: digits,
    combinedExposureMicros: digits,
    perCallReserveMicros: digits,
    profile: (v) => oneOf(v, ["s22-synthetic-booking.v1"]),
    mode: (v) => oneOf(v, ["widget_booking"]),
    reason: code,
    query_state: (v) => oneOf(v, ["COLLECTED", "SKIPPED_UNBOUND_SESSION"]),
    status: (v) => oneOf(v, ["active", "expired", "revoked"]) ?? fieldSanitizers.status(v),
    ...Object.fromEntries(
      "contact_unbound conversation_unbound not_revoked channel_active origin_active absolute_valid idle_valid conversation_ownership_matches observation_only no_message_or_call_triggered historical_costs_not_reconciled accountingComplete blocked runtime staging_database least_privilege read_only row_security tenant_matches collection_window_valid safe"
        .split(" ")
        .map((key) => [key, bool]),
    ),
  };
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, field]) => {
      if (key === "rows")
        return [[key, Array.isArray(field) ? field.slice(0, 31).map(sanitizeAttemptValue) : []]];
      if (key === "widget") return [[key, sanitizeAttemptValue(field)]];
      return Object.hasOwn(scalarFields, key) ? [[key, scalarFields[key](field)]] : [];
    }),
  );
};
const project = (value, fields) =>
  sanitizeAttemptValue(Object.fromEntries(fields.split(" ").map((key) => [key, value?.[key]])));
export const sanitizeAttemptBudget = (snapshot, conversationId = null) => ({
  ...project(
    snapshot,
    "profile mode physicalCalls logicalMessages knownCostMicros unresolvedReserveMicros historicalReserveMicros combinedExposureMicros perCallReserveMicros accountingComplete blocked reason",
  ),
  widget: {
    ...project(
      snapshot?.widget,
      "physicalCalls logicalMessages customerMessages knownCostMicros unresolvedReserveMicros",
    ),
    sessionId: snapshot?.widget?.sessionId === attemptScope.session ? attemptScope.session : null,
    conversationId:
      conversationId !== null && snapshot?.widget?.conversationId === conversationId
        ? conversationId
        : null,
  },
});
export const collectWidgetAttempt = async (read, report) => {
  const scope = attemptScope;
  const rows = await read(attemptSessionSql, [scope.session, scope.channel, scope.origin]);
  const row = rows.length === 1 ? rows[0] : null;
  if (
    row?.organization_id !== scope.organization ||
    row.session_id !== scope.session ||
    row.channel_connection_id !== scope.channel ||
    row.allowed_origin_id !== scope.origin ||
    row.conversation_ownership_matches !== true ||
    !(
      (row.conversation_id === null &&
        row.contact_unbound === true &&
        row.conversation_unbound === true) ||
      (uuid(row.conversation_id) !== null &&
        row.contact_unbound === false &&
        row.conversation_unbound === false)
    )
  )
    fail("ATTEMPT_SESSION_SCOPE_INVALID");
  const conversationId = row.conversation_id;
  report("widget_attempt_session", true, {
    session_id: scope.session,
    channel_connection_id: scope.channel,
    allowed_origin_id: scope.origin,
    conversation_id: conversationId,
    conversation_status: fieldSanitizers.conversation_status(row.conversation_status),
    conversation_version: digits(row.conversation_version),
    automation_mode: fieldSanitizers.automation_mode(row.automation_mode),
    no_active_handoff: conversationId === null ? null : bool(row.no_active_handoff),
    status: oneOf(row.status, ["active", "expired", "revoked"]),
    version: digits(row.version),
    issued_at: date(row.issued_at),
    last_seen_at: date(row.last_seen_at),
    expires_at: date(row.expires_at),
    ...Object.fromEntries(
      [
        "contact_unbound",
        "conversation_unbound",
        "not_revoked",
        "channel_active",
        "origin_active",
        "absolute_valid",
        "idle_valid",
        "conversation_ownership_matches",
      ].map((key) => [key, bool(row[key])]),
    ),
    observation_only: true,
  });
  for (const [assertion, sql] of Object.entries(attemptQueries)) {
    const data =
      conversationId === null
        ? []
        : await read(sql, [conversationId, scope.channel, scope.windowStart, scope.windowEnd]);
    const limit =
      assertion === "widget_attempt_outbox"
        ? 31
        : assertion === "widget_attempt_messages"
          ? 21
          : assertion === "widget_attempt_requests"
            ? 6
            : 11;
    if (!Array.isArray(data) || data.length >= limit) fail("ATTEMPT_ROW_LIMIT_EXCEEDED");
    report(assertion, true, {
      conversation_id: conversationId,
      windowStart: scope.windowStart,
      windowEnd: scope.windowEnd,
      query_state: conversationId === null ? "SKIPPED_UNBOUND_SESSION" : "COLLECTED",
      rows: data.map(sanitizeAttemptRow),
      observation_only: true,
    });
  }
  return conversationId;
};
export const attemptFailureCodes = new Set([
  "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED",
  "FORCE_RLS_NOT_OWNER_GUARD_FAILED",
  "ATTEMPT_START_INVALID",
  "ATTEMPT_SESSION_SCOPE_INVALID",
  "ATTEMPT_ROW_LIMIT_EXCEEDED",
  "COHORT_SCOPE_INVALID",
  "TENANT_MISMATCH",
  "DATABASE_UNAVAILABLE",
  "DATABASE_OR_TOOLING_UNAVAILABLE",
  "DATABASE_CLEANUP_FAILED",
]);
const rollback = new Error("EXPECTED_READ_ONLY_ROLLBACK");
export const runReadOnlyWidgetAttempt = async () => {
  let runtime,
    failures = 0,
    stage = "initialize",
    reportedGuards = false;
  const report = (assertion, pass, observed) => {
    if (!pass) failures++;
    console.log(
      JSON.stringify({
        operation: attemptOperation,
        assertion,
        outcome: pass ? "PASS" : "FAIL",
        observed,
      }),
    );
  };
  const blocked = (assertion, error, fallback = "DATABASE_OR_TOOLING_UNAVAILABLE") => {
    failures++;
    const sqlstate = oneOf(error?.code, [
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
    ]);
    console.log(
      JSON.stringify({
        operation: attemptOperation,
        assertion,
        outcome: "BLOCKED",
        code: attemptFailureCodes.has(error?.code) ? error.code : fallback,
        ...(sqlstate === null ? {} : { sqlstate }),
      }),
    );
  };
  try {
    const scope = attemptScope;
    stage = "collection_window";
    const startedAt = process.env.S22_WIDGET_ATTEMPT_STARTED_AT;
    if (date(startedAt) !== startedAt) fail("ATTEMPT_START_INVALID");
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
            current_database()='lead_agent_staging' as staging_database,not r.rolsuper and not r.rolbypassrls as least_privilege,
            current_setting('transaction_read_only')='on' as read_only,current_setting('row_security')='on' as row_security,
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
          if (!reportedGuards) report(stage, true, sanitizeAttemptValue(guards[0]));
          stage = "force_rls_not_owner_guard";
          const rls = await read(
            `select count(*)::integer as count,bool_and(c.relrowsecurity and c.relforcerowsecurity
            and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
            from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relname=any($2::text[]) and $1::uuid is not null limit 1`,
            [attemptForceRlsTableNames],
          );
          if (
            rls.length !== 1 ||
            rls[0].count !== attemptForceRlsTableNames.length ||
            rls[0].safe !== true
          )
            fail("FORCE_RLS_NOT_OWNER_GUARD_FAILED");
          if (!reportedGuards) report(stage, true, sanitizeAttemptValue(rls[0]));
          reportedGuards = true;
          stage = callbackStage;
          result = await callback(session, read);
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return result;
    };
    stage = "widget_attempt_collection";
    const conversationId = await readOnly(scope.organization, async (_session, read) =>
      collectWidgetAttempt((text, extra) => {
        stage =
          text === attemptSessionSql
            ? "widget_attempt_session"
            : (Object.entries(attemptQueries).find(([, sql]) => sql === text)?.[0] ??
              "widget_attempt_collection");
        return read(text, extra);
      }, report),
    );
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
    stage = "cohort_reservation_accounting";
    report(
      stage,
      true,
      sanitizeAttemptBudget(await budget.read(scope.organization), conversationId),
    );
    report("widget_attempt_collection", true, {
      windowStart: scope.windowStart,
      windowEnd: scope.windowEnd,
      conversation_id: conversationId,
      observation_only: true,
      no_message_or_call_triggered: true,
      historical_costs_not_reconciled: true,
    });
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
if (process.env.S22_WIDGET_ATTEMPT_READ === "execute" && import.meta.url.endsWith("/[eval1]"))
  await runReadOnlyWidgetAttempt();
