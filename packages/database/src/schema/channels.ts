import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";

export const channelConnections = pgTable(
  "channel_connections",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    channelType: varchar("channel_type", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    providerAccountIdHash: binary("provider_account_id_hash"),
    credentialSecretRef: varchar("credential_secret_ref", { length: 512 }),
    webhookSecretHash: binary("webhook_secret_hash"),
    configuration: jsonb("configuration_jsonb")
      .default(sql`'{}'::jsonb`)
      .notNull(),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }),
    credentialVersion: integer("credential_version").default(1).notNull(),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "channel_connections_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "channel_connections_channel_type_check",
      sql`${table.channelType} in ('widget', 'telegram', 'instagram', 'whatsapp')`,
    ),
    check(
      "channel_connections_status_check",
      sql`${table.status} in ('pending', 'active', 'disabled', 'revoked')`,
    ),
    check(
      "channel_connections_display_name_check",
      sql`${table.displayName} = btrim(${table.displayName}) and length(${table.displayName}) between 1 and 200`,
    ),
    check(
      "channel_connections_provider_account_hash_check",
      sql`${table.providerAccountIdHash} is null or octet_length(${table.providerAccountIdHash}) between 16 and 128`,
    ),
    check(
      "channel_connections_credential_secret_ref_check",
      sql`${table.credentialSecretRef} is null
        or (${table.credentialSecretRef} = btrim(${table.credentialSecretRef})
          and length(${table.credentialSecretRef}) between 6 and 512
          and ${table.credentialSecretRef} ~ '^[a-z][a-z0-9+.-]{1,31}://[^[:space:]]+$')`,
    ),
    check(
      "channel_connections_webhook_secret_hash_check",
      sql`${table.webhookSecretHash} is null or octet_length(${table.webhookSecretHash}) between 16 and 128`,
    ),
    check(
      "channel_connections_configuration_check",
      sql`jsonb_typeof(${table.configuration}) = 'object'
        and pg_column_size(${table.configuration}) <= 65536`,
    ),
    check("channel_connections_credential_version_check", sql`${table.credentialVersion} > 0`),
    check("channel_connections_version_check", sql`${table.version} > 0`),
    check("channel_connections_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "channel_connections_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("channel_connections_organization_id_id_unique").on(table.organizationId, table.id),
    unique("channel_connections_organization_type_provider_unique").on(
      table.organizationId,
      table.channelType,
      table.providerAccountIdHash,
    ),
    uniqueIndex("channel_connections_organization_display_name_unique").on(
      table.organizationId,
      sql`lower(${table.displayName})`,
    ),
    index("channel_connections_organization_type_status_idx").on(
      table.organizationId,
      table.channelType,
      table.status,
    ),
  ],
);

export const widgetAllowedOrigins = pgTable(
  "widget_allowed_origins",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    matchType: varchar("match_type", { length: 24 }).notNull(),
    scheme: varchar("scheme", { length: 8 }).notNull(),
    normalizedHost: varchar("normalized_host", { length: 253 }).notNull(),
    port: integer("port"),
    status: varchar("status", { length: 16 }).notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "widget_allowed_origins_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "widget_allowed_origins_match_type_check",
      sql`${table.matchType} in ('exact', 'subdomain_wildcard')`,
    ),
    check("widget_allowed_origins_scheme_check", sql`${table.scheme} = 'https'`),
    check(
      "widget_allowed_origins_host_check",
      sql`${table.normalizedHost} = lower(btrim(${table.normalizedHost}))
        and length(${table.normalizedHost}) between 3 and 253
        and ${table.normalizedHost} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'`,
    ),
    check(
      "widget_allowed_origins_port_check",
      sql`${table.port} is null or (${table.port} between 1 and 65535 and ${table.port} <> 443)`,
    ),
    check(
      "widget_allowed_origins_wildcard_port_check",
      sql`${table.matchType} <> 'subdomain_wildcard' or ${table.port} is null`,
    ),
    check("widget_allowed_origins_status_check", sql`${table.status} in ('active', 'disabled')`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "widget_allowed_origins_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "widget_allowed_origins_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "widget_allowed_origins_creator_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("widget_allowed_origins_organization_id_id_unique").on(table.organizationId, table.id),
    unique("widget_allowed_origins_connection_id_id_unique").on(
      table.organizationId,
      table.channelConnectionId,
      table.id,
    ),
    uniqueIndex("widget_allowed_origins_canonical_origin_unique").on(
      table.organizationId,
      table.channelConnectionId,
      table.matchType,
      table.scheme,
      table.normalizedHost,
      sql`coalesce(${table.port}, 0)`,
    ),
    index("widget_allowed_origins_organization_status_idx").on(table.organizationId, table.status),
  ],
);

export const widgetSessions = pgTable(
  "widget_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    widgetAllowedOriginId: uuid("widget_allowed_origin_id").notNull(),
    sessionTokenJtiHash: binary("session_token_jti_hash").notNull(),
    participantLookupHash: binary("participant_lookup_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    requestedLocale: varchar("requested_locale", { length: 2 }).notNull(),
    contactId: uuid("contact_id"),
    conversationId: uuid("conversation_id"),
    issuedAt: timestamp("issued_at", { mode: "date", withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revocationReason: varchar("revocation_reason", { length: 500 }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "widget_sessions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "widget_sessions_contact_uuid_v7_check",
      sql`${table.contactId} is null or ${table.contactId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "widget_sessions_conversation_uuid_v7_check",
      sql`${table.conversationId} is null or ${table.conversationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "widget_sessions_session_token_hash_check",
      sql`octet_length(${table.sessionTokenJtiHash}) between 16 and 128`,
    ),
    check(
      "widget_sessions_participant_lookup_hash_check",
      sql`octet_length(${table.participantLookupHash}) between 16 and 128`,
    ),
    check("widget_sessions_status_check", sql`${table.status} in ('active', 'expired', 'revoked')`),
    check(
      "widget_sessions_requested_locale_check",
      sql`${table.requestedLocale} in ('uz', 'ru', 'en')`,
    ),
    check(
      "widget_sessions_lifetime_check",
      sql`${table.expiresAt} > ${table.issuedAt}
        and ${table.lastSeenAt} >= ${table.issuedAt}
        and ${table.lastSeenAt} < ${table.expiresAt}`,
    ),
    check(
      "widget_sessions_revocation_check",
      sql`(${table.status} = 'revoked'
          and ${table.revokedAt} is not null
          and ${table.revokedAt} >= ${table.issuedAt}
          and ${table.revokedAt} < ${table.expiresAt})
        or (${table.status} <> 'revoked' and ${table.revokedAt} is null)`,
    ),
    check(
      "widget_sessions_revocation_reason_check",
      sql`${table.revocationReason} is null
        or (${table.status} = 'revoked'
          and ${table.revocationReason} = btrim(${table.revocationReason})
          and length(${table.revocationReason}) between 1 and 500)`,
    ),
    check("widget_sessions_version_check", sql`${table.version} > 0`),
    check("widget_sessions_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "widget_sessions_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "widget_sessions_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "widget_sessions_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId, table.widgetAllowedOriginId],
      foreignColumns: [
        widgetAllowedOrigins.organizationId,
        widgetAllowedOrigins.channelConnectionId,
        widgetAllowedOrigins.id,
      ],
      name: "widget_sessions_allowed_origin_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("widget_sessions_organization_id_id_unique").on(table.organizationId, table.id),
    unique("widget_sessions_organization_jti_hash_unique").on(
      table.organizationId,
      table.sessionTokenJtiHash,
    ),
    uniqueIndex("widget_sessions_one_active_participant_unique")
      .on(table.organizationId, table.channelConnectionId, table.participantLookupHash)
      .where(sql`${table.status} = 'active'`),
    index("widget_sessions_organization_status_expiry_idx").on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
    index("widget_sessions_organization_conversation_idx").on(
      table.organizationId,
      table.conversationId,
    ),
    index("widget_sessions_organization_connection_idx").on(
      table.organizationId,
      table.channelConnectionId,
    ),
  ],
);
