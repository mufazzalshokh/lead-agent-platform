const operation = "staging_database_validation";

const expectedRlsTables = [
  "ai_action_evaluations",
  "ai_runs",
  "analytics_events",
  "appointment_confirmation_evidence",
  "appointment_request_attendance",
  "appointment_request_preferences",
  "appointment_request_transitions",
  "appointment_requests",
  "appointment_revenue_attributions",
  "audit_events",
  "business_policies",
  "channel_connections",
  "consent_records",
  "contact_identities",
  "contacts",
  "conversations",
  "faqs",
  "handoff_transitions",
  "handoffs",
  "idempotency_keys",
  "inbound_routes",
  "lead_qualification_evaluations",
  "lead_qualification_evidence",
  "leads",
  "legal_holds",
  "location_business_hours",
  "location_closures",
  "location_versions",
  "locations",
  "membership_invitations",
  "membership_location_scopes",
  "memberships",
  "messages",
  "notification_attempts",
  "notifications",
  "organizations",
  "outbox_events",
  "privacy_requests",
  "retention_policies",
  "retention_policy_rules",
  "service_locations",
  "service_prices",
  "service_versions",
  "services",
  "thread_automation_controls",
  "webhook_receipts",
  "widget_allowed_origins",
  "widget_sessions",
].sort();

const applicationRoleUrls = Object.freeze({
  AUTH_DATABASE_URL: "lead_agent_auth",
  DATABASE_URL: "lead_agent_runtime",
  INGRESS_DATABASE_URL: "lead_agent_ingress",
  QUEUE_DATABASE_URL: "lead_agent_queue_runtime",
});

const definerRoles = [
  "lead_agent_async_maintenance_definer",
  "lead_agent_identity_definer",
  "lead_agent_inbound_route_definer",
  "lead_agent_membership_definer",
  "lead_agent_outbox_relay_definer",
  "lead_agent_worker_reliability_definer",
].sort();

const safeError = (error) => {
  const candidate = typeof error === "object" && error !== null ? error : undefined;
  const name =
    candidate && "name" in candidate && typeof candidate.name === "string"
      ? candidate.name
      : "UnknownError";
  const rawCode =
    candidate && "code" in candidate && typeof candidate.code === "string"
      ? candidate.code
      : "unavailable";
  const code = /^[0-9A-Z_]{2,32}$/u.test(rawCode) ? rawCode : "unavailable";
  return { error_code: code, error_name: name.slice(0, 80) };
};

const required = (key) => {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    const error = new Error("Required validator environment is unavailable");
    error.code = "ENV_UNAVAILABLE";
    throw error;
  }
  return value;
};

const results = [];
const check = async ({ assertion, expected, failureCode }, inspect) => {
  try {
    const { observed, pass } = await inspect();
    const result = {
      assertion,
      expected,
      failure_code: failureCode,
      observed,
      operation,
      outcome: pass ? "PASS" : "FAIL",
    };
    results.push(result);
    console.info(JSON.stringify(result));
  } catch (error) {
    const result = {
      assertion,
      expected,
      failure_code: failureCode,
      observed: safeError(error),
      operation,
      outcome: "FAIL",
    };
    results.push(result);
    console.info(JSON.stringify(result));
  }
};

const dependencyUnavailable = () => {
  const error = new Error("Validator dependency is unavailable");
  error.code = "DEPENDENCY_UNAVAILABLE";
  return error;
};

const main = async () => {
  const { withLibpqCompatibleRequireSsl } = await import("@lead-agent/config");
  const { Pool } = await import("pg");
  const { readStagingMigrationManifest, stagingRolePasswordFromUrl } =
    await import("./dist/migrate.js");

  const pools = [];
  const rolePools = new Map();
  let admin;
  let manifest;

  await check(
    {
      assertion: "migration_count",
      expected: 30,
      failureCode: "S22V001_MIGRATION_COUNT",
    },
    async () => {
      manifest = await readStagingMigrationManifest();
      return { observed: manifest.entries.length, pass: manifest.entries.length === 30 };
    },
  );

  await check(
    {
      assertion: "migration_head",
      expected: "0029_s21_thread_automation_controls",
      failureCode: "S22V002_MIGRATION_HEAD",
    },
    async () => {
      manifest ??= await readStagingMigrationManifest();
      const observed = manifest.entries.at(-1)?.tag ?? "unavailable";
      return { observed, pass: observed === "0029_s21_thread_automation_controls" };
    },
  );

  await check(
    {
      assertion: "migration_admin_connectivity",
      expected: { database: "lead_agent_staging", postgresql_major: 17 },
      failureCode: "S22V003_MIGRATION_ADMIN_CONNECTIVITY",
    },
    async () => {
      const pool = new Pool({
        application_name: "lead-agent-staging-validator",
        connectionString: withLibpqCompatibleRequireSsl(required("MIGRATION_DATABASE_URL")),
        connectionTimeoutMillis: 15_000,
        max: 1,
        query_timeout: 15_000,
      });
      pools.push(pool);
      admin = await pool.connect();
      const identity = await admin.query(
        "select current_database() as database_name, current_setting('server_version_num')::integer as server_version_num",
      );
      const databaseName = identity.rows[0]?.database_name ?? "unavailable";
      const serverVersion = identity.rows[0]?.server_version_num ?? 0;
      const observed = {
        database: databaseName,
        postgresql_major: Math.trunc(serverVersion / 10_000),
      };
      return {
        observed,
        pass:
          databaseName === "lead_agent_staging" &&
          serverVersion >= 170_000 &&
          serverVersion < 180_000,
      };
    },
  );

  const withAdmin = async (inspect) => {
    if (admin === undefined) throw dependencyUnavailable();
    return inspect(admin);
  };

  await check(
    {
      assertion: "applied_migration_count",
      expected: 30,
      failureCode: "S22V004_APPLIED_MIGRATION_COUNT",
    },
    () =>
      withAdmin(async (client) => {
        const applied = await client.query(
          "select count(*)::integer as count from drizzle.__drizzle_migrations",
        );
        const observed = applied.rows[0]?.count ?? 0;
        return { observed, pass: observed === 30 };
      }),
  );

  await check(
    {
      assertion: "applied_migration_head",
      expected: "0029_s21_thread_automation_controls",
      failureCode: "S22V005_APPLIED_MIGRATION_HEAD",
    },
    () =>
      withAdmin(async (client) => {
        manifest ??= await readStagingMigrationManifest();
        const head = manifest.entries.at(-1);
        const applied = await client.query(
          "select max(created_at)::text as latest_applied_when from drizzle.__drizzle_migrations",
        );
        const latestAppliedWhen = applied.rows[0]?.latest_applied_when ?? "unavailable";
        const observed = {
          latest_applied_when: latestAppliedWhen,
          packaged_head: head?.tag ?? "unavailable",
        };
        return {
          observed,
          pass:
            head?.tag === "0029_s21_thread_automation_controls" &&
            latestAppliedWhen === String(head.when),
        };
      }),
  );

  await check(
    {
      assertion: "production_table_count",
      expected: 52,
      failureCode: "S22V006_PRODUCTION_TABLE_COUNT",
    },
    () =>
      withAdmin(async (client) => {
        const tables = await client.query(
          "select count(*)::integer as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
        );
        const observed = tables.rows[0]?.count ?? 0;
        return { observed, pass: observed === 52 };
      }),
  );

  await check(
    {
      assertion: "force_rls_manifest",
      expected: expectedRlsTables,
      failureCode: "S22V007_FORCE_RLS_MANIFEST",
    },
    () =>
      withAdmin(async (client) => {
        const rls = await client.query(
          "select relname from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity and relforcerowsecurity order by relname",
        );
        const observed = rls.rows.map(({ relname }) => relname).sort();
        return {
          observed,
          pass: JSON.stringify(observed) === JSON.stringify(expectedRlsTables),
        };
      }),
  );

  await check(
    {
      assertion: "required_nologin_definer_roles",
      expected: {
        bypassrls: false,
        login: false,
        roles: definerRoles,
        superuser: false,
      },
      failureCode: "S22V008_DEFINER_ROLE_MANIFEST",
    },
    () =>
      withAdmin(async (client) => {
        const roles = await client.query(
          "select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_catalog.pg_roles where rolname = any($1::text[]) order by rolname",
          [definerRoles],
        );
        const observed = roles.rows.map((role) => ({
          bypassrls: role.rolbypassrls,
          login: role.rolcanlogin,
          role: role.rolname,
          superuser: role.rolsuper,
        }));
        const secure = roles.rows.every(
          (role) =>
            role.rolcanlogin === false &&
            role.rolsuper === false &&
            role.rolcreatedb === false &&
            role.rolcreaterole === false &&
            role.rolreplication === false &&
            role.rolbypassrls === false,
        );
        return {
          observed,
          pass:
            roles.rows.length === definerRoles.length &&
            roles.rows.map(({ rolname }) => rolname).join(",") === definerRoles.join(",") &&
            secure,
        };
      }),
  );

  await check(
    {
      assertion: "forbidden_bypassrls_roles",
      expected: [],
      failureCode: "S22V009_FORBIDDEN_BYPASSRLS",
    },
    () =>
      withAdmin(async (client) => {
        const roles = await client.query(
          "select rolname from pg_catalog.pg_roles where rolname like 'lead\\_agent\\_%' escape '\\' and rolbypassrls order by rolname",
        );
        const observed = roles.rows.map(({ rolname }) => rolname);
        return { observed, pass: observed.length === 0 };
      }),
  );

  for (const [index, role] of Object.values(applicationRoleUrls).entries()) {
    await check(
      {
        assertion: `${role}_exists`,
        expected: { bypassrls: false, login: true, role },
        failureCode: `S22V01${index}_APPLICATION_ROLE`,
      },
      () =>
        withAdmin(async (client) => {
          const roles = await client.query(
            "select rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls from pg_catalog.pg_roles where rolname = $1",
            [role],
          );
          const record = roles.rows[0];
          const observed = record
            ? {
                bypassrls: record.rolbypassrls,
                login: record.rolcanlogin,
                role: record.rolname,
                superuser: record.rolsuper,
              }
            : { role: "missing" };
          return {
            observed,
            pass:
              record?.rolname === role &&
              record.rolcanlogin === true &&
              record.rolsuper === false &&
              record.rolcreatedb === false &&
              record.rolcreaterole === false &&
              record.rolreplication === false &&
              record.rolbypassrls === false,
          };
        }),
    );
  }

  for (const [index, [key, role]] of Object.entries(applicationRoleUrls).entries()) {
    await check(
      {
        assertion: `${role}_connectivity`,
        expected: { database: "lead_agent_staging", role },
        failureCode: `S22V02${index}_ROLE_CONNECTIVITY`,
      },
      async () => {
        const connectionString = required(key);
        stagingRolePasswordFromUrl(connectionString, role);
        const pool = new Pool({
          application_name: `lead-agent-staging-${role}-validator`,
          connectionString: withLibpqCompatibleRequireSsl(connectionString),
          connectionTimeoutMillis: 15_000,
          max: 1,
          query_timeout: 15_000,
        });
        pools.push(pool);
        rolePools.set(role, pool);
        const identity = await pool.query(
          "select current_user as role_name, current_database() as database_name",
        );
        const observed = {
          database: identity.rows[0]?.database_name ?? "unavailable",
          role: identity.rows[0]?.role_name ?? "unavailable",
        };
        return {
          observed,
          pass: observed.database === "lead_agent_staging" && observed.role === role,
        };
      },
    );
  }

  await check(
    {
      assertion: "inbound_route_security_definer",
      expected: {
        ingress_execute: true,
        owner: "lead_agent_inbound_route_definer",
        runtime_execute: false,
        search_path: "pg_catalog",
        security_definer: true,
      },
      failureCode: "S22V030_INBOUND_SECURITY_DEFINER",
    },
    () =>
      withAdmin(async (client) => {
        const functions = await client.query(
          `select owner.rolname as owner_name,
                  procedure.prosecdef as security_definer,
                  procedure.proconfig as configuration,
                  pg_catalog.has_function_privilege('lead_agent_ingress', procedure.oid, 'EXECUTE') as ingress_execute,
                  pg_catalog.has_function_privilege('lead_agent_runtime', procedure.oid, 'EXECUTE') as runtime_execute
             from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
            where procedure.oid = 'app.resolve_inbound_route(character varying,bytea)'::regprocedure`,
        );
        const fn = functions.rows[0];
        const observed = fn
          ? {
              ingress_execute: fn.ingress_execute,
              owner: fn.owner_name,
              runtime_execute: fn.runtime_execute,
              search_path: Array.isArray(fn.configuration)
                ? (fn.configuration.find((value) => value.startsWith("search_path=")) ?? "missing")
                : "missing",
              security_definer: fn.security_definer,
            }
          : { function: "missing" };
        return {
          observed,
          pass:
            fn?.owner_name === "lead_agent_inbound_route_definer" &&
            fn.security_definer === true &&
            fn.ingress_execute === true &&
            fn.runtime_execute === false &&
            Array.isArray(fn.configuration) &&
            fn.configuration.includes("search_path=pg_catalog"),
        };
      }),
  );

  await check(
    {
      assertion: "inbound_route_security_definer_behavior",
      expected: { unknown_route_rows: 0 },
      failureCode: "S22V031_INBOUND_SECURITY_DEFINER_BEHAVIOR",
    },
    async () => {
      const ingress = rolePools.get("lead_agent_ingress");
      if (ingress === undefined) throw dependencyUnavailable();
      const resolved = await ingress.query(
        "select count(*)::integer as count from app.resolve_inbound_route($1::character varying, $2::bytea)",
        ["widget_key", Buffer.alloc(32, 0xa5)],
      );
      const observed = { unknown_route_rows: resolved.rows[0]?.count ?? -1 };
      return { observed, pass: observed.unknown_route_rows === 0 };
    },
  );

  await check(
    {
      assertion: "ingress_direct_table_denial",
      expected: { denied: true, sqlstate: "42501" },
      failureCode: "S22V032_INGRESS_DIRECT_TABLE_DENIAL",
    },
    async () => {
      const ingress = rolePools.get("lead_agent_ingress");
      if (ingress === undefined) throw dependencyUnavailable();
      try {
        await ingress.query("select 1 from public.inbound_routes limit 1");
        return { observed: { denied: false, sqlstate: "NONE" }, pass: false };
      } catch (error) {
        const { error_code: sqlstate } = safeError(error);
        return { observed: { denied: true, sqlstate }, pass: sqlstate === "42501" };
      }
    },
  );

  await check(
    {
      assertion: "cross_tenant_denial",
      expected: { visible_cross_tenant_rows: 0 },
      failureCode: "S22V033_CROSS_TENANT_DENIAL",
    },
    async () => {
      const runtime = rolePools.get("lead_agent_runtime");
      if (admin === undefined || runtime === undefined) throw dependencyUnavailable();
      const target = await admin.query(
        "select id::text as organization_id from public.organizations order by id limit 1",
      );
      const targetId = target.rows[0]?.organization_id;
      const tenantId =
        targetId === "00000000-0000-4000-8000-000000000001"
          ? "00000000-0000-4000-8000-000000000002"
          : "00000000-0000-4000-8000-000000000001";
      const client = await runtime.connect();
      try {
        await client.query("begin read only");
        await client.query("select set_config('app.organization_id', $1, true)", [tenantId]);
        const visible =
          typeof targetId === "string"
            ? await client.query(
                "select count(*)::integer as count from public.organizations where id = $1::uuid",
                [targetId],
              )
            : await client.query("select count(*)::integer as count from public.organizations");
        const policy = await admin.query(
          `select count(*)::integer as count
             from pg_catalog.pg_policy
            where polrelid = 'public.organizations'::regclass
              and polname = 'organizations_tenant_isolation'
              and pg_catalog.pg_get_expr(polqual, polrelid) like '%app.current_organization_id()%'`,
        );
        const observed = {
          policy_matches: policy.rows[0]?.count ?? 0,
          target_fixture_available: typeof targetId === "string",
          visible_cross_tenant_rows: visible.rows[0]?.count ?? -1,
        };
        return {
          observed,
          pass: observed.policy_matches === 1 && observed.visible_cross_tenant_rows === 0,
        };
      } finally {
        await client.query("rollback").catch(() => {});
        client.release();
      }
    },
  );

  admin?.release();
  await Promise.all(pools.map(async (pool) => pool.end().catch(() => {})));

  const failures = results.filter(({ outcome }) => outcome === "FAIL");
  const summary = {
    assertion_count: results.length,
    failed_assertions: failures.map(({ failure_code: failureCode }) => failureCode),
    failure_count: failures.length,
    operation,
    outcome: failures.length === 0 ? "PASS" : "FAIL",
    summary: true,
  };
  console.info(JSON.stringify(summary));
  if (failures.length > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.info(
    JSON.stringify({
      assertion: "validator_bootstrap",
      expected: "validator dependencies available",
      failure_code: "S22V000_VALIDATOR_BOOTSTRAP",
      observed: safeError(error),
      operation,
      outcome: "FAIL",
      summary: true,
    }),
  );
  process.exitCode = 1;
});
