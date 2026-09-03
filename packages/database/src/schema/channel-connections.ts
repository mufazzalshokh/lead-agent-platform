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

import { binary, mutableColumns } from "./common.js";
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
