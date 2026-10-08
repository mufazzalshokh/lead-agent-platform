// Actual ES-module stdin in /app. No provider, migration, writes or customer content.
export const selectionOrganization = "01a0ee39-91a9-7293-82c0-5b7046c10115";
export const selectionOperation = "s22_widget_session_selection";
const rollback = new Error("EXPECTED_READ_ONLY_ROLLBACK");
export const selectionFailureCodes = new Set([
  "SELECTION_SCOPE_INVALID",
  "READ_ONLY_RUNTIME_TENANT_GUARD_FAILED",
  "FORCE_RLS_NOT_OWNER_GUARD_FAILED",
  "EXACT_ORIGIN_NOT_ACTIVE",
  "EXACT_ORIGIN_AMBIGUOUS",
  "NO_FRESH_UNBOUND_SESSION",
  "FRESH_SESSION_AMBIGUOUS",
  "FRESH_SESSION_STATE_INVALID",
  "DATABASE_UNAVAILABLE",
  "DATABASE_OR_TOOLING_UNAVAILABLE",
  "DATABASE_CLEANUP_FAILED",
]);
const fail = (code) => {
  throw Object.assign(new Error(), { code });
};
const resourceId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const timestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export const parseSelectionScope = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("SELECTION_SCOPE_INVALID");
  if (Object.keys(value).sort().join() !== "from,origin,until") fail("SELECTION_SCOPE_INVALID");
  let origin;
  try {
    origin = new URL(value.origin);
  } catch {
    fail("SELECTION_SCOPE_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    !origin.hostname.endsWith(".cloudshell.dev") ||
    value.origin !== origin.origin ||
    timestamp(value.from) !== value.from ||
    timestamp(value.until) !== value.until ||
    Date.parse(value.until) - Date.parse(value.from) !== 300_000
  )
    fail("SELECTION_SCOPE_INVALID");
  return {
    origin: origin.origin,
    host: origin.hostname,
    port: origin.port === "" ? null : Number(origin.port),
    from: value.from,
    until: value.until,
  };
};

export const collectWidgetSessionSelection = async (read, scope, report) => {
  const origins = await read(
    `select o.id::text as allowed_origin_id,c.id::text as channel_connection_id
     from widget_allowed_origins o join channel_connections c
       on c.organization_id=$1 and c.id=o.channel_connection_id
     where o.organization_id=$1 and o.status='active' and c.status='active'
       and c.channel_type='widget' and o.match_type='exact' and o.scheme='https'
       and o.normalized_host=$2 and o.port is not distinct from $3::integer
     order by o.id limit 2`,
    [scope.host, scope.port],
  );
  if (origins.length === 0) fail("EXACT_ORIGIN_NOT_ACTIVE");
  if (origins.length !== 1) fail("EXACT_ORIGIN_AMBIGUOUS");
  const origin = origins[0];
  if (!resourceId(origin.allowed_origin_id) || !resourceId(origin.channel_connection_id))
    fail("FRESH_SESSION_STATE_INVALID");
  report("exact_active_widget_origin", {
    allowed_origin_id: origin.allowed_origin_id,
    channel_connection_id: origin.channel_connection_id,
    count: 1,
    match_type: "exact",
  });
  const rows = await read(
    `select s.id::text as session_id,s.channel_connection_id::text,
       s.widget_allowed_origin_id::text as allowed_origin_id,s.status,s.version::text,
       s.issued_at,s.last_seen_at,s.expires_at,
       s.contact_id is null as contact_unbound,s.conversation_id is null as conversation_unbound,
       s.revoked_at is null as not_revoked,
       s.expires_at>now() and s.last_seen_at>now()-interval '30 minutes' as lifetime_valid
     from widget_sessions s
     where s.organization_id=$1 and s.channel_connection_id=$2 and s.widget_allowed_origin_id=$3
       and s.status='active' and s.revoked_at is null
       and s.contact_id is null and s.conversation_id is null
       and s.issued_at>=$4::timestamptz and s.issued_at<=$5::timestamptz
     order by s.issued_at desc,s.id limit 2`,
    [origin.channel_connection_id, origin.allowed_origin_id, scope.from, scope.until],
  );
  if (rows.length === 0) fail("NO_FRESH_UNBOUND_SESSION");
  if (rows.length !== 1) fail("FRESH_SESSION_AMBIGUOUS");
  const row = rows[0];
  const issued = timestamp(row.issued_at),
    lastSeen = timestamp(row.last_seen_at),
    expires = timestamp(row.expires_at);
  if (
    !resourceId(row.session_id) ||
    row.channel_connection_id !== origin.channel_connection_id ||
    row.allowed_origin_id !== origin.allowed_origin_id ||
    row.status !== "active" ||
    row.version !== "2" ||
    row.contact_unbound !== true ||
    row.conversation_unbound !== true ||
    row.not_revoked !== true ||
    row.lifetime_valid !== true ||
    issued === null ||
    lastSeen === null ||
    expires === null ||
    issued < scope.from ||
    issued > scope.until ||
    lastSeen < issued ||
    expires <= lastSeen
  )
    fail("FRESH_SESSION_STATE_INVALID");
  // Version 2 matches fresh redemption, but alone does not prove its execution:
  // legacy authorize can also touch a session. Correlate with owner's fresh frame.
  const selected = {
    session_id: row.session_id,
    channel_connection_id: row.channel_connection_id,
    allowed_origin_id: row.allowed_origin_id,
    count: 1,
    status: "active",
    version: "2",
    issued_at: issued,
    last_seen_at: lastSeen,
    expires_at: expires,
    contact_unbound: true,
    conversation_unbound: true,
    lifetime_valid: true,
    redemption_evidence: "VERSION_2_REQUIRES_OWNER_FRESH_FRAME_CORROBORATION",
  };
  report("fresh_unbound_widget_session", selected);
  return selected;
};

export const runReadOnlySelection = async () => {
  let runtime,
    failures = 0,
    stage = "initialize";
  const report = (assertion, observed) =>
    console.log(
      JSON.stringify({ operation: selectionOperation, assertion, outcome: "PASS", observed }),
    );
  const blocked = (assertion, code) => {
    failures++;
    console.log(
      JSON.stringify({ operation: selectionOperation, assertion, outcome: "BLOCKED", code }),
    );
  };
  try {
    let scope;
    try {
      scope = parseSelectionScope(
        JSON.parse(
          Buffer.from(process.env.S22_WIDGET_SESSION_SCOPE_B64 ?? "", "base64").toString(),
        ),
      );
    } catch {
      fail("SELECTION_SCOPE_INVALID");
    }
    const config = await import("@lead-agent/config");
    const db = await import("@lead-agent/database");
    const internal = await import(
      new URL("./runtime/tenant.js", import.meta.resolve("@lead-agent/database")).href
    );
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
      { onUnexpectedPoolError: () => blocked("pool_error", "DATABASE_UNAVAILABLE") },
    );
    await runtime.verifyReady();
    try {
      await runtime.withTenantTransaction(selectionOrganization, async (session) => {
        const read = async (text, extra = []) =>
          (await internal.executeTenantQuery(session, (org) => ({ text, values: [org, ...extra] })))
            .rows;
        stage = "runtime_read_only_tenant_guard";
        const guard = await read(
          `select current_user='lead_agent_runtime' and session_user=current_user as runtime,
           current_database()='lead_agent_staging' as staging_database,
           not r.rolsuper and not r.rolbypassrls as least_privilege,
           current_setting('transaction_read_only')='on' as read_only,
           current_setting('row_security')='on' as row_security,
           current_setting('app.organization_id')=$1 as tenant_matches,
           now()>=$2::timestamptz-interval '30 seconds'
             and now()<=$2::timestamptz+interval '5 minutes' as collection_window_valid
           from pg_catalog.pg_roles r where r.rolname=current_user limit 1`,
          [scope.until],
        );
        if (guard.length !== 1 || Object.values(guard[0]).some((value) => value !== true))
          fail("READ_ONLY_RUNTIME_TENANT_GUARD_FAILED");
        report(stage, guard[0]);
        stage = "force_rls_not_owner_guard";
        const rls = await read(
          `select count(*)::integer as count,
           bool_and(c.relrowsecurity and c.relforcerowsecurity
             and c.relowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)) as safe
           from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname=any($2::text[])`,
          [["widget_sessions", "widget_allowed_origins", "channel_connections"]],
        );
        if (rls.length !== 1 || rls[0].count !== 3 || rls[0].safe !== true)
          fail("FORCE_RLS_NOT_OWNER_GUARD_FAILED");
        report(stage, rls[0]);
        stage = "widget_session_selection";
        await collectWidgetSessionSelection(read, scope, report);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  } catch (error) {
    blocked(
      stage,
      selectionFailureCodes.has(error?.code) ? error.code : "DATABASE_OR_TOOLING_UNAVAILABLE",
    );
  } finally {
    if (runtime !== undefined)
      try {
        await runtime.close();
      } catch {
        blocked("cleanup", "DATABASE_CLEANUP_FAILED");
      }
    if (failures > 0) process.exitCode = 1;
  }
};

if (process.env.S22_WIDGET_SESSION_READ === "execute" && import.meta.url.endsWith("/[eval1]"))
  await runReadOnlySelection();
