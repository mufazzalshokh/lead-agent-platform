import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  businessPolicies,
  channelConnections,
  faqs,
  inboundRoutes,
  locationBusinessHours,
  locationClosures,
  locations,
  locationVersions,
  memberships,
  migrationsFolder,
  organizations,
  retentionPolicies,
  retentionPolicyRules,
  runMigrations,
  serviceLocations,
  servicePrices,
  services,
  serviceVersions,
  users,
  widgetAllowedOrigins,
  widgetSessions,
} from "../../packages/database/src/index.js";

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
const LOCATION_VERSION_A = "0193f1a8-7f65-7c28-a434-a10796c41c40";
const LOCATION_VERSION_B = "0193f1a8-7f65-7c28-a434-a10796c41c41";
const BUSINESS_HOUR_A = "0193f1a8-7f65-7c28-a434-a10796c41c42";
const CLOSURE_A = "0193f1a8-7f65-7c28-a434-a10796c41c43";
const SERVICE_A = "0193f1a8-7f65-7c28-a434-a10796c41c44";
const SERVICE_B = "0193f1a8-7f65-7c28-a434-a10796c41c45";
const SERVICE_VERSION_A = "0193f1a8-7f65-7c28-a434-a10796c41c46";
const SERVICE_VERSION_B = "0193f1a8-7f65-7c28-a434-a10796c41c47";
const PRICE_A = "0193f1a8-7f65-7c28-a434-a10796c41c48";
const FAQ_A = "0193f1a8-7f65-7c28-a434-a10796c41c49";
const POLICY_A = "0193f1a8-7f65-7c28-a434-a10796c41c4a";
const WIDGET_ORIGIN_A = "0193f1a8-7f65-7c28-a434-a10796c41c4b";
const WIDGET_ORIGIN_B = "0193f1a8-7f65-7c28-a434-a10796c41c4c";
const WIDGET_SESSION_A = "0193f1a8-7f65-7c28-a434-a10796c41c4d";
const WIDGET_SESSION_B = "0193f1a8-7f65-7c28-a434-a10796c41c4e";
const FUTURE_CONTACT_A = "0193f1a8-7f65-7c28-a434-a10796c41c4f";
const FUTURE_CONVERSATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c50";
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
const S4B2_TABLES = [
  "business_policies",
  "faqs",
  "inbound_routes",
  "location_business_hours",
  "location_closures",
  "location_versions",
  "locations",
  "memberships",
  "organizations",
  "retention_policies",
  "retention_policy_rules",
  "service_locations",
  "service_prices",
  "service_versions",
  "services",
  "users",
];
const S4B3_TABLES = [
  "business_policies",
  "channel_connections",
  "faqs",
  "inbound_routes",
  "location_business_hours",
  "location_closures",
  "location_versions",
  "locations",
  "memberships",
  "organizations",
  "retention_policies",
  "retention_policy_rules",
  "service_locations",
  "service_prices",
  "service_versions",
  "services",
  "users",
  "widget_allowed_origins",
  "widget_sessions",
];
const SCHEMA_TABLES = {
  business_policies: businessPolicies,
  channel_connections: channelConnections,
  faqs,
  inbound_routes: inboundRoutes,
  location_business_hours: locationBusinessHours,
  location_closures: locationClosures,
  location_versions: locationVersions,
  locations,
  memberships,
  organizations,
  retention_policies: retentionPolicies,
  retention_policy_rules: retentionPolicyRules,
  service_locations: serviceLocations,
  service_prices: servicePrices,
  service_versions: serviceVersions,
  services,
  users,
  widget_allowed_origins: widgetAllowedOrigins,
  widget_sessions: widgetSessions,
} as const;

const isDrizzleColumn = (value: unknown): value is { name: string; table: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "name") === "string" &&
  Reflect.get(value, "table") !== undefined;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let upgradeTablesAfterS4a: string[] = [];
let upgradeTablesAfterS4b1: string[] = [];
let upgradeTablesAfterS4b2: string[] = [];
let upgradeTablesAfterS4b3: string[] = [];

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

  await applyMigrationSql(testPool, "0002_unique_bucky.sql");
  upgradeTablesAfterS4b2 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0003_happy_lilith.sql");
  upgradeTablesAfterS4b3 = await productionTables(testPool);

  await testPool.query(
    `drop table widget_sessions, widget_allowed_origins, channel_connections,
      business_policies, faqs, service_prices, service_locations,
      service_versions, services, location_closures, location_business_hours,
      location_versions, inbound_routes, retention_policy_rules, retention_policies,
      memberships, locations, users, organizations`,
  );
  if ((await productionTables(testPool)).length !== 0) {
    throw new Error("S4b.3 upgrade verification failed to restore the disposable database");
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

const insertLocationVersion = async (
  id: string,
  organizationId: string,
  locationId: string,
  versionNo: number,
  publisherUserId: string,
  timeZone = "Asia/Tashkent",
): Promise<void> => {
  await database().query(
    `insert into location_versions
      (id, organization_id, location_id, version_no, name_i18n, address_i18n,
       public_contact_jsonb, time_zone, published_at, published_by_user_id, content_hash)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, now(), $9, $10)`,
    [
      id,
      organizationId,
      locationId,
      versionNo,
      JSON.stringify({ en: "Synthetic Clinic", ru: "Тестовая клиника", uz: "Sinov klinikasi" }),
      JSON.stringify({ en: "1 Test Street" }),
      JSON.stringify({ phone: "+00000000000" }),
      timeZone,
      publisherUserId,
      Buffer.from("synthetic-location-content-hash"),
    ],
  );
};

const insertService = async (id: string, organizationId: string, code: string): Promise<void> => {
  await database().query(
    `insert into services (id, organization_id, code, status)
     values ($1, $2, $3, 'active')`,
    [id, organizationId, code],
  );
};

const insertServiceVersion = async (
  id: string,
  organizationId: string,
  serviceId: string,
  versionNo: number,
  publisherUserId: string,
): Promise<void> => {
  await database().query(
    `insert into service_versions
      (id, organization_id, service_id, version_no, name_i18n, description_i18n,
       duration_guidance_minutes, disclaimer_i18n, content_hash, published_at,
       published_by_user_id)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 30, $7::jsonb, $8, now(), $9)`,
    [
      id,
      organizationId,
      serviceId,
      versionNo,
      JSON.stringify({ en: "Synthetic Consultation", uz: "Sinov konsultatsiyasi" }),
      JSON.stringify({ en: "A deterministic synthetic service description" }),
      JSON.stringify({ en: "Guidance only" }),
      Buffer.from("synthetic-service-content-hash"),
      publisherUserId,
    ],
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

const insertChannelConnection = async (
  id: string,
  organizationId: string,
  channelType: "instagram" | "telegram" | "whatsapp" | "widget",
  displayName: string,
  providerAccountHash?: string,
): Promise<void> => {
  await database().query(
    `insert into channel_connections
      (id, organization_id, channel_type, status, display_name,
       provider_account_id_hash, credential_secret_ref, webhook_secret_hash,
       configuration_jsonb, verified_at)
     values ($1, $2, $3, 'active', $4, $5, $6, $7, $8::jsonb, now())`,
    [
      id,
      organizationId,
      channelType,
      displayName,
      providerAccountHash === undefined ? null : Buffer.from(providerAccountHash),
      channelType === "widget" ? null : `secret://channels/${id}/credential`,
      channelType === "widget" ? null : Buffer.from("synthetic-webhook-secret-hash"),
      JSON.stringify({ environment: "test", enabledCapabilities: ["text"] }),
    ],
  );
};

const insertWidgetOrigin = async (
  id: string,
  organizationId: string,
  channelConnectionId: string,
  createdByUserId: string,
  normalizedHost = "clinic.example",
): Promise<void> => {
  await database().query(
    `insert into widget_allowed_origins
      (id, organization_id, channel_connection_id, match_type, scheme,
       normalized_host, port, status, created_by_user_id)
     values ($1, $2, $3, 'exact', 'https', $4, null, 'active', $5)`,
    [id, organizationId, channelConnectionId, normalizedHost, createdByUserId],
  );
};

const insertWidgetSession = async (
  id: string,
  organizationId: string,
  channelConnectionId: string,
  widgetAllowedOriginId: string,
  tokenHash: string,
  participantHash: string,
): Promise<void> => {
  await database().query(
    `insert into widget_sessions
      (id, organization_id, channel_connection_id, widget_allowed_origin_id,
       session_token_jti_hash, participant_lookup_hash, status, requested_locale,
       issued_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, 'active', 'en',
       timestamptz '2026-01-01 00:00:00+00',
       timestamptz '2026-01-01 00:01:00+00',
       timestamptz '2026-01-01 00:15:00+00')`,
    [
      id,
      organizationId,
      channelConnectionId,
      widgetAllowedOriginId,
      Buffer.from(tokenHash),
      Buffer.from(participantHash),
    ],
  );
};

beforeAll(async () => {
  const testDatabaseUrl = requireTestDatabaseUrl();
  if (testDatabaseUrl === undefined) {
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s4b3_test")
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
    `truncate table widget_sessions, widget_allowed_origins, channel_connections,
      business_policies, faqs, service_prices, service_locations,
      service_versions, services, location_closures, location_business_hours,
      location_versions, inbound_routes, retention_policy_rules, retention_policies,
      memberships, locations, users, organizations`,
  );
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
}, 60_000);

describe("S4b.3 PostgreSQL 17 migration", { timeout: 30_000 }, () => {
  it("upgrades S4a through S4b.2 to S4b.3, bootstraps head, and reruns safely", async () => {
    expect(upgradeTablesAfterS4a).toEqual(S4A_TABLES);
    expect(upgradeTablesAfterS4b1).toEqual(S4B1_TABLES);
    expect(upgradeTablesAfterS4b2).toEqual(S4B2_TABLES);
    expect(upgradeTablesAfterS4b3).toEqual(S4B3_TABLES);

    const version = await database().query<{ server_version_num: string }>(
      "show server_version_num",
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

    expect(await productionTables(database())).toEqual(S4B3_TABLES);

    const migrationCount = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrationCount.rows[0]?.count).toBe(4);
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
    expect(namesByTable["channel_connections"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "channel_type",
      "status",
      "display_name",
      "provider_account_id_hash",
      "credential_secret_ref",
      "webhook_secret_hash",
      "configuration_jsonb",
      "verified_at",
      "credential_version",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["widget_allowed_origins"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "channel_connection_id",
      "match_type",
      "scheme",
      "normalized_host",
      "port",
      "status",
      "created_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["widget_sessions"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "channel_connection_id",
      "widget_allowed_origin_id",
      "session_token_jti_hash",
      "participant_lookup_hash",
      "status",
      "requested_locale",
      "contact_id",
      "conversation_id",
      "issued_at",
      "last_seen_at",
      "expires_at",
      "revoked_at",
      "revocation_reason",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["location_versions"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "location_id",
      "version_no",
      "name_i18n",
      "address_i18n",
      "public_contact_jsonb",
      "time_zone",
      "published_at",
      "published_by_user_id",
      "content_hash",
      "created_at",
    ]);
    expect(namesByTable["location_business_hours"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "location_version_id",
      "day_of_week",
      "opens_at_local",
      "closes_at_local",
      "sequence_no",
      "created_at",
    ]);
    expect(namesByTable["location_closures"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "location_id",
      "local_date",
      "kind",
      "opens_at_local",
      "closes_at_local",
      "reason_i18n",
      "status",
      "supersedes_id",
      "created_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["services"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "code",
      "status",
      "current_version_id",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["service_versions"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "service_id",
      "version_no",
      "name_i18n",
      "description_i18n",
      "duration_guidance_minutes",
      "disclaimer_i18n",
      "search_vector_uz",
      "search_vector_ru",
      "search_vector_en",
      "content_hash",
      "published_at",
      "published_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["service_locations"]?.map(({ column_name }) => column_name)).toEqual([
      "organization_id",
      "service_id",
      "location_id",
      "status",
      "effective_from",
      "effective_to",
      "created_at",
    ]);
    expect(namesByTable["service_prices"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "service_id",
      "location_id",
      "price_type",
      "currency",
      "min_amount_minor",
      "max_amount_minor",
      "display_text_i18n",
      "effective_from",
      "effective_to",
      "status",
      "version_no",
      "published_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["faqs"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "faq_key",
      "version_no",
      "service_id",
      "location_id",
      "question_i18n",
      "answer_i18n",
      "search_vector_uz",
      "search_vector_ru",
      "search_vector_en",
      "status",
      "effective_from",
      "effective_to",
      "content_hash",
      "published_by_user_id",
      "created_at",
    ]);
    expect(namesByTable["business_policies"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "policy_key",
      "version_no",
      "policy_type",
      "schema_version",
      "rules_jsonb",
      "status",
      "effective_from",
      "effective_to",
      "content_hash",
      "published_by_user_id",
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
    expect(utcTimestamps).toHaveLength(26);
    expect(utcTimestamps.every(({ data_type }) => data_type === "timestamp with time zone")).toBe(
      true,
    );
    expect(columns.rows.some(({ column_name }) => column_name.includes("issuer"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("subject"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("password"))).toBe(false);
    expect(
      columns.rows
        .filter(
          ({ column_name }) => column_name.includes("secret") || column_name.includes("token"),
        )
        .map(({ column_name, table_name }) => `${table_name}.${column_name}`)
        .sort(),
    ).toEqual([
      "channel_connections.credential_secret_ref",
      "channel_connections.webhook_secret_hash",
      "widget_sessions.session_token_jti_hash",
    ]);
    expect(
      columns.rows.some(({ column_name }) =>
        [
          "access_token",
          "api_key",
          "bot_token",
          "credential",
          "refresh_token",
          "session_token",
          "webhook_secret",
        ].includes(column_name),
      ),
    ).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name === "route_key")).toBe(false);
  });

  it("keeps the Drizzle table declarations in exact column parity with the migrated database", async () => {
    const migratedColumns = await database().query<{ column_name: string; table_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    );
    const migratedNamesByTable = Object.groupBy(
      migratedColumns.rows,
      ({ table_name }) => table_name,
    );
    const declaredNames = Object.keys(SCHEMA_TABLES).sort();

    expect(declaredNames).toEqual(S4B3_TABLES);
    for (const [tableName, table] of Object.entries(SCHEMA_TABLES)) {
      const declaredColumns = Object.values(table as unknown as Record<string, unknown>)
        .filter(isDrizzleColumn)
        .map(({ name }) => name);
      expect(migratedNamesByTable[tableName]?.map(({ column_name }) => column_name)).toEqual(
        declaredColumns,
      );
    }
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
        "locations_current_version_fk",
        "location_versions_location_fk",
        "location_versions_publisher_membership_fk",
        "location_business_hours_location_version_fk",
        "location_closures_location_fk",
        "location_closures_superseded_record_fk",
        "location_closures_creator_membership_fk",
        "services_organization_id_organizations_id_fk",
        "services_current_version_fk",
        "service_versions_service_fk",
        "service_versions_publisher_membership_fk",
        "service_locations_service_fk",
        "service_locations_location_fk",
        "service_prices_service_fk",
        "service_prices_location_fk",
        "service_prices_publisher_membership_fk",
        "faqs_service_fk",
        "faqs_location_fk",
        "faqs_publisher_membership_fk",
        "business_policies_organization_id_organizations_id_fk",
        "business_policies_publisher_membership_fk",
        "channel_connections_organization_id_id_unique",
        "channel_connections_organization_type_provider_unique",
        "channel_connections_organization_id_organizations_id_fk",
        "inbound_routes_channel_connection_fk",
        "widget_allowed_origins_organization_id_id_unique",
        "widget_allowed_origins_connection_id_id_unique",
        "widget_allowed_origins_organization_id_organizations_id_fk",
        "widget_allowed_origins_channel_connection_fk",
        "widget_allowed_origins_creator_membership_fk",
        "widget_sessions_organization_id_id_unique",
        "widget_sessions_organization_jti_hash_unique",
        "widget_sessions_organization_id_organizations_id_fk",
        "widget_sessions_channel_connection_fk",
        "widget_sessions_allowed_origin_fk",
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
    expect(indexDefinitions.get("location_versions_organization_location_version_idx")).toContain(
      "(organization_id, location_id, version_no DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("location_business_hours_organization_version_day_idx")).toContain(
      "(organization_id, location_version_id, day_of_week)",
    );
    expect(indexDefinitions.get("service_locations_organization_location_status_idx")).toContain(
      "(organization_id, location_id, status)",
    );
    expect(
      indexDefinitions.get("service_prices_org_service_location_status_effective_idx"),
    ).toContain(
      "(organization_id, service_id, location_id, status, effective_from DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("faqs_search_vector_uz_idx")).toContain("USING gin");
    expect(indexDefinitions.get("faqs_search_vector_ru_idx")).toContain("USING gin");
    expect(indexDefinitions.get("faqs_search_vector_en_idx")).toContain("USING gin");
    expect(indexDefinitions.get("service_versions_search_vector_uz_idx")).toContain("USING gin");
    expect(indexDefinitions.get("service_versions_search_vector_ru_idx")).toContain("USING gin");
    expect(indexDefinitions.get("service_versions_search_vector_en_idx")).toContain("USING gin");
    expect(indexDefinitions.get("channel_connections_organization_type_status_idx")).toContain(
      "(organization_id, channel_type, status)",
    );
    expect(indexDefinitions.get("channel_connections_organization_display_name_unique")).toContain(
      "UNIQUE",
    );
    expect(indexDefinitions.get("widget_allowed_origins_canonical_origin_unique")).toContain(
      "(organization_id, channel_connection_id, match_type, scheme, normalized_host, COALESCE(port, 0))",
    );
    expect(indexDefinitions.get("widget_sessions_one_active_participant_unique")).toContain(
      "(organization_id, channel_connection_id, participant_lookup_hash)",
    );
    expect(indexDefinitions.get("widget_sessions_one_active_participant_unique")).toContain(
      "WHERE ((status)::text = 'active'::text)",
    );
    expect(indexDefinitions.get("widget_sessions_organization_status_expiry_idx")).toContain(
      "(organization_id, status, expires_at)",
    );
    expect(indexDefinitions.get("widget_sessions_organization_conversation_idx")).toContain(
      "(organization_id, conversation_id)",
    );

    const exclusions = await database().query<{ conname: string }>(
      `select conname
         from pg_constraint
        where contype = 'x'
          and connamespace = 'public'::regnamespace
        order by conname`,
    );
    expect(exclusions.rows.map(({ conname }) => conname)).toEqual([
      "location_business_hours_no_overlap_excl",
      "service_locations_no_active_overlap_excl",
      "service_prices_no_published_overlap_excl",
    ]);

    const localeValidator = await database().query<{ provolatile: string }>(
      `select provolatile
         from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname = 'is_bounded_locale_map'`,
    );
    expect(localeValidator.rows).toEqual([{ provolatile: "i" }]);
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
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Primary Widget");
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
    await insertChannelConnection(
      CHANNEL_CONNECTION_A,
      ORGANIZATION_A,
      "widget",
      "Routes Widget A",
    );
    await insertChannelConnection(
      CHANNEL_CONNECTION_B,
      ORGANIZATION_B,
      "widget",
      "Routes Widget B",
    );
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
    await expect(
      insertInboundRoute(
        TEST_ID_3,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_B,
        "cross-tenant-connection-hash",
        "disabled",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "inbound_routes_channel_connection_fk",
    });
  });

  it("persists local schedules and DST-aware location versions while rejecting invalid locale and closure shapes", async () => {
    await insertOrganization(ORGANIZATION_A, "location-config-a");
    await insertOrganization(ORGANIZATION_B, "location-config-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "new-york-office");
    await insertLocation(LOCATION_B, ORGANIZATION_B, "other-tenant-office");
    await insertLocationVersion(
      LOCATION_VERSION_A,
      ORGANIZATION_A,
      LOCATION_A,
      1,
      USER_A,
      "America/New_York",
    );
    await database().query("update locations set current_version_id = $2 where id = $1", [
      LOCATION_A,
      LOCATION_VERSION_A,
    ]);
    await database().query(
      `insert into location_business_hours
        (id, organization_id, location_version_id, day_of_week,
         opens_at_local, closes_at_local, sequence_no)
       values ($1, $2, $3, 1, time '09:00', time '17:00', 1)`,
      [BUSINESS_HOUR_A, ORGANIZATION_A, LOCATION_VERSION_A],
    );

    const localSchedule = await database().query<{
      closes_at_local: string;
      opens_at_local: string;
      time_zone: string;
    }>(
      `select h.opens_at_local::text, h.closes_at_local::text, v.time_zone
         from location_business_hours h
         join location_versions v
           on v.organization_id = h.organization_id and v.id = h.location_version_id`,
    );
    expect(localSchedule.rows[0]).toEqual({
      closes_at_local: "17:00:00",
      opens_at_local: "09:00:00",
      time_zone: "America/New_York",
    });

    const dstSemantics = await database().query<{ summer: string; winter: string }>(
      `select timezone('America/New_York', timestamptz '2026-01-15 14:00:00+00')::time::text as winter,
              timezone('America/New_York', timestamptz '2026-07-15 13:00:00+00')::time::text as summer`,
    );
    expect(dstSemantics.rows[0]).toEqual({ summer: "09:00:00", winter: "09:00:00" });

    await expect(
      database().query(
        `insert into location_business_hours
          (id, organization_id, location_version_id, day_of_week,
           opens_at_local, closes_at_local, sequence_no)
         values ($1, $2, $3, 1, time '16:00', time '18:00', 2)`,
        [TEST_ID_1, ORGANIZATION_A, LOCATION_VERSION_A],
      ),
    ).rejects.toMatchObject({
      code: "23P01",
      constraint: "location_business_hours_no_overlap_excl",
    });
    await expect(
      database().query(
        `insert into location_versions
          (id, organization_id, location_id, version_no, name_i18n, address_i18n,
           public_contact_jsonb, time_zone, published_at, published_by_user_id, content_hash)
         values ($1, $2, $3, 2, $4::jsonb, '{"en":"Synthetic"}'::jsonb,
           '{}'::jsonb, 'UTC', now(), $5, $6)`,
        [
          TEST_ID_1,
          ORGANIZATION_A,
          LOCATION_A,
          JSON.stringify({ en: "Valid", fr: "Not supported" }),
          USER_A,
          Buffer.from("invalid-locale-map-hash"),
        ],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "location_versions_name_i18n_check",
    });

    await database().query(
      `insert into location_closures
        (id, organization_id, location_id, local_date, kind, reason_i18n,
         status, created_by_user_id)
       values ($1, $2, $3, date '2026-12-25', 'closed', '{"en":"Public holiday"}'::jsonb,
         'active', $4)`,
      [CLOSURE_A, ORGANIZATION_A, LOCATION_A, USER_A],
    );
    await expect(
      database().query(
        `insert into location_closures
          (id, organization_id, location_id, local_date, kind, reason_i18n,
           status, created_by_user_id)
         values ($1, $2, $3, date '2026-12-25', 'closed', '{"en":"Duplicate"}'::jsonb,
           'active', $4)`,
        [TEST_ID_2, ORGANIZATION_A, LOCATION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "location_closures_one_active_per_local_date_unique",
    });
    await expect(
      database().query(
        `insert into location_closures
          (id, organization_id, location_id, local_date, kind, opens_at_local,
           closes_at_local, reason_i18n, status, created_by_user_id)
         values ($1, $2, $3, date '2026-12-26', 'closed', time '09:00', time '12:00',
           '{"en":"Invalid closed interval"}'::jsonb, 'active', $4)`,
        [TEST_ID_3, ORGANIZATION_A, LOCATION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "location_closures_interval_shape_check",
    });

    await insertLocationVersion(
      LOCATION_VERSION_B,
      ORGANIZATION_B,
      LOCATION_B,
      1,
      USER_B,
      "Europe/London",
    );
    await expect(
      database().query("update locations set current_version_id = $2 where id = $1", [
        LOCATION_A,
        LOCATION_VERSION_B,
      ]),
    ).rejects.toMatchObject({ code: "23503", constraint: "locations_current_version_fk" });
    await expect(
      database().query(
        `insert into location_closures
          (id, organization_id, location_id, local_date, kind, reason_i18n,
           status, created_by_user_id)
         values ($1, $2, $3, date '2026-12-27', 'closed', '{"en":"Invalid actor"}'::jsonb,
           'active', $4)`,
        [TEST_ID_1, ORGANIZATION_A, LOCATION_A, USER_B],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "location_closures_creator_membership_fk",
    });
  });

  it("enforces service version ownership, current pointers, location scope, and active interval exclusion", async () => {
    await insertOrganization(ORGANIZATION_A, "service-config-a");
    await insertOrganization(ORGANIZATION_B, "service-config-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "service-location-a");
    await insertLocation(LOCATION_B, ORGANIZATION_B, "service-location-b");
    await insertService(SERVICE_A, ORGANIZATION_A, "synthetic-consultation");
    await insertService(SERVICE_B, ORGANIZATION_B, "other-tenant-service");
    await insertServiceVersion(SERVICE_VERSION_A, ORGANIZATION_A, SERVICE_A, 1, USER_A);
    await insertServiceVersion(SERVICE_VERSION_B, ORGANIZATION_B, SERVICE_B, 1, USER_B);
    await database().query("update services set current_version_id = $2 where id = $1", [
      SERVICE_A,
      SERVICE_VERSION_A,
    ]);

    const searchVectors = await database().query<{ search_vector_en: string }>(
      "select search_vector_en::text from service_versions where id = $1",
      [SERVICE_VERSION_A],
    );
    expect(searchVectors.rows[0]?.search_vector_en).toContain("synthet");

    await expect(
      insertServiceVersion(TEST_ID_1, ORGANIZATION_A, SERVICE_B, 2, USER_A),
    ).rejects.toMatchObject({ code: "23503", constraint: "service_versions_service_fk" });
    await expect(
      database().query("update services set current_version_id = $2 where id = $1", [
        SERVICE_A,
        SERVICE_VERSION_B,
      ]),
    ).rejects.toMatchObject({ code: "23503", constraint: "services_current_version_fk" });

    await database().query(
      `insert into service_locations
        (organization_id, service_id, location_id, status, effective_from)
       values ($1, $2, $3, 'active', timestamptz '2026-01-01 00:00:00+00')`,
      [ORGANIZATION_A, SERVICE_A, LOCATION_A],
    );
    await expect(
      database().query(
        `insert into service_locations
          (organization_id, service_id, location_id, status, effective_from)
         values ($1, $2, $3, 'active', timestamptz '2026-02-01 00:00:00+00')`,
        [ORGANIZATION_A, SERVICE_A, LOCATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23P01",
      constraint: "service_locations_no_active_overlap_excl",
    });
    await expect(
      database().query(
        `insert into service_locations
          (organization_id, service_id, location_id, status, effective_from)
         values ($1, $2, $3, 'active', timestamptz '2027-01-01 00:00:00+00')`,
        [ORGANIZATION_A, SERVICE_A, LOCATION_B],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "service_locations_location_fk" });
    await expect(
      database().query(
        `insert into service_locations
          (organization_id, service_id, location_id, status, effective_from)
         values ($1, $2, $3, 'inactive', timestamptz '2026-02-01 00:00:00+00')`,
        [ORGANIZATION_A, SERVICE_A, LOCATION_A],
      ),
    ).resolves.toBeDefined();
  });

  it("enforces integer price shapes, canonical currency, tenant scope, publisher provenance, and interval exclusion", async () => {
    await insertOrganization(ORGANIZATION_A, "price-config-a");
    await insertOrganization(ORGANIZATION_B, "price-config-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "price-location-a");
    await insertLocation(LOCATION_B, ORGANIZATION_B, "price-location-b");
    await insertService(SERVICE_A, ORGANIZATION_A, "priced-service");

    await database().query(
      `insert into service_prices
        (id, organization_id, service_id, location_id, price_type, currency,
         min_amount_minor, max_amount_minor, display_text_i18n, effective_from,
         status, version_no, published_by_user_id)
       values ($1, $2, $3, $4, 'fixed', 'USD', 12500, 12500,
         '{"en":"Synthetic fixed price"}'::jsonb, timestamptz '2026-01-01 00:00:00+00',
         'published', 1, $5)`,
      [PRICE_A, ORGANIZATION_A, SERVICE_A, LOCATION_A, USER_A],
    );
    const storedPrice = await database().query<{
      currency: string;
      max_amount_minor: string;
      min_amount_minor: string;
    }>(
      `select currency, min_amount_minor, max_amount_minor
         from service_prices where id = $1`,
      [PRICE_A],
    );
    expect(storedPrice.rows[0]).toEqual({
      currency: "USD",
      max_amount_minor: "12500",
      min_amount_minor: "12500",
    });

    await expect(
      database().query(
        `insert into service_prices
          (id, organization_id, service_id, price_type, currency,
           min_amount_minor, display_text_i18n, status, version_no)
         values ($1, $2, $3, 'from', 'USD', -1, '{"en":"Invalid"}'::jsonb, 'draft', 2)`,
        [TEST_ID_1, ORGANIZATION_A, SERVICE_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "service_prices_amount_shape_check" });
    await expect(
      database().query(
        `insert into service_prices
          (id, organization_id, service_id, price_type, currency,
           min_amount_minor, max_amount_minor, display_text_i18n, status, version_no)
         values ($1, $2, $3, 'fixed', 'usd', 1, 1, '{"en":"Invalid"}'::jsonb, 'draft', 2)`,
        [TEST_ID_1, ORGANIZATION_A, SERVICE_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "service_prices_currency_check" });
    await expect(
      database().query(
        `insert into service_prices
          (id, organization_id, service_id, location_id, price_type, currency,
           min_amount_minor, max_amount_minor, display_text_i18n, status, version_no)
         values ($1, $2, $3, $4, 'fixed', 'USD', 1, 1,
           '{"en":"Invalid tenant"}'::jsonb, 'draft', 2)`,
        [TEST_ID_1, ORGANIZATION_A, SERVICE_A, LOCATION_B],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "service_prices_location_fk" });
    await expect(
      database().query(
        `insert into service_prices
          (id, organization_id, service_id, location_id, price_type, currency,
           min_amount_minor, max_amount_minor, display_text_i18n, effective_from,
           status, version_no, published_by_user_id)
         values ($1, $2, $3, $4, 'fixed', 'USD', 13000, 13000,
           '{"en":"Overlapping"}'::jsonb, timestamptz '2026-06-01 00:00:00+00',
           'published', 2, $5)`,
        [TEST_ID_2, ORGANIZATION_A, SERVICE_A, LOCATION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23P01",
      constraint: "service_prices_no_published_overlap_excl",
    });
    await expect(
      database().query(
        `insert into service_prices
          (id, organization_id, service_id, price_type, currency,
           display_text_i18n, effective_from, status, version_no, published_by_user_id)
         values ($1, $2, $3, 'quote_required', 'USD', '{"en":"Ask staff"}'::jsonb,
           timestamptz '2027-01-01 00:00:00+00', 'published', 3, $4)`,
        [TEST_ID_3, ORGANIZATION_A, SERVICE_A, USER_B],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "service_prices_publisher_membership_fk",
    });
  });

  it("enforces FAQ and business-policy publication, tenant references, bounded content, and current uniqueness", async () => {
    await insertOrganization(ORGANIZATION_A, "knowledge-config-a");
    await insertOrganization(ORGANIZATION_B, "knowledge-config-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertLocation(LOCATION_A, ORGANIZATION_A, "knowledge-location-a");
    await insertService(SERVICE_A, ORGANIZATION_A, "knowledge-service-a");
    await insertService(SERVICE_B, ORGANIZATION_B, "knowledge-service-b");

    await database().query(
      `insert into faqs
        (id, organization_id, faq_key, version_no, service_id, location_id,
         question_i18n, answer_i18n, status, effective_from, content_hash,
         published_by_user_id)
       values ($1, $2, 'preparation', 1, $3, $4,
         '{"en":"How should I prepare?"}'::jsonb,
         '{"en":"Follow the approved instructions."}'::jsonb,
         'published', timestamptz '2026-01-01 00:00:00+00', $5, $6)`,
      [
        FAQ_A,
        ORGANIZATION_A,
        SERVICE_A,
        LOCATION_A,
        Buffer.from("synthetic-faq-content-hash"),
        USER_A,
      ],
    );
    const faqSearch = await database().query<{ search_vector_en: string }>(
      "select search_vector_en::text from faqs where id = $1",
      [FAQ_A],
    );
    expect(faqSearch.rows[0]?.search_vector_en).toContain("prepar");

    await expect(
      database().query(
        `insert into faqs
          (id, organization_id, faq_key, version_no, service_id, question_i18n,
           answer_i18n, status, content_hash)
         values ($1, $2, 'cross-tenant', 1, $3, '{"en":"Question"}'::jsonb,
           '{"en":"Answer"}'::jsonb, 'draft', $4)`,
        [TEST_ID_1, ORGANIZATION_A, SERVICE_B, Buffer.from("cross-tenant-faq-hash")],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "faqs_service_fk" });
    await expect(
      database().query(
        `insert into faqs
          (id, organization_id, faq_key, version_no, service_id, location_id,
           question_i18n, answer_i18n, status, effective_from, content_hash,
           published_by_user_id)
         values ($1, $2, 'preparation', 2, $3, $4, '{"en":"New question"}'::jsonb,
           '{"en":"New answer"}'::jsonb, 'published',
           timestamptz '2027-01-01 00:00:00+00', $5, $6)`,
        [
          TEST_ID_2,
          ORGANIZATION_A,
          SERVICE_A,
          LOCATION_A,
          Buffer.from("duplicate-current-faq-hash"),
          USER_A,
        ],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "faqs_one_published_per_key_scope_unique",
    });

    await database().query(
      `insert into business_policies
        (id, organization_id, policy_key, version_no, policy_type, schema_version,
         rules_jsonb, status, effective_from, content_hash, published_by_user_id)
       values ($1, $2, 'qualification-default', 1, 'qualification', 1,
         '{"required_fields":["service_id"]}'::jsonb, 'published',
         timestamptz '2026-01-01 00:00:00+00', $3, $4)`,
      [POLICY_A, ORGANIZATION_A, Buffer.from("synthetic-policy-content-hash"), USER_A],
    );
    await expect(
      database().query(
        `insert into business_policies
          (id, organization_id, policy_key, version_no, policy_type, schema_version,
           rules_jsonb, status, content_hash)
         values ($1, $2, 'empty-rules', 1, 'safety', 1, '{}'::jsonb, 'draft', $3)`,
        [TEST_ID_1, ORGANIZATION_A, Buffer.from("empty-policy-content-hash")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "business_policies_rules_check" });
    await expect(
      database().query(
        `insert into business_policies
          (id, organization_id, policy_key, version_no, policy_type, schema_version,
           rules_jsonb, status, effective_from, content_hash, published_by_user_id)
         values ($1, $2, 'qualification-default', 2, 'qualification', 1,
           '{"required_fields":[]}'::jsonb, 'published',
           timestamptz '2027-01-01 00:00:00+00', $3, $4)`,
        [TEST_ID_2, ORGANIZATION_A, Buffer.from("duplicate-policy-content-hash"), USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "business_policies_one_published_per_key_type_unique",
    });
    await expect(
      database().query(
        `insert into business_policies
          (id, organization_id, policy_key, version_no, policy_type, schema_version,
           rules_jsonb, status, effective_from, content_hash, published_by_user_id)
         values ($1, $2, 'handoff-default', 1, 'handoff', 1,
           '{"queue":"staff"}'::jsonb, 'published',
           timestamptz '2026-01-01 00:00:00+00', $3, $4)`,
        [TEST_ID_3, ORGANIZATION_A, Buffer.from("cross-actor-policy-hash"), USER_B],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "business_policies_publisher_membership_fk",
    });
  });

  it("persists the canonical channel vocabulary and anonymous widget session shape", async () => {
    await insertOrganization(ORGANIZATION_A, "channels-a");
    await insertUser(USER_A);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Website Widget");
    await insertChannelConnection(
      CHANNEL_CONNECTION_B,
      ORGANIZATION_A,
      "telegram",
      "Telegram Bot",
      "synthetic-telegram-account-hash",
    );
    await insertChannelConnection(
      TEST_ID_1,
      ORGANIZATION_A,
      "instagram",
      "Instagram Seam",
      "synthetic-instagram-account-hash",
    );
    await insertChannelConnection(
      TEST_ID_2,
      ORGANIZATION_A,
      "whatsapp",
      "WhatsApp Seam",
      "synthetic-whatsapp-account-hash",
    );
    await insertWidgetOrigin(WIDGET_ORIGIN_A, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A);
    await insertWidgetSession(
      WIDGET_SESSION_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      WIDGET_ORIGIN_A,
      "synthetic-session-jti-hash",
      "synthetic-participant-hash",
    );

    expect(
      (
        await database().query<{ channel_type: string }>(
          "select channel_type from channel_connections order by channel_type",
        )
      ).rows.map(({ channel_type }) => channel_type),
    ).toEqual(["instagram", "telegram", "whatsapp", "widget"]);

    const anonymousSession = await database().query<{
      contact_id: string | null;
      conversation_id: string | null;
      expires_at: Date;
      issued_at: Date;
      session_token_jti_hash: Buffer;
    }>(
      `select contact_id, conversation_id, issued_at, expires_at, session_token_jti_hash
         from widget_sessions
        where organization_id = $1 and id = $2`,
      [ORGANIZATION_A, WIDGET_SESSION_A],
    );
    expect(anonymousSession.rows[0]).toMatchObject({
      contact_id: null,
      conversation_id: null,
      session_token_jti_hash: Buffer.from("synthetic-session-jti-hash"),
    });
    expect(anonymousSession.rows[0]?.issued_at).toBeInstanceOf(Date);
    expect(anonymousSession.rows[0]?.expires_at).toBeInstanceOf(Date);

    await expect(
      database().query(
        `update widget_sessions
            set contact_id = $2, conversation_id = $3
          where id = $1`,
        [WIDGET_SESSION_A, FUTURE_CONTACT_A, FUTURE_CONVERSATION_A],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects invalid channel metadata, credential representations, and tenant/provider duplicates", async () => {
    await insertOrganization(ORGANIZATION_A, "channel-constraints-a");
    await insertOrganization(ORGANIZATION_B, "channel-constraints-b");
    await insertChannelConnection(
      CHANNEL_CONNECTION_A,
      ORGANIZATION_A,
      "telegram",
      "Primary Telegram",
      "synthetic-provider-account-hash",
    );

    const insertInvalidConnection = async (
      channelType: string,
      status: string,
      displayName: string,
      providerHash: Buffer | null,
      credentialSecretRef: string | null,
      webhookSecretHash: Buffer | null,
      configuration: string,
      id = TEST_ID_1,
    ) =>
      database().query(
        `insert into channel_connections
          (id, organization_id, channel_type, status, display_name,
           provider_account_id_hash, credential_secret_ref, webhook_secret_hash,
           configuration_jsonb)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          id,
          ORGANIZATION_A,
          channelType,
          status,
          displayName,
          providerHash,
          credentialSecretRef,
          webhookSecretHash,
          configuration,
        ],
      );

    await expect(
      insertInvalidConnection("email", "active", "Unsupported", null, null, null, "{}"),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_channel_type_check",
    });
    await expect(
      insertInvalidConnection("widget", "deleted", "Invalid Status", null, null, null, "{}"),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_status_check",
    });
    await expect(
      insertInvalidConnection(
        "telegram",
        "active",
        "Short Provider Hash",
        Buffer.from("short"),
        null,
        null,
        "{}",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_provider_account_hash_check",
    });
    await expect(
      insertInvalidConnection(
        "telegram",
        "active",
        "Plain Credential",
        null,
        "plaintext-reusable-token",
        null,
        "{}",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_credential_secret_ref_check",
    });
    await expect(
      insertInvalidConnection(
        "telegram",
        "active",
        "Short Webhook Hash",
        null,
        null,
        Buffer.from("short"),
        "{}",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_webhook_secret_hash_check",
    });
    await expect(
      insertInvalidConnection("widget", "active", "Array Config", null, null, null, "[]"),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_configuration_check",
    });
    await expect(
      insertInvalidConnection(
        "telegram",
        "active",
        "Duplicate Provider",
        Buffer.from("synthetic-provider-account-hash"),
        "secret://channels/duplicate/credential",
        Buffer.from("synthetic-webhook-secret-hash"),
        "{}",
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "channel_connections_organization_type_provider_unique",
    });
    await expect(
      insertInvalidConnection("widget", "active", "primary telegram", null, null, null, "{}"),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "channel_connections_organization_display_name_unique",
    });
    await expect(
      insertInvalidConnection(
        "widget",
        "active",
        "UUID V4 Connection",
        null,
        null,
        null,
        "{}",
        UUID_V4,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "channel_connections_id_uuid_v7_check",
    });
    await expect(
      database().query(
        `insert into channel_connections
          (id, organization_id, channel_type, status, display_name, provider_account_id_hash)
         values ($1, $2, 'telegram', 'active', 'Other Tenant Telegram', $3)`,
        [TEST_ID_2, ORGANIZATION_B, Buffer.from("synthetic-provider-account-hash")],
      ),
    ).resolves.toBeDefined();
  });

  it("enforces canonical widget origins, actor provenance, and same-tenant connection ownership", async () => {
    await insertOrganization(ORGANIZATION_A, "origin-constraints-a");
    await insertOrganization(ORGANIZATION_B, "origin-constraints-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Widget A");
    await insertChannelConnection(CHANNEL_CONNECTION_B, ORGANIZATION_B, "widget", "Widget B");
    await insertWidgetOrigin(WIDGET_ORIGIN_A, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A);

    await expect(
      insertWidgetOrigin(
        WIDGET_ORIGIN_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_B,
        USER_A,
        "cross-tenant.example",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "widget_allowed_origins_channel_connection_fk",
    });
    await expect(
      insertWidgetOrigin(
        WIDGET_ORIGIN_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        USER_B,
        "wrong-actor.example",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "widget_allowed_origins_creator_membership_fk",
    });

    for (const invalidHost of [
      "*.clinic.example",
      "Clinic.Example",
      "https://clinic.example",
      "clinic.example/path",
      "localhost",
    ]) {
      await expect(
        insertWidgetOrigin(
          WIDGET_ORIGIN_B,
          ORGANIZATION_A,
          CHANNEL_CONNECTION_A,
          USER_A,
          invalidHost,
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "widget_allowed_origins_host_check",
      });
    }

    await expect(
      database().query(
        `insert into widget_allowed_origins
          (id, organization_id, channel_connection_id, match_type, scheme,
           normalized_host, port, status, created_by_user_id)
         values ($1, $2, $3, 'exact', 'http', 'http.example', null, 'active', $4)`,
        [WIDGET_ORIGIN_B, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_allowed_origins_scheme_check",
    });
    await expect(
      database().query(
        `insert into widget_allowed_origins
          (id, organization_id, channel_connection_id, match_type, scheme,
           normalized_host, port, status, created_by_user_id)
         values ($1, $2, $3, 'subdomain_wildcard', 'https',
           'wildcard.example', 8443, 'active', $4)`,
        [WIDGET_ORIGIN_B, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_allowed_origins_wildcard_port_check",
    });
    await expect(
      database().query(
        `insert into widget_allowed_origins
          (id, organization_id, channel_connection_id, match_type, scheme,
           normalized_host, port, status, created_by_user_id)
         values ($1, $2, $3, 'exact', 'https', 'default-port.example', 443, 'active', $4)`,
        [WIDGET_ORIGIN_B, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_allowed_origins_port_check",
    });
    await expect(
      insertWidgetOrigin(WIDGET_ORIGIN_B, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "widget_allowed_origins_canonical_origin_unique",
    });
  });

  it("enforces widget session hashes, lifetime, origin binding, tenant integrity, and restrictive deletes", async () => {
    await insertOrganization(ORGANIZATION_A, "session-constraints-a");
    await insertOrganization(ORGANIZATION_B, "session-constraints-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertChannelConnection(
      CHANNEL_CONNECTION_A,
      ORGANIZATION_A,
      "widget",
      "Session Widget A",
    );
    await insertChannelConnection(
      CHANNEL_CONNECTION_B,
      ORGANIZATION_B,
      "widget",
      "Session Widget B",
    );
    await insertChannelConnection(TEST_ID_1, ORGANIZATION_A, "widget", "Second Widget A");
    await insertWidgetOrigin(WIDGET_ORIGIN_A, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A);
    await insertWidgetOrigin(WIDGET_ORIGIN_B, ORGANIZATION_A, TEST_ID_1, USER_A, "other.example");
    await insertWidgetSession(
      WIDGET_SESSION_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      WIDGET_ORIGIN_A,
      "synthetic-session-jti-hash",
      "synthetic-participant-hash",
    );

    const insertSessionShape = async (
      id: string,
      organizationId: string,
      connectionId: string,
      originId: string,
      tokenHash: string,
      participantHash: string,
      status: string,
      locale: string,
      issuedAt: string,
      lastSeenAt: string,
      expiresAt: string,
    ) =>
      database().query(
        `insert into widget_sessions
          (id, organization_id, channel_connection_id, widget_allowed_origin_id,
           session_token_jti_hash, participant_lookup_hash, status, requested_locale,
           issued_at, last_seen_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8,
           $9::timestamptz, $10::timestamptz, $11::timestamptz)`,
        [
          id,
          organizationId,
          connectionId,
          originId,
          Buffer.from(tokenHash),
          Buffer.from(participantHash),
          status,
          locale,
          issuedAt,
          lastSeenAt,
          expiresAt,
        ],
      );

    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "short",
        "another-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_sessions_session_token_hash_check",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "another-session-token-hash",
        "another-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:15:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_sessions_lifetime_check",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "another-session-token-hash",
        "another-participant-hash",
        "unknown",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_sessions_status_check",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "another-session-token-hash",
        "another-participant-hash",
        "active",
        "de",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "widget_sessions_requested_locale_check",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_B,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "another-session-token-hash",
        "another-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "widget_sessions_channel_connection_fk",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_B,
        "another-session-token-hash",
        "another-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "widget_sessions_allowed_origin_fk",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "synthetic-session-jti-hash",
        "different-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "widget_sessions_organization_jti_hash_unique",
    });
    await expect(
      insertSessionShape(
        WIDGET_SESSION_B,
        ORGANIZATION_A,
        CHANNEL_CONNECTION_A,
        WIDGET_ORIGIN_A,
        "different-session-jti-hash",
        "synthetic-participant-hash",
        "active",
        "en",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:15:00Z",
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "widget_sessions_one_active_participant_unique",
    });

    await expect(
      database().query("delete from widget_allowed_origins where id = $1", [WIDGET_ORIGIN_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "widget_sessions_allowed_origin_fk",
    });
    await expect(
      database().query("delete from channel_connections where id = $1", [CHANNEL_CONNECTION_A]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database().query("delete from organizations where id = $1", [ORGANIZATION_A]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("keeps RLS deferred, activates the route FK, and preserves future contact/conversation seams", async () => {
    const rls = await database().query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
        order by relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "business_policies", relrowsecurity: false },
      { relname: "channel_connections", relrowsecurity: false },
      { relname: "faqs", relrowsecurity: false },
      { relname: "inbound_routes", relrowsecurity: false },
      { relname: "location_business_hours", relrowsecurity: false },
      { relname: "location_closures", relrowsecurity: false },
      { relname: "location_versions", relrowsecurity: false },
      { relname: "locations", relrowsecurity: false },
      { relname: "memberships", relrowsecurity: false },
      { relname: "organizations", relrowsecurity: false },
      { relname: "retention_policies", relrowsecurity: false },
      { relname: "retention_policy_rules", relrowsecurity: false },
      { relname: "service_locations", relrowsecurity: false },
      { relname: "service_prices", relrowsecurity: false },
      { relname: "service_versions", relrowsecurity: false },
      { relname: "services", relrowsecurity: false },
      { relname: "users", relrowsecurity: false },
      { relname: "widget_allowed_origins", relrowsecurity: false },
      { relname: "widget_sessions", relrowsecurity: false },
    ]);

    const activatedRouteForeignKey = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'inbound_routes'
          and constraint_name = 'inbound_routes_channel_connection_fk'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(activatedRouteForeignKey.rows[0]?.count).toBe(1);

    const deferredFutureForeignKeys = await database().query<{ column_name: string }>(
      `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_schema = tc.constraint_schema
          and kcu.constraint_name = tc.constraint_name
        where tc.table_schema = 'public'
          and tc.table_name = 'widget_sessions'
          and tc.constraint_type = 'FOREIGN KEY'
          and kcu.column_name in ('contact_id', 'conversation_id')
        order by kcu.column_name`,
    );
    expect(deferredFutureForeignKeys.rows).toEqual([]);

    const activatedCurrentVersionForeignKeys = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.key_column_usage
        where table_schema = 'public'
          and column_name = 'current_version_id'
          and position_in_unique_constraint is not null`,
    );
    expect(activatedCurrentVersionForeignKeys.rows[0]?.count).toBe(2);

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
