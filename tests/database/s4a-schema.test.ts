import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AgentDecisionActionSchema,
  AgentDecisionV1Schema,
  DOMAIN_EVENT_NAMES,
  DomainEventSchemasByVersion,
  type AgentActionType,
  type DomainAggregateType,
  type DomainEventName,
  type DomainEventPayloadByName,
} from "../../packages/contracts/src/index.js";
import {
  analyticsEvents,
  aiActionEvaluations,
  aiRuns,
  appointmentConfirmationEvidence,
  appointmentRequestAttendance,
  appointmentRequestPreferences,
  appointmentRequestTransitions,
  appointmentRequests,
  appointmentRevenueAttributions,
  auditEvents,
  businessPolicies,
  channelConnections,
  consentRecords,
  contactIdentities,
  contacts,
  conversations,
  faqs,
  handoffs,
  handoffTransitions,
  idempotencyKeys,
  inboundRoutes,
  locationBusinessHours,
  locationClosures,
  locations,
  locationVersions,
  leadQualificationEvaluations,
  leadQualificationEvidence,
  leads,
  legalHolds,
  memberships,
  messages,
  migrationsFolder,
  notificationAttempts,
  notifications,
  organizations,
  outboxEvents,
  platformAuditEvents,
  privacyRequests,
  retentionPolicies,
  retentionPolicyRules,
  runMigrations,
  serviceLocations,
  servicePrices,
  services,
  serviceVersions,
  users,
  webhookReceipts,
  widgetAllowedOrigins,
  widgetSessions,
} from "../../packages/database/src/index.js";
import {
  isAppointmentConfirmationSource,
  isAppointmentRequestStatus,
  isConversationAutomationMode,
  isConversationStatus,
  isHandoffStatus,
  isHandoffTriggerReason,
  type AppointmentConfirmationSource,
  type AppointmentRequestStatus,
  type ConversationAutomationMode,
  type ConversationStatus,
  type HandoffStatus,
  type HandoffTriggerReason,
} from "../../packages/domain/src/index.js";

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
const CONTACT_A = "0193f1a8-7f65-7c28-a434-a10796c41c51";
const CONTACT_B = "0193f1a8-7f65-7c28-a434-a10796c41c52";
const CONTACT_IDENTITY_A = "0193f1a8-7f65-7c28-a434-a10796c41c53";
const CONTACT_IDENTITY_B = "0193f1a8-7f65-7c28-a434-a10796c41c54";
const CONSENT_A = "0193f1a8-7f65-7c28-a434-a10796c41c55";
const CONSENT_B = "0193f1a8-7f65-7c28-a434-a10796c41c56";
const LEAD_A = "0193f1a8-7f65-7c28-a434-a10796c41c57";
const LEAD_B = "0193f1a8-7f65-7c28-a434-a10796c41c58";
const EVALUATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c59";
const EVALUATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c5a";
const MESSAGE_A = "0193f1a8-7f65-7c28-a434-a10796c41c5b";
const MESSAGE_B = "0193f1a8-7f65-7c28-a434-a10796c41c5c";
const CONVERSATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c5d";
const CONVERSATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c5e";
const APPOINTMENT_REQUEST_A = "0193f1a8-7f65-7c28-a434-a10796c41c5f";
const APPOINTMENT_PREFERENCE_A = "0193f1a8-7f65-7c28-a434-a10796c41c61";
const APPOINTMENT_TRANSITION_A = "0193f1a8-7f65-7c28-a434-a10796c41c62";
const CONFIRMATION_EVIDENCE_A = "0193f1a8-7f65-7c28-a434-a10796c41c63";
const ATTENDANCE_A = "0193f1a8-7f65-7c28-a434-a10796c41c64";
const ATTENDANCE_B = "0193f1a8-7f65-7c28-a434-a10796c41c65";
const REVENUE_ATTRIBUTION_A = "0193f1a8-7f65-7c28-a434-a10796c41c66";
const REVENUE_ATTRIBUTION_B = "0193f1a8-7f65-7c28-a434-a10796c41c67";
const CORRELATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c68";
const ACTIVE_HANDOFF_A = "0193f1a8-7f65-7c28-a434-a10796c41c69";
const HANDOFF_A = "0193f1a8-7f65-7c28-a434-a10796c41c6a";
const HANDOFF_B = "0193f1a8-7f65-7c28-a434-a10796c41c6b";
const NOTIFICATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c6c";
const NOTIFICATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c6d";
const OUTBOX_EVENT_A = "0193f1a8-7f65-7c28-a434-a10796c41c6e";
const OUTBOX_EVENT_B = "0193f1a8-7f65-7c28-a434-a10796c41c6f";
const AI_RUN_A = "0193f1a8-7f65-7c28-a434-a10796c41c70";
const AI_RUN_B = "0193f1a8-7f65-7c28-a434-a10796c41c71";
const AI_ACTION_EVALUATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c72";
const AI_ACTION_EVALUATION_B = "0193f1a8-7f65-7c28-a434-a10796c41c73";
const WEBHOOK_RECEIPT_A = "0193f1a8-7f65-7c28-a434-a10796c41c74";
const WEBHOOK_RECEIPT_B = "0193f1a8-7f65-7c28-a434-a10796c41c75";
const IDEMPOTENCY_KEY_A = "0193f1a8-7f65-7c28-a434-a10796c41c76";
const IDEMPOTENCY_KEY_B = "0193f1a8-7f65-7c28-a434-a10796c41c77";
const CAUSATION_A = "0193f1a8-7f65-7c28-a434-a10796c41c78";
const AUDIT_EVENT_A = "0193f1a8-7f65-7c28-a434-a10796c41c79";
const AUDIT_EVENT_B = "0193f1a8-7f65-7c28-a434-a10796c41c7a";
const PLATFORM_AUDIT_EVENT_A = "0193f1a8-7f65-7c28-a434-a10796c41c7b";
const PRIVACY_REQUEST_A = "0193f1a8-7f65-7c28-a434-a10796c41c7c";
const PRIVACY_REQUEST_B = "0193f1a8-7f65-7c28-a434-a10796c41c7d";
const LEGAL_HOLD_A = "0193f1a8-7f65-7c28-a434-a10796c41c7e";
const LEGAL_HOLD_B = "0193f1a8-7f65-7c28-a434-a10796c41c7f";
const ANALYTICS_EVENT_A = "0193f1a8-7f65-7c28-a434-a10796c41c80";
const ANALYTICS_EVENT_B = "0193f1a8-7f65-7c28-a434-a10796c41c81";
const DOMAIN_AGGREGATE_TYPES = [
  "ai_run",
  "appointment_request",
  "business_policy",
  "channel_connection",
  "contact",
  "conversation",
  "faq",
  "handoff",
  "lead",
  "location",
  "membership",
  "notification",
  "organization",
  "service",
] as const satisfies readonly DomainAggregateType[];
const UNKNOWN_ORGANIZATION = "0193f1a8-7f65-7c28-a434-a10796c41cff";
const UUID_V4 = "550e8400-e29b-41d4-a716-446655440000";

const syntheticUuid = (suffix: number): string =>
  `0193f1a8-7f65-7c28-a434-${suffix.toString(16).padStart(12, "0")}`;

type CanonicalNotificationType =
  DomainEventPayloadByName["notification.created"]["notification_type"];
type CanonicalNotificationResourceType =
  DomainEventPayloadByName["notification.created"]["related_resource_type"];
type CanonicalNotificationEventStatus =
  | DomainEventPayloadByName["notification.created"]["notification_status"]
  | DomainEventPayloadByName["notification.dead_lettered"]["notification_status"]
  | DomainEventPayloadByName["notification.delivered"]["notification_status"]
  | DomainEventPayloadByName["notification.failed"]["notification_status"];
type PersistedNotificationStatus = CanonicalNotificationEventStatus | "cancelled" | "processing";

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
const S4B4_TABLES = [
  "business_policies",
  "channel_connections",
  "consent_records",
  "contact_identities",
  "contacts",
  "faqs",
  "inbound_routes",
  "lead_qualification_evaluations",
  "lead_qualification_evidence",
  "leads",
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
const S4B5_TABLES = [
  "appointment_confirmation_evidence",
  "appointment_request_attendance",
  "appointment_request_preferences",
  "appointment_request_transitions",
  "appointment_requests",
  "appointment_revenue_attributions",
  "business_policies",
  "channel_connections",
  "consent_records",
  "contact_identities",
  "contacts",
  "conversations",
  "faqs",
  "inbound_routes",
  "lead_qualification_evaluations",
  "lead_qualification_evidence",
  "leads",
  "location_business_hours",
  "location_closures",
  "location_versions",
  "locations",
  "memberships",
  "messages",
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
const S4B6_TABLES = [
  "appointment_confirmation_evidence",
  "appointment_request_attendance",
  "appointment_request_preferences",
  "appointment_request_transitions",
  "appointment_requests",
  "appointment_revenue_attributions",
  "business_policies",
  "channel_connections",
  "consent_records",
  "contact_identities",
  "contacts",
  "conversations",
  "faqs",
  "handoff_transitions",
  "handoffs",
  "inbound_routes",
  "lead_qualification_evaluations",
  "lead_qualification_evidence",
  "leads",
  "location_business_hours",
  "location_closures",
  "location_versions",
  "locations",
  "memberships",
  "messages",
  "notification_attempts",
  "notifications",
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
const S4C1_TABLES = [...S4B6_TABLES, "ai_action_evaluations", "ai_runs"].sort();
const S4C2_TABLES = [
  ...S4C1_TABLES,
  "idempotency_keys",
  "outbox_events",
  "webhook_receipts",
].sort();
const S4C3_TABLES = [
  ...S4C2_TABLES,
  "analytics_events",
  "audit_events",
  "legal_holds",
  "platform_audit_events",
  "privacy_requests",
].sort();
const SCHEMA_TABLES = {
  analytics_events: analyticsEvents,
  ai_action_evaluations: aiActionEvaluations,
  ai_runs: aiRuns,
  appointment_confirmation_evidence: appointmentConfirmationEvidence,
  appointment_request_attendance: appointmentRequestAttendance,
  appointment_request_preferences: appointmentRequestPreferences,
  appointment_request_transitions: appointmentRequestTransitions,
  appointment_requests: appointmentRequests,
  appointment_revenue_attributions: appointmentRevenueAttributions,
  audit_events: auditEvents,
  business_policies: businessPolicies,
  channel_connections: channelConnections,
  consent_records: consentRecords,
  contact_identities: contactIdentities,
  contacts,
  conversations,
  faqs,
  handoff_transitions: handoffTransitions,
  handoffs,
  idempotency_keys: idempotencyKeys,
  inbound_routes: inboundRoutes,
  lead_qualification_evaluations: leadQualificationEvaluations,
  lead_qualification_evidence: leadQualificationEvidence,
  leads,
  legal_holds: legalHolds,
  location_business_hours: locationBusinessHours,
  location_closures: locationClosures,
  location_versions: locationVersions,
  locations,
  memberships,
  messages,
  notification_attempts: notificationAttempts,
  notifications,
  organizations,
  outbox_events: outboxEvents,
  platform_audit_events: platformAuditEvents,
  privacy_requests: privacyRequests,
  retention_policies: retentionPolicies,
  retention_policy_rules: retentionPolicyRules,
  service_locations: serviceLocations,
  service_prices: servicePrices,
  service_versions: serviceVersions,
  services,
  users,
  webhook_receipts: webhookReceipts,
  widget_allowed_origins: widgetAllowedOrigins,
  widget_sessions: widgetSessions,
} as const;

const isDrizzleColumn = (value: unknown): value is { name: string; table: unknown } =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "name") === "string" &&
  Reflect.get(value, "table") !== undefined;

const readObjectProperty = (value: unknown, property: PropertyKey): unknown =>
  typeof value === "object" && value !== null
    ? (Reflect.get(value, property) as unknown)
    : undefined;

const isDomainAggregateType = (value: unknown): value is DomainAggregateType =>
  DOMAIN_AGGREGATE_TYPES.some((aggregateType) => aggregateType === value);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let upgradeTablesAfterS4a: string[] = [];
let upgradeTablesAfterS4b1: string[] = [];
let upgradeTablesAfterS4b2: string[] = [];
let upgradeTablesAfterS4b3: string[] = [];
let upgradeTablesAfterS4b4: string[] = [];
let upgradeTablesAfterS4b5: string[] = [];
let upgradeTablesAfterS4b6: string[] = [];
let upgradeTablesAfterS4c1: string[] = [];
let upgradeTablesAfterS4c2: string[] = [];
let upgradeTablesAfterS4c3: string[] = [];

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

  await applyMigrationSql(testPool, "0004_tired_jubilee.sql");
  upgradeTablesAfterS4b4 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0005_past_dorian_gray.sql");
  upgradeTablesAfterS4b5 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0006_mighty_molly_hayes.sql");
  upgradeTablesAfterS4b6 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0007_bright_star_brand.sql");
  upgradeTablesAfterS4c1 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0008_wandering_omega_flight.sql");
  upgradeTablesAfterS4c2 = await productionTables(testPool);

  await applyMigrationSql(testPool, "0009_lyrical_night_thrasher.sql");
  upgradeTablesAfterS4c3 = await productionTables(testPool);

  await testPool.query(
    `drop table analytics_events, legal_holds, privacy_requests,
      audit_events, platform_audit_events,
      webhook_receipts, idempotency_keys,
      notification_attempts, handoff_transitions, notifications, outbox_events,
      ai_action_evaluations, ai_runs, handoffs,
      appointment_confirmation_evidence, appointment_request_attendance,
      appointment_request_preferences, appointment_request_transitions,
      appointment_revenue_attributions, appointment_requests,
      lead_qualification_evidence, consent_records, messages,
      lead_qualification_evaluations, widget_sessions, conversations,
      leads, contact_identities, contacts,
      widget_allowed_origins, channel_connections,
      business_policies, faqs, service_prices, service_locations,
      service_versions, services, location_closures, location_business_hours,
      location_versions, inbound_routes, retention_policy_rules, retention_policies,
      memberships, locations, users, organizations`,
  );
  if ((await productionTables(testPool)).length !== 0) {
    throw new Error("S4c.3 upgrade verification failed to restore the disposable database");
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

const insertContact = async (
  id: string,
  organizationId: string,
  status: "active" | "anonymized" | "blocked" = "active",
): Promise<void> => {
  await database().query(
    `insert into contacts
      (id, organization_id, display_name_ciphertext, preferred_locale, status,
       first_seen_at, last_seen_at, anonymized_at)
     values ($1, $2, case when $3 = 'anonymized' then null else $4::bytea end, 'en', $3,
       timestamptz '2026-01-01 00:00:00+00',
       timestamptz '2026-01-01 00:01:00+00',
       case when $3 = 'anonymized' then timestamptz '2026-01-01 00:02:00+00' else null end)`,
    [id, organizationId, status, Buffer.from("synthetic-display-name-ciphertext")],
  );
};

const insertContactIdentity = async (
  id: string,
  organizationId: string,
  contactId: string,
  identityType: "email" | "phone" | "telegram_user" | "widget_participant",
  lookupHash: string,
  channelConnectionId: string | null = null,
): Promise<void> => {
  await database().query(
    `insert into contact_identities
      (id, organization_id, contact_id, identity_type, channel_connection_id,
       value_ciphertext, lookup_hash, display_redacted, validation_status, status)
     values ($1, $2, $3, $4, $5, $6, $7, '***redacted', 'valid', 'active')`,
    [
      id,
      organizationId,
      contactId,
      identityType,
      channelConnectionId,
      Buffer.from("synthetic-identity-ciphertext"),
      Buffer.from(lookupHash),
    ],
  );
};

const insertBusinessPolicy = async (
  id: string,
  organizationId: string,
  policyKey: string,
  policyType: "booking" | "consent" | "handoff" | "qualification" | "safety" = "qualification",
): Promise<void> => {
  await database().query(
    `insert into business_policies
      (id, organization_id, policy_key, version_no, policy_type, schema_version,
       rules_jsonb, status, content_hash)
     values ($1, $2, $3, 1, $4, 1,
       '{"required_fields":["service"]}'::jsonb, 'draft', $5)`,
    [id, organizationId, policyKey, policyType, Buffer.from("synthetic-policy-content-hash")],
  );
};

const insertLead = async (
  id: string,
  organizationId: string,
  contactId: string,
  sourceChannelConnectionId: string,
  status = "new",
): Promise<void> => {
  await database().query(
    `insert into leads
      (id, organization_id, contact_id, status, source_channel_connection_id,
       closed_at, closed_reason)
     values ($1, $2, $3, $4::varchar, $5,
       case when $4::varchar = 'closed' then now() else null end,
       case when $4::varchar = 'closed' then 'completed' else null end)`,
    [id, organizationId, contactId, status, sourceChannelConnectionId],
  );
};

const insertLeadQualificationEvaluation = async (
  id: string,
  organizationId: string,
  leadId: string,
  businessPolicyId: string,
  result: "disqualified" | "incomplete" | "qualified" = "qualified",
): Promise<void> => {
  await database().query(
    `insert into lead_qualification_evaluations
      (id, organization_id, lead_id, business_policy_id, result, reason_codes,
       facts_jsonb, evaluated_by, occurred_at)
     values ($1, $2, $3, $4, $5, array['service_confirmed'],
       '{"service_confirmed":true}'::jsonb, 'system', now())`,
    [id, organizationId, leadId, businessPolicyId, result],
  );
};

const insertConversation = async (
  id: string,
  organizationId: string,
  contactId: string,
  leadId: string,
  channelConnectionId: string,
  status: "awaiting_lead" | "awaiting_staff" | "closed" | "open" | "resolved" = "open",
  automationMode: "ai" | "paused" | "staff" = "ai",
  activeHandoffId: string | null = null,
): Promise<void> => {
  await database().query(
    `insert into conversations
      (id, organization_id, contact_id, lead_id, channel_connection_id,
       external_thread_hash, status, preferred_locale, automation_mode,
       active_handoff_id, started_at, last_activity_at, resolved_at, closed_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'en', $8, $9,
       timestamptz '2026-01-01 00:00:00+00',
       timestamptz '2026-01-01 00:01:00+00',
       case when $7::varchar in ('resolved', 'closed')
         then timestamptz '2026-01-01 00:02:00+00' else null end,
       case when $7::varchar = 'closed'
         then timestamptz '2026-01-01 00:03:00+00' else null end)`,
    [
      id,
      organizationId,
      contactId,
      leadId,
      channelConnectionId,
      Buffer.from(`synthetic-thread-hash-${id}`),
      status,
      automationMode,
      activeHandoffId,
    ],
  );
};

const insertInboundMessage = async (
  id: string,
  organizationId: string,
  conversationId: string,
  channelConnectionId: string,
  senderContactId: string,
  sequenceNo: number,
  externalMessageId = `provider-message-${id}`,
): Promise<void> => {
  await database().query(
    `insert into messages
      (id, organization_id, conversation_id, channel_connection_id,
       direction, sender_type, sender_contact_id, sequence_no,
       external_event_id, external_message_id, external_sent_at,
       content_type, body_ciphertext, body_hash, locale,
       processing_status, delivery_status)
     values ($1, $2, $3, $4, 'inbound', 'customer', $5, $6,
       $7, $8, timestamptz '2026-01-01 00:01:00+00',
       'text', $9, $10, 'en', 'accepted', 'not_applicable')`,
    [
      id,
      organizationId,
      conversationId,
      channelConnectionId,
      senderContactId,
      sequenceNo,
      `provider-event-${id}`,
      externalMessageId,
      Buffer.from("synthetic-message-ciphertext"),
      Buffer.from(`synthetic-message-body-hash-${id}`),
    ],
  );
};

type AppointmentFixture = Readonly<{
  businessPolicyId: string;
  contactId: string;
  conversationId: string;
  leadId: string;
  locationId: string;
  locationVersionId: string;
  messageId: string;
  organizationId: string;
  serviceId: string;
  serviceVersionId: string;
  staffMembershipId: string;
}>;

const insertAppointmentRequest = async (
  id: string,
  fixture: AppointmentFixture,
  status:
    | "awaiting_customer_confirmation"
    | "cancelled"
    | "confirmed"
    | "expired"
    | "rejected"
    | "requested"
    | "staff_accepted" = "requested",
  dedupeKey = `request-${id}`,
): Promise<void> => {
  await database().query(
    `insert into appointment_requests
      (id, organization_id, lead_id, contact_id, conversation_id,
       source_message_id, service_id, service_version_id, location_id,
       location_version_id, business_policy_id, status, request_dedupe_key,
       customer_notes_ciphertext, staff_decided_by_membership_id,
       staff_decided_at, staff_decision_reason_code, start_at, end_at,
       offered_time_zone, offered_local_start, offer_version,
       confirmation_issued_at, offer_expires_at, confirmation_token_hash,
       confirmed_at, confirmation_source, rejection_reason_code,
       cancellation_reason_code, cancelled_by_type, expired_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected')
         then $15::uuid else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected')
         then statement_timestamp() + interval '1 minute' else null end,
       case when $12::varchar = 'rejected' then 'service_unavailable' else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
         then statement_timestamp() + interval '1 day' else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
         then statement_timestamp() + interval '1 day 30 minutes' else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
         then 'Asia/Tashkent' else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
         then timestamp '2026-10-01 09:00:00' else null end,
       case when $12::varchar in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
         then 1 else 0 end,
       case when $12::varchar in ('awaiting_customer_confirmation', 'confirmed')
         then statement_timestamp() + interval '2 minutes' else null end,
       case when $12::varchar in ('awaiting_customer_confirmation', 'confirmed')
         then statement_timestamp() + interval '1 hour' else null end,
       case when $12::varchar in ('awaiting_customer_confirmation', 'confirmed')
         then $16::bytea else null end,
       case when $12::varchar = 'confirmed'
         then statement_timestamp() + interval '3 minutes' else null end,
       case when $12::varchar = 'confirmed' then 'customer_session' else null end,
       case when $12::varchar = 'rejected' then 'service_unavailable' else null end,
       case when $12::varchar = 'cancelled' then 'customer_declined' else null end,
       case when $12::varchar = 'cancelled' then 'customer' else null end,
       case when $12::varchar = 'expired'
         then statement_timestamp() + interval '1 hour' else null end)`,
    [
      id,
      fixture.organizationId,
      fixture.leadId,
      fixture.contactId,
      fixture.conversationId,
      fixture.messageId,
      fixture.serviceId,
      fixture.serviceVersionId,
      fixture.locationId,
      fixture.locationVersionId,
      fixture.businessPolicyId,
      status,
      dedupeKey,
      Buffer.from("synthetic-customer-notes-ciphertext"),
      fixture.staffMembershipId,
      Buffer.from(`synthetic-confirmation-token-hash-${id}`),
    ],
  );
};

type WorkflowTenantSeed = AppointmentFixture &
  Readonly<{
    channelConnectionId: string;
    userId: string;
  }>;

const seedWorkflowTenant = async (
  seed: WorkflowTenantSeed,
  slug: string,
  locationCode: string,
  serviceCode: string,
): Promise<void> => {
  await insertOrganization(seed.organizationId, slug);
  await insertUser(seed.userId);
  await insertActiveMembership(seed.staffMembershipId, seed.organizationId, seed.userId);
  await insertLocation(seed.locationId, seed.organizationId, locationCode);
  await insertLocationVersion(
    seed.locationVersionId,
    seed.organizationId,
    seed.locationId,
    1,
    seed.userId,
  );
  await insertService(seed.serviceId, seed.organizationId, serviceCode);
  await insertServiceVersion(
    seed.serviceVersionId,
    seed.organizationId,
    seed.serviceId,
    1,
    seed.userId,
  );
  await insertBusinessPolicy(
    seed.businessPolicyId,
    seed.organizationId,
    "appointment-booking",
    "booking",
  );
  await insertContact(seed.contactId, seed.organizationId);
  await insertChannelConnection(
    seed.channelConnectionId,
    seed.organizationId,
    "widget",
    `Widget ${slug}`,
  );
  await insertLead(
    seed.leadId,
    seed.organizationId,
    seed.contactId,
    seed.channelConnectionId,
    "qualified",
  );
  await insertConversation(
    seed.conversationId,
    seed.organizationId,
    seed.contactId,
    seed.leadId,
    seed.channelConnectionId,
  );
  await insertInboundMessage(
    seed.messageId,
    seed.organizationId,
    seed.conversationId,
    seed.channelConnectionId,
    seed.contactId,
    1,
  );
};

const WORKFLOW_A: WorkflowTenantSeed = {
  businessPolicyId: POLICY_A,
  channelConnectionId: CHANNEL_CONNECTION_A,
  contactId: CONTACT_A,
  conversationId: CONVERSATION_A,
  leadId: LEAD_A,
  locationId: LOCATION_A,
  locationVersionId: LOCATION_VERSION_A,
  messageId: MESSAGE_A,
  organizationId: ORGANIZATION_A,
  serviceId: SERVICE_A,
  serviceVersionId: SERVICE_VERSION_A,
  staffMembershipId: MEMBERSHIP_A,
  userId: USER_A,
};

const WORKFLOW_B: WorkflowTenantSeed = {
  businessPolicyId: TEST_ID_3,
  channelConnectionId: CHANNEL_CONNECTION_B,
  contactId: CONTACT_B,
  conversationId: CONVERSATION_B,
  leadId: LEAD_B,
  locationId: LOCATION_B,
  locationVersionId: LOCATION_VERSION_B,
  messageId: MESSAGE_B,
  organizationId: ORGANIZATION_B,
  serviceId: SERVICE_B,
  serviceVersionId: SERVICE_VERSION_B,
  staffMembershipId: MEMBERSHIP_B,
  userId: USER_B,
};

type HandoffInsertOverrides = Readonly<{
  assignedMembershipId?: string | null;
  conversationId?: string;
  leadId?: string;
  locationId?: string | null;
  organizationId?: string;
  queueKey?: string;
  triggerReason?: HandoffTriggerReason;
}>;

const insertHandoff = async (
  id: string,
  fixture: WorkflowTenantSeed,
  status: HandoffStatus = "requested",
  overrides: HandoffInsertOverrides = {},
): Promise<void> => {
  const organizationId = overrides.organizationId ?? fixture.organizationId;
  const conversationId = overrides.conversationId ?? fixture.conversationId;
  const leadId = overrides.leadId ?? fixture.leadId;
  const locationId = overrides.locationId === undefined ? fixture.locationId : overrides.locationId;
  const defaultAssignee = ["assigned", "in_progress", "resolved"].includes(status)
    ? fixture.staffMembershipId
    : null;
  const assignedMembershipId = overrides.assignedMembershipId ?? defaultAssignee;

  await database().query(
    `insert into handoffs
      (id, organization_id, conversation_id, lead_id, location_id, status,
       trigger_reason, queue_key, assigned_membership_id, requested_at,
       assigned_at, started_at, sla_due_at, resolved_at, resolution_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
       timestamptz '2026-01-01 00:02:00+00',
       case when $6::varchar in ('assigned', 'in_progress', 'resolved')
         then timestamptz '2026-01-01 00:03:00+00' else null end,
       case when $6::varchar in ('in_progress', 'resolved')
         then timestamptz '2026-01-01 00:04:00+00' else null end,
       timestamptz '2026-01-01 01:02:00+00',
       case when $6::varchar = 'resolved'
         then timestamptz '2026-01-01 00:05:00+00' else null end,
       case when $6::varchar = 'resolved' then 'handled' else null end)`,
    [
      id,
      organizationId,
      conversationId,
      leadId,
      locationId,
      status,
      overrides.triggerReason ?? "customer_requested",
      overrides.queueKey ?? "front_desk",
      assignedMembershipId,
    ],
  );
};

type HandoffTransitionInsert = Readonly<{
  actorContactId?: string | null;
  actorMembershipId?: string | null;
  actorType?: "customer" | "member" | "system";
  conversationDisposition?: "resume_ai" | "resolve_conversation" | "successor_handoff" | null;
  fromAssigneeId?: string | null;
  fromStatus: HandoffStatus | null;
  handoffId: string;
  id: string;
  organizationId: string;
  reasonCode?: string | null;
  toAssigneeId?: string | null;
  toStatus: HandoffStatus;
  version: number;
}>;

const insertHandoffTransition = async (transition: HandoffTransitionInsert): Promise<void> => {
  await database().query(
    `insert into handoff_transitions
      (id, organization_id, handoff_id, from_status, to_status,
       aggregate_version, actor_type, actor_contact_id, actor_membership_id,
       from_assignee_id, to_assignee_id, conversation_disposition,
       reason_code, correlation_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $10, $11, $12,
       $13, $14, timestamptz '2026-01-01 00:10:00+00' + ($6::bigint * interval '1 minute'))`,
    [
      transition.id,
      transition.organizationId,
      transition.handoffId,
      transition.fromStatus,
      transition.toStatus,
      transition.version,
      transition.actorType ?? "system",
      transition.actorContactId ?? null,
      transition.actorMembershipId ?? null,
      transition.fromAssigneeId ?? null,
      transition.toAssigneeId ?? null,
      transition.conversationDisposition ?? null,
      transition.reasonCode ?? null,
      syntheticUuid(0x800 + transition.version),
    ],
  );
};

type OutboxEventInsertOverrides = Readonly<{
  aggregateId?: string;
  aggregateType?: DomainAggregateType;
  aggregateVersion?: number;
  causationId?: string | null;
  correlationId?: string;
  eventType?: DomainEventName | "unknown.event";
  payload?: Record<string, unknown> | readonly unknown[];
  schemaVersion?: string;
  status?: "dead_lettered" | "pending" | "processing" | "published";
}>;

const insertOutboxEvent = async (
  id: string,
  organizationId: string,
  overrides: OutboxEventInsertOverrides = {},
): Promise<void> => {
  const status = overrides.status ?? "pending";
  await database().query(
    `insert into outbox_events
      (id, organization_id, event_type, schema_version, aggregate_type,
       aggregate_id, aggregate_version, payload_jsonb, correlation_id,
       causation_id, occurred_at, status, attempt_count, available_at,
       locked_by, locked_until, published_at, last_error_category)
     values ($1, $2, $3, $4, $5, $6, $7::bigint, $8::jsonb, $9, $10,
       timestamptz '2026-01-01 00:10:00+00', $11,
       case when $11::varchar = 'pending' then 0 else 1 end,
       timestamptz '2026-01-01 00:10:00+00',
       case when $11::varchar = 'processing' then 'worker:test-1' else null end,
       case when $11::varchar = 'processing'
         then timestamptz '2026-01-01 00:20:00+00' else null end,
       case when $11::varchar = 'published'
         then timestamptz '2026-01-01 00:11:00+00' else null end,
       case when $11::varchar = 'dead_lettered' then 'synthetic_failure' else null end)`,
    [
      id,
      organizationId,
      overrides.eventType ?? "notification.created",
      overrides.schemaVersion ?? "1",
      overrides.aggregateType ?? "notification",
      overrides.aggregateId ?? id,
      overrides.aggregateVersion ?? 1,
      JSON.stringify(overrides.payload ?? { source: "synthetic_fixture" }),
      overrides.correlationId ?? CORRELATION_A,
      overrides.causationId ?? null,
      status,
    ],
  );
};

const ensureOutboxEvent = async (
  id: string,
  organizationId: string,
  aggregateId: string,
): Promise<void> => {
  const existing = await database().query("select 1 from outbox_events where id = $1", [id]);
  if (existing.rowCount === 0) {
    await insertOutboxEvent(id, organizationId, { aggregateId });
  }
};

type WebhookReceiptInsertOverrides = Readonly<{
  attemptCount?: number;
  channelConnectionId?: string;
  correlationId?: string;
  externalEventId?: string;
  externalMessageId?: string | null;
  firstReceivedAt?: string;
  lastErrorCategory?: string | null;
  lastReceivedAt?: string;
  nextAttemptAt?: string | null;
  organizationId?: string;
  payloadCiphertext?: Buffer | null;
  payloadHash?: Buffer;
  processedMessageId?: string | null;
  provider?: string;
  providerSequence?: number | null;
  status?: "permanent_failure" | "processed" | "processing" | "received" | "retryable_failure";
}>;

const insertWebhookReceipt = async (
  id: string,
  fixture: WorkflowTenantSeed,
  overrides: WebhookReceiptInsertOverrides = {},
): Promise<void> => {
  const status = overrides.status ?? "processed";
  await database().query(
    `insert into webhook_receipts
      (id, organization_id, channel_connection_id, provider,
       external_event_id, external_message_id, payload_hash,
       payload_ciphertext, signature_verified_at, provider_sent_at,
       provider_sequence, status, attempt_count, next_attempt_at,
       processed_message_id, first_received_at, last_received_at,
       correlation_id, last_error_category)
     values ($1, $2, $3, $4, $5, $6, $7, $8,
       timestamptz '2026-01-01 00:00:01+00',
       timestamptz '2026-01-01 00:00:00+00', $9, $10, $11, $12, $13,
       $14::timestamptz, $15::timestamptz, $16, $17)`,
    [
      id,
      overrides.organizationId ?? fixture.organizationId,
      overrides.channelConnectionId ?? fixture.channelConnectionId,
      overrides.provider ?? "synthetic_provider",
      overrides.externalEventId ?? `provider-event-${id}`,
      overrides.externalMessageId === undefined
        ? `provider-message-${id}`
        : overrides.externalMessageId,
      overrides.payloadHash ?? Buffer.from(`synthetic-webhook-payload-hash-${id}`),
      overrides.payloadCiphertext ?? null,
      overrides.providerSequence ?? 1,
      status,
      overrides.attemptCount ?? (status === "received" ? 0 : 1),
      overrides.nextAttemptAt ?? (status === "retryable_failure" ? "2026-01-01T00:05:00Z" : null),
      overrides.processedMessageId === undefined
        ? status === "processed"
          ? fixture.messageId
          : null
        : overrides.processedMessageId,
      overrides.firstReceivedAt ?? "2026-01-01T00:00:01Z",
      overrides.lastReceivedAt ?? "2026-01-01T00:00:01Z",
      overrides.correlationId ?? CORRELATION_A,
      overrides.lastErrorCategory ??
        (status === "retryable_failure" || status === "permanent_failure"
          ? "synthetic_failure"
          : null),
    ],
  );
};

type IdempotencyKeyInsertOverrides = Readonly<{
  completedAt?: string | null;
  expiresAt?: string;
  keyHash?: Buffer;
  lockedUntil?: string | null;
  principalIdHash?: Buffer;
  principalType?: "channel_participant" | "system" | "user" | "widget_session";
  requestHash?: Buffer;
  resourceId?: string | null;
  resourceType?: string | null;
  responseCiphertext?: Buffer | null;
  responseStatus?: number | null;
  scope?: string;
  status?: "failed" | "in_progress" | "succeeded";
}>;

const insertIdempotencyKey = async (
  id: string,
  organizationId: string,
  overrides: IdempotencyKeyInsertOverrides = {},
): Promise<void> => {
  const status = overrides.status ?? "succeeded";
  await database().query(
    `insert into idempotency_keys
      (id, organization_id, scope, key_hash, principal_type,
       principal_id_hash, request_hash, status, response_status,
       response_ciphertext, resource_type, resource_id, locked_until,
       expires_at, created_at, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13::timestamptz, $14::timestamptz,
       timestamptz '2026-01-01 00:00:00+00', $15::timestamptz)`,
    [
      id,
      organizationId,
      overrides.scope ?? "conversation.reply",
      overrides.keyHash ?? Buffer.from("synthetic-idempotency-key-hash"),
      overrides.principalType ?? "user",
      overrides.principalIdHash ?? Buffer.from("synthetic-principal-id-hash"),
      overrides.requestHash ?? Buffer.from("synthetic-request-fingerprint"),
      status,
      overrides.responseStatus === undefined
        ? status === "in_progress"
          ? null
          : 202
        : overrides.responseStatus,
      overrides.responseCiphertext === undefined
        ? status === "in_progress"
          ? null
          : Buffer.from("synthetic-encrypted-response")
        : overrides.responseCiphertext,
      overrides.resourceType ?? null,
      overrides.resourceId ?? null,
      overrides.lockedUntil === undefined
        ? status === "in_progress"
          ? "2026-01-01T00:05:00Z"
          : null
        : overrides.lockedUntil,
      overrides.expiresAt ?? "2026-01-02T00:00:00Z",
      overrides.completedAt === undefined
        ? status === "in_progress"
          ? null
          : "2026-01-01T00:01:00Z"
        : overrides.completedAt,
    ],
  );
};

type NotificationInsertOverrides = Readonly<{
  audienceType?: "contact" | "membership" | "queue";
  claimedByMembershipId?: string | null;
  dedupeKey?: string;
  notificationType?: CanonicalNotificationType;
  originatingOutboxEventId?: string;
  queueKey?: string | null;
  recipientContactId?: string | null;
  recipientMembershipId?: string | null;
  relatedResourceId?: string;
  relatedResourceType?: CanonicalNotificationResourceType;
  status?: PersistedNotificationStatus;
}>;

const insertNotification = async (
  id: string,
  organizationId: string,
  overrides: NotificationInsertOverrides = {},
): Promise<void> => {
  const audienceType = overrides.audienceType ?? "membership";
  const status = overrides.status ?? "pending";
  const originatingOutboxEventId = overrides.originatingOutboxEventId ?? OUTBOX_EVENT_A;
  await ensureOutboxEvent(originatingOutboxEventId, organizationId, id);
  await database().query(
    `insert into notifications
      (id, organization_id, notification_type, audience_type,
       recipient_membership_id, recipient_contact_id, queue_key,
       related_resource_type, related_resource_id, originating_outbox_event_id,
       template_key, template_version, payload_ciphertext, status, dedupe_key,
       available_at, attempt_count, next_attempt_at, delivered_at,
       claimed_by_membership_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       'handoff.created', 1, $11, $12, $13,
       timestamptz '2026-01-01 00:20:00+00', 0, null,
       case when $12::varchar = 'delivered'
         then timestamptz '2026-01-01 00:21:00+00' else null end,
       $14)`,
    [
      id,
      organizationId,
      overrides.notificationType ?? "staff_task",
      audienceType,
      overrides.recipientMembershipId ?? (audienceType === "membership" ? MEMBERSHIP_A : null),
      overrides.recipientContactId ?? (audienceType === "contact" ? CONTACT_A : null),
      overrides.queueKey ?? (audienceType === "queue" ? "front_desk" : null),
      overrides.relatedResourceType ?? "handoff",
      overrides.relatedResourceId ?? HANDOFF_A,
      originatingOutboxEventId,
      Buffer.from("synthetic-notification-ciphertext"),
      status,
      overrides.dedupeKey ?? `notification-${id}`,
      overrides.claimedByMembershipId ?? null,
    ],
  );
};

const insertNotificationAttempt = async (
  id: string,
  organizationId: string,
  notificationId: string,
  attemptNo: number,
  adapter: "email" | "in_app" | "push" | "sms" | "telegram" | "widget" = "in_app",
  outcome: "delivered" | "permanent_failure" | "retryable_failure" = "delivered",
  providerRequestKey = `provider-request-${id}`,
): Promise<void> => {
  await database().query(
    `insert into notification_attempts
      (id, organization_id, notification_id, adapter, attempt_no,
       provider_request_key, started_at, finished_at, outcome,
       provider_status_code, error_category, provider_message_id_hash, latency_ms)
     values ($1, $2, $3, $4, $5, $6,
       timestamptz '2026-01-01 00:30:00+00',
       timestamptz '2026-01-01 00:30:01+00', $7, 200,
       case when $7::varchar = 'delivered' then null else 'provider_unavailable' end,
       $8, 1000)`,
    [
      id,
      organizationId,
      notificationId,
      adapter,
      attemptNo,
      providerRequestKey,
      outcome,
      Buffer.from(`synthetic-provider-message-hash-${id}`),
    ],
  );
};

type AiRunInsertOverrides = Readonly<{
  attemptNo?: number;
  conversationId?: string;
  correlationId?: string;
  decisionSchemaVersion?: string;
  expectedConversationVersion?: number;
  inputSnapshotCiphertext?: Buffer | null;
  organizationId?: string;
  outputSnapshotCiphertext?: Buffer | null;
  providerId?: string;
  requestedModelId?: string;
  snapshotCapturePolicyId?: string | null;
  triggerMessageId?: string;
}>;

const insertAiRun = async (
  id: string,
  fixture: WorkflowTenantSeed,
  overrides: AiRunInsertOverrides = {},
): Promise<void> => {
  const attemptNo = overrides.attemptNo ?? 1;
  await database().query(
    `insert into ai_runs
      (id, organization_id, conversation_id, trigger_message_id,
       expected_conversation_version, provider_id, requested_model_id,
       model_profile_version, provider_resolved_model_id, orchestrator_version,
       prompt_template_version, decision_schema_version, policy_version, status,
       input_units, output_units, cached_input_units, reasoning_units, total_units,
       estimated_cost_micros, cost_currency, cost_catalog_version, latency_ms,
       attempt_no, failure_category, knowledge_manifest_jsonb, input_hash,
       output_hash, input_snapshot_ciphertext, output_snapshot_ciphertext,
       snapshot_capture_policy_id, schema_valid, policy_allowed, started_at,
       finished_at, correlation_id)
     values ($1, $2, $3, $4, $5::bigint, $6, $7,
       'profile-v1', 'synthetic-model-2026-08-01', 'orchestrator-v1',
       'lead-booking-v1', $8, 'application-policy-v1', 'succeeded',
       120, 40, 10, 5, 160, 2500, 'USD', 'catalog-v1', 850,
       $9, null, '{"context_version":"synthetic-v1"}'::jsonb, $10, $11,
       $12, $13, $14, true, true,
       timestamptz '2026-01-01 00:01:01+00',
       timestamptz '2026-01-01 00:01:02+00', $15)`,
    [
      id,
      overrides.organizationId ?? fixture.organizationId,
      overrides.conversationId ?? fixture.conversationId,
      overrides.triggerMessageId ?? fixture.messageId,
      overrides.expectedConversationVersion ?? 1,
      overrides.providerId ?? "synthetic_provider",
      overrides.requestedModelId ?? "synthetic-model-2026-08-01",
      overrides.decisionSchemaVersion ?? "1",
      attemptNo,
      Buffer.from(`synthetic-ai-input-hash-${id}`),
      Buffer.from(`synthetic-ai-output-hash-${id}`),
      overrides.inputSnapshotCiphertext ?? null,
      overrides.outputSnapshotCiphertext ?? null,
      overrides.snapshotCapturePolicyId ?? null,
      overrides.correlationId ?? syntheticUuid(0x900 + attemptNo),
    ],
  );
};

type AiActionEvaluationInsert = Readonly<{
  actionName?: AgentActionType;
  aiRunId: string;
  applicationStatus?: "applied" | "failed" | "not_applied" | "stale";
  id: string;
  organizationId: string;
  policyReasonCode?: string | null;
  targetAggregateId?: string | null;
  targetAggregateType?: "appointment_request" | "conversation" | "handoff" | null;
  validationStatus?: "allowed" | "denied" | "malformed" | "pending";
}>;

const insertAiActionEvaluation = async (evaluation: AiActionEvaluationInsert): Promise<void> => {
  const validationStatus = evaluation.validationStatus ?? "allowed";
  const applicationStatus = evaluation.applicationStatus ?? "not_applied";
  const hasResult = applicationStatus !== "not_applied";
  await database().query(
    `insert into ai_action_evaluations
      (id, organization_id, ai_run_id, action_name, action_schema_version,
       proposal_hash, arguments_ciphertext, validation_status,
       policy_reason_code, application_status, target_aggregate_type,
       target_aggregate_id, result_hash, result_ciphertext, started_at, finished_at)
     values ($1, $2, $3, $4, '1', $5, $6, $7, $8, $9, $10, $11,
       case when $12::boolean then $13::bytea else null end,
       case when $12::boolean then $14::bytea else null end,
       timestamptz '2026-01-01 00:01:02+00',
       case when $7::varchar = 'pending'
         then null else timestamptz '2026-01-01 00:01:03+00' end)`,
    [
      evaluation.id,
      evaluation.organizationId,
      evaluation.aiRunId,
      evaluation.actionName ?? "none",
      Buffer.from(`synthetic-proposal-hash-${evaluation.id}`),
      Buffer.from("synthetic-encrypted-agent-decision-action"),
      validationStatus,
      evaluation.policyReasonCode ?? null,
      applicationStatus,
      evaluation.targetAggregateType ?? null,
      evaluation.targetAggregateId ?? null,
      hasResult,
      Buffer.from(`synthetic-result-hash-${evaluation.id}`),
      Buffer.from("synthetic-encrypted-application-result"),
    ],
  );
};

type AuditEventOverrides = Readonly<{
  actorId?: string | null;
  actorMembershipId?: string | null;
  actorType?: "customer" | "member" | "platform_operator" | "system";
  metadata?: unknown;
  organizationId?: string;
  sourceIpPrefix?: string | null;
}>;

const insertAuditEvent = async (
  id: string,
  organizationId: string,
  overrides: AuditEventOverrides = {},
): Promise<void> => {
  const actorType = overrides.actorType ?? "system";
  await database().query(
    `insert into audit_events
      (id, organization_id, event_type, actor_type, actor_id, actor_membership_id,
       target_type, target_id, action, result, reason_code, request_id, trace_id,
       correlation_id, source_ip_prefix, user_agent_hash, metadata_redacted_jsonb,
       occurred_at)
     values ($1, $2, 'security.access', $3, $4, $5,
       'conversation', $6, 'conversation.view', 'succeeded', null,
       'request:test-001', 'trace:test-001', $7, $8::cidr, $9, $10::jsonb,
       timestamptz '2026-01-01 00:10:00+00')`,
    [
      id,
      overrides.organizationId ?? organizationId,
      actorType,
      overrides.actorId ?? null,
      overrides.actorMembershipId ?? null,
      CONVERSATION_A,
      CORRELATION_A,
      overrides.sourceIpPrefix ?? "192.0.2.0/24",
      Buffer.from("synthetic-keyed-user-agent-hash"),
      JSON.stringify(overrides.metadata ?? { source: "staff_console" }),
    ],
  );
};

const insertPlatformAuditEvent = async (
  id: string,
  targetOrganizationId: string | null,
  metadata: unknown = { control_plane: true },
): Promise<void> => {
  await database().query(
    `insert into platform_audit_events
      (id, operator_principal_id, action, target_organization_id, target_type,
       target_id, approval_reference, reason_code, result, request_id,
       source_ip_hash, occurred_at, metadata_jsonb)
     values ($1, $2, 'support.access_requested', $3, 'organization', $3,
       'approval:test-001', 'customer_support', 'succeeded', 'request:test-002',
       $4, timestamptz '2026-01-01 00:11:00+00', $5::jsonb)`,
    [
      id,
      syntheticUuid(0xe00),
      targetOrganizationId,
      Buffer.from("synthetic-keyed-source-ip-hash"),
      JSON.stringify(metadata),
    ],
  );
};

const insertPrivacyRequest = async (
  id: string,
  organizationId: string,
  contactId: string | null,
  handledByMembershipId: string | null = null,
): Promise<void> => {
  await database().query(
    `insert into privacy_requests
      (id, organization_id, contact_id, request_type, status, requested_at,
       due_at, request_channel, handled_by_membership_id,
       request_details_ciphertext, legal_hold_blocked)
     values ($1, $2, $3, 'export', 'received',
       timestamptz '2026-01-01 00:00:00+00',
       timestamptz '2026-01-31 00:00:00+00', 'web_form', $4, $5, false)`,
    [
      id,
      organizationId,
      contactId,
      handledByMembershipId,
      Buffer.from("synthetic-encrypted-privacy-request-details"),
    ],
  );
};

const insertLegalHold = async (
  id: string,
  organizationId: string,
  placedByUserId: string,
  scopeType: "appointment_request" | "contact" | "conversation" | "data_class" | "organization",
  scopeId: string | null,
  dataClass: string | null,
): Promise<void> => {
  await database().query(
    `insert into legal_holds
      (id, organization_id, scope_type, scope_id, data_class, status,
       reason_ciphertext, placed_by_user_id, placed_at, approval_reference)
     values ($1, $2, $3, $4, $5, 'active', $6, $7,
       timestamptz '2026-01-01 00:12:00+00', 'legal:test-001')`,
    [
      id,
      organizationId,
      scopeType,
      scopeId,
      dataClass,
      Buffer.from("synthetic-encrypted-legal-hold-reason"),
      placedByUserId,
    ],
  );
};

type AnalyticsEventOverrides = Readonly<{
  appointmentRequestId?: string | null;
  campaignKey?: string | null;
  conversationId?: string | null;
  dimensions?: unknown;
  eventType?: DomainEventName;
  leadId?: string | null;
  numericValueMinor?: bigint | null;
  organizationId?: string;
  schemaVersion?: string;
  sourceEventId?: string;
}>;

const insertAnalyticsEvent = async (
  id: string,
  organizationId: string,
  overrides: AnalyticsEventOverrides = {},
): Promise<void> => {
  const numericValueMinor = overrides.numericValueMinor ?? null;
  await database().query(
    `insert into analytics_events
      (id, organization_id, source_event_id, event_type, schema_version,
       occurred_at, lead_id, conversation_id, appointment_request_id,
       channel_type, locale, campaign_key, dimensions_jsonb,
       numeric_value_minor, currency, projected_at)
     values ($1, $2, $3, $4, $5,
       timestamptz '2026-01-01 00:13:00+00', $6, $7, $8,
       'widget', 'en', $9, $10::jsonb, $11,
       case when $11::bigint is null then null else 'USD' end,
       timestamptz '2026-01-01 00:14:00+00')`,
    [
      id,
      overrides.organizationId ?? organizationId,
      overrides.sourceEventId ?? syntheticUuid(0xe10),
      overrides.eventType ?? "conversation.started",
      overrides.schemaVersion ?? "1",
      overrides.leadId ?? null,
      overrides.conversationId ?? null,
      overrides.appointmentRequestId ?? null,
      overrides.campaignKey ?? null,
      JSON.stringify(overrides.dimensions ?? { funnel_step: "conversation_started" }),
      numericValueMinor,
    ],
  );
};

beforeAll(async () => {
  const testDatabaseUrl = requireTestDatabaseUrl();
  if (testDatabaseUrl === undefined) {
    container = await new PostgreSqlContainer("postgres:17")
      .withDatabase("lead_agent_s4c3_test")
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
    `truncate table analytics_events, legal_holds, privacy_requests,
      audit_events, platform_audit_events,
      webhook_receipts, idempotency_keys,
      notification_attempts, handoff_transitions, notifications, outbox_events,
      ai_action_evaluations, ai_runs, handoffs,
      appointment_confirmation_evidence, appointment_request_attendance,
      appointment_request_preferences, appointment_request_transitions,
      appointment_revenue_attributions, appointment_requests,
      lead_qualification_evidence, consent_records, messages,
      lead_qualification_evaluations, widget_sessions, conversations,
      leads, contact_identities, contacts,
      widget_allowed_origins, channel_connections,
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

describe("S4c.3 PostgreSQL 17 migration", { timeout: 30_000 }, () => {
  it("keeps persisted state and confirmation vocabularies aligned with the domain", () => {
    const conversationStatuses = [
      "open",
      "awaiting_lead",
      "awaiting_staff",
      "resolved",
      "closed",
    ] as const satisfies readonly ConversationStatus[];
    const automationModes = [
      "ai",
      "paused",
      "staff",
    ] as const satisfies readonly ConversationAutomationMode[];
    const appointmentStatuses = [
      "requested",
      "staff_accepted",
      "awaiting_customer_confirmation",
      "confirmed",
      "rejected",
      "cancelled",
      "expired",
    ] as const satisfies readonly AppointmentRequestStatus[];
    const confirmationSources = [
      "customer_session",
      "telegram",
      "staff_attested_external",
    ] as const satisfies readonly AppointmentConfirmationSource[];
    const handoffStatuses = [
      "requested",
      "assigned",
      "in_progress",
      "resolved",
      "cancelled",
      "expired",
    ] as const satisfies readonly HandoffStatus[];
    const handoffTriggerReasons = [
      "customer_requested",
      "missing_authoritative_information",
      "medical_or_safety",
      "low_confidence",
      "policy_blocked",
      "ai_unavailable",
      "delivery_problem",
      "staff_created",
      "other",
    ] as const satisfies readonly HandoffTriggerReason[];
    const notificationTypes = [
      "staff_task",
      "customer_message",
      "staff_alert",
    ] as const satisfies readonly CanonicalNotificationType[];
    const notificationResourceTypes = [
      "appointment_request",
      "handoff",
      "conversation",
      "lead",
      "channel_connection",
      "ai_run",
    ] as const satisfies readonly CanonicalNotificationResourceType[];
    const notificationStatuses = [
      "pending",
      "processing",
      "delivered",
      "failed",
      "dead_lettered",
      "cancelled",
    ] as const satisfies readonly PersistedNotificationStatus[];
    const agentActions = [
      "none",
      "request_information",
      "create_appointment_request",
      "confirm_appointment",
      "decline_appointment",
      "request_handoff",
    ] as const satisfies readonly AgentActionType[];

    expect(conversationStatuses.every(isConversationStatus)).toBe(true);
    expect(automationModes.every(isConversationAutomationMode)).toBe(true);
    expect(appointmentStatuses.every(isAppointmentRequestStatus)).toBe(true);
    expect(confirmationSources.every(isAppointmentConfirmationSource)).toBe(true);
    expect(handoffStatuses.every(isHandoffStatus)).toBe(true);
    expect(handoffTriggerReasons.every(isHandoffTriggerReason)).toBe(true);
    expect(notificationTypes).toHaveLength(3);
    expect(notificationResourceTypes).toHaveLength(6);
    expect(notificationStatuses).toHaveLength(6);
    expect(agentActions).toHaveLength(6);
    expect(DOMAIN_EVENT_NAMES).toHaveLength(63);
    expect(Object.keys(DomainEventSchemasByVersion)).toEqual([...DOMAIN_EVENT_NAMES]);
    expect(Object.keys(DomainEventSchemasByVersion["lead.reopened"])).toEqual(["1", "2"]);
    expect(Reflect.get(AgentDecisionV1Schema, "$id")).toBe("AgentDecision.v1");
    expect(Reflect.get(AgentDecisionActionSchema, "$id")).toBe("AgentDecisionAction.v1");
    expect(isConversationStatus("handed_off")).toBe(false);
    expect(isConversationAutomationMode("human")).toBe(false);
    expect(isAppointmentRequestStatus("completed")).toBe(false);
    expect(isAppointmentConfirmationSource("staff_acceptance")).toBe(false);
    expect(isHandoffStatus("queued")).toBe(false);
    expect(isHandoffTriggerReason("prompt_requested")).toBe(false);
  });

  it("upgrades S4a through S4c.2 to S4c.3, bootstraps head, and reruns safely", async () => {
    expect(upgradeTablesAfterS4a).toEqual(S4A_TABLES);
    expect(upgradeTablesAfterS4b1).toEqual(S4B1_TABLES);
    expect(upgradeTablesAfterS4b2).toEqual(S4B2_TABLES);
    expect(upgradeTablesAfterS4b3).toEqual(S4B3_TABLES);
    expect(upgradeTablesAfterS4b4).toEqual(S4B4_TABLES);
    expect(upgradeTablesAfterS4b5).toEqual(S4B5_TABLES);
    expect(upgradeTablesAfterS4b6).toEqual(S4B6_TABLES);
    expect(upgradeTablesAfterS4c1).toEqual(S4C1_TABLES);
    expect(upgradeTablesAfterS4c2).toEqual(S4C2_TABLES);
    expect(upgradeTablesAfterS4c3).toEqual(S4C3_TABLES);

    const version = await database().query<{ server_version_num: string }>(
      "show server_version_num",
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(170_000);
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180_000);

    expect(await productionTables(database())).toEqual(S4C3_TABLES);

    const migrationCount = await database().query<{ count: number }>(
      "select count(*)::integer as count from drizzle.__drizzle_migrations",
    );
    expect(migrationCount.rows[0]?.count).toBe(10);
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

    expect(namesByTable["ai_runs"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "conversation_id",
      "trigger_message_id",
      "expected_conversation_version",
      "provider_id",
      "requested_model_id",
      "model_profile_version",
      "provider_resolved_model_id",
      "orchestrator_version",
      "prompt_template_version",
      "decision_schema_version",
      "policy_version",
      "status",
      "input_units",
      "output_units",
      "cached_input_units",
      "reasoning_units",
      "total_units",
      "estimated_cost_micros",
      "cost_currency",
      "cost_catalog_version",
      "latency_ms",
      "attempt_no",
      "failure_category",
      "knowledge_manifest_jsonb",
      "input_hash",
      "output_hash",
      "input_snapshot_ciphertext",
      "output_snapshot_ciphertext",
      "snapshot_capture_policy_id",
      "schema_valid",
      "policy_allowed",
      "started_at",
      "finished_at",
      "correlation_id",
    ]);
    expect(namesByTable["ai_action_evaluations"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "ai_run_id",
      "action_name",
      "action_schema_version",
      "proposal_hash",
      "arguments_ciphertext",
      "validation_status",
      "policy_reason_code",
      "application_status",
      "target_aggregate_type",
      "target_aggregate_id",
      "result_hash",
      "result_ciphertext",
      "started_at",
      "finished_at",
    ]);
    expect(namesByTable["webhook_receipts"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "channel_connection_id",
      "provider",
      "external_event_id",
      "external_message_id",
      "payload_hash",
      "payload_ciphertext",
      "signature_verified_at",
      "provider_sent_at",
      "provider_sequence",
      "status",
      "attempt_count",
      "next_attempt_at",
      "processed_message_id",
      "first_received_at",
      "last_received_at",
      "correlation_id",
      "last_error_category",
    ]);
    expect(namesByTable["idempotency_keys"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "scope",
      "key_hash",
      "principal_type",
      "principal_id_hash",
      "request_hash",
      "status",
      "response_status",
      "response_ciphertext",
      "resource_type",
      "resource_id",
      "locked_until",
      "expires_at",
      "created_at",
      "completed_at",
    ]);
    expect(namesByTable["outbox_events"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "event_type",
      "schema_version",
      "aggregate_type",
      "aggregate_id",
      "aggregate_version",
      "payload_jsonb",
      "correlation_id",
      "causation_id",
      "occurred_at",
      "status",
      "attempt_count",
      "available_at",
      "locked_by",
      "locked_until",
      "published_at",
      "last_error_category",
    ]);
    expect(namesByTable["audit_events"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "event_type",
      "actor_type",
      "actor_id",
      "actor_membership_id",
      "impersonation_session_id",
      "support_grant_id",
      "target_type",
      "target_id",
      "action",
      "result",
      "reason_code",
      "request_id",
      "trace_id",
      "correlation_id",
      "source_ip_prefix",
      "user_agent_hash",
      "metadata_redacted_jsonb",
      "occurred_at",
    ]);
    expect(namesByTable["platform_audit_events"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "operator_principal_id",
      "action",
      "target_organization_id",
      "target_type",
      "target_id",
      "approval_reference",
      "reason_code",
      "result",
      "request_id",
      "source_ip_hash",
      "occurred_at",
      "metadata_jsonb",
    ]);
    expect(namesByTable["privacy_requests"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "contact_id",
      "request_type",
      "status",
      "requested_at",
      "due_at",
      "verified_at",
      "completed_at",
      "request_channel",
      "handled_by_membership_id",
      "reason_code",
      "request_details_ciphertext",
      "export_artifact_ref",
      "artifact_expires_at",
      "legal_hold_blocked",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["legal_holds"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "scope_type",
      "scope_id",
      "data_class",
      "status",
      "reason_ciphertext",
      "placed_by_user_id",
      "placed_at",
      "released_by_user_id",
      "released_at",
      "approval_reference",
    ]);
    expect(namesByTable["analytics_events"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "source_event_id",
      "event_type",
      "schema_version",
      "occurred_at",
      "lead_id",
      "conversation_id",
      "appointment_request_id",
      "channel_type",
      "locale",
      "campaign_key",
      "service_id",
      "location_id",
      "confirmation_source",
      "dimensions_jsonb",
      "numeric_value_minor",
      "currency",
      "projected_at",
    ]);

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
    expect(namesByTable["contacts"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "display_name_ciphertext",
      "preferred_locale",
      "status",
      "first_seen_at",
      "last_seen_at",
      "anonymized_at",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["contact_identities"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "contact_id",
      "identity_type",
      "channel_connection_id",
      "value_ciphertext",
      "lookup_hash",
      "hash_key_version",
      "display_redacted",
      "validation_status",
      "verified_at",
      "status",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["consent_records"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "contact_id",
      "conversation_id",
      "contact_identity_id",
      "purpose",
      "status",
      "lawful_basis_code",
      "notice_key",
      "notice_version",
      "policy_url",
      "locale",
      "capture_channel",
      "channel_connection_id",
      "source_message_id",
      "captured_by_type",
      "captured_by_id",
      "captured_at",
      "withdrawn_at",
      "supersedes_consent_id",
      "evidence_hash",
      "evidence_ciphertext",
      "created_at",
    ]);
    expect(namesByTable["leads"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "contact_id",
      "status",
      "source_channel_connection_id",
      "campaign_key",
      "service_id",
      "location_id",
      "assigned_membership_id",
      "qualification_policy_id",
      "qualification_reason_codes",
      "engaged_at",
      "qualified_at",
      "booking_requested_at",
      "converted_at",
      "closed_at",
      "closed_reason",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(
      namesByTable["lead_qualification_evaluations"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "lead_id",
      "business_policy_id",
      "result",
      "reason_codes",
      "facts_jsonb",
      "evaluated_by",
      "member_id",
      "occurred_at",
    ]);
    expect(
      namesByTable["lead_qualification_evidence"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "organization_id",
      "evaluation_id",
      "message_id",
      "field_key",
      "evidence_kind",
      "created_at",
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
    expect(namesByTable["conversations"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "contact_id",
      "lead_id",
      "channel_connection_id",
      "external_thread_hash",
      "status",
      "preferred_locale",
      "automation_mode",
      "active_handoff_id",
      "next_sequence_no",
      "started_at",
      "last_activity_at",
      "resolved_at",
      "closed_at",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["messages"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "conversation_id",
      "channel_connection_id",
      "direction",
      "sender_type",
      "sender_contact_id",
      "sender_membership_id",
      "sequence_no",
      "external_event_id",
      "external_message_id",
      "external_sent_at",
      "external_sequence",
      "content_type",
      "body_ciphertext",
      "body_hash",
      "locale",
      "processing_status",
      "delivery_status",
      "reply_to_message_id",
      "ai_run_id",
      "knowledge_manifest_jsonb",
      "redacted_at",
      "created_at",
    ]);
    expect(namesByTable["appointment_requests"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "lead_id",
      "contact_id",
      "conversation_id",
      "source_message_id",
      "service_id",
      "service_version_id",
      "location_id",
      "location_version_id",
      "business_policy_id",
      "status",
      "request_dedupe_key",
      "customer_notes_ciphertext",
      "staff_decided_by_membership_id",
      "staff_decided_at",
      "staff_decision_reason_code",
      "start_at",
      "end_at",
      "offered_time_zone",
      "offered_local_start",
      "offer_version",
      "confirmation_issued_at",
      "offer_expires_at",
      "confirmation_token_hash",
      "confirmation_token_consumed_at",
      "confirmed_at",
      "confirmation_source",
      "rejection_reason_code",
      "cancellation_reason_code",
      "cancelled_by_type",
      "expired_at",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(
      namesByTable["appointment_request_preferences"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "appointment_request_id",
      "preference_order",
      "start_at",
      "end_at",
      "time_zone",
      "original_local_text_ciphertext",
      "local_start",
      "local_end",
      "precision",
      "created_at",
    ]);
    expect(
      namesByTable["appointment_request_transitions"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "appointment_request_id",
      "from_status",
      "to_status",
      "aggregate_version",
      "command",
      "offer_version",
      "actor_type",
      "actor_contact_id",
      "actor_membership_id",
      "reason_code",
      "source_message_id",
      "correlation_id",
      "occurred_at",
      "metadata_jsonb",
    ]);
    expect(
      namesByTable["appointment_confirmation_evidence"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "appointment_request_id",
      "offer_version",
      "outcome",
      "source",
      "customer_contact_id",
      "recorded_by_membership_id",
      "source_message_id",
      "external_reference_hash",
      "customer_acted_at",
      "recorded_at",
      "attestation_method",
      "attestation_reason_code",
      "evidence_ciphertext",
      "correlation_id",
    ]);
    expect(
      namesByTable["appointment_request_attendance"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "appointment_request_id",
      "outcome",
      "occurred_at",
      "recorded_by_membership_id",
      "recorded_at",
      "source",
      "is_current",
      "supersedes_id",
      "reason_code",
    ]);
    expect(
      namesByTable["appointment_revenue_attributions"]?.map(({ column_name }) => column_name),
    ).toEqual([
      "id",
      "organization_id",
      "appointment_request_id",
      "amount_minor",
      "currency",
      "entry_type",
      "category_code",
      "recognized_at",
      "recorded_by_membership_id",
      "recorded_at",
      "source",
      "reverses_attribution_id",
      "external_reference_hash",
      "reason_code",
    ]);
    expect(namesByTable["handoffs"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "conversation_id",
      "lead_id",
      "location_id",
      "status",
      "trigger_reason",
      "queue_key",
      "assigned_membership_id",
      "requested_at",
      "assigned_at",
      "started_at",
      "sla_due_at",
      "resolved_at",
      "resolution_code",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["handoff_transitions"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "handoff_id",
      "from_status",
      "to_status",
      "aggregate_version",
      "actor_type",
      "actor_contact_id",
      "actor_membership_id",
      "from_assignee_id",
      "to_assignee_id",
      "conversation_disposition",
      "reason_code",
      "correlation_id",
      "occurred_at",
    ]);
    expect(namesByTable["notifications"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "notification_type",
      "audience_type",
      "recipient_membership_id",
      "recipient_contact_id",
      "queue_key",
      "related_resource_type",
      "related_resource_id",
      "originating_outbox_event_id",
      "template_key",
      "template_version",
      "payload_ciphertext",
      "status",
      "dedupe_key",
      "available_at",
      "attempt_count",
      "next_attempt_at",
      "delivered_at",
      "read_at",
      "claimed_by_membership_id",
      "last_error_category",
      "created_at",
      "updated_at",
      "version",
    ]);
    expect(namesByTable["notification_attempts"]?.map(({ column_name }) => column_name)).toEqual([
      "id",
      "organization_id",
      "notification_id",
      "adapter",
      "attempt_no",
      "provider_request_key",
      "started_at",
      "finished_at",
      "outcome",
      "provider_status_code",
      "error_category",
      "provider_message_id_hash",
      "latency_ms",
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
    expect(
      namesByTable["contacts"]
        ?.filter(({ column_name }) => column_name === "display_name_ciphertext")
        .every(({ data_type }) => data_type === "bytea"),
    ).toBe(true);
    expect(
      namesByTable["contact_identities"]
        ?.filter(({ column_name }) => ["value_ciphertext", "lookup_hash"].includes(column_name))
        .every(({ data_type }) => data_type === "bytea"),
    ).toBe(true);
    expect(utcTimestamps).toHaveLength(47);
    expect(utcTimestamps.every(({ data_type }) => data_type === "timestamp with time zone")).toBe(
      true,
    );
    expect(columns.rows.some(({ column_name }) => column_name.includes("issuer"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("subject"))).toBe(false);
    expect(columns.rows.some(({ column_name }) => column_name.includes("password"))).toBe(false);
    expect(
      columns.rows
        .filter(
          ({ column_name }) =>
            column_name.includes("secret") ||
            (column_name.includes("token") && !column_name.endsWith("_at")),
        )
        .map(({ column_name, table_name }) => `${table_name}.${column_name}`)
        .sort(),
    ).toEqual([
      "appointment_requests.confirmation_token_hash",
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
    expect(
      namesByTable["notifications"]
        ?.filter(({ column_name }) => column_name === "payload_ciphertext")
        .every(({ data_type }) => data_type === "bytea"),
    ).toBe(true);
    expect(
      namesByTable["notification_attempts"]?.some(({ column_name }) =>
        ["provider_response", "provider_response_body", "provider_secret"].includes(column_name),
      ),
    ).toBe(false);
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

    expect(declaredNames).toEqual(S4C3_TABLES);
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
        "analytics_events_organization_id_id_unique",
        "analytics_events_source_projection_unique",
        "analytics_events_organization_id_organizations_id_fk",
        "analytics_events_lead_fk",
        "analytics_events_conversation_fk",
        "analytics_events_appointment_request_fk",
        "analytics_events_service_fk",
        "analytics_events_location_fk",
        "audit_events_organization_id_id_unique",
        "audit_events_organization_id_organizations_id_fk",
        "audit_events_actor_membership_fk",
        "legal_holds_organization_id_id_unique",
        "legal_holds_organization_id_organizations_id_fk",
        "legal_holds_placed_by_user_id_users_id_fk",
        "legal_holds_released_by_user_id_users_id_fk",
        "platform_audit_events_target_organization_fk",
        "privacy_requests_organization_id_id_unique",
        "privacy_requests_organization_id_organizations_id_fk",
        "privacy_requests_contact_fk",
        "privacy_requests_handler_membership_fk",
        "webhook_receipts_organization_id_id_unique",
        "webhook_receipts_connection_external_event_unique",
        "webhook_receipts_organization_id_organizations_id_fk",
        "webhook_receipts_channel_connection_fk",
        "webhook_receipts_processed_message_fk",
        "idempotency_keys_organization_id_id_unique",
        "idempotency_keys_tenant_principal_scope_key_unique",
        "idempotency_keys_organization_id_organizations_id_fk",
        "outbox_events_organization_id_id_unique",
        "outbox_events_aggregate_version_event_unique",
        "outbox_events_organization_id_organizations_id_fk",
        "notifications_originating_outbox_event_fk",
        "ai_action_evaluations_organization_id_id_unique",
        "ai_action_evaluations_organization_ai_run_unique",
        "ai_action_evaluations_organization_id_organizations_id_fk",
        "ai_action_evaluations_ai_run_fk",
        "ai_runs_organization_id_id_unique",
        "ai_runs_trigger_attempt_provider_unique",
        "ai_runs_organization_id_organizations_id_fk",
        "ai_runs_conversation_fk",
        "ai_runs_trigger_message_fk",
        "ai_runs_snapshot_capture_policy_fk",
        "messages_ai_run_fk",
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
        "widget_sessions_contact_fk",
        "contacts_organization_id_id_unique",
        "contacts_organization_id_organizations_id_fk",
        "contact_identities_organization_id_id_unique",
        "contact_identities_contact_id_id_unique",
        "contact_identities_contact_fk",
        "contact_identities_channel_connection_fk",
        "consent_records_organization_id_id_unique",
        "consent_records_contact_fk",
        "consent_records_contact_identity_fk",
        "consent_records_contact_identity_subject_fk",
        "consent_records_channel_connection_fk",
        "consent_records_superseded_record_fk",
        "leads_organization_id_id_unique",
        "leads_contact_fk",
        "leads_source_channel_connection_fk",
        "leads_service_fk",
        "leads_location_fk",
        "leads_assigned_membership_fk",
        "leads_qualification_policy_fk",
        "lead_qualification_evaluations_lead_fk",
        "lead_qualification_evaluations_policy_fk",
        "lead_qualification_evaluations_member_fk",
        "lead_qualification_evidence_pk",
        "lead_qualification_evidence_evaluation_fk",
        "lead_qualification_evidence_message_fk",
        "consent_records_conversation_fk",
        "consent_records_source_message_fk",
        "widget_sessions_conversation_fk",
        "conversations_organization_id_id_unique",
        "conversations_organization_lead_id_unique",
        "conversations_lead_contact_fk",
        "conversations_channel_connection_fk",
        "conversations_active_handoff_fk",
        "messages_organization_conversation_sequence_unique",
        "messages_conversation_channel_fk",
        "messages_reply_to_message_fk",
        "appointment_requests_organization_id_id_unique",
        "appointment_requests_conversation_context_fk",
        "appointment_requests_source_message_fk",
        "appointment_requests_service_version_fk",
        "appointment_requests_location_version_fk",
        "appointment_request_preferences_request_fk",
        "appointment_request_transitions_request_fk",
        "appointment_confirmation_evidence_request_fk",
        "appointment_request_attendance_request_fk",
        "appointment_request_attendance_superseded_fk",
        "appointment_revenue_attributions_request_fk",
        "appointment_revenue_attributions_reversed_entry_fk",
        "handoffs_organization_id_id_unique",
        "handoffs_organization_conversation_id_unique",
        "handoffs_conversation_fk",
        "handoffs_conversation_lead_fk",
        "handoffs_lead_fk",
        "handoffs_location_fk",
        "handoffs_assigned_membership_fk",
        "handoff_transitions_handoff_version_unique",
        "handoff_transitions_handoff_fk",
        "handoff_transitions_actor_contact_fk",
        "handoff_transitions_actor_membership_fk",
        "notifications_organization_dedupe_key_unique",
        "notifications_recipient_membership_fk",
        "notifications_recipient_contact_fk",
        "notifications_claimer_membership_fk",
        "notification_attempts_notification_adapter_attempt_unique",
        "notification_attempts_provider_request_key_unique",
        "notification_attempts_notification_fk",
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
    expect(indexDefinitions.get("analytics_events_organization_occurred_event_idx")).toContain(
      "(organization_id, occurred_at, event_type)",
    );
    expect(indexDefinitions.get("analytics_events_organization_lead_occurred_idx")).toContain(
      "(organization_id, lead_id, occurred_at)",
    );
    expect(
      indexDefinitions.get("analytics_events_organization_appointment_occurred_idx"),
    ).toContain("(organization_id, appointment_request_id, occurred_at)");
    expect(indexDefinitions.get("audit_events_organization_occurred_idx")).toContain(
      "(organization_id, occurred_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("audit_events_organization_target_occurred_idx")).toContain(
      "(organization_id, target_type, target_id, occurred_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("audit_events_organization_actor_occurred_idx")).toContain(
      "(organization_id, actor_type, actor_id, occurred_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("legal_holds_equivalent_active_unique")).toContain("UNIQUE");
    expect(indexDefinitions.get("legal_holds_equivalent_active_unique")).toContain(
      "WHERE ((status)::text = 'active'::text)",
    );
    expect(indexDefinitions.get("legal_holds_organization_status_scope_idx")).toContain(
      "(organization_id, status, scope_type, scope_id)",
    );
    expect(indexDefinitions.get("legal_holds_organization_data_class_status_idx")).toContain(
      "(organization_id, data_class, status)",
    );
    expect(indexDefinitions.get("platform_audit_events_operator_occurred_idx")).toContain(
      "(operator_principal_id, occurred_at DESC NULLS LAST)",
    );
    expect(
      indexDefinitions.get("platform_audit_events_target_organization_occurred_idx"),
    ).toContain("(target_organization_id, occurred_at DESC NULLS LAST)");
    expect(indexDefinitions.get("privacy_requests_organization_status_due_idx")).toContain(
      "(organization_id, status, due_at)",
    );
    expect(indexDefinitions.get("privacy_requests_organization_contact_requested_idx")).toContain(
      "(organization_id, contact_id, requested_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("webhook_receipts_connection_external_message_unique")).toContain(
      "UNIQUE",
    );
    expect(indexDefinitions.get("webhook_receipts_connection_external_message_unique")).toContain(
      "WHERE (external_message_id IS NOT NULL)",
    );
    expect(indexDefinitions.get("webhook_receipts_organization_status_next_attempt_idx")).toContain(
      "(organization_id, status, next_attempt_at)",
    );
    expect(
      indexDefinitions.get("webhook_receipts_organization_connection_provider_sent_idx"),
    ).toContain("(organization_id, channel_connection_id, provider_sent_at)");
    expect(indexDefinitions.get("idempotency_keys_organization_expires_idx")).toContain(
      "(organization_id, expires_at)",
    );
    expect(indexDefinitions.get("idempotency_keys_organization_status_locked_idx")).toContain(
      "(organization_id, status, locked_until)",
    );
    expect(indexDefinitions.get("outbox_events_pending_available_idx")).toContain(
      "(status, available_at, id)",
    );
    expect(indexDefinitions.get("outbox_events_pending_available_idx")).toContain(
      "WHERE ((status)::text = 'pending'::text)",
    );
    expect(indexDefinitions.get("outbox_events_organization_occurred_idx")).toContain(
      "(organization_id, occurred_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("outbox_events_locked_until_idx")).toContain("(locked_until)");
    expect(indexDefinitions.get("ai_runs_organization_conversation_started_idx")).toContain(
      "(organization_id, conversation_id, started_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("ai_runs_organization_status_started_idx")).toContain(
      "(organization_id, status, started_at)",
    );
    expect(indexDefinitions.get("ai_runs_organization_model_started_idx")).toContain(
      "(organization_id, requested_model_id, started_at)",
    );
    expect(
      indexDefinitions.get("ai_action_evaluations_org_action_validation_started_idx"),
    ).toContain("(organization_id, action_name, validation_status, started_at)");
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
    expect(indexDefinitions.get("contacts_organization_status_last_seen_idx")).toContain(
      "(organization_id, status, last_seen_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("contact_identities_active_lookup_unique")).toContain("UNIQUE");
    expect(indexDefinitions.get("contact_identities_active_lookup_unique")).toContain(
      "WHERE ((status)::text = 'active'::text)",
    );
    expect(indexDefinitions.get("consent_records_source_event_dedupe_unique")).toContain("UNIQUE");
    expect(indexDefinitions.get("leads_organization_status_updated_idx")).toContain(
      "(organization_id, status, updated_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("lead_qualification_evaluations_lead_occurred_idx")).toContain(
      "(organization_id, lead_id, occurred_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("lead_qualification_evidence_message_evaluation_idx")).toContain(
      "(organization_id, message_id, evaluation_id)",
    );
    expect(indexDefinitions.has("leads_one_active_per_contact_unique")).toBe(false);
    expect(indexDefinitions.get("conversations_organization_status_activity_idx")).toContain(
      "(organization_id, status, last_activity_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("messages_external_message_dedupe_unique")).toContain(
      "(organization_id, channel_connection_id, external_message_id)",
    );
    expect(indexDefinitions.get("messages_external_message_dedupe_unique")).toContain("UNIQUE");
    expect(indexDefinitions.get("appointment_requests_organization_status_created_idx")).toContain(
      "(organization_id, status, created_at)",
    );
    expect(indexDefinitions.get("appointment_requests_organization_offer_expiry_idx")).toContain(
      "(organization_id, offer_expires_at)",
    );
    expect(indexDefinitions.get("appointment_request_transitions_request_occurred_idx")).toContain(
      "(organization_id, appointment_request_id, occurred_at)",
    );
    expect(indexDefinitions.get("appointment_confirmation_evidence_offer_unique")).toContain(
      "UNIQUE",
    );
    expect(indexDefinitions.get("appointment_confirmation_evidence_offer_unique")).toContain(
      "WHERE",
    );
    expect(indexDefinitions.get("appointment_request_attendance_one_current_unique")).toContain(
      "UNIQUE",
    );
    expect(indexDefinitions.get("appointment_revenue_attributions_one_reversal_unique")).toContain(
      "UNIQUE",
    );
    expect(indexDefinitions.get("handoffs_one_active_per_conversation_unique")).toContain("UNIQUE");
    expect(indexDefinitions.get("handoffs_one_active_per_conversation_unique")).toContain("WHERE");
    expect(indexDefinitions.get("handoffs_organization_status_sla_due_idx")).toContain(
      "(organization_id, status, sla_due_at)",
    );
    expect(indexDefinitions.get("handoffs_organization_queue_status_requested_idx")).toContain(
      "(organization_id, queue_key, status, requested_at)",
    );
    expect(indexDefinitions.get("handoffs_organization_assignee_status_idx")).toContain(
      "(organization_id, assigned_membership_id, status)",
    );
    expect(indexDefinitions.get("handoffs_organization_lead_requested_idx")).toContain(
      "(organization_id, lead_id, requested_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("handoff_transitions_handoff_occurred_idx")).toContain(
      "(organization_id, handoff_id, occurred_at)",
    );
    expect(indexDefinitions.get("notifications_organization_status_available_idx")).toContain(
      "(organization_id, status, available_at)",
    );
    expect(indexDefinitions.get("notifications_organization_queue_status_created_idx")).toContain(
      "(organization_id, queue_key, status, created_at)",
    );
    expect(indexDefinitions.get("notifications_organization_resource_created_idx")).toContain(
      "(organization_id, related_resource_type, related_resource_id, created_at DESC NULLS LAST)",
    );
    expect(indexDefinitions.get("notification_attempts_notification_attempt_idx")).toContain(
      "(organization_id, notification_id, attempt_no)",
    );
    expect(indexDefinitions.get("notification_attempts_outcome_finished_idx")).toContain(
      "(organization_id, outcome, finished_at)",
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

    const targetOwnershipTrigger = await database().query<{ trigger_name: string }>(
      `select distinct trigger_name
         from information_schema.triggers
        where event_object_schema = 'public'
          and event_object_table = 'ai_action_evaluations'
          and trigger_name = 'ai_action_evaluations_target_tenant_trigger'`,
    );
    expect(targetOwnershipTrigger.rows).toEqual([
      { trigger_name: "ai_action_evaluations_target_tenant_trigger" },
    ]);

    const outboxImmutabilityTrigger = await database().query<{ trigger_name: string }>(
      `select distinct trigger_name
         from information_schema.triggers
        where event_object_schema = 'public'
          and event_object_table = 'outbox_events'
          and trigger_name = 'outbox_events_semantic_immutability_trigger'`,
    );
    expect(outboxImmutabilityTrigger.rows).toEqual([
      { trigger_name: "outbox_events_semantic_immutability_trigger" },
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

    await insertContact(FUTURE_CONTACT_A, ORGANIZATION_A);
    await insertLead(LEAD_A, ORGANIZATION_A, FUTURE_CONTACT_A, CHANNEL_CONNECTION_A);
    await insertConversation(
      FUTURE_CONVERSATION_A,
      ORGANIZATION_A,
      FUTURE_CONTACT_A,
      LEAD_A,
      CHANNEL_CONNECTION_A,
    );
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

  it("keeps RLS deferred and activates only the current reviewed relationship seams", async () => {
    const rls = await database().query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
        order by relname`,
    );
    expect(rls.rows).toEqual(S4C3_TABLES.map((relname) => ({ relname, relrowsecurity: false })));

    const activatedRouteForeignKey = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'inbound_routes'
          and constraint_name = 'inbound_routes_channel_connection_fk'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(activatedRouteForeignKey.rows[0]?.count).toBe(1);

    const notificationOutboxForeignKey = await database().query<{ count: number }>(
      `select count(*)::integer as count
         from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'notifications'
          and constraint_name = 'notifications_originating_outbox_event_fk'
          and constraint_type = 'FOREIGN KEY'`,
    );
    expect(notificationOutboxForeignKey.rows[0]?.count).toBe(1);

    const widgetContactAndConversationForeignKeys = await database().query<{
      column_name: string;
    }>(
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
    expect(widgetContactAndConversationForeignKeys.rows).toEqual([
      { column_name: "contact_id" },
      { column_name: "conversation_id" },
    ]);

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

  it("protects contact PII and enforces identity lifecycle, uniqueness, and tenant ownership", async () => {
    await insertOrganization(ORGANIZATION_A, "contacts-a");
    await insertOrganization(ORGANIZATION_B, "contacts-b");
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);
    await insertContactIdentity(
      CONTACT_IDENTITY_A,
      ORGANIZATION_A,
      CONTACT_A,
      "email",
      "same-synthetic-lookup-hash",
    );
    await expect(
      insertContactIdentity(
        CONTACT_IDENTITY_B,
        ORGANIZATION_B,
        CONTACT_B,
        "email",
        "same-synthetic-lookup-hash",
      ),
    ).resolves.toBeUndefined();

    const protectedValues = await database().query<{
      display_name_ciphertext: Buffer;
      lookup_hash: Buffer;
      value_ciphertext: Buffer;
    }>(
      `select c.display_name_ciphertext, i.value_ciphertext, i.lookup_hash
         from contacts c
         join contact_identities i
           on i.organization_id = c.organization_id and i.contact_id = c.id
        where c.organization_id = $1 and c.id = $2`,
      [ORGANIZATION_A, CONTACT_A],
    );
    expect(protectedValues.rows[0]).toMatchObject({
      display_name_ciphertext: Buffer.from("synthetic-display-name-ciphertext"),
      lookup_hash: Buffer.from("same-synthetic-lookup-hash"),
      value_ciphertext: Buffer.from("synthetic-identity-ciphertext"),
    });

    await expect(
      insertContactIdentity(
        TEST_ID_1,
        ORGANIZATION_A,
        CONTACT_A,
        "email",
        "same-synthetic-lookup-hash",
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "contact_identities_active_lookup_unique",
    });
    await expect(
      insertContactIdentity(
        TEST_ID_1,
        ORGANIZATION_A,
        CONTACT_B,
        "phone",
        "different-synthetic-lookup-hash",
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "contact_identities_contact_fk" });
    await expect(
      database().query(
        `insert into contact_identities
          (id, organization_id, contact_id, identity_type, lookup_hash,
           validation_status, status)
         values ($1, $2, $3, 'social_handle', $4, 'valid', 'active')`,
        [TEST_ID_1, ORGANIZATION_A, CONTACT_A, Buffer.from("valid-length-lookup-hash")],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "contact_identities_identity_type_check",
    });
    await expect(
      database().query(
        `insert into contact_identities
          (id, organization_id, contact_id, identity_type, lookup_hash,
           validation_status, status)
         values ($1, $2, $3, 'phone', $4, 'valid', 'active')`,
        [TEST_ID_1, ORGANIZATION_A, CONTACT_A, Buffer.from("short")],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "contact_identities_lookup_hash_check",
    });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, preferred_locale, status, first_seen_at, last_seen_at)
         values ($1, $2, 'de', 'active', now(), now())`,
        [TEST_ID_1, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_preferred_locale_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, display_name_ciphertext, status,
           first_seen_at, last_seen_at, anonymized_at)
         values ($1, $2, $3, 'anonymized', now(), now(), now())`,
        [TEST_ID_1, ORGANIZATION_A, Buffer.from("must-not-survive-anonymization")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_anonymized_shape_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, status, first_seen_at, last_seen_at)
         values ($1, $2, 'active', now(), now() - interval '1 minute')`,
        [TEST_ID_1, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_seen_at_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, status, first_seen_at, last_seen_at)
         values ($1, $2, 'active', now(), now())`,
        [UUID_V4, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_id_uuid_v7_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, status, first_seen_at, last_seen_at)
         values ($1, $2, 'deleted', now(), now())`,
        [TEST_ID_1, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_status_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, display_name_ciphertext, status,
           first_seen_at, last_seen_at)
         values ($1, $2, $3, 'active', now(), now())`,
        [TEST_ID_1, ORGANIZATION_A, Buffer.alloc(0)],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "contacts_display_name_ciphertext_check",
    });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, status, first_seen_at, last_seen_at, version)
         values ($1, $2, 'active', now(), now(), 0)`,
        [TEST_ID_1, ORGANIZATION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "contacts_version_check" });
    await expect(
      database().query(
        `insert into contacts
          (id, organization_id, status, first_seen_at, last_seen_at)
         values ($1, $2, 'active', now(), now())`,
        [TEST_ID_1, UNKNOWN_ORGANIZATION],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "contacts_organization_id_organizations_id_fk",
    });

    await expect(
      database().query(
        `update contact_identities
            set status = 'anonymized', value_ciphertext = null,
                lookup_hash = null, display_redacted = null
          where id = $1`,
        [CONTACT_IDENTITY_A],
      ),
    ).resolves.toBeDefined();
    await expect(
      database().query("delete from contacts where id = $1", [CONTACT_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "contact_identities_contact_fk" });
  });

  it("activates the nullable same-tenant widget-session contact relationship", async () => {
    await insertOrganization(ORGANIZATION_A, "widget-contact-a");
    await insertOrganization(ORGANIZATION_B, "widget-contact-b");
    await insertUser(USER_A);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Widget A");
    await insertWidgetOrigin(WIDGET_ORIGIN_A, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A);
    await insertWidgetSession(
      WIDGET_SESSION_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      WIDGET_ORIGIN_A,
      "widget-contact-session-hash",
      "widget-contact-participant-hash",
    );
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);

    await expect(
      database().query("update widget_sessions set contact_id = $2 where id = $1", [
        WIDGET_SESSION_A,
        CONTACT_A,
      ]),
    ).resolves.toBeDefined();
    await expect(
      database().query("update widget_sessions set contact_id = $2 where id = $1", [
        WIDGET_SESSION_A,
        CONTACT_B,
      ]),
    ).rejects.toMatchObject({ code: "23503", constraint: "widget_sessions_contact_fk" });
    await expect(
      database().query("update widget_sessions set contact_id = null where id = $1", [
        WIDGET_SESSION_A,
      ]),
    ).resolves.toBeDefined();
  });

  it("stores append-only consent evidence with withdrawal history and tenant-safe subjects", async () => {
    await insertOrganization(ORGANIZATION_A, "consent-a");
    await insertOrganization(ORGANIZATION_B, "consent-b");
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);
    await insertContact(TEST_ID_1, ORGANIZATION_A);
    await insertContactIdentity(
      CONTACT_IDENTITY_A,
      ORGANIZATION_A,
      CONTACT_A,
      "phone",
      "consent-subject-lookup-hash-a",
    );
    await insertContactIdentity(
      CONTACT_IDENTITY_B,
      ORGANIZATION_B,
      CONTACT_B,
      "phone",
      "consent-subject-lookup-hash-b",
    );

    const insertConsent = (
      id: string,
      status: string,
      supersedesConsentId: string | null,
      withdrawnAt: string | null,
    ) =>
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, contact_identity_id, purpose, status,
           notice_key, notice_version, locale, capture_channel, captured_by_type,
           captured_at, withdrawn_at, supersedes_consent_id, evidence_hash,
           evidence_ciphertext)
         values ($1, $2, $3, $4, 'booking_follow_up', $5, 'privacy.booking', 1,
           'en', 'staff', 'system', timestamptz '2026-01-01 00:00:00+00',
           $6::timestamptz, $7, $8, $9)`,
        [
          id,
          ORGANIZATION_A,
          CONTACT_A,
          CONTACT_IDENTITY_A,
          status,
          withdrawnAt,
          supersedesConsentId,
          Buffer.from(`synthetic-evidence-hash-${id}`),
          Buffer.from("synthetic-consent-evidence-ciphertext"),
        ],
      );

    await insertConsent(CONSENT_A, "granted", null, null);
    await insertConsent(CONSENT_B, "withdrawn", CONSENT_A, "2026-01-02T00:00:00Z");
    const history = await database().query<{ id: string; status: string }>(
      "select id, status from consent_records order by captured_at, created_at, id",
    );
    expect(history.rows).toEqual([
      { id: CONSENT_A, status: "granted" },
      { id: CONSENT_B, status: "withdrawn" },
    ]);

    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, purpose, status, notice_key, notice_version,
           locale, capture_channel, captured_by_type, captured_at, evidence_hash)
         values ($1, $2, 'marketing', 'declined', 'privacy.marketing', 1,
           'en', 'staff', 'system', now(), $3)`,
        [TEST_ID_2, ORGANIZATION_A, Buffer.from("synthetic-evidence-hash")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "consent_records_subject_anchor_check" });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, purpose, status, notice_key, notice_version,
           locale, capture_channel, captured_by_type, captured_at, evidence_hash)
         values ($1, $2, $3, 'profiling', 'granted', 'privacy.profiling', 1,
           'en', 'staff', 'system', now(), $4)`,
        [TEST_ID_2, ORGANIZATION_A, CONTACT_A, Buffer.from("synthetic-evidence-hash")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "consent_records_purpose_check" });
    await expect(insertConsent(TEST_ID_2, "expired", null, null)).rejects.toMatchObject({
      code: "23514",
      constraint: "consent_records_status_check",
    });
    await expect(
      insertConsent(TEST_ID_2, "withdrawn", CONSENT_A, "2025-12-31T00:00:00Z"),
    ).rejects.toMatchObject({ code: "23514", constraint: "consent_records_withdrawal_check" });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, purpose, status, notice_key, notice_version,
           locale, capture_channel, captured_by_type, captured_at, evidence_hash)
         values ($1, $2, $3, 'marketing', 'granted', 'privacy.marketing', 1,
           'en', 'staff', 'system', now(), $4)`,
        [TEST_ID_2, ORGANIZATION_A, CONTACT_A, Buffer.from("short")],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "consent_records_evidence_hash_check" });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, purpose, status, notice_key, notice_version,
           locale, capture_channel, captured_by_type, captured_at, evidence_hash)
         values ($1, $2, $3, 'marketing', 'granted', 'privacy.marketing', 1,
           'en', 'browser', 'system', now(), $4)`,
        [TEST_ID_2, ORGANIZATION_A, CONTACT_A, Buffer.from("synthetic-evidence-hash")],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "consent_records_capture_channel_check",
    });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, purpose, status, notice_key, notice_version,
           locale, capture_channel, captured_by_type, captured_at, evidence_hash)
         values ($1, $2, $3, 'marketing', 'granted', 'privacy.marketing', 1,
           'en', 'staff', 'system', now(), $4)`,
        [TEST_ID_2, ORGANIZATION_A, CONTACT_B, Buffer.from("synthetic-evidence-hash")],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "consent_records_contact_fk" });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, contact_identity_id, purpose, status,
           notice_key, notice_version, locale, capture_channel, captured_by_type,
           captured_at, evidence_hash)
         values ($1, $2, $3, $4, 'marketing', 'granted', 'privacy.marketing', 1,
           'en', 'staff', 'system', now(), $5)`,
        [
          TEST_ID_2,
          ORGANIZATION_A,
          TEST_ID_1,
          CONTACT_IDENTITY_A,
          Buffer.from("synthetic-evidence-hash"),
        ],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "consent_records_contact_identity_subject_fk",
    });
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, contact_identity_id, purpose, status,
           notice_key, notice_version, locale, capture_channel, captured_by_type,
           captured_at, evidence_hash)
         values ($1, $2, $3, $4, 'marketing', 'granted', 'privacy.marketing', 1,
           'en', 'staff', 'system', now(), $5)`,
        [
          TEST_ID_2,
          ORGANIZATION_A,
          CONTACT_A,
          CONTACT_IDENTITY_B,
          Buffer.from("synthetic-evidence-hash"),
        ],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database().query("delete from contacts where id = $1", [CONTACT_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "consent_records_contact_fk" });
  });

  it("persists the exact Lead lifecycle without inventing active-lead uniqueness", async () => {
    await insertOrganization(ORGANIZATION_A, "leads-a");
    await insertOrganization(ORGANIZATION_B, "leads-b");
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Lead Widget A");
    await insertChannelConnection(CHANNEL_CONNECTION_B, ORGANIZATION_B, "widget", "Lead Widget B");

    const states = [
      [LEAD_A, "new"],
      [LEAD_B, "engaged"],
      [TEST_ID_1, "qualified"],
      [TEST_ID_2, "booking_requested"],
      [TEST_ID_3, "converted"],
      [SERVICE_A, "disqualified"],
      [SERVICE_B, "closed"],
    ] as const;
    for (const [id, status] of states) {
      await insertLead(id, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A, status);
    }
    await expect(
      insertLead(SERVICE_VERSION_A, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A, "new"),
    ).resolves.toBeUndefined();
    expect(
      (
        await database().query<{ status: string }>(
          "select distinct status from leads order by status",
        )
      ).rows.map(({ status }) => status),
    ).toEqual([
      "booking_requested",
      "closed",
      "converted",
      "disqualified",
      "engaged",
      "new",
      "qualified",
    ]);

    await expect(
      insertLead(SERVICE_VERSION_B, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A, "archived"),
    ).rejects.toMatchObject({ code: "23514", constraint: "leads_status_check" });
    await expect(
      insertLead(SERVICE_VERSION_B, ORGANIZATION_A, CONTACT_B, CHANNEL_CONNECTION_A),
    ).rejects.toMatchObject({ code: "23503", constraint: "leads_contact_fk" });
    await expect(
      insertLead(SERVICE_VERSION_B, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_B),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "leads_source_channel_connection_fk",
    });
    await expect(
      database().query(
        `insert into leads
          (id, organization_id, contact_id, status, source_channel_connection_id,
           qualification_reason_codes)
         values ($1, $2, $3, 'new', $4, array['Bad-Code'])`,
        [SERVICE_VERSION_B, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "leads_qualification_reason_codes_check",
    });
    await expect(
      database().query(
        `insert into leads
          (id, organization_id, contact_id, status, source_channel_connection_id, version)
         values ($1, $2, $3, 'new', $4, 0)`,
        [SERVICE_VERSION_B, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "leads_version_check" });
  });

  it("keeps qualification evaluations immutable-shaped and evidence tenant-safe", async () => {
    await insertOrganization(ORGANIZATION_A, "qualification-a");
    await insertOrganization(ORGANIZATION_B, "qualification-b");
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);
    await insertChannelConnection(CHANNEL_CONNECTION_A, ORGANIZATION_A, "widget", "Qualify A");
    await insertChannelConnection(CHANNEL_CONNECTION_B, ORGANIZATION_B, "widget", "Qualify B");
    await insertBusinessPolicy(POLICY_A, ORGANIZATION_A, "lead-qualification");
    await insertBusinessPolicy(TEST_ID_3, ORGANIZATION_B, "lead-qualification");
    await insertLead(LEAD_A, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A);
    await insertLead(LEAD_B, ORGANIZATION_B, CONTACT_B, CHANNEL_CONNECTION_B);
    await insertConversation(
      CONVERSATION_A,
      ORGANIZATION_A,
      CONTACT_A,
      LEAD_A,
      CHANNEL_CONNECTION_A,
    );
    await insertConversation(
      CONVERSATION_B,
      ORGANIZATION_B,
      CONTACT_B,
      LEAD_B,
      CHANNEL_CONNECTION_B,
    );
    await insertInboundMessage(
      MESSAGE_A,
      ORGANIZATION_A,
      CONVERSATION_A,
      CHANNEL_CONNECTION_A,
      CONTACT_A,
      1,
    );
    await insertInboundMessage(
      MESSAGE_B,
      ORGANIZATION_B,
      CONVERSATION_B,
      CHANNEL_CONNECTION_B,
      CONTACT_B,
      1,
    );
    await insertLeadQualificationEvaluation(EVALUATION_A, ORGANIZATION_A, LEAD_A, POLICY_A);
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'customer_statement')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_A],
      ),
    ).resolves.toBeDefined();

    await expect(
      insertLeadQualificationEvaluation(EVALUATION_B, ORGANIZATION_A, LEAD_B, POLICY_A),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "lead_qualification_evaluations_lead_fk",
    });
    await expect(
      insertLeadQualificationEvaluation(EVALUATION_B, ORGANIZATION_A, LEAD_A, TEST_ID_3),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "lead_qualification_evaluations_policy_fk",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evaluations
          (id, organization_id, lead_id, business_policy_id, result,
           reason_codes, facts_jsonb, evaluated_by, occurred_at)
         values ($1, $2, $3, $4, 'unknown', array[]::varchar[],
           '{}'::jsonb, 'system', now())`,
        [EVALUATION_B, ORGANIZATION_A, LEAD_A, POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evaluations_result_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evaluations
          (id, organization_id, lead_id, business_policy_id, result,
           reason_codes, facts_jsonb, evaluated_by, occurred_at)
         values ($1, $2, $3, $4, 'qualified', array[]::varchar[],
           '{}'::jsonb, 'member', now())`,
        [EVALUATION_B, ORGANIZATION_A, LEAD_A, POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evaluations_evaluator_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evaluations
          (id, organization_id, lead_id, business_policy_id, result,
           reason_codes, facts_jsonb, evaluated_by, occurred_at)
         values ($1, $2, $3, $4, 'qualified', array[]::varchar[],
           '[]'::jsonb, 'system', now())`,
        [EVALUATION_B, ORGANIZATION_A, LEAD_A, POLICY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evaluations_facts_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'customer_statement')`,
        [ORGANIZATION_B, EVALUATION_A, MESSAGE_B],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "lead_qualification_evidence_evaluation_fk",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'Unsafe Field', 'customer_statement')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_B],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evidence_field_key_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'model_guess')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_B],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evidence_kind_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'derived')`,
        [ORGANIZATION_A, EVALUATION_A, UUID_V4],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "lead_qualification_evidence_message_uuid_v7_check",
    });
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'customer_statement')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_A],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "lead_qualification_evidence_pk" });
    await expect(
      database().query("delete from lead_qualification_evaluations where id = $1", [EVALUATION_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "lead_qualification_evidence_evaluation_fk",
    });
  });

  it("persists only the canonical Conversation status, mode, and active-Handoff shapes", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "conversation-a", "conversation-a", "conversation-a");
    await seedWorkflowTenant(WORKFLOW_B, "conversation-b", "conversation-b", "conversation-b");

    const validShapes = [
      ["open", "ai", null, null],
      ["awaiting_lead", "ai", null, null],
      ["awaiting_lead", "staff", syntheticUuid(0x610), "assigned"],
      ["awaiting_staff", "paused", syntheticUuid(0x611), "requested"],
      ["awaiting_staff", "staff", syntheticUuid(0x612), "assigned"],
      ["resolved", "paused", null, null],
      ["closed", "paused", null, null],
    ] as const;

    for (const [index, [status, mode, activeHandoffId, handoffStatus]] of validShapes.entries()) {
      const conversationId = syntheticUuid(0x500 + index);
      if (activeHandoffId === null || handoffStatus === null) {
        await expect(
          insertConversation(
            conversationId,
            ORGANIZATION_A,
            CONTACT_A,
            LEAD_A,
            CHANNEL_CONNECTION_A,
            status,
            mode,
          ),
        ).resolves.toBeUndefined();
        continue;
      }

      await insertConversation(
        conversationId,
        ORGANIZATION_A,
        CONTACT_A,
        LEAD_A,
        CHANNEL_CONNECTION_A,
      );
      await insertHandoff(activeHandoffId, { ...WORKFLOW_A, conversationId }, handoffStatus);
      await expect(
        database().query(
          `update conversations
              set status = $2, automation_mode = $3, active_handoff_id = $4
            where id = $1`,
          [conversationId, status, mode, activeHandoffId],
        ),
      ).resolves.toBeDefined();
    }

    await expect(
      insertConversation(
        syntheticUuid(0x510),
        ORGANIZATION_A,
        CONTACT_A,
        LEAD_A,
        CHANNEL_CONNECTION_A,
        "open",
        "staff",
        ACTIVE_HANDOFF_A,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "conversations_state_ownership_shape_check",
    });
    await expect(
      insertConversation(
        syntheticUuid(0x511),
        ORGANIZATION_A,
        CONTACT_A,
        LEAD_A,
        CHANNEL_CONNECTION_A,
        "awaiting_staff",
        "paused",
        UUID_V4,
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "conversations_active_handoff_uuid_v7_check",
    });
    await expect(
      insertConversation(
        syntheticUuid(0x512),
        ORGANIZATION_A,
        CONTACT_B,
        LEAD_A,
        CHANNEL_CONNECTION_A,
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "conversations_contact_fk" });
    await expect(
      insertConversation(
        syntheticUuid(0x513),
        ORGANIZATION_A,
        CONTACT_A,
        LEAD_B,
        CHANNEL_CONNECTION_A,
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "conversations_lead_fk" });
    await expect(
      insertConversation(
        syntheticUuid(0x514),
        ORGANIZATION_A,
        CONTACT_A,
        LEAD_A,
        CHANNEL_CONNECTION_B,
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "conversations_channel_connection_fk",
    });

    const handoffTables = await database().query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public'
          and table_name in ('handoffs', 'handoff_transitions')
        order by table_name`,
    );
    expect(handoffTables.rows).toEqual([
      { table_name: "handoff_transitions" },
      { table_name: "handoffs" },
    ]);
  });

  it("enforces Handoff tenant integrity, lifecycle shape, active uniqueness, and exact Conversation identity", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "handoff-a", "handoff-a", "handoff-a");
    await seedWorkflowTenant(WORKFLOW_B, "handoff-b", "handoff-b", "handoff-b");

    await expect(
      insertHandoff(syntheticUuid(0x620), WORKFLOW_A, "requested", {
        conversationId: CONVERSATION_B,
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoffs_conversation_fk" });
    await expect(
      insertHandoff(syntheticUuid(0x621), WORKFLOW_A, "requested", { leadId: LEAD_B }),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoffs_lead_fk" });
    await expect(
      insertHandoff(syntheticUuid(0x622), WORKFLOW_A, "requested", { locationId: LOCATION_B }),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoffs_location_fk" });
    await expect(
      insertHandoff(syntheticUuid(0x623), WORKFLOW_A, "assigned", {
        assignedMembershipId: MEMBERSHIP_B,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "handoffs_assigned_membership_fk",
    });

    const secondLeadId = syntheticUuid(0x624);
    await insertLead(secondLeadId, ORGANIZATION_A, CONTACT_A, CHANNEL_CONNECTION_A, "qualified");
    await expect(
      insertHandoff(syntheticUuid(0x625), WORKFLOW_A, "requested", { leadId: secondLeadId }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "handoffs_conversation_lead_fk",
    });

    await expect(insertHandoff(HANDOFF_A, WORKFLOW_A)).resolves.toBeUndefined();
    await expect(
      database().query(
        `update conversations
            set status = 'awaiting_staff', automation_mode = 'paused', active_handoff_id = $2
          where id = $1`,
        [CONVERSATION_A, HANDOFF_A],
      ),
    ).resolves.toBeDefined();

    await expect(
      database().query(
        `update conversations
            set status = 'awaiting_staff', automation_mode = 'paused', active_handoff_id = $2
          where id = $1`,
        [CONVERSATION_B, HANDOFF_A],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "conversations_active_handoff_fk",
    });

    const secondConversationId = syntheticUuid(0x626);
    await insertConversation(
      secondConversationId,
      ORGANIZATION_A,
      CONTACT_A,
      LEAD_A,
      CHANNEL_CONNECTION_A,
    );
    await expect(
      database().query(
        `update conversations
            set status = 'awaiting_lead', automation_mode = 'staff', active_handoff_id = $2
          where id = $1`,
        [secondConversationId, HANDOFF_A],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "conversations_active_handoff_fk",
    });

    await expect(insertHandoff(syntheticUuid(0x627), WORKFLOW_A)).rejects.toMatchObject({
      code: "23505",
      constraint: "handoffs_one_active_per_conversation_unique",
    });
    await expect(
      database().query("update handoffs set status = 'queued' where id = $1", [HANDOFF_A]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database().query("update handoffs set version = 0 where id = $1", [HANDOFF_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "handoffs_version_check" });
    await expect(
      insertHandoff(UUID_V4, { ...WORKFLOW_A, conversationId: secondConversationId }),
    ).rejects.toMatchObject({ code: "23514", constraint: "handoffs_id_uuid_v7_check" });

    const deletionConversationId = syntheticUuid(0x628);
    await insertConversation(
      deletionConversationId,
      ORGANIZATION_A,
      CONTACT_A,
      LEAD_A,
      CHANNEL_CONNECTION_A,
    );
    await insertHandoff(syntheticUuid(0x629), {
      ...WORKFLOW_A,
      conversationId: deletionConversationId,
    });
    await expect(
      database().query("delete from conversations where id = $1", [deletionConversationId]),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoffs_conversation_fk" });
  });

  it("preserves versioned Handoff creation, claim/start, reassignment, and terminal history", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "handoff-history-a", "history-a", "history-a");
    await seedWorkflowTenant(WORKFLOW_B, "handoff-history-b", "history-b", "history-b");
    await insertHandoff(HANDOFF_A, WORKFLOW_A);

    const secondUserId = syntheticUuid(0x630);
    const secondMembershipId = syntheticUuid(0x631);
    await insertUser(secondUserId);
    await insertActiveMembership(secondMembershipId, ORGANIZATION_A, secondUserId);

    await insertHandoffTransition({
      fromStatus: null,
      handoffId: HANDOFF_A,
      id: syntheticUuid(0x632),
      organizationId: ORGANIZATION_A,
      toStatus: "requested",
      version: 1,
    });
    await insertHandoffTransition({
      actorMembershipId: MEMBERSHIP_A,
      actorType: "member",
      fromStatus: "requested",
      handoffId: HANDOFF_A,
      id: syntheticUuid(0x633),
      organizationId: ORGANIZATION_A,
      toAssigneeId: MEMBERSHIP_A,
      toStatus: "assigned",
      version: 2,
    });
    await insertHandoffTransition({
      actorMembershipId: MEMBERSHIP_A,
      actorType: "member",
      fromAssigneeId: MEMBERSHIP_A,
      fromStatus: "assigned",
      handoffId: HANDOFF_A,
      id: syntheticUuid(0x634),
      organizationId: ORGANIZATION_A,
      toAssigneeId: MEMBERSHIP_A,
      toStatus: "in_progress",
      version: 3,
    });
    await insertHandoffTransition({
      actorMembershipId: MEMBERSHIP_A,
      actorType: "member",
      fromAssigneeId: MEMBERSHIP_A,
      fromStatus: "assigned",
      handoffId: HANDOFF_A,
      id: syntheticUuid(0x635),
      organizationId: ORGANIZATION_A,
      toAssigneeId: secondMembershipId,
      toStatus: "assigned",
      version: 4,
    });
    await insertHandoffTransition({
      actorMembershipId: secondMembershipId,
      actorType: "member",
      conversationDisposition: "successor_handoff",
      fromAssigneeId: secondMembershipId,
      fromStatus: "assigned",
      handoffId: HANDOFF_A,
      id: syntheticUuid(0x636),
      organizationId: ORGANIZATION_A,
      reasonCode: "replacement_required",
      toStatus: "cancelled",
      version: 5,
    });

    const transitions = await database().query<{
      aggregate_version: string;
      conversation_disposition: string | null;
      from_status: string | null;
      to_status: string;
    }>(
      `select aggregate_version, from_status, to_status, conversation_disposition
         from handoff_transitions
        where handoff_id = $1
        order by aggregate_version`,
      [HANDOFF_A],
    );
    expect(transitions.rows).toEqual([
      {
        aggregate_version: "1",
        conversation_disposition: null,
        from_status: null,
        to_status: "requested",
      },
      {
        aggregate_version: "2",
        conversation_disposition: null,
        from_status: "requested",
        to_status: "assigned",
      },
      {
        aggregate_version: "3",
        conversation_disposition: null,
        from_status: "assigned",
        to_status: "in_progress",
      },
      {
        aggregate_version: "4",
        conversation_disposition: null,
        from_status: "assigned",
        to_status: "assigned",
      },
      {
        aggregate_version: "5",
        conversation_disposition: "successor_handoff",
        from_status: "assigned",
        to_status: "cancelled",
      },
    ]);

    await expect(
      insertHandoffTransition({
        fromStatus: "requested",
        handoffId: HANDOFF_A,
        id: syntheticUuid(0x637),
        organizationId: ORGANIZATION_A,
        toStatus: "assigned",
        version: 2,
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "handoff_transitions_handoff_version_unique",
    });
    await expect(
      insertHandoffTransition({
        actorMembershipId: MEMBERSHIP_A,
        actorType: "member",
        fromAssigneeId: MEMBERSHIP_A,
        fromStatus: "assigned",
        handoffId: HANDOFF_A,
        id: syntheticUuid(0x638),
        organizationId: ORGANIZATION_A,
        toAssigneeId: MEMBERSHIP_A,
        toStatus: "assigned",
        version: 6,
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "handoff_transitions_reassignment_check",
    });
    await expect(
      insertHandoffTransition({
        fromStatus: "in_progress",
        handoffId: HANDOFF_A,
        id: syntheticUuid(0x639),
        organizationId: ORGANIZATION_A,
        toStatus: "resolved",
        version: 6,
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "handoff_transitions_disposition_check",
    });
    await expect(
      insertHandoffTransition({
        actorMembershipId: MEMBERSHIP_B,
        actorType: "member",
        fromStatus: "requested",
        handoffId: HANDOFF_A,
        id: syntheticUuid(0x63a),
        organizationId: ORGANIZATION_A,
        toAssigneeId: MEMBERSHIP_B,
        toStatus: "assigned",
        version: 6,
      }),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      insertHandoffTransition({
        fromStatus: null,
        handoffId: HANDOFF_A,
        id: syntheticUuid(0x63b),
        organizationId: ORGANIZATION_B,
        toStatus: "requested",
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoff_transitions_handoff_fk" });
    await expect(
      database().query("delete from handoffs where id = $1", [HANDOFF_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "handoff_transitions_handoff_fk" });
  });

  it("enforces Notification audiences, tenant-scoped destinations, idempotency, and protected content", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "notifications-a", "notifications-a", "notifications-a");
    await seedWorkflowTenant(WORKFLOW_B, "notifications-b", "notifications-b", "notifications-b");
    await insertHandoff(HANDOFF_A, WORKFLOW_A);
    const recipientUserId = syntheticUuid(0x647);
    const recipientMembershipId = syntheticUuid(0x648);
    const recipientContactId = syntheticUuid(0x649);
    await insertUser(recipientUserId);
    await insertActiveMembership(recipientMembershipId, ORGANIZATION_A, recipientUserId);
    await insertContact(recipientContactId, ORGANIZATION_A);

    await expect(
      insertNotification(NOTIFICATION_A, ORGANIZATION_A, {
        recipientMembershipId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertNotification(syntheticUuid(0x640), ORGANIZATION_A, {
        dedupeKey: `notification-${NOTIFICATION_A}`,
        recipientMembershipId,
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "notifications_organization_dedupe_key_unique",
    });
    await expect(
      insertNotification(NOTIFICATION_B, ORGANIZATION_B, {
        dedupeKey: `notification-${NOTIFICATION_A}`,
        originatingOutboxEventId: OUTBOX_EVENT_B,
        recipientMembershipId: MEMBERSHIP_B,
        relatedResourceId: HANDOFF_B,
      }),
    ).resolves.toBeUndefined();

    await expect(
      insertNotification(syntheticUuid(0x641), ORGANIZATION_A, {
        dedupeKey: "cross-tenant-member",
        recipientMembershipId: MEMBERSHIP_B,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_recipient_membership_fk",
    });
    await expect(
      insertNotification(syntheticUuid(0x642), ORGANIZATION_A, {
        audienceType: "contact",
        dedupeKey: "cross-tenant-contact",
        notificationType: "customer_message",
        recipientContactId: CONTACT_B,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_recipient_contact_fk",
    });
    await expect(
      insertNotification(syntheticUuid(0x643), ORGANIZATION_A, {
        claimedByMembershipId: MEMBERSHIP_B,
        dedupeKey: "cross-tenant-claimer",
        recipientMembershipId: MEMBERSHIP_A,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_claimer_membership_fk",
    });
    await expect(
      insertNotification(syntheticUuid(0x644), ORGANIZATION_A, {
        audienceType: "queue",
        dedupeKey: "invalid-queue-audience",
        recipientMembershipId: MEMBERSHIP_A,
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "notifications_audience_shape_check",
    });

    await expect(
      insertNotification(syntheticUuid(0x645), ORGANIZATION_A, {
        audienceType: "contact",
        dedupeKey: "customer-message-contact",
        notificationType: "customer_message",
        recipientContactId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertNotification(syntheticUuid(0x646), ORGANIZATION_A, {
        audienceType: "queue",
        dedupeKey: "front-desk-alert",
        notificationType: "staff_alert",
      }),
    ).resolves.toBeUndefined();

    await expect(
      database().query("update notifications set status = 'sent' where id = $1", [NOTIFICATION_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "notifications_status_check" });
    await expect(
      database().query("update notifications set notification_type = 'marketing' where id = $1", [
        NOTIFICATION_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "notifications_type_check" });
    await expect(
      database().query("delete from memberships where id = $1", [recipientMembershipId]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_recipient_membership_fk",
    });
    await expect(
      database().query("delete from contacts where id = $1", [recipientContactId]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_recipient_contact_fk",
    });

    const content = await database().query<{
      payload_ciphertext: Buffer;
      related_resource_id: string;
      related_resource_type: string;
    }>(
      `select payload_ciphertext, related_resource_type, related_resource_id
         from notifications
        where id = $1`,
      [NOTIFICATION_A],
    );
    expect(content.rows[0]).toMatchObject({
      related_resource_id: HANDOFF_A,
      related_resource_type: "handoff",
    });
    expect(content.rows[0]?.payload_ciphertext).toEqual(
      Buffer.from("synthetic-notification-ciphertext"),
    );
  });

  it("enforces NotificationAttempt ordering, per-adapter identity, tenant scope, and safe telemetry", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "attempts-a", "attempts-a", "attempts-a");
    await seedWorkflowTenant(WORKFLOW_B, "attempts-b", "attempts-b", "attempts-b");
    await insertHandoff(HANDOFF_A, WORKFLOW_A);
    await insertNotification(NOTIFICATION_A, ORGANIZATION_A, {
      recipientMembershipId: MEMBERSHIP_A,
    });
    await insertNotification(NOTIFICATION_B, ORGANIZATION_B, {
      originatingOutboxEventId: OUTBOX_EVENT_B,
      recipientMembershipId: MEMBERSHIP_B,
      relatedResourceId: HANDOFF_B,
    });

    await insertNotificationAttempt(syntheticUuid(0x650), ORGANIZATION_A, NOTIFICATION_A, 1);
    await insertNotificationAttempt(
      syntheticUuid(0x651),
      ORGANIZATION_A,
      NOTIFICATION_A,
      2,
      "in_app",
      "retryable_failure",
    );
    await expect(
      insertNotificationAttempt(syntheticUuid(0x652), ORGANIZATION_A, NOTIFICATION_A, 1, "email"),
    ).resolves.toBeUndefined();

    await expect(
      insertNotificationAttempt(syntheticUuid(0x653), ORGANIZATION_A, NOTIFICATION_A, 1),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "notification_attempts_notification_adapter_attempt_unique",
    });
    await expect(
      insertNotificationAttempt(
        syntheticUuid(0x654),
        ORGANIZATION_A,
        NOTIFICATION_A,
        3,
        "in_app",
        "delivered",
        `provider-request-${syntheticUuid(0x650)}`,
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "notification_attempts_provider_request_key_unique",
    });
    await expect(
      insertNotificationAttempt(syntheticUuid(0x655), ORGANIZATION_A, NOTIFICATION_B, 1),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notification_attempts_notification_fk",
    });
    await expect(
      insertNotificationAttempt(syntheticUuid(0x656), ORGANIZATION_A, NOTIFICATION_A, 0),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "notification_attempts_attempt_no_check",
    });
    await expect(
      database().query(
        `update notification_attempts
            set finished_at = started_at - interval '1 second'
          where id = $1`,
        [syntheticUuid(0x650)],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "notification_attempts_timing_check",
    });
    await expect(
      database().query("update notification_attempts set adapter = 'fax' where id = $1", [
        syntheticUuid(0x650),
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "notification_attempts_adapter_check",
    });
    await expect(
      database().query("delete from notifications where id = $1", [NOTIFICATION_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notification_attempts_notification_fk",
    });
  });

  it("stores immutable protected Messages with tenant/channel-scoped deduplication", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "messages-a", "messages-a", "messages-a");
    await seedWorkflowTenant(WORKFLOW_B, "messages-b", "messages-b", "messages-b");

    await expect(
      insertInboundMessage(
        syntheticUuid(0x520),
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_A,
        CONTACT_A,
        2,
      ),
    ).resolves.toBeUndefined();
    await expect(
      insertInboundMessage(
        syntheticUuid(0x521),
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_A,
        CONTACT_A,
        2,
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "messages_organization_conversation_sequence_unique",
    });
    await expect(
      insertInboundMessage(
        syntheticUuid(0x522),
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_A,
        CONTACT_A,
        3,
        `provider-message-${MESSAGE_A}`,
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "messages_external_message_dedupe_unique",
    });
    await expect(
      insertInboundMessage(
        syntheticUuid(0x523),
        ORGANIZATION_B,
        CONVERSATION_B,
        CHANNEL_CONNECTION_B,
        CONTACT_B,
        2,
        `provider-message-${MESSAGE_A}`,
      ),
    ).resolves.toBeUndefined();
    await expect(
      insertInboundMessage(
        syntheticUuid(0x524),
        ORGANIZATION_A,
        CONVERSATION_B,
        CHANNEL_CONNECTION_A,
        CONTACT_A,
        4,
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "messages_conversation_channel_fk" });
    await expect(
      insertInboundMessage(
        syntheticUuid(0x525),
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_B,
        CONTACT_A,
        4,
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "messages_channel_connection_fk" });
    await expect(
      database().query(
        `insert into messages
          (id, organization_id, conversation_id, channel_connection_id,
           direction, sender_type, sequence_no, content_type, body_hash,
           processing_status, delivery_status)
         values ($1, $2, $3, $4, 'inbound', 'system', 4, 'text', $5,
           'accepted', 'not_applicable')`,
        [
          syntheticUuid(0x526),
          ORGANIZATION_A,
          CONVERSATION_A,
          CHANNEL_CONNECTION_A,
          Buffer.from("synthetic-message-body-hash"),
        ],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "messages_sender_shape_check" });

    const bodyColumns = await database().query<{ column_name: string; data_type: string }>(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name like 'body%'
        order by column_name`,
    );
    expect(bodyColumns.rows).toEqual([
      { column_name: "body_ciphertext", data_type: "bytea" },
      { column_name: "body_hash", data_type: "bytea" },
    ]);
    await expect(
      database().query("delete from conversations where id = $1", [CONVERSATION_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "messages_conversation_channel_fk" });
  });

  it("activates widget, consent, and qualification Message relationships with tenant integrity", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "deferred-a", "deferred-a", "deferred-a");
    await seedWorkflowTenant(WORKFLOW_B, "deferred-b", "deferred-b", "deferred-b");
    await insertWidgetOrigin(WIDGET_ORIGIN_A, ORGANIZATION_A, CHANNEL_CONNECTION_A, USER_A);
    await insertWidgetSession(
      WIDGET_SESSION_A,
      ORGANIZATION_A,
      CHANNEL_CONNECTION_A,
      WIDGET_ORIGIN_A,
      "deferred-session-token-hash",
      "deferred-participant-hash",
    );

    await expect(
      database().query("update widget_sessions set conversation_id = $2 where id = $1", [
        WIDGET_SESSION_A,
        CONVERSATION_A,
      ]),
    ).resolves.toBeDefined();
    await expect(
      database().query("update widget_sessions set conversation_id = $2 where id = $1", [
        WIDGET_SESSION_A,
        CONVERSATION_B,
      ]),
    ).rejects.toMatchObject({ code: "23503", constraint: "widget_sessions_conversation_fk" });
    await expect(
      database().query("update widget_sessions set conversation_id = null where id = $1", [
        WIDGET_SESSION_A,
      ]),
    ).resolves.toBeDefined();

    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, conversation_id, purpose, status,
           notice_key, notice_version, locale, capture_channel,
           channel_connection_id, source_message_id, captured_by_type,
           captured_at, evidence_hash)
         values ($1, $2, $3, $4, 'service_messages', 'granted',
           'privacy.service', 1, 'en', 'widget', $5, $6, 'customer', now(), $7)`,
        [
          CONSENT_A,
          ORGANIZATION_A,
          CONTACT_A,
          CONVERSATION_A,
          CHANNEL_CONNECTION_A,
          MESSAGE_A,
          Buffer.from("synthetic-consent-evidence-hash"),
        ],
      ),
    ).resolves.toBeDefined();
    await expect(
      database().query(
        `insert into consent_records
          (id, organization_id, contact_id, conversation_id, purpose, status,
           notice_key, notice_version, locale, capture_channel,
           channel_connection_id, source_message_id, captured_by_type,
           captured_at, evidence_hash)
         values ($1, $2, $3, $4, 'service_messages', 'granted',
           'privacy.service', 1, 'en', 'widget', $5, $6, 'customer', now(), $7)`,
        [
          CONSENT_B,
          ORGANIZATION_A,
          CONTACT_A,
          CONVERSATION_A,
          CHANNEL_CONNECTION_A,
          MESSAGE_B,
          Buffer.from("synthetic-consent-evidence-hash-b"),
        ],
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "consent_records_source_message_fk" });

    await insertLeadQualificationEvaluation(EVALUATION_A, ORGANIZATION_A, LEAD_A, POLICY_A);
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.requested', 'customer_statement')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_A],
      ),
    ).resolves.toBeDefined();
    await expect(
      database().query(
        `insert into lead_qualification_evidence
          (organization_id, evaluation_id, message_id, field_key, evidence_kind)
         values ($1, $2, $3, 'service.other', 'customer_statement')`,
        [ORGANIZATION_A, EVALUATION_A, MESSAGE_B],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "lead_qualification_evidence_message_fk",
    });
  });

  it("persists exactly the seven AppointmentRequest states and rejects cross-tenant references", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "appointments-a", "appointments-a", "appointments-a");
    await seedWorkflowTenant(WORKFLOW_B, "appointments-b", "appointments-b", "appointments-b");

    const statuses = [
      "requested",
      "staff_accepted",
      "awaiting_customer_confirmation",
      "confirmed",
      "rejected",
      "cancelled",
      "expired",
    ] as const;
    for (const [index, status] of statuses.entries()) {
      const requestId = syntheticUuid(0x540 + index);
      const messageId = index === 0 ? MESSAGE_A : syntheticUuid(0x550 + index);
      if (index > 0) {
        await insertInboundMessage(
          messageId,
          ORGANIZATION_A,
          CONVERSATION_A,
          CHANNEL_CONNECTION_A,
          CONTACT_A,
          index + 1,
        );
      }
      await expect(
        insertAppointmentRequest(requestId, { ...WORKFLOW_A, messageId }, status),
      ).resolves.toBeUndefined();
    }

    await expect(
      database().query("update appointment_requests set status = 'pending' where id = $1", [
        syntheticUuid(0x540),
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    const hostileMessageIds = Array.from({ length: 5 }, (_, index) => syntheticUuid(0x565 + index));
    for (const [index, messageId] of hostileMessageIds.entries()) {
      await insertInboundMessage(
        messageId,
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_A,
        CONTACT_A,
        index + 8,
      );
    }

    await expect(
      insertAppointmentRequest(
        syntheticUuid(0x560),
        { ...WORKFLOW_A, leadId: LEAD_B, messageId: hostileMessageIds[0]! },
        "requested",
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "appointment_requests_lead_fk" });
    await expect(
      insertAppointmentRequest(
        syntheticUuid(0x561),
        { ...WORKFLOW_A, contactId: CONTACT_B, messageId: hostileMessageIds[1]! },
        "requested",
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "appointment_requests_contact_fk" });
    await expect(
      insertAppointmentRequest(
        syntheticUuid(0x562),
        { ...WORKFLOW_A, conversationId: CONVERSATION_B, messageId: hostileMessageIds[2]! },
        "requested",
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_requests_conversation_fk",
    });
    await expect(
      insertAppointmentRequest(
        syntheticUuid(0x563),
        { ...WORKFLOW_A, locationId: LOCATION_B, messageId: hostileMessageIds[3]! },
        "requested",
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "appointment_requests_location_fk" });
    await expect(
      insertAppointmentRequest(
        syntheticUuid(0x564),
        { ...WORKFLOW_A, messageId: hostileMessageIds[4]!, serviceId: SERVICE_B },
        "requested",
      ),
    ).rejects.toMatchObject({ code: "23503", constraint: "appointment_requests_service_fk" });
    await expect(
      database().query("update appointment_requests set version = 0 where id = $1", [
        syntheticUuid(0x540),
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "appointment_requests_version_check" });
    await expect(
      database().query(
        `update appointment_requests
            set confirmed_at = offer_expires_at,
                confirmation_source = 'customer_session'
          where id = $1`,
        [syntheticUuid(0x542)],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_requests_confirmation_result_check",
    });
  });

  it("preserves preference windows and deterministic append-only transition versions", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "history-a", "history-a", "history-a");
    await seedWorkflowTenant(WORKFLOW_B, "history-b", "history-b", "history-b");
    await insertAppointmentRequest(APPOINTMENT_REQUEST_A, WORKFLOW_A);

    await expect(
      database().query(
        `insert into appointment_request_preferences
          (id, organization_id, appointment_request_id, preference_order,
           start_at, end_at, time_zone, local_start, local_end, precision)
         values ($1, $2, $3, 1,
           timestamptz '2026-10-01 04:00:00+00',
           timestamptz '2026-10-01 05:00:00+00', 'Asia/Tashkent',
           timestamp '2026-10-01 09:00:00', timestamp '2026-10-01 10:00:00', 'exact')`,
        [APPOINTMENT_PREFERENCE_A, ORGANIZATION_A, APPOINTMENT_REQUEST_A],
      ),
    ).resolves.toBeDefined();
    await expect(
      database().query(
        `insert into appointment_request_preferences
          (id, organization_id, appointment_request_id, preference_order,
           time_zone, precision)
         values ($1, $2, $3, 2, 'Asia/Tashkent', 'free_text')`,
        [syntheticUuid(0x570), ORGANIZATION_A, APPOINTMENT_REQUEST_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_request_preferences_shape_check",
    });
    await expect(
      database().query(
        `insert into appointment_request_preferences
          (id, organization_id, appointment_request_id, preference_order,
           original_local_text_ciphertext, time_zone, precision)
         values ($1, $2, $3, 1, $4, 'Asia/Tashkent', 'free_text')`,
        [
          syntheticUuid(0x571),
          ORGANIZATION_B,
          APPOINTMENT_REQUEST_A,
          Buffer.from("synthetic-local-text-ciphertext"),
        ],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_request_preferences_request_fk",
    });

    const insertTransition = (
      id: string,
      aggregateVersion: number,
      organizationId = ORGANIZATION_A,
    ) =>
      database().query(
        `insert into appointment_request_transitions
          (id, organization_id, appointment_request_id, from_status, to_status,
           aggregate_version, command, actor_type, actor_contact_id,
           source_message_id, correlation_id, occurred_at)
         values ($1, $2, $3, null, 'requested', $4,
           'create_appointment_request', 'customer', $5, $6, $7, now())`,
        [
          id,
          organizationId,
          APPOINTMENT_REQUEST_A,
          aggregateVersion,
          CONTACT_A,
          MESSAGE_A,
          CORRELATION_A,
        ],
      );

    await expect(insertTransition(APPOINTMENT_TRANSITION_A, 1)).resolves.toBeDefined();
    await expect(insertTransition(syntheticUuid(0x572), 1)).rejects.toMatchObject({
      code: "23505",
      constraint: "appointment_request_transitions_request_version_unique",
    });
    await expect(insertTransition(syntheticUuid(0x573), 2, ORGANIZATION_B)).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_request_transitions_request_fk",
    });
    await expect(
      database().query("delete from appointment_requests where id = $1", [APPOINTMENT_REQUEST_A]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("stores confirmation evidence for an exact offer and preserves dual-version history", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "confirmation-a", "confirmation-a", "confirmation-a");
    await insertAppointmentRequest(
      APPOINTMENT_REQUEST_A,
      WORKFLOW_A,
      "awaiting_customer_confirmation",
    );
    await database().query(
      `insert into appointment_request_transitions
        (id, organization_id, appointment_request_id, from_status, to_status,
         aggregate_version, command, offer_version, actor_type,
         correlation_id, occurred_at)
       values ($1, $2, $3, 'staff_accepted', 'awaiting_customer_confirmation',
         3, 'prepare_customer_confirmation', 1, 'system', $4, now())`,
      [APPOINTMENT_TRANSITION_A, ORGANIZATION_A, APPOINTMENT_REQUEST_A, CORRELATION_A],
    );

    await expect(
      database().query(
        `insert into appointment_confirmation_evidence
          (id, organization_id, appointment_request_id, offer_version, outcome,
           source, customer_contact_id, external_reference_hash,
           customer_acted_at, recorded_at, evidence_ciphertext, correlation_id)
         values ($1, $2, $3, 1, 'confirmed', 'customer_session', $4, $5,
           now(), now(), $6, $7)`,
        [
          CONFIRMATION_EVIDENCE_A,
          ORGANIZATION_A,
          APPOINTMENT_REQUEST_A,
          CONTACT_A,
          Buffer.from("synthetic-confirmation-reference-hash"),
          Buffer.from("synthetic-confirmation-evidence-ciphertext"),
          CORRELATION_A,
        ],
      ),
    ).resolves.toBeDefined();
    const versionEvidence = await database().query<{
      aggregate_version: string;
      evidence_offer_version: number;
      transition_offer_version: number;
    }>(
      `select t.aggregate_version,
              t.offer_version as transition_offer_version,
              e.offer_version as evidence_offer_version
         from appointment_request_transitions t
         join appointment_confirmation_evidence e
           on (e.organization_id, e.appointment_request_id) =
              (t.organization_id, t.appointment_request_id)
        where e.id = $1`,
      [CONFIRMATION_EVIDENCE_A],
    );
    expect(versionEvidence.rows[0]).toEqual({
      aggregate_version: "3",
      evidence_offer_version: 1,
      transition_offer_version: 1,
    });
    await expect(
      database().query(
        `insert into appointment_confirmation_evidence
          (id, organization_id, appointment_request_id, offer_version, outcome,
           source, customer_contact_id, customer_acted_at, recorded_at,
           correlation_id)
         values ($1, $2, $3, 1, 'confirmed', 'staff_attested_external', $4,
           now(), now(), $5)`,
        [syntheticUuid(0x580), ORGANIZATION_A, APPOINTMENT_REQUEST_A, CONTACT_A, CORRELATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_confirmation_evidence_source_shape_check",
    });
    await expect(
      database().query(
        `update appointment_confirmation_evidence
            set recorded_at = customer_acted_at - interval '1 second'
          where id = $1`,
        [CONFIRMATION_EVIDENCE_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_confirmation_evidence_timestamps_check",
    });
  }, 60_000);

  it("records attendance corrections without adding medical or AppointmentRequest states", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "attendance-a", "attendance-a", "attendance-a");
    await seedWorkflowTenant(WORKFLOW_B, "attendance-b", "attendance-b", "attendance-b");
    await insertAppointmentRequest(APPOINTMENT_REQUEST_A, WORKFLOW_A, "confirmed");

    const insertAttendance = (
      id: string,
      organizationId: string,
      membershipId: string,
      supersedesId: string | null,
      isCurrent: boolean,
    ) =>
      database().query(
        `insert into appointment_request_attendance
          (id, organization_id, appointment_request_id, outcome, occurred_at,
           recorded_by_membership_id, recorded_at, source, is_current,
           supersedes_id, reason_code)
         values ($1, $2, $3, 'attended', now(), $4, now(), 'staff_manual',
           $5, $6, 'staff_verified')`,
        [id, organizationId, APPOINTMENT_REQUEST_A, membershipId, isCurrent, supersedesId],
      );

    await expect(
      insertAttendance(ATTENDANCE_A, ORGANIZATION_A, MEMBERSHIP_A, null, true),
    ).resolves.toBeDefined();
    await expect(
      insertAttendance(ATTENDANCE_B, ORGANIZATION_A, MEMBERSHIP_A, null, true),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "appointment_request_attendance_one_current_unique",
    });
    await database().query(
      "update appointment_request_attendance set is_current = false where id = $1",
      [ATTENDANCE_A],
    );
    await expect(
      insertAttendance(ATTENDANCE_B, ORGANIZATION_A, MEMBERSHIP_A, ATTENDANCE_A, true),
    ).resolves.toBeDefined();
    await expect(
      insertAttendance(syntheticUuid(0x590), ORGANIZATION_A, MEMBERSHIP_B, null, false),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_request_attendance_member_fk",
    });

    const medicalColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'appointment_request_attendance'
          and (column_name like '%diagnos%'
            or column_name like '%medical%'
            or column_name like '%procedure%'
            or column_name like '%note%')`,
    );
    expect(medicalColumns.rows).toEqual([]);
  });

  it("stores trustworthy integer-minor-unit revenue attribution and append-only reversals", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "revenue-a", "revenue-a", "revenue-a");
    await seedWorkflowTenant(WORKFLOW_B, "revenue-b", "revenue-b", "revenue-b");
    await insertAppointmentRequest(APPOINTMENT_REQUEST_A, WORKFLOW_A, "confirmed");

    const insertRevenue = (
      id: string,
      amountMinor: number,
      currency: string,
      entryType: "adjustment" | "charge" | "reversal",
      reversesAttributionId: string | null,
      membershipId = MEMBERSHIP_A,
    ) =>
      database().query(
        `insert into appointment_revenue_attributions
          (id, organization_id, appointment_request_id, amount_minor, currency,
           entry_type, category_code, recognized_at,
           recorded_by_membership_id, recorded_at, source,
           reverses_attribution_id, reason_code)
         values ($1, $2, $3, $4, $5, $6, 'treatment_revenue', now(),
           $7, now(), 'staff_manual', $8, 'staff_recorded')`,
        [
          id,
          ORGANIZATION_A,
          APPOINTMENT_REQUEST_A,
          amountMinor,
          currency,
          entryType,
          membershipId,
          reversesAttributionId,
        ],
      );

    await expect(
      insertRevenue(REVENUE_ATTRIBUTION_A, 250_000, "UZS", "charge", null),
    ).resolves.toBeDefined();
    const amount = await database().query<{ amount_minor: string; data_type: string }>(
      `select r.amount_minor,
              (select data_type
                 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'appointment_revenue_attributions'
                  and column_name = 'amount_minor') as data_type
         from appointment_revenue_attributions r
        where r.id = $1`,
      [REVENUE_ATTRIBUTION_A],
    );
    expect(amount.rows[0]).toEqual({ amount_minor: "250000", data_type: "bigint" });
    await expect(
      insertRevenue(REVENUE_ATTRIBUTION_B, 250_000, "UZS", "reversal", REVENUE_ATTRIBUTION_A),
    ).resolves.toBeDefined();
    await expect(
      insertRevenue(syntheticUuid(0x5a0), 1, "UZS", "reversal", REVENUE_ATTRIBUTION_A),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "appointment_revenue_attributions_one_reversal_unique",
    });
    const unreversedRevenueId = syntheticUuid(0x5a5);
    await expect(
      insertRevenue(unreversedRevenueId, 1, "UZS", "charge", null),
    ).resolves.toBeDefined();
    await expect(
      insertRevenue(syntheticUuid(0x5a1), 1, "USD", "reversal", unreversedRevenueId),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_revenue_attributions_reversed_entry_fk",
    });
    await expect(
      insertRevenue(syntheticUuid(0x5a2), 0, "UZS", "charge", null),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_revenue_attributions_amount_check",
    });
    await expect(
      insertRevenue(syntheticUuid(0x5a3), 1, "uzs", "charge", null),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "appointment_revenue_attributions_currency_check",
    });
    await expect(
      insertRevenue(syntheticUuid(0x5a4), 1, "UZS", "charge", null, MEMBERSHIP_B),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "appointment_revenue_attributions_member_fk",
    });
  });

  it("persists provider-neutral AI run provenance with protected payloads and exact telemetry", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "ai-runs-a", "ai-location-a", "ai-service-a");
    await insertRetentionPolicy(RETENTION_POLICY_A, ORGANIZATION_A, 1);
    await insertAiRun(AI_RUN_A, WORKFLOW_A, {
      inputSnapshotCiphertext: Buffer.from("synthetic-encrypted-input-snapshot"),
      outputSnapshotCiphertext: Buffer.from("synthetic-encrypted-output-snapshot"),
      snapshotCapturePolicyId: RETENTION_POLICY_A,
    });

    const run = await database().query<{
      cost_currency: string;
      decision_schema_version: string;
      estimated_cost_micros: string;
      input_snapshot_type: string;
      input_units: string;
      policy_allowed: boolean;
      provider_id: string;
      schema_valid: boolean;
      status: string;
      total_units: string;
    }>(
      `select provider_id, decision_schema_version, status, input_units,
              total_units, estimated_cost_micros, cost_currency,
              schema_valid, policy_allowed,
              pg_typeof(input_snapshot_ciphertext)::text as input_snapshot_type
         from ai_runs
        where id = $1`,
      [AI_RUN_A],
    );
    expect(run.rows[0]).toEqual({
      cost_currency: "USD",
      decision_schema_version: "1",
      estimated_cost_micros: "2500",
      input_snapshot_type: "bytea",
      input_units: "120",
      policy_allowed: true,
      provider_id: "synthetic_provider",
      schema_valid: true,
      status: "succeeded",
      total_units: "160",
    });

    const forbiddenPlaintextColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'ai_runs'
          and column_name in ('prompt', 'prompt_text', 'input_text', 'output_text',
                              'response', 'response_body', 'api_key', 'authorization_header')`,
    );
    expect(forbiddenPlaintextColumns.rows).toEqual([]);

    await database().query(
      `insert into messages
        (id, organization_id, conversation_id, channel_connection_id,
         direction, sender_type, sequence_no, content_type, body_ciphertext,
         body_hash, locale, processing_status, delivery_status, ai_run_id)
       values ($1, $2, $3, $4, 'outbound', 'system', 2, 'text', $5, $6,
         'en', 'processed', 'queued', $7)`,
      [
        syntheticUuid(0x960),
        ORGANIZATION_A,
        CONVERSATION_A,
        CHANNEL_CONNECTION_A,
        Buffer.from("synthetic-encrypted-outbound-message"),
        Buffer.from("synthetic-outbound-message-hash"),
        AI_RUN_A,
      ],
    );

    await expect(
      database().query("delete from retention_policies where id = $1", [RETENTION_POLICY_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_runs_snapshot_capture_policy_fk",
    });
    await expect(
      database().query("delete from messages where id = $1", [MESSAGE_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "ai_runs_trigger_message_fk" });
  });

  it("rejects invalid AI run lifecycle, telemetry, payload, and cross-tenant relationships", async () => {
    await seedWorkflowTenant(
      WORKFLOW_A,
      "ai-run-guard-a",
      "ai-guard-location-a",
      "ai-guard-service-a",
    );
    await seedWorkflowTenant(
      WORKFLOW_B,
      "ai-run-guard-b",
      "ai-guard-location-b",
      "ai-guard-service-b",
    );
    await insertRetentionPolicy(RETENTION_POLICY_B, ORGANIZATION_B, 1);
    await insertAiRun(AI_RUN_A, WORKFLOW_A);
    await insertAiRun(AI_RUN_B, WORKFLOW_B);

    await expect(
      database().query("update ai_runs set id = $1 where id = $2", [UUID_V4, AI_RUN_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_id_uuid_v7_check" });
    await expect(
      database().query("update ai_runs set provider_id = 'Synthetic Provider' where id = $1", [
        AI_RUN_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_provider_id_check" });
    await expect(
      database().query("update ai_runs set requested_model_id = 'latest' where id = $1", [
        AI_RUN_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_model_identifiers_check" });
    await expect(
      database().query("update ai_runs set input_units = -1 where id = $1", [AI_RUN_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_usage_check" });
    await expect(
      database().query("update ai_runs set estimated_cost_micros = -1 where id = $1", [AI_RUN_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_cost_check" });
    await expect(
      database().query("update ai_runs set cost_currency = 'usd' where id = $1", [AI_RUN_A]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_cost_currency_check" });
    await expect(
      database().query("update ai_runs set knowledge_manifest_jsonb = '[]'::jsonb where id = $1", [
        AI_RUN_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_knowledge_manifest_check" });
    await expect(
      database().query(
        `update ai_runs
            set status = 'failed', failure_category = 'synthetic_failure',
                schema_valid = false, policy_allowed = true
          where id = $1`,
        [AI_RUN_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_validation_order_check" });
    await expect(
      database().query(
        `update ai_runs
            set finished_at = started_at - interval '1 millisecond'
          where id = $1`,
        [AI_RUN_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "ai_runs_lifecycle_check" });
    await expect(
      database().query(
        `update ai_runs
            set input_snapshot_ciphertext = $1, snapshot_capture_policy_id = null
          where id = $2`,
        [Buffer.from("synthetic-encrypted-snapshot"), AI_RUN_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ai_runs_snapshot_capture_policy_check",
    });

    await expect(
      insertAiRun(syntheticUuid(0x961), WORKFLOW_A, {
        attemptNo: 2,
        conversationId: CONVERSATION_B,
        triggerMessageId: MESSAGE_B,
      }),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      insertAiRun(syntheticUuid(0x962), WORKFLOW_A, {
        attemptNo: 3,
        triggerMessageId: MESSAGE_B,
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "ai_runs_trigger_message_fk" });
    await expect(
      insertAiRun(syntheticUuid(0x963), WORKFLOW_A, {
        attemptNo: 4,
        inputSnapshotCiphertext: Buffer.from("synthetic-encrypted-input-snapshot"),
        snapshotCapturePolicyId: RETENTION_POLICY_B,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_runs_snapshot_capture_policy_fk",
    });
    await expect(
      database().query("update messages set ai_run_id = $1 where id = $2", [AI_RUN_B, MESSAGE_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "messages_ai_run_fk" });
  });

  it("stores one canonical encrypted action evaluation without treating validation as execution", async () => {
    await seedWorkflowTenant(
      WORKFLOW_A,
      "ai-action-a",
      "ai-action-location-a",
      "ai-action-service-a",
    );
    await insertAiRun(AI_RUN_A, WORKFLOW_A);
    await insertAiActionEvaluation({
      actionName: "request_handoff",
      aiRunId: AI_RUN_A,
      id: AI_ACTION_EVALUATION_A,
      organizationId: ORGANIZATION_A,
      validationStatus: "allowed",
    });

    const evaluation = await database().query<{
      action_name: string;
      action_schema_version: string;
      application_status: string;
      arguments_type: string;
      validation_status: string;
    }>(
      `select action_name, action_schema_version, validation_status,
              application_status,
              pg_typeof(arguments_ciphertext)::text as arguments_type
         from ai_action_evaluations
        where id = $1`,
      [AI_ACTION_EVALUATION_A],
    );
    expect(evaluation.rows[0]).toEqual({
      action_name: "request_handoff",
      action_schema_version: "1",
      application_status: "not_applied",
      arguments_type: "bytea",
      validation_status: "allowed",
    });

    const forbiddenPlaintextColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'ai_action_evaluations'
          and column_name in ('arguments', 'arguments_jsonb', 'result', 'result_jsonb',
                              'tool_call', 'tool_output')`,
    );
    expect(forbiddenPlaintextColumns.rows).toEqual([]);

    await expect(
      insertAiActionEvaluation({
        aiRunId: AI_RUN_A,
        id: AI_ACTION_EVALUATION_B,
        organizationId: ORGANIZATION_A,
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "ai_action_evaluations_organization_ai_run_unique",
    });
    await expect(
      database().query(
        "update ai_action_evaluations set action_name = 'execute_sql' where id = $1",
        [AI_ACTION_EVALUATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ai_action_evaluations_action_name_check",
    });
    await expect(
      database().query(
        `update ai_action_evaluations
            set validation_status = 'denied', policy_reason_code = 'policy_blocked',
                application_status = 'applied'
          where id = $1`,
        [AI_ACTION_EVALUATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ai_action_evaluations_authority_shape_check",
    });
    await expect(
      database().query("delete from ai_runs where id = $1", [AI_RUN_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_ai_run_fk",
    });
  });

  it("rejects cross-tenant action-evaluation runs and bounded aggregate targets", async () => {
    await seedWorkflowTenant(
      WORKFLOW_A,
      "ai-target-a",
      "ai-target-location-a",
      "ai-target-service-a",
    );
    await seedWorkflowTenant(
      WORKFLOW_B,
      "ai-target-b",
      "ai-target-location-b",
      "ai-target-service-b",
    );
    await insertAiRun(AI_RUN_A, WORKFLOW_A);
    await insertAiRun(AI_RUN_B, WORKFLOW_B);
    await insertAppointmentRequest(APPOINTMENT_REQUEST_A, WORKFLOW_A);
    const appointmentRequestB = syntheticUuid(0x970);
    await insertAppointmentRequest(appointmentRequestB, WORKFLOW_B);
    await insertHandoff(HANDOFF_B, WORKFLOW_B);

    await expect(
      insertAiActionEvaluation({
        aiRunId: AI_RUN_B,
        id: AI_ACTION_EVALUATION_A,
        organizationId: ORGANIZATION_A,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_ai_run_fk",
    });

    await expect(
      insertAiActionEvaluation({
        actionName: "confirm_appointment",
        aiRunId: AI_RUN_A,
        id: AI_ACTION_EVALUATION_A,
        organizationId: ORGANIZATION_A,
        targetAggregateId: appointmentRequestB,
        targetAggregateType: "appointment_request",
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_target_tenant_fk",
    });

    const secondAiRunA = syntheticUuid(0x971);
    await insertAiRun(secondAiRunA, WORKFLOW_A, { attemptNo: 2 });
    await expect(
      insertAiActionEvaluation({
        actionName: "request_information",
        aiRunId: secondAiRunA,
        id: syntheticUuid(0x972),
        organizationId: ORGANIZATION_A,
        targetAggregateId: CONVERSATION_B,
        targetAggregateType: "conversation",
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_target_tenant_fk",
    });

    const thirdAiRunA = syntheticUuid(0x973);
    await insertAiRun(thirdAiRunA, WORKFLOW_A, { attemptNo: 3 });
    await expect(
      insertAiActionEvaluation({
        actionName: "request_handoff",
        aiRunId: thirdAiRunA,
        id: syntheticUuid(0x974),
        organizationId: ORGANIZATION_A,
        targetAggregateId: HANDOFF_B,
        targetAggregateType: "handoff",
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_target_tenant_fk",
    });

    await insertAiActionEvaluation({
      actionName: "confirm_appointment",
      aiRunId: AI_RUN_A,
      id: AI_ACTION_EVALUATION_A,
      organizationId: ORGANIZATION_A,
      targetAggregateId: APPOINTMENT_REQUEST_A,
      targetAggregateType: "appointment_request",
    });
    await expect(
      database().query(
        `update ai_action_evaluations
            set target_aggregate_id = $1
          where id = $2`,
        [appointmentRequestB, AI_ACTION_EVALUATION_A],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "ai_action_evaluations_target_tenant_fk",
    });
  });

  it("deduplicates verified webhook receipts by tenant connection and provider identity", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "webhook-a", "webhook-a", "webhook-a");
    await seedWorkflowTenant(WORKFLOW_B, "webhook-b", "webhook-b", "webhook-b");
    const sharedEventId = "synthetic-provider-event-shared";
    const sharedMessageId = "synthetic-provider-message-shared";

    await insertWebhookReceipt(WEBHOOK_RECEIPT_A, WORKFLOW_A, {
      externalEventId: sharedEventId,
      externalMessageId: sharedMessageId,
      payloadCiphertext: Buffer.from("synthetic-encrypted-webhook-payload"),
    });
    const receipt = await database().query<{
      payload_type: string;
      processed_message_id: string;
      provider: string;
      status: string;
    }>(
      `select provider, status, processed_message_id,
              pg_typeof(payload_ciphertext)::text as payload_type
         from webhook_receipts
        where id = $1`,
      [WEBHOOK_RECEIPT_A],
    );
    expect(receipt.rows[0]).toEqual({
      payload_type: "bytea",
      processed_message_id: MESSAGE_A,
      provider: "synthetic_provider",
      status: "processed",
    });

    await expect(
      insertWebhookReceipt(syntheticUuid(0xa00), WORKFLOW_A, {
        externalEventId: sharedEventId,
        externalMessageId: "different-provider-message",
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "webhook_receipts_connection_external_event_unique",
    });
    await expect(
      insertWebhookReceipt(syntheticUuid(0xa01), WORKFLOW_A, {
        externalEventId: "different-provider-event",
        externalMessageId: sharedMessageId,
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "webhook_receipts_connection_external_message_unique",
    });
    await expect(
      insertWebhookReceipt(WEBHOOK_RECEIPT_B, WORKFLOW_B, {
        externalEventId: sharedEventId,
        externalMessageId: sharedMessageId,
      }),
    ).resolves.toBeUndefined();

    const secondConnectionA = syntheticUuid(0xa02);
    await insertChannelConnection(secondConnectionA, ORGANIZATION_A, "telegram", "Webhook A 2");
    await expect(
      insertWebhookReceipt(syntheticUuid(0xa03), WORKFLOW_A, {
        channelConnectionId: secondConnectionA,
        externalEventId: sharedEventId,
        externalMessageId: sharedMessageId,
        processedMessageId: null,
      }),
    ).resolves.toBeUndefined();

    const forbiddenColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'webhook_receipts'
          and column_name in ('payload', 'payload_jsonb', 'signature', 'headers_jsonb',
                              'authorization_header', 'webhook_secret', 'provider_credentials')`,
    );
    expect(forbiddenColumns.rows).toEqual([]);
    await expect(
      database().query("delete from messages where id = $1", [MESSAGE_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "webhook_receipts_processed_message_fk" });
  });

  it("rejects malformed webhook evidence and cross-tenant receipt relationships", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "webhook-guard-a", "webhook-guard-a", "webhook-guard-a");
    await seedWorkflowTenant(WORKFLOW_B, "webhook-guard-b", "webhook-guard-b", "webhook-guard-b");
    await insertWebhookReceipt(WEBHOOK_RECEIPT_A, WORKFLOW_A, { status: "received" });

    await expect(
      database().query("update webhook_receipts set id = $1 where id = $2", [
        UUID_V4,
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "webhook_receipts_id_uuid_v7_check" });
    await expect(
      database().query(
        "update webhook_receipts set provider = 'Synthetic Provider' where id = $1",
        [WEBHOOK_RECEIPT_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "webhook_receipts_provider_check" });
    await expect(
      database().query("update webhook_receipts set payload_hash = $1 where id = $2", [
        Buffer.from("short"),
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "webhook_receipts_payload_hash_check" });
    await expect(
      database().query("update webhook_receipts set payload_ciphertext = $1 where id = $2", [
        Buffer.alloc(0),
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_payload_ciphertext_check",
    });
    await expect(
      database().query("update webhook_receipts set provider_sequence = -1 where id = $1", [
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_provider_sequence_check",
    });
    await expect(
      database().query("update webhook_receipts set status = 'rejected' where id = $1", [
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database().query("update webhook_receipts set attempt_count = -1 where id = $1", [
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_attempt_count_check",
    });
    await expect(
      database().query(
        "update webhook_receipts set last_received_at = first_received_at - interval '1 second' where id = $1",
        [WEBHOOK_RECEIPT_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "webhook_receipts_timestamps_check" });
    await expect(
      database().query("update webhook_receipts set status = 'retryable_failure' where id = $1", [
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_processing_shape_check",
    });
    await expect(
      database().query("update webhook_receipts set processed_message_id = $1 where id = $2", [
        MESSAGE_A,
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_processed_message_shape_check",
    });
    await expect(
      database().query("update webhook_receipts set correlation_id = $1 where id = $2", [
        UUID_V4,
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "webhook_receipts_correlation_uuid_v7_check",
    });
    await expect(
      database().query("update webhook_receipts set channel_connection_id = $1 where id = $2", [
        CHANNEL_CONNECTION_B,
        WEBHOOK_RECEIPT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "webhook_receipts_channel_connection_fk",
    });
    await expect(
      database().query(
        "update webhook_receipts set status = 'processed', processed_message_id = $1 where id = $2",
        [MESSAGE_B, WEBHOOK_RECEIPT_A],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "webhook_receipts_processed_message_fk",
    });
  });

  it("preserves exact tenant-principal idempotency scope and protected replay evidence", async () => {
    await insertOrganization(ORGANIZATION_A, "idempotency-a");
    await insertOrganization(ORGANIZATION_B, "idempotency-b");
    const keyHash = Buffer.from("synthetic-shared-idempotency-key-hash");
    const principalHash = Buffer.from("synthetic-shared-principal-hash");

    await insertIdempotencyKey(IDEMPOTENCY_KEY_A, ORGANIZATION_A, {
      keyHash,
      principalIdHash: principalHash,
      resourceId: CONVERSATION_A,
      resourceType: "conversation",
    });
    const record = await database().query<{
      key_type: string;
      request_type: string;
      response_type: string;
      status: string;
    }>(
      `select status, pg_typeof(key_hash)::text as key_type,
              pg_typeof(request_hash)::text as request_type,
              pg_typeof(response_ciphertext)::text as response_type
         from idempotency_keys where id = $1`,
      [IDEMPOTENCY_KEY_A],
    );
    expect(record.rows[0]).toEqual({
      key_type: "bytea",
      request_type: "bytea",
      response_type: "bytea",
      status: "succeeded",
    });

    await expect(
      insertIdempotencyKey(syntheticUuid(0xa10), ORGANIZATION_A, {
        keyHash,
        principalIdHash: principalHash,
        requestHash: Buffer.from("different-synthetic-request-fingerprint"),
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "idempotency_keys_tenant_principal_scope_key_unique",
    });
    await expect(
      insertIdempotencyKey(IDEMPOTENCY_KEY_B, ORGANIZATION_B, {
        keyHash,
        principalIdHash: principalHash,
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertIdempotencyKey(syntheticUuid(0xa11), ORGANIZATION_A, {
        keyHash,
        principalIdHash: principalHash,
        scope: "appointment_request.accept",
      }),
    ).resolves.toBeUndefined();
    await expect(
      insertIdempotencyKey(syntheticUuid(0xa12), ORGANIZATION_A, {
        keyHash,
        principalIdHash: Buffer.from("different-synthetic-principal-hash"),
      }),
    ).resolves.toBeUndefined();

    const forbiddenColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'idempotency_keys'
          and column_name in ('key', 'idempotency_key', 'request_body', 'request_jsonb',
                              'response_body', 'response_jsonb', 'headers_jsonb', 'cookies')`,
    );
    expect(forbiddenColumns.rows).toEqual([]);
    await expect(
      database().query("delete from organizations where id = $1", [ORGANIZATION_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "idempotency_keys_organization_id_organizations_id_fk",
    });
  });

  it("enforces idempotency lifecycle, hash, response, resource, and replay-window bounds", async () => {
    await insertOrganization(ORGANIZATION_A, "idempotency-guards");
    await insertIdempotencyKey(IDEMPOTENCY_KEY_A, ORGANIZATION_A, { status: "in_progress" });

    await expect(
      database().query("update idempotency_keys set id = $1 where id = $2", [
        UUID_V4,
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_id_uuid_v7_check" });
    await expect(
      database().query("update idempotency_keys set scope = 'Conversation Reply' where id = $1", [
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_scope_check" });
    await expect(
      database().query("update idempotency_keys set key_hash = $1 where id = $2", [
        Buffer.from("short"),
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_hashes_check" });
    await expect(
      database().query("update idempotency_keys set principal_type = 'admin' where id = $1", [
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "idempotency_keys_principal_type_check",
    });
    await expect(
      database().query("update idempotency_keys set status = 'pending' where id = $1", [
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database().query(
        "update idempotency_keys set expires_at = created_at + interval '23 hours' where id = $1",
        [IDEMPOTENCY_KEY_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_timestamps_check" });
    await expect(
      database().query(
        "update idempotency_keys set resource_type = 'conversation', resource_id = null where id = $1",
        [IDEMPOTENCY_KEY_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "idempotency_keys_resource_shape_check",
    });
    await expect(
      database().query("update idempotency_keys set status = 'succeeded' where id = $1", [
        IDEMPOTENCY_KEY_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_lifecycle_check" });

    await insertIdempotencyKey(IDEMPOTENCY_KEY_B, ORGANIZATION_A, {
      keyHash: Buffer.from("synthetic-idempotency-key-hash-b"),
    });
    await expect(
      database().query("update idempotency_keys set response_status = 99 where id = $1", [
        IDEMPOTENCY_KEY_B,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "idempotency_keys_response_status_check",
    });
    await expect(
      database().query("update idempotency_keys set response_ciphertext = $1 where id = $2", [
        Buffer.alloc(0),
        IDEMPOTENCY_KEY_B,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "idempotency_keys_response_ciphertext_check",
    });
    await expect(
      database().query(
        "update idempotency_keys set completed_at = created_at - interval '1 second' where id = $1",
        [IDEMPOTENCY_KEY_B],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "idempotency_keys_timestamps_check" });
  });

  it("aligns outbox event names, versions, aggregate provenance, and immutable semantics", async () => {
    await insertOrganization(ORGANIZATION_A, "outbox-contracts");
    let eventVariantCount = 0;

    for (const eventName of DOMAIN_EVENT_NAMES) {
      const schemas = DomainEventSchemasByVersion[eventName];
      for (const [schemaVersion, eventSchema] of Object.entries(schemas)) {
        const properties = readObjectProperty(eventSchema, "properties");
        const aggregateType = readObjectProperty(
          readObjectProperty(properties, "aggregate_type"),
          "const",
        );
        if (!isDomainAggregateType(aggregateType)) {
          throw new Error(`Missing canonical aggregate type for ${eventName}`);
        }
        expect(readObjectProperty(eventSchema, "$id")).toMatch(
          new RegExp(`DomainEvent\\.v${schemaVersion}$`),
        );
        await insertOutboxEvent(syntheticUuid(0xb00 + eventVariantCount), ORGANIZATION_A, {
          aggregateId: syntheticUuid(0xc00 + eventVariantCount),
          aggregateType,
          eventType: eventName,
          schemaVersion,
        });
        eventVariantCount += 1;
      }
    }

    expect(eventVariantCount).toBe(64);
    const persistedCount = await database().query<{ count: number }>(
      "select count(*)::integer as count from outbox_events",
    );
    expect(persistedCount.rows[0]?.count).toBe(64);

    await expect(
      insertOutboxEvent(syntheticUuid(0xd00), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd01),
        aggregateType: "lead",
        eventType: "unknown.event",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_event_aggregate_check",
    });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd02), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd03),
        aggregateType: "conversation",
        eventType: "lead.created",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_event_aggregate_check",
    });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd04), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd05),
        aggregateType: "lead",
        eventType: "lead.created",
        schemaVersion: "2",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_schema_version_check",
    });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd06), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd07),
        aggregateType: "lead",
        eventType: "lead.created",
        payload: [],
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "outbox_events_payload_check" });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd09), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd0a),
        aggregateType: "lead",
        aggregateVersion: 0,
        eventType: "lead.created",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_aggregate_version_check",
    });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd0b), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xd0c),
        aggregateType: "lead",
        causationId: UUID_V4,
        eventType: "lead.created",
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_causation_uuid_v7_check",
    });

    const immutableEventId = syntheticUuid(0xb00);
    await expect(
      database().query(
        "update outbox_events set payload_jsonb = '{\"changed\":true}' where id = $1",
        [immutableEventId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_semantic_immutability_check",
    });
    await expect(
      insertOutboxEvent(syntheticUuid(0xd08), ORGANIZATION_A, {
        aggregateId: syntheticUuid(0xc00),
        aggregateType: "organization",
        eventType: "organization.created",
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "outbox_events_aggregate_version_event_unique",
    });
  });

  it("enforces outbox delivery envelopes and Notification same-tenant provenance", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "outbox-a", "outbox-a", "outbox-a");
    await seedWorkflowTenant(WORKFLOW_B, "outbox-b", "outbox-b", "outbox-b");
    await insertOutboxEvent(OUTBOX_EVENT_A, ORGANIZATION_A, {
      aggregateId: HANDOFF_A,
      aggregateType: "handoff",
      causationId: CAUSATION_A,
      eventType: "handoff.requested",
    });
    await insertOutboxEvent(OUTBOX_EVENT_B, ORGANIZATION_B, {
      aggregateId: HANDOFF_B,
      aggregateType: "handoff",
      eventType: "handoff.requested",
    });

    await database().query(
      `update outbox_events
          set status = 'processing', attempt_count = 1,
              locked_by = 'worker:test-1',
              locked_until = timestamptz '2026-01-01 00:20:00+00'
        where id = $1`,
      [OUTBOX_EVENT_A],
    );
    await database().query(
      `update outbox_events
          set status = 'published', locked_by = null, locked_until = null,
              published_at = timestamptz '2026-01-01 00:21:00+00'
        where id = $1`,
      [OUTBOX_EVENT_A],
    );
    await expect(
      database().query("update outbox_events set status = 'unknown' where id = $1", [
        OUTBOX_EVENT_A,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database().query("update outbox_events set attempt_count = -1 where id = $1", [
        OUTBOX_EVENT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_attempt_count_check",
    });
    await expect(
      database().query("update outbox_events set causation_id = $1 where id = $2", [
        UUID_V4,
        OUTBOX_EVENT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "outbox_events_semantic_immutability_check",
    });

    await insertOutboxEvent(syntheticUuid(0xd10), ORGANIZATION_A);
    await expect(
      database().query("update outbox_events set locked_by = 'worker:test-2' where id = $1", [
        syntheticUuid(0xd10),
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "outbox_events_lifecycle_check" });
    await insertOutboxEvent(syntheticUuid(0xd11), ORGANIZATION_A, { status: "dead_lettered" });
    await expect(
      database().query("update outbox_events set last_error_category = null where id = $1", [
        syntheticUuid(0xd11),
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "outbox_events_lifecycle_check" });

    await insertNotification(NOTIFICATION_A, ORGANIZATION_A, {
      originatingOutboxEventId: OUTBOX_EVENT_A,
      recipientMembershipId: MEMBERSHIP_A,
      relatedResourceId: HANDOFF_A,
    });
    await expect(
      insertNotification(NOTIFICATION_B, ORGANIZATION_A, {
        dedupeKey: "cross-tenant-outbox-notification",
        originatingOutboxEventId: OUTBOX_EVENT_B,
        recipientMembershipId: MEMBERSHIP_A,
        relatedResourceId: HANDOFF_A,
      }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_originating_outbox_event_fk",
    });
    await expect(
      database().query("delete from outbox_events where id = $1", [OUTBOX_EVENT_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "notifications_originating_outbox_event_fk",
    });

    const forbiddenColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'outbox_events'
          and column_name in ('access_token', 'authorization_header', 'cookie',
                              'raw_message', 'raw_prompt', 'provider_credentials')`,
    );
    expect(forbiddenColumns.rows).toEqual([]);
  });

  it("persists minimized tenant audit evidence and rejects mutation or cross-tenant actors", async () => {
    await insertOrganization(ORGANIZATION_A, "audit-a");
    await insertOrganization(ORGANIZATION_B, "audit-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertAuditEvent(AUDIT_EVENT_A, ORGANIZATION_A, {
      actorId: USER_A,
      actorMembershipId: MEMBERSHIP_A,
      actorType: "member",
    });

    const stored = await database().query<{
      actor_type: string;
      metadata_type: string;
      source_ip_prefix: string;
    }>(
      `select actor_type, source_ip_prefix::text,
              jsonb_typeof(metadata_redacted_jsonb) as metadata_type
         from audit_events where id = $1`,
      [AUDIT_EVENT_A],
    );
    expect(stored.rows[0]).toEqual({
      actor_type: "member",
      metadata_type: "object",
      source_ip_prefix: "192.0.2.0/24",
    });

    await expect(
      insertAuditEvent(AUDIT_EVENT_B, ORGANIZATION_A, {
        actorId: USER_B,
        actorMembershipId: MEMBERSHIP_B,
        actorType: "member",
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "audit_events_actor_membership_fk" });
    await expect(
      database().query("update audit_events set action = 'conversation.export' where id = $1", [
        AUDIT_EVENT_A,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_events_immutability_check" });
    await expect(
      insertAuditEvent(AUDIT_EVENT_B, ORGANIZATION_A, {
        metadata: ["not", "allowlisted", "object"],
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_events_metadata_check" });
    await expect(
      insertAuditEvent(AUDIT_EVENT_B, ORGANIZATION_A, { sourceIpPrefix: "192.0.2.1/32" }),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_events_source_ip_prefix_check" });
    await expect(
      database().query("delete from memberships where id = $1", [MEMBERSHIP_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "audit_events_actor_membership_fk",
    });
  });

  it("keeps global platform audit evidence separate from tenant audit records", async () => {
    await insertOrganization(ORGANIZATION_A, "platform-audit");
    await insertPlatformAuditEvent(PLATFORM_AUDIT_EVENT_A, null);
    await insertPlatformAuditEvent(syntheticUuid(0xe01), ORGANIZATION_A);

    const contexts = await database().query<{ target_organization_id: string | null }>(
      "select target_organization_id from platform_audit_events order by target_organization_id nulls first",
    );
    expect(contexts.rows).toEqual([
      { target_organization_id: null },
      { target_organization_id: ORGANIZATION_A },
    ]);

    await expect(
      insertPlatformAuditEvent(syntheticUuid(0xe02), UNKNOWN_ORGANIZATION),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "platform_audit_events_target_organization_fk",
    });
    await expect(
      database().query("update platform_audit_events set reason_code = 'rewritten' where id = $1", [
        PLATFORM_AUDIT_EVENT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "platform_audit_events_immutability_check",
    });
    await expect(
      insertPlatformAuditEvent(syntheticUuid(0xe03), null, ["not-an-object"]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "platform_audit_events_metadata_check",
    });

    const forbiddenPlatformColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'platform_audit_events'
          and column_name in ('organization_id', 'actor_type', 'actor_membership_id',
                              'support_grant_secret', 'impersonated_user_id')`,
    );
    expect(forbiddenPlatformColumns.rows).toEqual([]);
    await expect(
      database().query("delete from organizations where id = $1", [ORGANIZATION_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "platform_audit_events_target_organization_fk",
    });
  });

  it("preserves privacy request provenance and tenant-safe unresolved-subject lifecycle state", async () => {
    await insertOrganization(ORGANIZATION_A, "privacy-a");
    await insertOrganization(ORGANIZATION_B, "privacy-b");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertActiveMembership(MEMBERSHIP_A, ORGANIZATION_A, USER_A);
    await insertActiveMembership(MEMBERSHIP_B, ORGANIZATION_B, USER_B);
    await insertContact(CONTACT_A, ORGANIZATION_A);
    await insertContact(CONTACT_B, ORGANIZATION_B);

    await insertPrivacyRequest(PRIVACY_REQUEST_A, ORGANIZATION_A, null);
    await database().query(
      `update privacy_requests
          set contact_id = $1, handled_by_membership_id = $2,
              status = 'completed', verified_at = timestamptz '2026-01-02 00:00:00+00',
              completed_at = timestamptz '2026-01-03 00:00:00+00',
              updated_at = now(), version = version + 1
        where id = $3`,
      [CONTACT_A, MEMBERSHIP_A, PRIVACY_REQUEST_A],
    );
    const completed = await database().query<{
      contact_id: string;
      details_type: string;
      status: string;
    }>(
      `select contact_id, status,
              pg_typeof(request_details_ciphertext)::text as details_type
         from privacy_requests where id = $1`,
      [PRIVACY_REQUEST_A],
    );
    expect(completed.rows[0]).toEqual({
      contact_id: CONTACT_A,
      details_type: "bytea",
      status: "completed",
    });

    await expect(
      insertPrivacyRequest(PRIVACY_REQUEST_B, ORGANIZATION_A, CONTACT_B),
    ).rejects.toMatchObject({ code: "23503", constraint: "privacy_requests_contact_fk" });
    await expect(
      insertPrivacyRequest(PRIVACY_REQUEST_B, ORGANIZATION_A, null, MEMBERSHIP_B),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "privacy_requests_handler_membership_fk",
    });
    await expect(
      database().query(
        "update privacy_requests set request_details_ciphertext = $1 where id = $2",
        [Buffer.from("rewritten-sensitive-evidence"), PRIVACY_REQUEST_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "privacy_requests_provenance_immutability_check",
    });
    await expect(
      database().query("update privacy_requests set contact_id = $1 where id = $2", [
        CONTACT_B,
        PRIVACY_REQUEST_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "privacy_requests_provenance_immutability_check",
    });
    await expect(
      database().query("update privacy_requests set due_at = requested_at - interval '1 day'"),
    ).rejects.toMatchObject({ code: "23514", constraint: "privacy_requests_timestamps_check" });
    await expect(
      database().query("delete from contacts where id = $1", [CONTACT_A]),
    ).rejects.toMatchObject({ code: "23503", constraint: "privacy_requests_contact_fk" });
  });

  it("enforces legal-hold shape, unique active scope, terminal release, and durable provenance", async () => {
    await insertOrganization(ORGANIZATION_A, "legal-hold-a");
    await insertUser(USER_A);
    await insertUser(USER_B);
    await insertLegalHold(
      LEGAL_HOLD_A,
      ORGANIZATION_A,
      USER_A,
      "data_class",
      null,
      "conversation_content",
    );

    await expect(
      insertLegalHold(
        LEGAL_HOLD_B,
        ORGANIZATION_A,
        USER_A,
        "data_class",
        null,
        "conversation_content",
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "legal_holds_equivalent_active_unique" });
    await database().query(
      `update legal_holds
          set status = 'released', released_by_user_id = $1,
              released_at = timestamptz '2026-01-02 00:12:00+00'
        where id = $2`,
      [USER_B, LEGAL_HOLD_A],
    );
    await expect(
      insertLegalHold(
        LEGAL_HOLD_B,
        ORGANIZATION_A,
        USER_A,
        "data_class",
        null,
        "conversation_content",
      ),
    ).resolves.toBeUndefined();
    await expect(
      database().query(
        "update legal_holds set status = 'active', released_by_user_id = null, released_at = null where id = $1",
        [LEGAL_HOLD_A],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "legal_holds_release_immutability_check",
    });
    await expect(
      database().query(
        `insert into legal_holds
          (id, organization_id, scope_type, scope_id, data_class, status,
           reason_ciphertext, placed_by_user_id, placed_at, approval_reference)
         values ($1, $2, 'organization', $3, null, 'active', $4, $5, now(), 'legal:test-002')`,
        [syntheticUuid(0xe04), ORGANIZATION_A, CONTACT_A, Buffer.from("protected"), USER_A],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "legal_holds_scope_check" });
    await expect(
      database().query("delete from users where id = $1", [USER_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "legal_holds_placed_by_user_id_users_id_fk",
    });
    await expect(
      database().query("delete from organizations where id = $1", [ORGANIZATION_A]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "legal_holds_organization_id_organizations_id_fk",
    });
  });

  it("projects canonical, idempotent, privacy-minimized analytics facts with tenant-safe subjects", async () => {
    await seedWorkflowTenant(WORKFLOW_A, "analytics-a", "analytics-a", "analytics-a");
    await seedWorkflowTenant(WORKFLOW_B, "analytics-b", "analytics-b", "analytics-b");
    const isolatedAnalyticsOrganizationId = syntheticUuid(0x1300);
    await insertOrganization(isolatedAnalyticsOrganizationId, "analytics-isolated");
    await insertAnalyticsEvent(syntheticUuid(0x1301), isolatedAnalyticsOrganizationId, {
      sourceEventId: syntheticUuid(0x1302),
    });
    let eventVariantCount = 0;

    for (const eventName of DOMAIN_EVENT_NAMES) {
      for (const schemaVersion of Object.keys(DomainEventSchemasByVersion[eventName])) {
        await insertAnalyticsEvent(syntheticUuid(0x1000 + eventVariantCount), ORGANIZATION_A, {
          eventType: eventName,
          schemaVersion,
          sourceEventId: syntheticUuid(0x1100 + eventVariantCount),
        });
        eventVariantCount += 1;
      }
    }
    expect(eventVariantCount).toBe(64);

    await insertAnalyticsEvent(ANALYTICS_EVENT_A, ORGANIZATION_A, {
      campaignKey: "consented_campaign",
      conversationId: CONVERSATION_A,
      dimensions: { channel_group: "owned", funnel_step: "conversation_started" },
      leadId: LEAD_A,
      sourceEventId: syntheticUuid(0x1200),
    });
    await expect(
      insertAnalyticsEvent(ANALYTICS_EVENT_B, ORGANIZATION_A, {
        leadId: LEAD_B,
        sourceEventId: syntheticUuid(0x1201),
      }),
    ).rejects.toMatchObject({ code: "23503", constraint: "analytics_events_lead_fk" });
    await expect(
      insertAnalyticsEvent(ANALYTICS_EVENT_B, ORGANIZATION_A, {
        eventType: "conversation.started",
        sourceEventId: syntheticUuid(0x1200),
      }),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "analytics_events_source_projection_unique",
    });
    await database().query(
      `update analytics_events
          set lead_id = null, conversation_id = null, campaign_key = null,
              dimensions_jsonb = '{"funnel_step":"conversation_started"}'::jsonb
        where id = $1`,
      [ANALYTICS_EVENT_A],
    );
    await expect(
      database().query("update analytics_events set lead_id = $1 where id = $2", [
        LEAD_A,
        ANALYTICS_EVENT_A,
      ]),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "analytics_events_semantic_immutability_check",
    });
    await expect(
      insertAnalyticsEvent(ANALYTICS_EVENT_B, ORGANIZATION_A, {
        dimensions: ["raw", "telemetry"],
        sourceEventId: syntheticUuid(0x1202),
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "analytics_events_dimensions_check" });

    const prohibitedAnalyticsColumns = await database().query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'analytics_events'
          and column_name in ('email', 'phone', 'customer_name', 'message_body',
                              'conversation_transcript', 'ip_address', 'user_agent',
                              'browser_fingerprint', 'advertising_id', 'raw_payload',
                              'revenue_amount', 'attendance_outcome')`,
    );
    expect(prohibitedAnalyticsColumns.rows).toEqual([]);
    await expect(
      database().query("delete from organizations where id = $1", [
        isolatedAnalyticsOrganizationId,
      ]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "analytics_events_organization_id_organizations_id_fk",
    });
  });
});
