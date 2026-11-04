// Preparation only. Importing or invoking this module never opens a browser,
// executes a Cloud Run job, connects to a database or constructs a provider.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const replacementScope = Object.freeze({
  organization: "01a0ee39-91a9-7293-82c0-5b7046c10115",
  anchor: "01a11c48-dbc2-76de-a873-f41664da5ccb",
  channel: "01a11771-2c02-7240-86f7-19f95690d22e",
  origin: "01a11771-2c02-7765-b999-7dc9895ee49d",
  retiredSession: "01a12a04-d2ae-7cba-aded-0c48a410be0c",
  retiredConversation: "01a12a13-2f0a-7cb4-a8c7-8f0051168d39",
  retiredMessage: "01a12a13-2f0a-728c-9cdb-30fa521911c2",
  retiredRun: "01a12a13-389a-7ede-8073-99fe1edf5672",
  retiredRequest: "01a12a13-498e-7d43-83cf-85b13307bd7b",
  historicalConversation: "01a1067f-d7d8-7e7e-9fb0-39bfe2f7cdc7",
  historicalRuns: Object.freeze([
    "01a1067f-dfc8-7e14-9e12-89a0e30fd27e",
    "01a10af4-5126-7ce8-ab52-0424e07ab3d9",
  ]),
});
export const replacementLimits = Object.freeze({
  newCustomerMessages: 2,
  newPhysicalAttempts: 3,
  physicalAttemptsPerMessage: 2,
  perAttemptReserveMicros: "801432",
  historicalReserveMicros: "1033396",
  combinedExposureCapMicros: "4247838",
  hardCeilingMicros: "10000000",
  retainedWidgetCustomerMessages: 1,
  retainedWidgetPhysicalAttempts: 1,
  retainedWidgetCostMicros: "2250",
  priorPhysicalAttempts: 5,
  priorPaidTriggerMessages: 5,
  priorKnownCostMicros: "10964",
  priorCombinedExposureMicros: "1044360",
});
export const replacementPlan = Object.freeze({
  profile: "s22-widget-replacement-preparation.v1",
  status: "PREPARATION_ONLY",
  scope: replacementScope,
  limits: replacementLimits,
  newReserveBoundMicros: (
    BigInt(replacementLimits.perAttemptReserveMicros) *
    BigInt(replacementLimits.newPhysicalAttempts)
  ).toString(),
  plannedCombinedExposureBoundMicros: (
    BigInt(replacementLimits.priorCombinedExposureMicros) +
    BigInt(replacementLimits.perAttemptReserveMicros) *
      BigInt(replacementLimits.newPhysicalAttempts)
  ).toString(),
  maximumWidgetPhysicalAttemptsIncludingRetired: 4,
  maximumWidgetCustomerMessagesIncludingRetired: 3,
  runtimeGuardImplemented: false,
  liveBaselineCollected: false,
  deploymentAuthorized: false,
  sessionCreationAuthorized: false,
  sendAuthorized: false,
  historicalAccountingComplete: false,
});
export const replacementPlanSha256 = createHash("sha256")
  .update(JSON.stringify(replacementPlan))
  .digest("hex");
const fail = (code) => {
  throw Object.assign(new Error(), { code });
};
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const instant = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};
const one = (rows) => (Array.isArray(rows) && rows.length === 1 ? rows[0] : null);
export const replacementRlsTables = Object.freeze([
  "widget_sessions",
  "widget_allowed_origins",
  "channel_connections",
  "contacts",
  "conversations",
  "messages",
  "ai_runs",
  "audit_events",
  "appointment_requests",
]);
// The adapter must use one transaction, READ ONLY, trusted tenant context and
// bounded timeouts. Arguments include tenant explicitly: no client tenant discovery.
export const replacementQueries = Object.freeze({
  guards: `select current_user='lead_agent_runtime' and session_user=current_user as runtime,
    current_database()='lead_agent_staging' as staging_database,
    not r.rolsuper and not r.rolbypassrls as least_privilege,
    current_setting('transaction_read_only')='on' as read_only,
    current_setting('row_security')='on' as row_security,
    current_setting('app.organization_id')=$1 as tenant_matches,
    now()>=$2::timestamptz-interval '30 seconds' and now()<=$2::timestamptz+interval '5 minutes' as fresh
    from pg_catalog.pg_roles r where r.rolname=current_user limit 1`,
  rls: `select count(*)::integer as count,
    bool_and(c.relrowsecurity and c.relforcerowsecurity
      and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($2::text[]) and $1::uuid is not null limit 1`,
  historical: `select count(*)::integer as count,
    bool_and(r.estimated_cost_micros is null) as costs_still_unknown
    from (select estimated_cost_micros from ai_runs where organization_id=$1
      and conversation_id=$2 and id=any($3::uuid[]) limit 3) r limit 1`,
  selection: `select metadata_redacted_jsonb->>'selected_session_id' as selected_session_id,
    metadata_redacted_jsonb->>'selection_version' as selection_version,
    metadata_redacted_jsonb->>'expected_selection_version' as expected_selection_version,
    metadata_redacted_jsonb->>'expected_session_version' as expected_session_version,
    metadata_redacted_jsonb->>'channel_connection_id' as channel_connection_id,
    metadata_redacted_jsonb->>'allowed_origin_id' as allowed_origin_id,
    actor_type='member' and actor_id is not null and actor_membership_id is not null as attributed
    from audit_events where organization_id=$1 and target_type='widget_session' and target_id=$2
      and action='ai_run.widget_cohort_selected' and result='succeeded'
      and metadata_redacted_jsonb->>'profile'='s22-widget-selection.v1'
    order by occurred_at,id limit 17`,
  retired: `select s.organization_id::text,s.id::text as session_id,s.conversation_id::text,
    s.channel_connection_id::text,s.widget_allowed_origin_id::text as allowed_origin_id,
    s.recovery_token_hash is null and s.access_expires_at is null as proof_not_issued,
    coalesce(s.access_expires_at,s.expires_at)<=now() as access_expired,
    s.revoked_at is null as not_revoked,
    cv.contact_id=s.contact_id and cv.channel_connection_id=s.channel_connection_id as owns_conversation,
    ar.id::text as request_id,ar.status as request_status,ar.version::text as request_version,
    ar.offer_version,
    (select count(*)::integer from (select m.id from messages m
      where m.organization_id=$1 and m.conversation_id=$3 and m.direction='inbound' limit 2) m) as customer_messages,
    exists(select 1 from messages m where m.organization_id=$1 and m.id=$7
      and m.conversation_id=$3 and m.channel_connection_id=$4 and m.direction='inbound') as message_matches
    from widget_sessions s join conversations cv on cv.organization_id=$1 and cv.id=s.conversation_id
    join appointment_requests ar on ar.organization_id=$1 and ar.conversation_id=cv.id and ar.id=$6
    where s.organization_id=$1 and s.id=$2 and s.conversation_id=$3
      and s.channel_connection_id=$4 and s.widget_allowed_origin_id=$5 limit 2`,
  binding: `select target_id::text as session_id,
    metadata_redacted_jsonb->>'widget_session_id' as widget_session_id,
    metadata_redacted_jsonb->>'conversation_id' as conversation_id
    from audit_events where organization_id=$1 and action='ai_run.widget_journey_bound'
      and target_type='widget_session' and result='succeeded'
      and metadata_redacted_jsonb->>'profile'='s22-synthetic-booking.v1' limit 3`,
  run: `select r.id::text,r.conversation_id::text,r.trigger_message_id::text,r.status,
    r.estimated_cost_micros::text,r.finished_at is not null as finished,
    r.provider_id,r.requested_model_id,r.provider_resolved_model_id,
    (select count(*)::integer from (select a.id from audit_events a where a.organization_id=$1
      and a.target_type='ai_run' and a.target_id=r.id and a.action='ai_run.dispatch_reserved'
      limit 2) a) as reservations,
    (select a.metadata_redacted_jsonb->>'widget_session_id' from audit_events a
      where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id
      and a.action='ai_run.dispatch_reserved' order by a.occurred_at,a.id limit 1) as widget_session_id,
    (select a.metadata_redacted_jsonb->>'conversation_id' from audit_events a
      where a.organization_id=$1 and a.target_type='ai_run' and a.target_id=r.id
      and a.action='ai_run.dispatch_reserved' order by a.occurred_at,a.id limit 1) as widget_conversation_id
    from ai_runs r where r.organization_id=$1 and r.id=$2 and r.conversation_id=$3
      and r.trigger_message_id=$4 limit 2`,
});
export const collectReplacementBaseline = async ({ read, readBudget, startedAt }) => {
  if (instant(startedAt) === null) fail("REPLACEMENT_COLLECTION_TIME_INVALID");
  const s = replacementScope;
  const guards = one(await read(replacementQueries.guards, [s.organization, startedAt]));
  if (
    ![
      "runtime",
      "staging_database",
      "least_privilege",
      "read_only",
      "row_security",
      "tenant_matches",
      "fresh",
    ].every((key) => guards?.[key] === true)
  )
    fail("REPLACEMENT_RUNTIME_GUARD_FAILED");
  const rls = one(await read(replacementQueries.rls, [s.organization, replacementRlsTables]));
  if (rls?.count !== replacementRlsTables.length || rls.safe !== true)
    fail("REPLACEMENT_RLS_GUARD_FAILED");
  const historical = one(
    await read(replacementQueries.historical, [
      s.organization,
      s.historicalConversation,
      s.historicalRuns,
    ]),
  );
  if (historical?.count !== 2 || historical.costs_still_unknown !== true)
    fail("REPLACEMENT_HISTORICAL_COST_CHANGED");
  const selections = await read(replacementQueries.selection, [s.organization, s.anchor]);
  if (
    !Array.isArray(selections) ||
    selections.length === 0 ||
    selections.length >= 16 ||
    selections.some((row) => !/^[1-9][0-9]?$/u.test(row?.selection_version ?? ""))
  )
    fail("REPLACEMENT_SELECTION_CHANGED");
  const ordered = [...selections].sort(
    (a, b) => Number(a.selection_version) - Number(b.selection_version),
  );
  if (
    ordered.some(
      (row, index) =>
        row.selection_version !== String(index + 1) ||
        row.expected_selection_version !== String(index) ||
        row.expected_session_version !== "2" ||
        row.channel_connection_id !== s.channel ||
        row.allowed_origin_id !== s.origin ||
        row.attributed !== true ||
        !uuid(row.selected_session_id),
    ) ||
    ordered.at(-1).selected_session_id !== s.retiredSession
  )
    fail("REPLACEMENT_SELECTION_CHANGED");
  const retired = one(
    await read(replacementQueries.retired, [
      s.organization,
      s.retiredSession,
      s.retiredConversation,
      s.channel,
      s.origin,
      s.retiredRequest,
      s.retiredMessage,
    ]),
  );
  if (
    retired?.organization_id !== s.organization ||
    retired.session_id !== s.retiredSession ||
    retired.conversation_id !== s.retiredConversation ||
    retired.channel_connection_id !== s.channel ||
    retired.allowed_origin_id !== s.origin ||
    retired.request_id !== s.retiredRequest ||
    retired.request_status !== "requested" ||
    retired.request_version !== "1" ||
    retired.offer_version !== 0 ||
    retired.customer_messages !== 1 ||
    ![
      "proof_not_issued",
      "access_expired",
      "not_revoked",
      "owns_conversation",
      "message_matches",
    ].every((key) => retired[key] === true)
  )
    fail("REPLACEMENT_RETIRED_SCOPE_CHANGED");
  const binding = one(await read(replacementQueries.binding, [s.organization]));
  if (
    binding?.session_id !== s.retiredSession ||
    binding.widget_session_id !== s.retiredSession ||
    binding.conversation_id !== s.retiredConversation
  )
    fail("REPLACEMENT_BINDING_CHANGED");
  const run = one(
    await read(replacementQueries.run, [
      s.organization,
      s.retiredRun,
      s.retiredConversation,
      s.retiredMessage,
    ]),
  );
  if (
    run?.id !== s.retiredRun ||
    run.conversation_id !== s.retiredConversation ||
    run.trigger_message_id !== s.retiredMessage ||
    run.widget_session_id !== s.retiredSession ||
    run.widget_conversation_id !== s.retiredConversation ||
    run.status !== "succeeded" ||
    run.finished !== true ||
    run.reservations !== 1 ||
    run.estimated_cost_micros !== "2250" ||
    run.provider_id !== "gemini" ||
    run.requested_model_id !== "gemini-3.8-flash" ||
    run.provider_resolved_model_id !== "gemini-3.8-flash"
  )
    fail("REPLACEMENT_RETIRED_RUN_CHANGED");
  const budget = await readBudget();
  if (
    budget?.profile !== "s22-synthetic-booking.v1" ||
    budget.mode !== "widget_booking" ||
    budget.physicalCalls !== 5 ||
    budget.logicalMessages !== 5 ||
    budget.knownCostMicros !== "10964" ||
    budget.unresolvedReserveMicros !== "0" ||
    budget.historicalReserveMicros !== "1033396" ||
    budget.combinedExposureMicros !== "1044360" ||
    budget.perCallReserveMicros !== "801432" ||
    budget.accountingComplete !== false ||
    budget.blocked !== true ||
    !["widget_session_unavailable", "widget_binding_integrity"].includes(budget.reason) ||
    budget.widget?.sessionId !== s.retiredSession
  )
    fail("REPLACEMENT_LEDGER_CHANGED");
  return Object.freeze({
    outcome: "BASELINE_MATCHES_PREPARED_PLAN",
    planSha256: replacementPlanSha256,
    retainedCustomerMessages: 1,
    retainedPhysicalAttempts: 1,
    knownCostMicros: "10964",
    pendingReserveMicros: "0",
    historicalAccountingComplete: false,
    runtimeGuardImplemented: false,
    sendAuthorized: false,
  });
};

export const recoveryAccessSql = `select s.organization_id::text,s.id::text as session_id,
  s.conversation_id::text,s.channel_connection_id::text,s.widget_allowed_origin_id::text as allowed_origin_id,
  s.status,s.revoked_at is null as not_revoked,s.issued_at,s.expires_at,s.last_seen_at,
  s.access_issued_at,s.access_expires_at,s.recovery_issued_at,s.recovery_expires_at,
  now() as observed_at,s.recovery_token_hash is not null as proof_exists,
  c.status='active' and c.channel_type='widget' as channel_active,
  o.status='active' and o.match_type='exact' and o.scheme='https' as origin_active,
  cv.contact_id=s.contact_id and cv.channel_connection_id=s.channel_connection_id as owns_conversation,
  cv.status in ('open','awaiting_lead','awaiting_staff') as conversation_nonterminal,
  ct.status='active' as contact_active
  from widget_sessions s join channel_connections c on c.organization_id=$1 and c.id=s.channel_connection_id
  join widget_allowed_origins o on o.organization_id=$1 and o.id=s.widget_allowed_origin_id
    and o.channel_connection_id=s.channel_connection_id
  join conversations cv on cv.organization_id=$1 and cv.id=s.conversation_id
  join contacts ct on ct.organization_id=$1 and ct.id=s.contact_id
  where s.organization_id=$1 and s.id=$2 and s.conversation_id=$3
    and s.channel_connection_id=$4 and s.widget_allowed_origin_id=$5 limit 2`;
// Observation only. Caller must corroborate this identity before and after
// recovery, inside the guarded transaction above; it is never a bearer selector.
export const assessRecoveredAccess = (rows, expected) => {
  if (
    !expected ||
    Object.keys(expected).sort().join() !== "conversation,session" ||
    !uuid(expected.session) ||
    !uuid(expected.conversation) ||
    expected.session === replacementScope.retiredSession
  )
    fail("RECOVERY_EXPECTATION_INVALID");
  const row = one(rows),
    s = replacementScope;
  if (
    row?.organization_id !== s.organization ||
    row.session_id !== expected.session ||
    row.conversation_id !== expected.conversation ||
    row.channel_connection_id !== s.channel ||
    row.allowed_origin_id !== s.origin ||
    row.status !== "active" ||
    ![
      "not_revoked",
      "proof_exists",
      "channel_active",
      "origin_active",
      "owns_conversation",
      "conversation_nonterminal",
      "contact_active",
    ].every((key) => row[key] === true)
  )
    return false;
  const keys = [
    "issued_at",
    "expires_at",
    "last_seen_at",
    "access_issued_at",
    "access_expires_at",
    "recovery_issued_at",
    "recovery_expires_at",
    "observed_at",
  ];
  const times = Object.fromEntries(keys.map((key) => [key, instant(row[key])]));
  if (keys.some((key) => times[key] === null)) return false;
  return (
    times.expires_at > times.issued_at &&
    times.expires_at <= times.issued_at + 7_200_000 &&
    times.recovery_issued_at >= times.issued_at &&
    times.recovery_expires_at === times.recovery_issued_at + 86_400_000 &&
    times.access_issued_at >= times.recovery_issued_at &&
    times.access_issued_at <= times.observed_at &&
    times.access_expires_at > times.observed_at &&
    times.access_expires_at <= times.access_issued_at + 7_200_000 &&
    times.access_expires_at <= times.recovery_expires_at &&
    times.last_seen_at >= times.access_issued_at &&
    times.last_seen_at <= times.observed_at &&
    times.last_seen_at > times.observed_at - 1_800_000
  );
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--plan") {
    console.error("REPLACEMENT_PREPARATION_ARGUMENTS_INVALID");
    process.exitCode = 1;
  } else
    console.log(JSON.stringify({ plan: replacementPlan, sha256: replacementPlanSha256 }, null, 2));
}
