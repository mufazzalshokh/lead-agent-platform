import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { mutableColumns } from "./common.js";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    slug: varchar("slug", { length: 63 }).notNull().unique(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    defaultLocale: varchar("default_locale", { length: 2 }).notNull(),
    defaultTimeZone: varchar("default_time_zone", { length: 255 }).notNull(),
    // The same-tenant FK is added in S4b when retention_policies exists.
    currentRetentionPolicyId: uuid("current_retention_policy_id"),
    ...mutableColumns(),
    closedAt: timestamp("closed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    check(
      "organizations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "organizations_slug_normalized_check",
      sql`${table.slug} = lower(btrim(${table.slug})) and ${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "organizations_display_name_check",
      sql`length(btrim(${table.displayName})) between 1 and 200`,
    ),
    check("organizations_status_check", sql`${table.status} in ('active', 'suspended', 'closed')`),
    check("organizations_default_locale_check", sql`${table.defaultLocale} in ('uz', 'ru', 'en')`),
    check(
      "organizations_default_time_zone_check",
      sql`${table.defaultTimeZone} = btrim(${table.defaultTimeZone})
        and length(${table.defaultTimeZone}) between 1 and 255
        and (${table.defaultTimeZone} = 'UTC' or ${table.defaultTimeZone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone(${table.defaultTimeZone}, timestamptz '2000-01-01 00:00:00+00') is not null`,
    ),
    check(
      "organizations_retention_policy_uuid_v7_check",
      sql`${table.currentRetentionPolicyId} is null or ${table.currentRetentionPolicyId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("organizations_version_check", sql`${table.version} > 0`),
    check("organizations_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    check(
      "organizations_closed_at_check",
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null)`,
    ),
    index("organizations_status_idx").on(table.status),
  ],
);
