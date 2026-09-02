import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { mutableColumns } from "./common.js";
import { organizations } from "./organizations.js";

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    // The same-tenant FK is added in S4b when location_versions exists.
    currentVersionId: uuid("current_version_id"),
    ...mutableColumns(),
  },
  (table) => [
    check(
      "locations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "locations_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("locations_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "locations_current_version_uuid_v7_check",
      sql`${table.currentVersionId} is null or ${table.currentVersionId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("locations_version_check", sql`${table.version} > 0`),
    check("locations_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "locations_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("locations_organization_id_code_unique").on(table.organizationId, table.code),
    unique("locations_organization_id_id_unique").on(table.organizationId, table.id),
    index("locations_organization_status_code_idx").on(
      table.organizationId,
      table.status,
      table.code,
    ),
  ],
);
