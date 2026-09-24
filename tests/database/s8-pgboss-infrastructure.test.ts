import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";

import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createQueueDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import { migrationsFolder, runMigrations } from "../../packages/database/src/migrations.js";
import {
  createQueueInfrastructure,
  deadLetterQueueFor,
  PG_BOSS_SCHEMA_VERSION,
  QUEUE_NAMES,
} from "../../apps/worker/src/queue-infrastructure.js";

const QUEUE_RUNTIME_ROLE = "lead_agent_queue_runtime";
const TENANT_RUNTIME_ROLE = "lead_agent_runtime";
const S8_MIGRATION = "0021_s8_pgboss_infrastructure.sql";

const isUnknownArray = (candidate: unknown): candidate is unknown[] => Array.isArray(candidate);
const BUSINESS_TABLE_COUNT = 52;
const EXPECTED_BASE_TABLES = [
  "bam",
  "job",
  "job_common",
  "job_dependency",
  "queue",
  "queue_stats",
  "schedule",
  "subscription",
  "version",
  "warning",
] as const;
const EXPECTED_FUNCTIONS = [
  "create_queue",
  "delete_queue",
  "job_table_format",
  "job_table_run",
  "job_table_run_async",
] as const;

let container: StartedPostgreSqlContainer | undefined;
let ownerPool: Pool | undefined;
let queuePool: Pool | undefined;
let tenantPool: Pool | undefined;
let ownerConnectionString: string | undefined;
let queueConnectionString: string | undefined;
let serverVersion = "";
let migrationOwner = "";
let upgradeBusinessTableCount = 0;
let upgradeSchemaVersion = 0;

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
  if (
    names.indexOf(S8_MIGRATION) !== 21 ||
    names[20] !== "0020_s7_faq_policy_history_integrity.sql"
  ) {
    throw new Error("S8.1 must immediately follow the accepted 0020 baseline");
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

beforeAll(async () => {
  const externalUrl = requireTestDatabaseUrl();
  if (externalUrl === undefined) {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s81_test")
      .withUsername("lead_agent_s81_owner")
      .withPassword("s81-local-test-only-owner-password")
      .start();
    ownerConnectionString = container.getConnectionUri();
  } else {
    ownerConnectionString = externalUrl;
  }

  ownerPool = new Pool({ connectionString: ownerConnectionString, max: 4 });
  if (externalUrl !== undefined) await requireEmptyExternalTestDatabase(ownerPool);

  const versionResult = await ownerPool.query<{
    current_user: string;
    server_version: string;
    server_version_num: string;
  }>(
    "select current_user, current_setting('server_version') as server_version, current_setting('server_version_num') as server_version_num",
  );
  const versionNumber = Number(versionResult.rows[0]?.server_version_num);
  if (versionNumber < 170_000 || versionNumber >= 180_000) {
    throw new Error("S8.1 integration tests require PostgreSQL major version 17");
  }
  serverVersion = versionResult.rows[0]?.server_version ?? "";
  migrationOwner = versionResult.rows[0]?.current_user ?? "";

  const migrationNames = await loadMigrationNames();
  const migrationIndex = migrationNames.indexOf(S8_MIGRATION);
  for (const filename of migrationNames.slice(0, migrationIndex)) {
    await applyMigrationSql(ownerPool, filename);
  }
  upgradeBusinessTableCount = await publicTableCount(ownerPool);
  await applyMigrationSql(ownerPool, S8_MIGRATION);
  const upgradeVersion = await ownerPool.query<{ version: number }>(
    "select version from pgboss.version",
  );
  upgradeSchemaVersion = upgradeVersion.rows[0]?.version ?? -1;

  await resetDatabaseSchemas(ownerPool);
  await runMigrations(ownerPool);
  await runMigrations(ownerPool);

  const queuePassword = "s81-local-test-only-queue-password";
  const tenantPassword = "s81-local-test-only-tenant-password";
  await configureDisposableRolePassword(ownerPool, QUEUE_RUNTIME_ROLE, queuePassword);
  await configureDisposableRolePassword(ownerPool, TENANT_RUNTIME_ROLE, tenantPassword);
  queueConnectionString = connectionStringForRole(QUEUE_RUNTIME_ROLE, queuePassword);
  queuePool = new Pool({ connectionString: queueConnectionString, max: 2 });
  tenantPool = new Pool({
    connectionString: connectionStringForRole(TENANT_RUNTIME_ROLE, tenantPassword),
    max: 1,
  });
}, 180_000);

afterAll(async () => {
  await tenantPool?.end();
  await queuePool?.end();
  await ownerPool?.end();
  await container?.stop();
}, 60_000);

describe("S8.1 PostgreSQL 17 pg-boss infrastructure", { timeout: 30_000 }, () => {
  it("upgrades the accepted 0020 baseline without changing business tables", () => {
    expect(serverVersion).toMatch(/^17\./u);
    expect(upgradeBusinessTableCount).toBe(BUSINESS_TABLE_COUNT);
    expect(upgradeSchemaVersion).toBe(PG_BOSS_SCHEMA_VERSION);
  });

  it("fresh-bootstraps current head and reruns the migration runner safely", async () => {
    expect(await publicTableCount(database())).toBe(BUSINESS_TABLE_COUNT);
    const migrations = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrations.rows[0]?.count).toBe(30);
    const version = await database().query<{ version: number }>(
      "select version from pgboss.version",
    );
    expect(version.rows).toEqual([{ version: PG_BOSS_SCHEMA_VERSION }]);
  });

  it("installs the reviewed infrastructure only in the dedicated pgboss schema", async () => {
    const tables = await database().query<{ relname: string }>(
      `select c.relname
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pgboss'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    );
    const names = tables.rows.map(({ relname }) => relname);
    for (const expected of EXPECTED_BASE_TABLES) expect(names).toContain(expected);
    expect(names.filter((name) => /^queue_stats_\d{8}$/u.test(name))).toHaveLength(2);
    expect(names).toHaveLength(12);

    const functions = await database().query<{ proname: string }>(
      `select p.proname
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pgboss'
        order by p.proname`,
    );
    expect(functions.rows.map(({ proname }) => proname)).toEqual(EXPECTED_FUNCTIONS);

    const enumLabels = await database().query<{ enumlabel: string }>(
      `select e.enumlabel
         from pg_catalog.pg_enum e
         join pg_catalog.pg_type t on t.oid = e.enumtypid
         join pg_catalog.pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'pgboss'
          and t.typname = 'job_state'
        order by e.enumsortorder`,
    );
    expect(enumLabels.rows.map(({ enumlabel }) => enumlabel)).toEqual([
      "created",
      "retry",
      "active",
      "completed",
      "cancelled",
      "failed",
    ]);

    const publicObjects = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = any($1::text[])`,
      [[...EXPECTED_BASE_TABLES]],
    );
    expect(publicObjects.rows[0]?.count).toBe(0);

    const extras = await database().query<{
      extensions: number;
      sequences: number;
      triggers: number;
    }>(
      `select
         (select count(*)::integer
            from pg_catalog.pg_extension e
            join pg_catalog.pg_namespace n on n.oid = e.extnamespace
           where n.nspname = 'pgboss') as extensions,
         (select count(*)::integer
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'pgboss' and c.relkind = 'S') as sequences,
         (select count(*)::integer
            from pg_catalog.pg_trigger t
            join pg_catalog.pg_class c on c.oid = t.tgrelid
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'pgboss' and not t.tgisinternal) as triggers`,
    );
    expect(extras.rows).toEqual([{ extensions: 0, sequences: 0, triggers: 0 }]);
  });

  it("precreates the six frozen queues and their six non-partitioned DLQs", async () => {
    const queues = await database().query<{ name: string; partition: boolean; policy: string }>(
      "select name, partition, policy from pgboss.queue order by name",
    );
    expect(queues.rows.map(({ name }) => name)).toEqual(
      [...QUEUE_NAMES, ...QUEUE_NAMES.map(deadLetterQueueFor)].sort(),
    );
    expect(queues.rows.every(({ partition, policy }) => !partition && policy === "standard")).toBe(
      true,
    );
  });

  it("keeps migration ownership and privileges separate from queue runtime", async () => {
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
      [QUEUE_RUNTIME_ROLE],
    );
    expect(role.rows).toEqual([
      {
        rolbypassrls: false,
        rolcanlogin: true,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolsuper: false,
      },
    ]);

    const ownership = await database().query<{ owner: string }>(
      `select r.rolname as owner
         from pg_catalog.pg_namespace n
         join pg_catalog.pg_roles r on r.oid = n.nspowner
        where n.nspname = 'pgboss'`,
    );
    expect(ownership.rows).toEqual([{ owner: migrationOwner }]);
    expect(migrationOwner).not.toBe(QUEUE_RUNTIME_ROLE);

    const ownedObjects = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from pg_catalog.pg_class c
         join pg_catalog.pg_roles r on r.oid = c.relowner
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pgboss'
          and r.rolname = $1`,
      [QUEUE_RUNTIME_ROLE],
    );
    expect(ownedObjects.rows[0]?.count).toBe(0);

    const privileges = await database().query<{
      can_create_database_objects: boolean;
      can_create_pgboss_objects: boolean;
      can_delete_queue: boolean;
      can_execute_create_queue: boolean;
      can_insert_jobs: boolean;
      can_read_business: boolean;
      can_read_outbox: boolean;
      can_read_queue: boolean;
      can_update_version: boolean;
      tenant_can_use_pgboss: boolean;
    }>(
      `select
         has_database_privilege($1, current_database(), 'CREATE') as can_create_database_objects,
         has_schema_privilege($1, 'pgboss', 'CREATE') as can_create_pgboss_objects,
         has_table_privilege($1, 'pgboss.queue', 'DELETE') as can_delete_queue,
         has_function_privilege($1, 'pgboss.create_queue(text,jsonb)', 'EXECUTE') as can_execute_create_queue,
         has_table_privilege($1, 'pgboss.job_common', 'INSERT') as can_insert_jobs,
         has_table_privilege($1, 'public.organizations', 'SELECT') as can_read_business,
         has_table_privilege($1, 'public.outbox_events', 'SELECT') as can_read_outbox,
         has_table_privilege($1, 'pgboss.queue', 'SELECT') as can_read_queue,
         has_table_privilege($1, 'pgboss.version', 'UPDATE') as can_update_version,
         has_schema_privilege($2, 'pgboss', 'USAGE') as tenant_can_use_pgboss`,
      [QUEUE_RUNTIME_ROLE, TENANT_RUNTIME_ROLE],
    );
    expect(privileges.rows).toEqual([
      {
        can_create_database_objects: false,
        can_create_pgboss_objects: false,
        can_delete_queue: false,
        can_execute_create_queue: false,
        can_insert_jobs: true,
        can_read_business: false,
        can_read_outbox: false,
        can_read_queue: true,
        can_update_version: false,
        tenant_can_use_pgboss: false,
      },
    ]);

    const publicGrants = await database().query<{ count: number }>(
      `select (
         (select count(*) from information_schema.table_privileges
           where table_schema = 'pgboss' and grantee = 'PUBLIC')
         +
         (select count(*) from information_schema.routine_privileges
           where routine_schema = 'pgboss' and grantee = 'PUBLIC')
       )::integer as count`,
    );
    expect(publicGrants.rows[0]?.count).toBe(0);

    const privilegedFunctions = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pgboss'
          and p.prosecdef`,
    );
    expect(privilegedFunctions.rows[0]?.count).toBe(0);
  });

  it("enforces queue/tenant runtime DDL and business-data denial", async () => {
    await expect(
      queueDatabase().query("select id from public.organizations limit 1"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("select id from public.outbox_events limit 1"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("create table pgboss.s81_forbidden(id integer)"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("update pgboss.version set version = 42"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      queueDatabase().query("select pgboss.create_queue('forbidden', '{}'::jsonb)"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tenantDatabase().query("select version from pgboss.version"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("starts and stops the pinned runtime against the current schema with migrations disabled", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    const infrastructure = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({
        connectionString: queueConnectionString,
        maxConnections: 1,
      }),
    );
    try {
      await infrastructure.start();
      const version = await database().query<{ version: number }>(
        "select version from pgboss.version",
      );
      expect(version.rows).toEqual([{ version: PG_BOSS_SCHEMA_VERSION }]);
    } finally {
      await infrastructure.stop();
    }
  });

  it("fails closed on an incompatible schema without repairing it", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    await database().query("update pgboss.version set version = 40");
    const infrastructure = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({
        connectionString: queueConnectionString,
        maxConnections: 1,
      }),
    );
    try {
      await expect(infrastructure.start()).rejects.toThrow("pg-boss database requires migrations");
      const version = await database().query<{ version: number }>(
        "select version from pgboss.version",
      );
      expect(version.rows).toEqual([{ version: 40 }]);
    } finally {
      await infrastructure.stop();
      await database().query("update pgboss.version set version = $1", [PG_BOSS_SCHEMA_VERSION]);
    }
  });

  it("fails closed on a missing schema without auto-installing it", async () => {
    if (queueConnectionString === undefined) throw new Error("Queue connection is not initialized");
    await database().query("alter schema pgboss rename to pgboss_missing_runtime_test");
    const infrastructure = createQueueInfrastructure(
      createQueueDatabaseRuntimeConfig({
        connectionString: queueConnectionString,
        maxConnections: 1,
      }),
    );
    try {
      await expect(infrastructure.start()).rejects.toThrow("pg-boss is not installed");
      const schemas = await database().query<{ schema_name: string }>(
        `select schema_name
           from information_schema.schemata
          where schema_name in ('pgboss', 'pgboss_missing_runtime_test')
          order by schema_name`,
      );
      expect(schemas.rows).toEqual([{ schema_name: "pgboss_missing_runtime_test" }]);
    } finally {
      await infrastructure.stop();
      await database().query("alter schema pgboss_missing_runtime_test rename to pgboss");
    }
  });
});
