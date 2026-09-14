import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createQueueDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import {
  OutboxRelayRoleError,
  OutboxRelayValidationError,
  createOutboxDispatcherId,
  createOutboxRelayDatabaseRuntime,
  migrationsFolder,
  runMigrations,
  type OutboxRelayClaim,
  type OutboxRelayDatabaseRuntime,
} from "../../packages/database/src/index.js";

const S8_RELAY_MIGRATION = "0022_s8_outbox_relay_persistence.sql";
const S8_ACTIVE_ROUTE_MIGRATION = "0023_s8_active_route_claim.sql";
const QUEUE_RUNTIME_ROLE = "lead_agent_queue_runtime";
const TENANT_RUNTIME_ROLE = "lead_agent_runtime";
const RELAY_DEFINER_ROLE = "lead_agent_outbox_relay_definer";
const BUSINESS_TABLE_COUNT = 51;

const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-000000000001";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-000000000002";
const ORGANIZATION_C = "0193f1a8-7f65-7c28-a434-000000000003";
const ORGANIZATION_CREATED_ACTIVE_ROUTE = Object.freeze([
  Object.freeze({ eventType: "organization.created" as const, schemaVersion: "1" }),
]);

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

const isUnknownArray = (candidate: unknown): candidate is unknown[] => Array.isArray(candidate);

let container: StartedPostgreSqlContainer | undefined;
let ownerPool: Pool | undefined;
let queuePool: Pool | undefined;
let tenantPool: Pool | undefined;
let relayRuntime: OutboxRelayDatabaseRuntime | undefined;
let ownerConnectionString: string | undefined;
let queueConnectionString: string | undefined;
let serverVersion = "";
let pgbossUpgradeUnchanged = false;

const database = (): Pool => {
  if (ownerPool === undefined) throw new Error("Owner test pool is not initialized");
  return ownerPool;
};

const queueDatabase = (): Pool => {
  if (queuePool === undefined) throw new Error("Queue test pool is not initialized");
  return queuePool;
};

const tenantDatabase = (): Pool => {
  if (tenantPool === undefined) throw new Error("Tenant test pool is not initialized");
  return tenantPool;
};

const runtime = (): OutboxRelayDatabaseRuntime => {
  if (relayRuntime === undefined) throw new Error("Relay runtime is not initialized");
  return relayRuntime;
};

const requireTestDatabaseUrl = (): string | undefined => {
  const value = process.env["TEST_DATABASE_URL"];
  if (value === undefined) return undefined;

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !/(^|[_-])test([_-]|$)/iu.test(databaseName)
  ) {
    throw new Error("TEST_DATABASE_URL must identify an explicitly named PostgreSQL test database");
  }
  return value;
};

const requireEmptyExternalTestDatabase = async (testPool: Pool): Promise<void> => {
  const tables = await testPool.query<{ count: number }>(
    `select count(*)::integer as count
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('information_schema', 'pg_catalog')`,
  );
  if (tables.rows[0]?.count !== 0) {
    throw new Error("TEST_DATABASE_URL must point to a fresh, empty disposable test database");
  }
};

const publicTableCount = async (queryable: Pool | PoolClient): Promise<number> => {
  const result = await queryable.query<{ count: number }>(
    `select count(*)::integer as count
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'`,
  );
  return result.rows[0]?.count ?? -1;
};

const applyMigrationSql = async (testPool: Pool, filename: string): Promise<void> => {
  const migrationSql = await readFile(join(migrationsFolder, filename), "utf8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  const client = await testPool.connect();
  try {
    await client.query("begin");
    for (const statement of statements) await client.query(statement);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

const loadMigrationNames = async (): Promise<readonly string[]> => {
  const journalText = await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8");
  const journal: unknown = JSON.parse(journalText);
  if (typeof journal !== "object" || journal === null) {
    throw new Error("Invalid Drizzle migration journal");
  }
  const entries = "entries" in journal ? journal.entries : undefined;
  if (!isUnknownArray(entries)) throw new Error("Invalid Drizzle migration journal entries");
  const names = entries.map((entry): string => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Invalid Drizzle migration journal entry");
    }
    const tag = "tag" in entry ? entry.tag : undefined;
    if (typeof tag !== "string") throw new Error("Invalid Drizzle migration tag");
    return `${tag}.sql`;
  });
  if (names.at(-1) !== S8_ACTIVE_ROUTE_MIGRATION || names.length !== 24) {
    throw new Error("S8.3 must be the only migration after the accepted 0022 baseline");
  }
  return names;
};

const resetDatabaseSchemas = async (testPool: Pool): Promise<void> => {
  await testPool.query(
    `drop schema if exists pgboss cascade;
     drop schema if exists drizzle cascade;
     drop schema if exists app cascade;
     drop schema if exists public cascade;
     create schema public authorization current_user;`,
  );
};

const pgbossFingerprint = async (testPool: Pool): Promise<string> => {
  const result = await testPool.query<{
    functions: number;
    queues: number;
    relations: number;
    schema_version: number;
  }>(
    `select
       (select count(*)::integer from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pgboss') as functions,
       (select count(*)::integer from pgboss.queue) as queues,
       (select count(*)::integer from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pgboss') as relations,
       (select version from pgboss.version) as schema_version`,
  );
  return JSON.stringify(result.rows[0]);
};

const configureDisposableRolePassword = async (
  testPool: Pool,
  role: string,
  password: string,
): Promise<void> => {
  const result = await testPool.query<{ statement: string }>(
    "select pg_catalog.format('alter role %I password %L', $1::text, $2::text) as statement",
    [role, password],
  );
  const statement = result.rows[0]?.statement;
  if (statement === undefined) throw new Error(`Unable to configure disposable role ${role}`);
  await testPool.query(statement);
};

const connectionStringForRole = (role: string, password: string): string => {
  if (ownerConnectionString === undefined) {
    throw new Error("Owner connection string is not initialized");
  }
  const url = new URL(ownerConnectionString);
  url.username = role;
  url.password = password;
  return url.toString();
};

const insertOrganization = async (id: string, slug: string): Promise<void> => {
  await database().query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1::uuid, $2::varchar, $3::varchar, 'active', 'en', 'Asia/Tashkent')`,
    [id, slug, `S8.2 ${slug}`],
  );
};

const insertOutboxEvent = async (
  id: string,
  organizationId: string,
  aggregateVersion: number,
  availableAt = new Date(Date.now() - 1_000),
): Promise<void> => {
  const occurredAt = new Date(Math.min(availableAt.getTime(), Date.now()) - 1_000);
  await database().query(
    `insert into outbox_events
      (id, organization_id, event_type, schema_version, aggregate_type,
       aggregate_id, aggregate_version, payload_jsonb, correlation_id,
       causation_id, occurred_at, status, attempt_count, available_at)
     values ($1::uuid, $2::uuid, 'organization.created', '1', 'organization',
       $2::uuid, $3::bigint, $4::jsonb, $1::uuid, null, $5::timestamptz,
       'pending', 0, $6::timestamptz)`,
    [
      id,
      organizationId,
      aggregateVersion,
      JSON.stringify({ fixture: "s8.2" }),
      occurredAt,
      availableAt,
    ],
  );
};

const insertRoutedOutboxEvent = async (input: {
  aggregateType: string;
  eventType: string;
  id: string;
  organizationId: string;
  schemaVersion: string;
  version: number;
}): Promise<void> => {
  await database().query(
    `insert into outbox_events
      (id, organization_id, event_type, schema_version, aggregate_type,
       aggregate_id, aggregate_version, payload_jsonb, correlation_id,
       causation_id, occurred_at, status, attempt_count, available_at)
     values ($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::varchar,
       $1::uuid, $6::bigint, $7::jsonb, $1::uuid, null,
       clock_timestamp() - interval '2 seconds', 'pending', 0,
       clock_timestamp() - interval '1 second')`,
    [
      input.id,
      input.organizationId,
      input.eventType,
      input.schemaVersion,
      input.aggregateType,
      input.version,
      JSON.stringify({ fixture: "s8.3-active-route" }),
    ],
  );
};

const insertOutboxEvents = async (
  organizationId: string,
  count: number,
  suffixStart: number,
  availableAt = new Date(Date.now() - 1_000),
): Promise<readonly string[]> => {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = syntheticUuid(suffixStart + index);
    ids.push(id);
    await insertOutboxEvent(id, organizationId, suffixStart + index, availableAt);
  }
  return ids;
};

type RawClaim = {
  aggregate_id: string;
  aggregate_type: string;
  attempt_number: number;
  causation_id: string | null;
  correlation_id: string;
  event_type: string;
  lease_token: string;
  locked_until: Date;
  organization_id: string;
  outbox_event_id: string;
  schema_version: string;
};

const claimRaw = async (
  dispatcherId: string,
  batchSize = 50,
  leaseSeconds = 60,
): Promise<readonly RawClaim[]> => {
  const result = await queueDatabase().query<RawClaim>(
    `select * from app.claim_outbox_events(
      $1::varchar, $2::varchar[], $3::varchar[], $4::integer, $5::integer
    )`,
    [dispatcherId, ["organization.created"], ["1"], batchSize, leaseSeconds],
  );
  return result.rows;
};

const relayRow = async (id: string) => {
  const result = await database().query<{
    attempt_count: number;
    available_at: Date;
    last_error_category: string | null;
    lease_token: string | null;
    locked_by: string | null;
    locked_until: Date | null;
    payload_jsonb: unknown;
    published_at: Date | null;
    published_claim_token: string | null;
    status: string;
  }>(
    `select status, attempt_count, available_at, locked_by, locked_until,
            lease_token, published_at, published_claim_token,
            last_error_category, payload_jsonb
       from outbox_events
      where id = $1::uuid`,
    [id],
  );
  return result.rows[0];
};

beforeAll(async () => {
  const externalUrl = requireTestDatabaseUrl();
  if (externalUrl === undefined) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s82_test")
      .withUsername("lead_agent_s82_owner")
      .withPassword("s82-local-test-only-owner-password")
      .start();
    ownerConnectionString = container.getConnectionUri();
  } else {
    ownerConnectionString = externalUrl;
  }

  ownerPool = new Pool({ connectionString: ownerConnectionString, max: 6 });
  if (externalUrl !== undefined) await requireEmptyExternalTestDatabase(ownerPool);

  const versionResult = await ownerPool.query<{
    server_version: string;
    server_version_num: string;
  }>(
    "select current_setting('server_version') as server_version, current_setting('server_version_num') as server_version_num",
  );
  const versionNumber = Number(versionResult.rows[0]?.server_version_num);
  if (versionNumber < 170_000 || versionNumber >= 180_000) {
    throw new Error("S8.2 integration tests require PostgreSQL major version 17");
  }
  serverVersion = versionResult.rows[0]?.server_version ?? "";

  const migrationNames = await loadMigrationNames();
  for (const filename of migrationNames.slice(0, migrationNames.indexOf(S8_RELAY_MIGRATION))) {
    await applyMigrationSql(ownerPool, filename);
  }
  await applyMigrationSql(ownerPool, S8_RELAY_MIGRATION);
  const beforeUpgrade = await pgbossFingerprint(ownerPool);
  await applyMigrationSql(ownerPool, S8_ACTIVE_ROUTE_MIGRATION);
  pgbossUpgradeUnchanged = beforeUpgrade === (await pgbossFingerprint(ownerPool));

  await resetDatabaseSchemas(ownerPool);
  await runMigrations(ownerPool);
  await runMigrations(ownerPool);

  const queuePassword = "s82-local-test-only-queue-password";
  const tenantPassword = "s82-local-test-only-tenant-password";
  await configureDisposableRolePassword(ownerPool, QUEUE_RUNTIME_ROLE, queuePassword);
  await configureDisposableRolePassword(ownerPool, TENANT_RUNTIME_ROLE, tenantPassword);
  queueConnectionString = connectionStringForRole(QUEUE_RUNTIME_ROLE, queuePassword);
  queuePool = new Pool({ connectionString: queueConnectionString, max: 4 });
  tenantPool = new Pool({
    connectionString: connectionStringForRole(TENANT_RUNTIME_ROLE, tenantPassword),
    max: 1,
  });
  relayRuntime = createOutboxRelayDatabaseRuntime(
    createQueueDatabaseRuntimeConfig({
      connectionString: queueConnectionString,
      maxConnections: 4,
    }),
    { onUnexpectedPoolError: () => undefined },
  );
}, 180_000);

beforeEach(async () => {
  await database().query("truncate table outbox_events, organizations cascade");
  await insertOrganization(ORGANIZATION_A, "s82-tenant-a");
  await insertOrganization(ORGANIZATION_B, "s82-tenant-b");
  await insertOrganization(ORGANIZATION_C, "s82-tenant-c");
});

afterAll(async () => {
  await relayRuntime?.close();
  await tenantPool?.end();
  await queuePool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("S8.2/S8.3 PostgreSQL 17 narrow outbox relay persistence", { timeout: 30_000 }, () => {
  it("upgrades 0022 to 0023 without changing business tables or pg-boss", async () => {
    expect(serverVersion).toMatch(/^17\.11(?:\.|\s|$)/u);
    expect(pgbossUpgradeUnchanged).toBe(true);
    expect(await publicTableCount(database())).toBe(BUSINESS_TABLE_COUNT);
    const migrations = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrations.rows).toEqual([{ count: 24 }]);
  });

  it("exposes only the minimal typed claim result without payload", async () => {
    await insertOutboxEvent(syntheticUuid(0x100), ORGANIZATION_A, 1);
    const claims = await runtime().claimBatch({
      activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
      dispatcherId: createOutboxDispatcherId("dispatcher.s82-a"),
      batchSize: 1,
    });
    expect(claims).toHaveLength(1);
    const claim = claims[0] as OutboxRelayClaim;
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.keys(claim)).toEqual([
      "outboxEventId",
      "organizationId",
      "eventType",
      "schemaVersion",
      "aggregateType",
      "aggregateId",
      "correlationId",
      "causationId",
      "leaseToken",
      "lockedUntil",
      "attemptNumber",
    ]);
    expect(claim.organizationId).toBe(ORGANIZATION_A);
    expect(claim.eventType).toBe("organization.created");
    expect(claim.attemptNumber).toBe(1);
    expect("payload_jsonb" in claim).toBe(false);
    expect("payload" in claim).toBe(false);
  });

  it("leaves every pending event untouched when the active route set is empty", async () => {
    const id = syntheticUuid(0x101);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    await expect(
      runtime().claimBatch({
        activeRoutes: [],
        dispatcherId: createOutboxDispatcherId("dispatcher.empty-routes"),
      }),
    ).resolves.toEqual([]);
    expect(await relayRow(id)).toMatchObject({
      attempt_count: 0,
      lease_token: null,
      locked_by: null,
      locked_until: null,
      status: "pending",
    });
  });

  it("treats an unknown exact pair as ineligible and rejects malformed route arrays", async () => {
    const id = syntheticUuid(0x105);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const unknown = await queueDatabase().query<RawClaim>(
      `select * from app.claim_outbox_events(
        'dispatcher.unknown-route', array['future.event']::varchar[],
        array['1']::varchar[], 1, 60
      )`,
    );
    expect(unknown.rows).toEqual([]);
    expect(await relayRow(id)).toMatchObject({ attempt_count: 0, status: "pending" });

    await expect(
      queueDatabase().query(
        `select * from app.claim_outbox_events(
          'dispatcher.bad-cardinality', array['organization.created']::varchar[],
          array[]::varchar[], 1, 60
        )`,
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        `select * from app.claim_outbox_events(
          'dispatcher.duplicate-route',
          array['organization.created', 'organization.created']::varchar[],
          array['1', '1']::varchar[], 1, 60
        )`,
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("activates lead.reopened V1 and V2 independently before leasing", async () => {
    const v1Id = syntheticUuid(0x102);
    const v2Id = syntheticUuid(0x103);
    await insertRoutedOutboxEvent({
      aggregateType: "lead",
      eventType: "lead.reopened",
      id: v1Id,
      organizationId: ORGANIZATION_A,
      schemaVersion: "1",
      version: 1,
    });
    await insertRoutedOutboxEvent({
      aggregateType: "lead",
      eventType: "lead.reopened",
      id: v2Id,
      organizationId: ORGANIZATION_A,
      schemaVersion: "2",
      version: 2,
    });

    const v1Claims = await runtime().claimBatch({
      activeRoutes: [{ eventType: "lead.reopened", schemaVersion: "1" }],
      dispatcherId: createOutboxDispatcherId("dispatcher.reopened-v1"),
    });
    expect(v1Claims.map(({ outboxEventId }) => outboxEventId)).toEqual([v1Id]);
    expect(await relayRow(v2Id)).toMatchObject({ attempt_count: 0, status: "pending" });
    const v1Claim = v1Claims[0];
    if (v1Claim === undefined) throw new Error("Expected V1 claim");
    await runtime().markDeadLettered({ ...v1Claim, errorCategory: "permanent" });

    const v2Claims = await runtime().claimBatch({
      activeRoutes: [{ eventType: "lead.reopened", schemaVersion: "2" }],
      dispatcherId: createOutboxDispatcherId("dispatcher.reopened-v2"),
    });
    expect(v2Claims.map(({ outboxEventId }) => outboxEventId)).toEqual([v2Id]);
    expect(await relayRow(v2Id)).toMatchObject({ attempt_count: 1, status: "processing" });
  });

  it("reclaims an expired lease only when its exact route is active", async () => {
    const id = syntheticUuid(0x104);
    await insertRoutedOutboxEvent({
      aggregateType: "lead",
      eventType: "lead.reopened",
      id,
      organizationId: ORGANIZATION_A,
      schemaVersion: "2",
      version: 1,
    });
    await database().query(
      `update outbox_events
          set status = 'processing', attempt_count = 1,
              locked_by = 'dispatcher.expired-seed',
              locked_until = clock_timestamp() - interval '1 second',
              lease_token = '123e4567-e89b-42d3-a456-426614174000'::uuid
        where id = $1::uuid`,
      [id],
    );

    expect(
      await runtime().claimBatch({
        activeRoutes: [{ eventType: "lead.reopened", schemaVersion: "1" }],
        dispatcherId: createOutboxDispatcherId("dispatcher.expired-wrong"),
      }),
    ).toEqual([]);
    expect(await relayRow(id)).toMatchObject({ attempt_count: 1, status: "processing" });

    const claims = await runtime().claimBatch({
      activeRoutes: [{ eventType: "lead.reopened", schemaVersion: "2" }],
      dispatcherId: createOutboxDispatcherId("dispatcher.expired-right"),
    });
    expect(
      claims.map(({ outboxEventId, attemptNumber }) => [outboxEventId, attemptNumber]),
    ).toEqual([[id, 2]]);
  });

  it("installs a narrow NOLOGIN definer and exact queue-only function grants", async () => {
    const role = await database().query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolsuper: boolean;
    }>(
      `select rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole, rolinherit,
              rolreplication, rolsuper
         from pg_catalog.pg_roles
        where rolname = $1`,
      [RELAY_DEFINER_ROLE],
    );
    expect(role.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const functions = await database().query<{
      owner: string;
      proconfig: string[];
      proname: string;
      prosecdef: boolean;
    }>(
      `select p.proname, owner.rolname as owner, p.prosecdef, p.proconfig
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         join pg_catalog.pg_roles owner on owner.oid = p.proowner
        where n.nspname = 'app'
          and p.proname = any($1::text[])
        order by p.proname`,
      [
        [
          "claim_outbox_events",
          "mark_outbox_event_dead_lettered",
          "mark_outbox_event_published",
          "release_outbox_event_for_retry",
          "renew_outbox_event_lease",
        ],
      ],
    );
    expect(functions.rows).toHaveLength(5);
    expect(
      functions.rows.every(
        ({ owner, proconfig, prosecdef }) =>
          owner === RELAY_DEFINER_ROLE && prosecdef && proconfig.includes("search_path=pg_catalog"),
      ),
    ).toBe(true);

    const definerScope = await database().query<{
      owns_relations: number;
      owns_schemas: number;
      payload_readable: boolean;
    }>(
      `select
         (select count(*)::integer from pg_catalog.pg_class c
           join pg_catalog.pg_roles r on r.oid = c.relowner
          where r.rolname = $1) as owns_relations,
         (select count(*)::integer from pg_catalog.pg_namespace n
           join pg_catalog.pg_roles r on r.oid = n.nspowner
          where r.rolname = $1) as owns_schemas,
         has_column_privilege($1, 'public.outbox_events', 'payload_jsonb', 'SELECT')
           as payload_readable`,
      [RELAY_DEFINER_ROLE],
    );
    expect(definerScope.rows).toEqual([
      { owns_relations: 0, owns_schemas: 0, payload_readable: false },
    ]);

    const claimResult = await database().query<{ result_type: string }>(
      `select pg_catalog.pg_get_function_result(p.oid) as result_type
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'claim_outbox_events'`,
    );
    expect(claimResult.rows[0]?.result_type).not.toContain("payload");

    const grants = await database().query<{
      public_grants: number;
      queue_grants: number;
      tenant_grants: number;
    }>(
      `select
         count(*) filter (where grantee = 'PUBLIC')::integer as public_grants,
         count(*) filter (where grantee = $1)::integer as queue_grants,
         count(*) filter (where grantee = $2)::integer as tenant_grants
       from information_schema.routine_privileges
       where routine_schema = 'app'
         and routine_name = any($3::text[])`,
      [QUEUE_RUNTIME_ROLE, TENANT_RUNTIME_ROLE, functions.rows.map(({ proname }) => proname)],
    );
    expect(grants.rows).toEqual([{ public_grants: 0, queue_grants: 5, tenant_grants: 0 }]);
  });

  it("denies queue direct table access and tenant relay execution", async () => {
    await insertOutboxEvent(syntheticUuid(0x110), ORGANIZATION_A, 1);
    await expect(
      queueDatabase().query("select payload_jsonb from public.outbox_events"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("select id from public.organizations"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("update public.outbox_events set attempt_count = 99"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(queueDatabase().query("delete from public.outbox_events")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      queueDatabase().query("insert into public.outbox_events (id) values ($1::uuid)", [
        syntheticUuid(0x111),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tenantDatabase().query(
        "select * from app.claim_outbox_events('tenant-forbidden', array['organization.created']::varchar[], array['1']::varchar[], 1, 60)",
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const privileges = await database().query<{
      can_bypass_rls: boolean;
      can_delete: boolean;
      can_insert: boolean;
      can_payload: boolean;
      can_select: boolean;
      can_update: boolean;
      is_superuser: boolean;
    }>(
      `select
         has_table_privilege($1, 'public.outbox_events', 'SELECT') as can_select,
         has_table_privilege($1, 'public.outbox_events', 'INSERT') as can_insert,
         has_table_privilege($1, 'public.outbox_events', 'UPDATE') as can_update,
         has_table_privilege($1, 'public.outbox_events', 'DELETE') as can_delete,
         has_column_privilege($1, 'public.outbox_events', 'payload_jsonb', 'SELECT') as can_payload,
         (select rolbypassrls from pg_catalog.pg_roles where rolname = $1) as can_bypass_rls,
         (select rolsuper from pg_catalog.pg_roles where rolname = $1) as is_superuser`,
      [QUEUE_RUNTIME_ROLE],
    );
    expect(privileges.rows).toEqual([
      {
        can_bypass_rls: false,
        can_delete: false,
        can_insert: false,
        can_payload: false,
        can_select: false,
        can_update: false,
        is_superuser: false,
      },
    ]);
  });

  it("gives exactly one concurrent claimer the same eligible row", async () => {
    const id = syntheticUuid(0x120);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [first, second] = await Promise.all([
      claimRaw("dispatcher.concurrent-a", 1),
      claimRaw("dispatcher.concurrent-b", 1),
    ]);
    expect([...first, ...second].map(({ outbox_event_id }) => outbox_event_id)).toEqual([id]);
    expect((await relayRow(id))?.attempt_count).toBe(1);
  });

  it("allows concurrent claimers to receive disjoint multi-row batches", async () => {
    const expectedIds = [
      ...(await insertOutboxEvents(ORGANIZATION_A, 6, 0x130)),
      ...(await insertOutboxEvents(ORGANIZATION_B, 6, 0x140)),
    ];
    const [first, second] = await Promise.all([
      claimRaw("dispatcher.multirow-a", 10),
      claimRaw("dispatcher.multirow-b", 10),
    ]);
    const firstIds = first.map(({ outbox_event_id }) => outbox_event_id);
    const secondIds = second.map(({ outbox_event_id }) => outbox_event_id);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(firstIds.length).toBeGreaterThan(0);
    expect(secondIds.length).toBeGreaterThan(0);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(expectedIds));
  });

  it("caps each tenant at five and orders selected work by due time then ID", async () => {
    const due = new Date(Date.now() - 5_000);
    const tenantAIds = await insertOutboxEvents(ORGANIZATION_A, 12, 0x200, due);
    const tenantBIds = await insertOutboxEvents(ORGANIZATION_B, 3, 0x220, due);
    const tenantCIds = await insertOutboxEvents(ORGANIZATION_C, 2, 0x230, due);
    const claims = await claimRaw("dispatcher.fairness", 50);
    const counts = new Map<string, number>();
    for (const claim of claims) {
      counts.set(claim.organization_id, (counts.get(claim.organization_id) ?? 0) + 1);
    }
    expect(counts).toEqual(
      new Map([
        [ORGANIZATION_A, 5],
        [ORGANIZATION_B, 3],
        [ORGANIZATION_C, 2],
      ]),
    );
    const expected = [...tenantAIds.slice(0, 5), ...tenantBIds, ...tenantCIds].sort();
    expect(claims.map(({ outbox_event_id }) => outbox_event_id)).toEqual(expected);
  });

  it("renews only a current lease without changing attempt or event data", async () => {
    const id = syntheticUuid(0x300);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [claim] = await runtime().claimBatch({
      activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
      dispatcherId: createOutboxDispatcherId("dispatcher.renewal"),
      batchSize: 1,
    });
    if (claim === undefined) throw new Error("Expected relay claim");
    const before = await relayRow(id);
    const renewedUntil = await runtime().renewLease({ ...claim, leaseSeconds: 120 });
    const after = await relayRow(id);
    expect(renewedUntil?.getTime()).toBeGreaterThan(claim.lockedUntil.getTime());
    expect(after).toMatchObject({
      attempt_count: 1,
      available_at: before?.available_at,
      payload_jsonb: before?.payload_jsonb,
      status: "processing",
    });
    expect(
      await database().query("select app.renew_outbox_event_lease($1, $2, $3, 60)", [
        ORGANIZATION_A,
        id,
        "123e4567-e89b-42d3-a456-426614174000",
      ]),
    ).toMatchObject({ rows: [{ renew_outbox_event_lease: null }] });
  });

  it("reclaims expired work and makes every stale lease mutation harmless", async () => {
    const id = syntheticUuid(0x310);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [first] = await claimRaw("dispatcher.expiry-a", 1, 60);
    if (first === undefined) throw new Error("Expected initial relay claim");
    await database().query(
      "update outbox_events set locked_until = clock_timestamp() - interval '1 second' where id = $1",
      [id],
    );
    const [second] = await claimRaw("dispatcher.expiry-b", 1, 60);
    if (second === undefined) throw new Error("Expected reclaimed relay claim");
    expect(second.lease_token).not.toBe(first.lease_token);
    expect(second.attempt_number).toBe(2);

    const stale = [ORGANIZATION_A, id, first.lease_token];
    expect(
      (
        await queueDatabase().query(
          "select app.renew_outbox_event_lease($1, $2, $3, 60) as value",
          stale,
        )
      ).rows,
    ).toEqual([{ value: null }]);
    expect(
      (
        await queueDatabase().query(
          "select app.release_outbox_event_for_retry($1, $2, $3, clock_timestamp() + interval '1 minute', 'transient') as value",
          stale,
        )
      ).rows,
    ).toEqual([{ value: false }]);
    expect(
      (
        await queueDatabase().query(
          "select app.mark_outbox_event_published($1, $2, $3) as value",
          stale,
        )
      ).rows,
    ).toEqual([{ value: "lease_lost" }]);
    expect(
      (
        await queueDatabase().query(
          "select app.mark_outbox_event_dead_lettered($1, $2, $3, 'permanent') as value",
          stale,
        )
      ).rows,
    ).toEqual([{ value: false }]);
    expect((await relayRow(id))?.lease_token).toBe(second.lease_token);
  });

  it("releases current work for a bounded retry without making it early-claimable", async () => {
    const id = syntheticUuid(0x320);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [claim] = await runtime().claimBatch({
      activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
      dispatcherId: createOutboxDispatcherId("dispatcher.retry-release"),
      batchSize: 1,
    });
    if (claim === undefined) throw new Error("Expected relay claim");
    const nextAvailableAt = new Date(Date.now() + 120_000);
    expect(
      await runtime().releaseForRetry({
        ...claim,
        availableAt: nextAvailableAt,
        errorCategory: "ambiguous_delivery",
      }),
    ).toBe(true);
    expect(await relayRow(id)).toMatchObject({
      attempt_count: 1,
      last_error_category: "ambiguous_delivery",
      lease_token: null,
      locked_by: null,
      locked_until: null,
      status: "pending",
    });
    expect(await claimRaw("dispatcher.retry-too-early", 1)).toEqual([]);
    await database().query(
      "update outbox_events set available_at = clock_timestamp() - interval '1 second' where id = $1",
      [id],
    );
    const reclaimed = await claimRaw("dispatcher.retry-due", 1);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.attempt_number).toBe(2);
  });

  it("dead-letters terminal work without changing its payload or replaying it", async () => {
    const id = syntheticUuid(0x330);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [claim] = await runtime().claimBatch({
      activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
      dispatcherId: createOutboxDispatcherId("dispatcher.dead-letter"),
      batchSize: 1,
    });
    if (claim === undefined) throw new Error("Expected relay claim");
    const payload = (await relayRow(id))?.payload_jsonb;
    expect(await runtime().markDeadLettered({ ...claim, errorCategory: "permanent" })).toBe(true);
    expect(await relayRow(id)).toMatchObject({
      attempt_count: 1,
      last_error_category: "permanent",
      lease_token: null,
      locked_until: null,
      payload_jsonb: payload,
      published_at: null,
      status: "dead_lettered",
    });
    expect(await claimRaw("dispatcher.no-dead-replay", 1)).toEqual([]);
    expect(await runtime().markDeadLettered({ ...claim, errorCategory: "permanent" })).toBe(false);
  });

  it("publishes idempotently only for the exact claim identity", async () => {
    const id = syntheticUuid(0x340);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const [claim] = await runtime().claimBatch({
      activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
      dispatcherId: createOutboxDispatcherId("dispatcher.publication"),
      batchSize: 1,
    });
    if (claim === undefined) throw new Error("Expected relay claim");
    const payload = (await relayRow(id))?.payload_jsonb;
    expect(
      (
        await queueDatabase().query("select app.mark_outbox_event_published($1, $2, $3) as value", [
          ORGANIZATION_B,
          id,
          claim.leaseToken,
        ])
      ).rows,
    ).toEqual([{ value: "lease_lost" }]);
    expect((await relayRow(id))?.status).toBe("processing");
    expect(await runtime().markPublished(claim)).toBe("published");
    expect(await runtime().markPublished(claim)).toBe("already_published");
    const published = await relayRow(id);
    expect(published).toMatchObject({
      attempt_count: 1,
      last_error_category: null,
      lease_token: null,
      locked_by: null,
      locked_until: null,
      payload_jsonb: payload,
      status: "published",
    });
    expect(published?.published_at).toBeInstanceOf(Date);
    expect(published?.published_claim_token).toBe(claim.leaseToken);
    expect(await claimRaw("dispatcher.no-published-replay", 1)).toEqual([]);
  });

  it("fails closed on malformed and unbounded function inputs", async () => {
    await expect(
      queueDatabase().query(
        "select * from app.claim_outbox_events('short', array['organization.created']::varchar[], array['1']::varchar[], 1, 60)",
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        "select * from app.claim_outbox_events($1::varchar, array['organization.created']::varchar[], array['1']::varchar[], 51, 60)",
        ["dispatcher.sql');drop table outbox_events;--"],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        "select * from app.claim_outbox_events('dispatcher.invalid', array['organization.created']::varchar[], array['1']::varchar[], 1, 0)",
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        "select app.mark_outbox_event_published($1::uuid, $2::uuid, $3::uuid)",
        [ORGANIZATION_A, syntheticUuid(0x350), "not-a-uuid"],
      ),
    ).rejects.toMatchObject({ code: "22P02" });
    await expect(
      queueDatabase().query(
        `select app.release_outbox_event_for_retry(
          $1::uuid, $2::uuid, $3::uuid, clock_timestamp() + interval '1 minute', 'arbitrary_blob'
        )`,
        [ORGANIZATION_A, syntheticUuid(0x350), "123e4567-e89b-42d3-a456-426614174000"],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        `select app.release_outbox_event_for_retry(
          $1::uuid, $2::uuid, $3::uuid, clock_timestamp() + interval '25 hours', 'transient'
        )`,
        [ORGANIZATION_A, syntheticUuid(0x350), "123e4567-e89b-42d3-a456-426614174000"],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(
      queueDatabase().query(
        "select app.mark_outbox_event_dead_lettered($1::uuid, $2::uuid, $3::uuid, 'arbitrary_blob')",
        [ORGANIZATION_A, syntheticUuid(0x350), "123e4567-e89b-42d3-a456-426614174000"],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    expect(() => createOutboxDispatcherId("short")).toThrow(OutboxRelayValidationError);
    await expect(
      runtime().claimBatch({
        activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
        dispatcherId: createOutboxDispatcherId("dispatcher.invalid-batch"),
        batchSize: 51,
      }),
    ).rejects.toBeInstanceOf(OutboxRelayValidationError);
  });

  it("is unaffected by caller search_path and rejects the wrong runtime role", async () => {
    await insertOutboxEvent(syntheticUuid(0x360), ORGANIZATION_A, 1);
    const client = await queueDatabase().connect();
    try {
      await client.query("set search_path = public, app, pg_catalog");
      const claims = await client.query<RawClaim>(
        "select * from app.claim_outbox_events('dispatcher.search-path', array['organization.created']::varchar[], array['1']::varchar[], 1, 60)",
      );
      expect(claims.rows).toHaveLength(1);
    } finally {
      client.release();
    }

    if (ownerConnectionString === undefined) throw new Error("Owner connection is unavailable");
    const wrongRoleRuntime = createOutboxRelayDatabaseRuntime(
      createQueueDatabaseRuntimeConfig({ connectionString: ownerConnectionString }),
      { onUnexpectedPoolError: () => undefined },
    );
    try {
      await expect(
        wrongRoleRuntime.claimBatch({
          activeRoutes: ORGANIZATION_CREATED_ACTIVE_ROUTE,
          dispatcherId: createOutboxDispatcherId("dispatcher.wrong-role"),
          batchSize: 1,
        }),
      ).rejects.toBeInstanceOf(OutboxRelayRoleError);
    } finally {
      await wrongRoleRuntime.close();
    }
  });

  it("keeps semantic fields immutable and FORCE RLS enabled", async () => {
    const id = syntheticUuid(0x370);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    await expect(
      database().query(
        "update outbox_events set payload_jsonb = '{\"tampered\":true}' where id = $1",
        [id],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_semantic_immutability_check",
    });
    const rls = await database().query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      `select relforcerowsecurity, relrowsecurity
         from pg_catalog.pg_class
        where oid = 'public.outbox_events'::regclass`,
    );
    expect(rls.rows).toEqual([{ relforcerowsecurity: true, relrowsecurity: true }]);
  });

  it("rolls back a claim atomically without consuming an attempt", async () => {
    const id = syntheticUuid(0x380);
    await insertOutboxEvent(id, ORGANIZATION_A, 1);
    const client = await queueDatabase().connect();
    try {
      await client.query("begin");
      const claimed = await client.query<RawClaim>(
        "select * from app.claim_outbox_events('dispatcher.rollback', array['organization.created']::varchar[], array['1']::varchar[], 1, 60)",
      );
      expect(claimed.rows).toHaveLength(1);
      await client.query("rollback");
    } finally {
      client.release();
    }
    expect(await relayRow(id)).toMatchObject({
      attempt_count: 0,
      lease_token: null,
      locked_until: null,
      status: "pending",
    });
    const [claimedAgain] = await claimRaw("dispatcher.after-rollback", 1);
    expect(claimedAgain?.attempt_number).toBe(1);
  });

  it("uses the accepted eligibility indexes on a representative sparse due backlog", async () => {
    await database().query(
      `insert into outbox_events
        (id, organization_id, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, payload_jsonb, correlation_id,
         causation_id, occurred_at, status, attempt_count, available_at)
       select
         ('0193f1a8-7f65-7c28-a434-' || lpad(to_hex(4096 + value), 12, '0'))::uuid,
         $1::uuid, 'organization.created', '1', 'organization', $1::uuid,
         (4096 + value)::bigint, '{\"fixture\":\"explain\"}'::jsonb,
         ('0193f1a8-7f65-7c28-a434-' || lpad(to_hex(4096 + value), 12, '0'))::uuid,
         null, clock_timestamp() - interval '1 minute', 'pending', 0,
         case when value <= 20 then clock_timestamp() - interval '1 second'
              else clock_timestamp() + interval '1 day' end
       from generate_series(1, 2000) as value`,
      [ORGANIZATION_A],
    );
    await database().query(
      `insert into outbox_events
        (id, organization_id, event_type, schema_version, aggregate_type,
         aggregate_id, aggregate_version, payload_jsonb, correlation_id,
         causation_id, occurred_at, status, attempt_count, available_at)
       select
         ('0193f1a8-7f65-7c28-a434-' || lpad(to_hex(20000 + value), 12, '0'))::uuid,
         $1::uuid, 'organization.created', '1', 'organization', $1::uuid,
         (20000 + value)::bigint, '{"fixture":"explain-other-tenant"}'::jsonb,
         ('0193f1a8-7f65-7c28-a434-' || lpad(to_hex(20000 + value), 12, '0'))::uuid,
         null, clock_timestamp() - interval '2 minutes', 'pending', 0,
         clock_timestamp() - interval '2 minutes'
       from generate_series(1, 5000) as value`,
      [ORGANIZATION_B],
    );
    await database().query("analyze outbox_events");
    const explain = await database().query<{ "QUERY PLAN": string }>(
      `explain (costs off)
       with effective_clock as materialized (
         select clock_timestamp() as claimed_at
       )
       select event.id
         from outbox_events event
         cross join effective_clock
        where event.organization_id = $1::uuid
          and event.status = 'pending'
          and event.available_at <= effective_clock.claimed_at
        order by event.available_at, event.id
        limit 5`,
      [ORGANIZATION_A],
    );
    const plan = explain.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(plan).toContain("outbox_events_relay_pending_tenant_idx");
    expect(plan).not.toMatch(/Seq Scan on outbox_events event/u);
  });
});
