import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrationsFolder, runMigrations } from "../../packages/database/src/index.js";

const ORGANIZATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const ORGANIZATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const USER_A = "0193f1a8-7f65-7c28-a434-a10796c41c2d";
const USER_B = "0193f1a8-7f65-7c28-a434-a10796c41c2e";
const MEMBERSHIP_A = "0193f1a8-7f65-7c28-a434-a10796c41c2f";
const MEMBERSHIP_B = "0193f1a8-7f65-7c28-a434-a10796c41c38";
const LOCATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c30";
const LOCATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c31";
const RETENTION_POLICY_A = "0193f1a8-7f65-7c28-a434-a10796c41c32";
const RETENTION_POLICY_B = "0193f1a8-7f65-7c28-a434-a10796c41c33";
const RETENTION_RULE_A = "0193f1a8-7f65-7c28-a434-a10796c41c34";
const INBOUND_ROUTE_A = "0193f1a8-7f65-7c28-a434-a10796c41c35";
const CHANNEL_CONNECTION_A = "0193f1a8-7f65-7c28-a434-a10796c41c36";
const CHANNEL_CONNECTION_B = "0193f1a8-7f65-7c28-a434-a10796c41c37";
const TEST_ID_1 = "0193f1a8-7f65-7c28-a434-a10796c41c39";
const TEST_ID_2 = "0193f1a8-7f65-7c28-a434-a10796c41c3a";
const TEST_ID_3 = "0193f1a8-7f65-7c28-a434-a10796c41c3b";
const UNKNOWN_ORGANIZATION = "0193f1a8-7f65-7c28-a434-a10796c41cff";
const UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";

const S4A_TABLES = ["locations", "memberships", "organizations", "users"];
const S4B1_TABLES = [
  "inbound_routes",
  "locations",
  "memberships",
  "organizations",
  "retention_policies",
  "retention_policy_rules",
  "users",
];

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let upgradeTablesAfterS4a: string[] = [];
let upgradeTablesAfterS4b1: string[] = [];

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

const productionTables = async (queryable: Pool | PoolClient): Promise<string[]> => {
  const tables = await queryable.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  return tables.rows.map(({ table_name }) => table_name);
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
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

const verifyUpgradeAndReset = async (testPool: Pool): Promise<void> => {
  await applyMigrationSql(testPool, "0000_left_tarantula.sql");
  upgradeTablesAfterS4a = await productionTables(testPool);

  await applyMigrationSql(testPool, "0001_slippery_grim_reaper.sql");
  upgradeTablesAfterS4b1 = await productionTables(testPool);

  await testPool.query(
    `drop table inbound_routes, retention_policy_rules, retention_policies,
      memberships, locations, users, organizations`,
  );
  if ((await productionTables(testPool)).length !== 0) {
    throw new Error("S4b.1 upgrade verification failed to restore the disposable database");
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

const insertRetentionPolicy = async (
  id: string,
  organizationId: string,
  versionNo: number,
  status: "draft" | "published" | "retired" = "draft",
  actorUserId?: string,
): Promise<void> => {
  await database().query(
    `insert into retention_policies
      (id, organization_id, version_no, status, jurisdiction_profile,
       effective_from, published_by_user_id, approved_by_user_id)
     values ($1, $2, $3, $4::varchar, 'launch-jurisdiction-v1',
       case when $4::varchar = 'draft' then null else now() end,
       case when $4::varchar = 'draft' then null else $5::uuid end,
       case when $4::varchar = 'draft' then null else $5::uuid end)`,
    [id, organizationId, versionNo, status, actorUserId ?? null],
  );
};

const insertRetentionRule = async (
  id: string,
  organizationId: string,
  retentionPolicyId: string,
  dataClass = "conversation-content",
): Promise<void> => {
  await database().query(
    `insert into retention_policy_rules
      (id, organization_id, retention_policy_id, data_class, purpose,
       trigger_event, duration_days, expiry_action,
       jurisdiction_reference, legal_basis_reference)
     values ($1, $2, $3, $4, 'service-messages', 'conversation-closed', 30,
       'anonymize', 'synthetic-jurisdiction-reference', 'synthetic-legal-basis')`,
    [id, organizationId, retentionPolicyId, dataClass],
  );
};

const insertInboundRoute = async (
  id: string,
  organizationId: string,
  channelConnectionId: string,
  hash: string,
  status: "active" | "disabled" = "active",
): Promise<void> => {
  await database().query(
    `insert into inbound_routes
      (id, route_type, route_key_hash, organization_id, channel_connection_id, status)
     values ($1, 'widget_key', $2, $3, $4, $5)`,
    [id, Buffer.from(hash), organizationId, channelConnectionId, status],
  );
};

beforeAll(async () => {
  const testDatabaseUrl = requireTestDatabaseUrl();
  if (testDatabaseUrl === undefined) {
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s4b1_test")
      .withUsername("lead_agent_test")
      .withPassword("local-test-only-password")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri(), max: 4 });
  } else {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 4 });
    await requireEmptyExternalTestDatabase(pool);
  }

  await requirePostgreSql17(pool);
  await verifyUpgradeAndReset(pool);
  await runMigrations(pool);
  await runMigrations(pool);
}, 180_000);

beforeEach(async () => {
  await database().query(
    `truncate table inbound_routes, retention_policy_rules, retention_policies,
      memberships, locations, users, organizations`,
  );
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

describe("S4b.1 PostgreSQL 17 migration", () => {
  it("upgrades S4a to S4b.1, migrates an empty database to head, and reruns safely", async () => {
    expect(upgradeTablesAfterS4a).toEqual(S4A_TABLES);
    expect(upgradeTablesAfterS4b1).toEqual(S4B1_TABLES);

    const version = await database().query<{ server_version_num: string }>(
      "show server_version_num",
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

    expect(await productionTables(database())).toEqual(S4B1_TABLES);

    const migrationCount = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrationCount.rows[0]?.count).toBe(2);
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
    expect(namesByTable["retention_policies"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "version_no",
      "status",
      "jurisdiction_profile",
      "effective_from",
      "published_by_user_id",
      "approved_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["retention_policy_rules"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "retention_policy_id",
      "data_class",
      "purpose",
      "trigger_event",
      "duration_days",
      "expiry_action",
      "jurisdiction_reference",
      "legal_basis_reference",
      "created_at",
    ]);
    expect(namesByTable["inbound_routes"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "route_type",
      "route_key_hash",
      "organization_id",
      "channel_connection_id",
      "status",
      "rotated_at",
      "created_at",
    ]);

    const userBinaryColumns = namesByTable["users"]?.filter(({ column_name }) =>
      ["email_ciphertext", "email_lookup_hash", "display_name_ciphertext"].includes(column_name),
    );
    const utcTimestamps = columns.rows.filter(({ column_name }) =>
      ["created_at", "updated_at"].includes(column_name),
    );
    const routeKeyHash = namesByTable["inbound_routes"]?.find(
      ({ column_name }) => column_name === "route_key_hash",
    );
    expect(userBinaryColumns).toHaveLength(3);
    expect(userBinaryColumns?.every(({ data_type }) => data_type === "bytea")).toBe(true);
    expect(routeKeyHash).toMatchObject({ data_type: "bytea", is_nullable: "NO" });
    expect(utcTimestamps).toHaveLength(11);
    expect(utcTimestamps.every(({ data_type }) => data_type === "timestamp with time zone")).toBe(
      true,
    );
    expect(columns.rows.some(({ column_name }) => column_name.includes("issuer"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("subject"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("password"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("secret"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name === "route_key")).toBe(false);
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
        "organizations_current_retention_policy_fk",
        "retention_policies_organization_id_version_no_unique",
        "retention_policies_organization_id_id_unique",
        "retention_policies_organization_id_organizations_id_fk",
        "retention_policies_publisher_membership_fk",
        "retention_policies_approver_membership_fk",
        "retention_policy_rules_organization_id_policy_rule_unique",
        "retention_policy_rules_organization_id_id_unique",
        "retention_policy_rules_organization_id_organizations_id_fk",
        "retention_policy_rules_retention_policy_fk",
        "inbound_routes_organization_id_id_unique",
        "inbound_routes_route_type_route_key_hash_unique",
        "inbound_routes_organization_id_organizations_id_fk",
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
    expect(
      indexDefinitions.get("retention_policies_organization_status_effective_from_idx"),
    ).toContain("(organization_id, status, effective_from DESC NULLS LAST)");
    expect(
      indexDefinitions.get("retention_policies_one_published_per_organization_unique"),
    ).toContain("UNIQUE");
    expect(
      indexDefinitions.get("retention_policies_one_published_per_organization_unique"),
    ).toContain("WHERE ((status)::text = 'published'::text)");
    expect(indexDefinitions.get("retention_policy_rules_organization_policy_idx")).toContain(
      "(organization_id, retention_policy_id)",
    );
    expect(indexDefinitions.get("retention_policy_rules_organization_class_trigger_idx")).toContain(
      "(organization_id, data_class, trigger_event)",
    );
    expect(indexDefinitions.get("inbound_routes_one_active_per_connection_type_unique")).toContain(
      "(organization_id, channel_connection_id, route_type)",
    );
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

  it("persists the approved retention and hashed inbound-routing shapes", async () => {
    await insertOrganization(ORGANIZATION_A, "retention-tenant");
    await insertUser(USER_A);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 1, "published", USER_A);
    await insertRetentionRule(RETENTION_RULE_A, ORGANIZATION_A, RETENTION_POLICY_A);
    await insertInboundRoute(
      INBOUND_ROUTE_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      "synthetic-keyed-route-hash",
    );
    await database().query(
      "update organizations set current_retention_policy_id = $2 where id = $1",
      [ORGANIZATION_A, RETENTION_POLICY_A],
    );

    const policy = await database().query<{
      current_retention_policy_id: string;
      expiry_action: string;
      route_key_hash: Buffer;
    }>(
      `select o.current_retention_policy_id, r.expiry_action, ir.route_key_hash
         from organizations o
         join retention_policies p
           on (p.organization_id, p.id) = (o.id, o.current_retention_policy_id)
         join retention_policy_rules r
           on (r.organization_id, r.retention_policy_id) = (p.organization_id, p.id)
         join inbound_routes ir on ir.organization_id = o.id
        where o.id = $1`,
      [ORGANIZATION_A],
    );

    expect(policy.rows[0]).toMatchObject({
      current_retention_policy_id: RETENTION_POLICY_A,
      expiry_action: "anonymize",
    });
    expect(policy.rows[0]?.route_key_hash).toEqual(Buffer.from("synthetic-keyed-route-hash"));
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

  it("rejects invalid retention policy versions, publication evidence, and cross-tenant actors", async () => {
    await insertOrganization(ORGANIZATION_A, "retention-a");
    await insertOrganization(ORGANIZATION_B, "retention-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);

    await expect(
      insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 0),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "retention_policies_version_no_check",
    });
    await expect(
      database().query(
        `insert into retention_policies
          (id, organization_id, version_no, status, jurisdiction_profile)
         values ($1, $2, 1, 'published', 'launch-jurisdiction-v1')`,
        [RETENTION_POLICY_A, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "retention_policies_publication_check",
    });
    await expect(
      insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 1, "published", USER_B),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "retention_policies_publisher_membership_fk",
    });

    await insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 1, "published", USER_A);
    await expect(
      insertRetentionPolicy(RETENTION_POLICY_B, ORGANIZATION_A, 1),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "retention_policies_organization_id_version_no_unique",
    });
    await expect(
      insertRetentionPolicy(RETENTION_POLICY_B, ORGANIZATION_A, 2, "published", USER_A),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "retention_policies_one_published_per_organization_unique",
    });
    await expect(
      database().query("update organizations set current_retention_policy_id = $2 where id = $1", [
        ORGANIZATION_B,
        RETENTION_POLICY_A,
      ]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "organizations_current_retention_policy_fk",
    });
  });

  it("rejects invalid retention rules, duplicate semantics, and cross-tenant policy links", async () => {
    await insertOrganization(ORGANIZATION_A, "rules-a");
    await insertOrganization(ORGANIZATION_B, "rules-b");
    await insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 1);

    await expect(
      insertRetentionRule(RETENTION_RULE_A, ORGANIZATION_B, RETENTION_POLICY_A),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "retention_policy_rules_retention_policy_fk",
    });
    await insertRetentionRule(RETENTION_RULE_A, ORGANIZATION_A, RETENTION_POLICY_A);
    await expect(
      insertRetentionRule(TEST_ID_1, ORGANIZATION_A, RETENTION_POLICY_A),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "retention_policy_rules_organization_id_policy_rule_unique",
    });
    await expect(
      database().query(
        `insert into retention_policy_rules
          (id, organization_id, retention_policy_id, data_class, purpose, trigger_event,
           duration_days, expiry_action, jurisdiction_reference, legal_basis_reference)
         values ($1, $2, $3, 'message-content', 'service', 'closed', -1,
           'purge', 'synthetic-jurisdiction', 'synthetic-basis')`,
        [TEST_ID_1, ORGANIZATION_A, RETENTION_POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "retention_policy_rules_duration_days_check",
    });
    await expect(
      database().query(
        `insert into retention_policy_rules
          (id, organization_id, retention_policy_id, data_class, purpose, trigger_event,
           duration_days, expiry_action, jurisdiction_reference, legal_basis_reference)
         values ($1, $2, $3, 'message-content', 'service', 'expired', 30,
           'archive', 'synthetic-jurisdiction', 'synthetic-basis')`,
        [TEST_ID_2, ORGANIZATION_A, RETENTION_POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "retention_policy_rules_expiry_action_check",
    });
    await expect(
      database().query(
        `insert into retention_policy_rules
          (id, organization_id, retention_policy_id, data_class, purpose, trigger_event,
           duration_days, expiry_action, jurisdiction_reference, legal_basis_reference)
         values ($1, $2, $3, 'Not Normalized', 'service', 'expired', 30,
           'aggregate', 'synthetic-jurisdiction', 'synthetic-basis')`,
        [TEST_ID_3, ORGANIZATION_A, RETENTION_POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "retention_policy_rules_identifiers_check",
    });
    await expect(
      database().query("delete from retention_policies where id = $1", [RETENTION_POLICY_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "retention_policy_rules_retention_policy_fk",
    });
  });

  it("enforces exact hashed-route uniqueness and tenant ownership without route scans", async () => {
    await insertOrganization(ORGANIZATION_A, "routes-a");
    await insertOrganization(ORGANIZATION_B, "routes-b");
    await insertInboundRoute(
      INBOUND_ROUTE_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      "global-exact-hash",
    );

    await expect(
      insertInboundRoute(TEST_ID_1, ORGANIZATION_B, CHANNEL_CONNECTION_B, "global-exact-hash"),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "inbound_routes_route_type_route_key_hash_unique",
    });
    await expect(
      insertInboundRoute(TEST_ID_1, ORGANIZATION_A, CHANNEL_CONNECTION_A, "different-hash"),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "inbound_routes_one_active_per_connection_type_unique",
    });
    await expect(
      insertInboundRoute(
        TEST_ID_1,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        "disabled-hash",
        "disabled",
      ),
    ).resolves.toBeUndefined();
    await expect(
      insertInboundRoute(TEST_ID_2, UNKNOWN_ORGANIZATION, CHANNEL_CONNECTION_B, "orphan-hash"),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "inbound_routes_organization_id_organizations_id_fk",
    });
    await expect(
      insertInboundRoute(UUID_V4, ORGANIZATION_B, CHANNEL_CONNECTION_B, "v4-route-hash"),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "inbound_routes_id_uuid_v7_check",
    });
    await expect(
      database().query(
        `insert into inbound_routes
          (id, route_type, route_key_hash, organization_id, channel_connection_id, status)
         values ($1, 'widget_key', $2, $3, $4, 'active')`,
        [TEST_ID_2, Buffer.alloc(0), ORGANIZATION_B, CHANNEL_CONNECTION_B],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "inbound_routes_route_key_hash_check",
    });
  });

  it("keeps RLS and later S4b channel/location relationships explicitly deferred", async () => {
    const rls = await database().query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
        order by relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "inbound_routes", relrowsecurity: false },
      { relname: "locations", relrowsecurity: false },
      { relname: "memberships", relrowsecurity: false },
      { relname: "organizations", relrowsecurity: false },
      { relname: "retention_policies", relrowsecurity: false },
      { relname: "retention_policy_rules", relrowsecurity: false },
      { relname: "users", relrowsecurity: false },
    ]);

    const deferredForeignKeys = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.key_column_usage
        where table_schema = 'public'
          and column_name in ('channel_connection_id', 'current_version_id')
          and position_in_unique_constraint is not null`,
    );
    expect(deferredForeignKeys.rows[0]?.count).toBe(0);

    const activatedRetentionForeignKey = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'organizations'
          and constraint_name = 'organizations_current_retention_policy_fk'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(activatedRetentionForeignKey.rows[0]?.count).toBe(1);
  });
});
