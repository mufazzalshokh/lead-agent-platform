import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../packages/database/src/index.js";

const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const USER_A = "0193f1a8-7f65-7c28-a434-a10796c41c2d";
const USER_B = "0193f1a8-7f65-7c28-a434-a10796c41c2e";
const MEMBERSHIP_A = "0193f1a8-7f65-7c28-a434-a10796c41c2f";
const LOCATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c30";
const LOCATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c31";
const UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

const requireTestDatabaseUrl = (): string | undefined => {
  const value = process.env["TEST_DATABASE_URL"];
  if (value === undefined) {
    return undefined;
  }

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !/(^|[_-])test([_-]|$)/i.test(databaseName)
  ) {
    throw new Error("TEST_DATABASE_URL must identify an explicitly named PostgreSQL test database");
  }

  return value;
};

const database = (): Pool => {
  if (pool === undefined) {
    throw new Error("PostgreSQL test pool is not initialized");
  }
  return pool;
};

const requirePostgreSql17 = async (testPool: Pool): Promise<void> => {
  const version = await testPool.query<{ server_version_num: string }>("show server_version_num");
  const serverVersionNumber = Number(version.rows[0]?.server_version_num);
  if (serverVersionNumber < 170_000 || serverVersionNumber >= 180_000) {
    throw new Error("S4a integration tests require PostgreSQL major version 17");
  }
};

const requireEmptyExternalTestDatabase = async (testPool: Pool): Promise<void> => {
  const tables = await testPool.query<{ table_schema: string; table_name: string }>(
    `select table_schema, table_name
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema not in ('information_schema', 'pg_catalog')
      order by table_schema, table_name`,
  );
  if (tables.rows.length > 0) {
    throw new Error("TEST_DATABASE_URL must point to a fresh, empty disposable test database");
  }
};

const insertOrganization = async (
  id: string,
  slug: string,
  displayName = "Fictional Clinic",
): Promise<void> => {
  await database().query(
    `insert into organizations
      (id, slug, display_name, status, default_locale, default_time_zone)
     values ($1, $2, $3, 'active', 'en', 'Asia/Tashkent')`,
    [id, slug, displayName],
  );
};

const insertUser = async (id: string): Promise<void> => {
  await database().query(
    `insert into users
      (id, email_ciphertext, email_lookup_hash, display_name_ciphertext, status)
     values ($1, $2, $3, $4, 'active')`,
    [
      id,
      Buffer.from("synthetic-email-ciphertext"),
      Buffer.from("synthetic-keyed-lookup-hash"),
      Buffer.from("synthetic-display-name-ciphertext"),
    ],
  );
};

const insertActiveMembership = async (
  id: string,
  organizationId: string,
  userId: string,
): Promise<void> => {
  await database().query(
    `insert into memberships
      (id, organization_id, user_id, role, status, location_scope, activated_at)
     values ($1, $2, $3, 'staff', 'active', 'restricted', now())`,
    [id, organizationId, userId],
  );
};

const insertLocation = async (id: string, organizationId: string, code: string): Promise<void> => {
  await database().query(
    `insert into locations (id, organization_id, code, status)
     values ($1, $2, $3, 'active')`,
    [id, organizationId, code],
  );
};

beforeAll(async () => {
  const testDatabaseUrl = requireTestDatabaseUrl();
  if (testDatabaseUrl === undefined) {
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s4a_test")
      .withUsername("lead_agent_test")
      .withPassword("local-test-only-password")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  } else {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
    await requireEmptyExternalTestDatabase(pool);
  }

  await requirePostgreSql17(pool);
  await runMigrations(pool);
  await runMigrations(pool);
}, 180_000);

beforeEach(async () => {
  await database().query("truncate table memberships, locations, users, organizations");
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

describe("S4a PostgreSQL 17 migration", () => {
  it("migrates an empty PostgreSQL 17 database to exactly four production tables and reruns safely", async () => {
    const version = await database().query<{ server_version_num: string }>(
      "show server_version_num",
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

    const tables = await database().query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "locations",
      "memberships",
      "organizations",
      "users",
    ]);

    const migrationCount = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrationCount.rows[0]?.count).toBe(1);
  });

  it("matches the approved provider-neutral column and storage model", async () => {
    const columns = await database().query<{
      column_name: string;
      data_type: string;
      is_nullable: "NO" | "YES";
      table_name: string;
    }>(
      `select table_name, column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    );
    const namesByTable = Object.groupBy(columns.rows, ({ table_name }) => table_name);

    expect(namesByTable["organizations"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "slug",
      "display_name",
      "status",
      "default_locale",
      "default_time_zone",
      "current_retention_policy_id",
      "created_at",
      "updated_at",
      "version",
      "closed_at",
    ]);
    expect(namesByTable["users"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "email_ciphertext",
      "email_lookup_hash",
      "display_name_ciphertext",
      "status",
      "last_authenticated_at",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["memberships"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "user_id",
      "role",
      "status",
      "location_scope",
      "invited_by_user_id",
      "invited_at",
      "activated_at",
      "revoked_at",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["locations"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "code",
      "status",
      "current_version_id",
      "created_at",
      "updated_at",
      "version",
    ]);

    const userBinaryColumns = namesByTable["users"]?.filter(({ column_name }) =>
      ["email_ciphertext", "email_lookup_hash", "display_name_ciphertext"].includes(column_name),
    );
    const mutableTimestamps = columns.rows.filter(({ column_name }) =>
      ["created_at", "updated_at"].includes(column_name),
    );
    expect(userBinaryColumns).toHaveLength(3);
    expect(userBinaryColumns?.every(({ data_type }) => data_type === "bytea")).toBe(true);
    expect(mutableTimestamps).toHaveLength(8);
    expect(
      mutableTimestamps.every(({ data_type }) => data_type === "timestamp with time zone"),
    ).toBe(true);
    expect(columns.rows.some(({ column_name }) => column_name.includes("issuer"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("subject"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("password"))).toBe(false);
  });

  it("creates the accepted uniqueness, foreign-key, check, and tenant-leading index structures", async () => {
    const constraints = await database().query<{ conname: string }>(
      `select constraint_name as conname
         from information_schema.table_constraints
        where table_schema = 'public'
        order by constraint_name`,
    );
    const constraintNames = constraints.rows.map(({ conname }) => conname);
    expect(constraintNames).toEqual(
      expect.arrayContaining([
        "locations_organization_id_code_unique",
        "locations_organization_id_id_unique",
        "locations_organization_id_organizations_id_fk",
        "memberships_organization_id_user_id_unique",
        "memberships_organization_id_id_unique",
        "memberships_organization_id_organizations_id_fk",
        "memberships_user_id_users_id_fk",
        "memberships_invited_by_user_id_users_id_fk",
        "organizations_slug_unique",
      ]),
    );

    const indexes = await database().query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
         from pg_indexes
        where schemaname = 'public'
        order by indexname`,
    );
    const indexDefinitions = new Map(
      indexes.rows.map(({ indexdef, indexname }) => [indexname, indexdef]),
    );
    expect(indexDefinitions.get("locations_organization_status_code_idx")).toContain(
      "(organization_id, status, code)",
    );
    expect(indexDefinitions.get("memberships_organization_status_role_idx")).toContain(
      "(organization_id, status, role)",
    );
    expect(indexDefinitions.get("memberships_user_status_idx")).toContain("(user_id, status)");
  });

  it("persists valid tenant/configuration records with UTC-aware timestamps and optimistic versions", async () => {
    await insertOrganization(ORGANIZATION_A, "fictional-clinic");
    await insertUser(USER_A);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "main-clinic");

    const row = await database().query<{
      created_at: Date;
      organization_id: string;
      updated_at: Date;
      version: string;
    }>(
      `select organization_id, created_at, updated_at, version
         from locations
        where id = $1`,
      [LOCATION_A],
    );
    expect(row.rows[0]).toMatchObject({ organization_id: ORGANIZATION_A, version: "1" });
    expect(row.rows[0]?.created_at).toBeInstanceOf(Date);
    expect(row.rows[0]?.updated_at).toBeInstanceOf(Date);
  });

  it("enforces UUIDv7, normalized identifiers, bounded statuses, and encrypted-user shape", async () => {
    await expect(insertOrganization(UUID_V4, "v4-tenant")).rejects.toMatchObject({
      code: "23514",
      constraint: "organizations_id_uuid_v7_check",
    });
    await expect(insertOrganization(ORGANIZATION_A, "Not-Normalized")).rejects.toMatchObject({
      code: "23514",
      constraint: "organizations_slug_normalized_check",
    });
    await expect(
      database().query(
        `insert into organizations
          (id, slug, display_name, status, default_locale, default_time_zone)
         values ($1, 'invalid-zone', 'Invalid Zone', 'active', 'en', 'Not/AZone')`,
        [ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "22023" });

    await insertOrganization(ORGANIZATION_A, "valid-tenant");
    await database().query(`insert into users (id, status) values ($1, 'active')`, [USER_A]);
    await expect(
      database().query(
        `update users
            set email_ciphertext = $2
          where id = $1`,
        [USER_A, Buffer.from("ciphertext-without-lookup-hash")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "users_email_pair_check" });
    await expect(
      database().query(`update users set status = 'unknown' where id = $1`, [USER_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "users_status_check" });
    await expect(
      database().query(`update users set version = 0 where id = $1`, [USER_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "users_version_check" });
    await expect(
      database().query(
        `update users
            set updated_at = created_at - interval '1 second'
          where id = $1`,
        [USER_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "users_timestamps_check" });
    await expect(
      database().query(
        `insert into memberships
          (id, organization_id, user_id, role, status, location_scope, activated_at)
         values ($1, $2, $3, 'superadmin', 'active', 'all', now())`,
        [MEMBERSHIP_A, ORGANIZATION_A, USER_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "memberships_role_check" });
    await expect(
      database().query(
        `insert into memberships
          (id, organization_id, user_id, role, status, location_scope)
         values ($1, $2, $3, 'staff', 'unknown', 'all')`,
        ["0193f1a8-7f65-7c28-a434-a10796c41c32", ORGANIZATION_A, USER_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "memberships_status_check" });
  });

  it("enforces tenant ownership, per-tenant uniqueness, and restrictive deletion", async () => {
    await insertOrganization(ORGANIZATION_A, "tenant-a");
    await insertOrganization(ORGANIZATION_B, "tenant-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "main");
    await insertLocation(LOCATION_B, ORGANIZATION_B, "main");

    await expect(
      insertLocation("0193f1a8-7f65-7c28-a434-a10796c41c32", ORGANIZATION_A, "main"),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "locations_organization_id_code_unique",
    });
    await expect(
      insertLocation(
        "0193f1a8-7f65-7c28-a434-a10796c41c33",
        "0193f1a8-7f65-7c28-a434-a10796c41cff",
        "foreign",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "locations_organization_id_organizations_id_fk",
    });
    await expect(
      insertActiveMembership("0193f1a8-7f65-7c28-a434-a10796c41c34", ORGANIZATION_B, USER_A),
    ).resolves.toBeUndefined();
    await expect(
      insertActiveMembership("0193f1a8-7f65-7c28-a434-a10796c41c35", ORGANIZATION_A, USER_A),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "memberships_organization_id_user_id_unique",
    });
    await expect(
      database().query("delete from organizations where id = $1", [ORGANIZATION_A]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("leaves RLS and deferred S4b relationships absent", async () => {
    const rls = await database().query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
        order by relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "locations", relrowsecurity: false },
      { relname: "memberships", relrowsecurity: false },
      { relname: "organizations", relrowsecurity: false },
      { relname: "users", relrowsecurity: false },
    ]);

    const deferredForeignKeys = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.key_column_usage
        where table_schema = 'public'
          and column_name in ('current_retention_policy_id', 'current_version_id')
          and position_in_unique_constraint is not null`,
    );
    expect(deferredForeignKeys.rows[0]?.count).toBe(0);
  });
});
