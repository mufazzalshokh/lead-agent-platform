import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { binary, mutableColumns } from "./common.js";
import { organizations } from "./organizations.js";

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    displayNameCiphertext: binary("display_name_ciphertext"),
    preferredLocale: varchar("preferred_locale", { length: 2 }),
    status: varchar("status", { length: 16 }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).notNull(),
    anonymizedAt: timestamp("anonymized_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table) => [
    check(
      "contacts_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "contacts_display_name_ciphertext_check",
      sql`${table.displayNameCiphertext} is null or octet_length(${table.displayNameCiphertext}) between 1 and 8192`,
    ),
    check(
      "contacts_preferred_locale_check",
      sql`${table.preferredLocale} is null or ${table.preferredLocale} in ('uz', 'ru', 'en')`,
    ),
    check("contacts_status_check", sql`${table.status} in ('active', 'anonymized', 'blocked')`),
    check("contacts_seen_at_check", sql`${table.lastSeenAt} >= ${table.firstSeenAt}`),
    check(
      "contacts_anonymized_shape_check",
      sql`(${table.status} = 'anonymized') = (${table.anonymizedAt} is not null)
        and (${table.status} <> 'anonymized' or ${table.displayNameCiphertext} is null)`,
    ),
    check("contacts_version_check", sql`${table.version} > 0`),
    check("contacts_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "contacts_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("contacts_organization_id_id_unique").on(table.organizationId, table.id),
    index("contacts_organization_status_last_seen_idx").on(
      table.organizationId,
      table.status,
      table.lastSeenAt.desc(),
    ),
  ],
);
