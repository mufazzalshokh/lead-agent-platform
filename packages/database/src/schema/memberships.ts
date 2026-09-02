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

import { mutableColumns } from "./common.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    locationScope: varchar("location_scope", { length: 16 }).notNull(),
    invitedByUserId: uuid("invited_by_user_id"),
    invitedAt: timestamp("invited_at", {
      mode: "date",
      withTimezone: true,
    }),
    activatedAt: timestamp("activated_at", {
      mode: "date",
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", {
      mode: "date",
      withTimezone: true,
    }),
    ...mutableColumns(),
  },
  (table) => [
    check(
      "memberships_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("memberships_role_check", sql`${table.role} in ('owner', 'admin', 'staff', 'analyst')`),
    check(
      "memberships_status_check",
      sql`${table.status} in ('invited', 'active', 'suspended', 'revoked')`,
    ),
    check("memberships_location_scope_check", sql`${table.locationScope} in ('all', 'restricted')`),
    check(
      "memberships_lifecycle_timestamps_check",
      sql`(${table.status} <> 'invited' or ${table.invitedAt} is not null)
        and (${table.status} <> 'active' or ${table.activatedAt} is not null)
        and (${table.status} <> 'revoked' or ${table.revokedAt} is not null)`,
    ),
    check("memberships_version_check", sql`${table.version} > 0`),
    check("memberships_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "memberships_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "memberships_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.invitedByUserId],
      foreignColumns: [users.id],
      name: "memberships_invited_by_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("memberships_organization_id_user_id_unique").on(table.organizationId, table.userId),
    unique("memberships_organization_id_id_unique").on(table.organizationId, table.id),
    index("memberships_organization_status_role_idx").on(
      table.organizationId,
      table.status,
      table.role,
    ),
    index("memberships_user_status_idx").on(table.userId, table.status),
  ],
);
