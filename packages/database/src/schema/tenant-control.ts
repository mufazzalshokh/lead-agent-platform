import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { immutableCreatedAt, mutableColumns } from "./common.js";
import { users } from "./users.js";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey(),
    slug: varchar("slug", { length: 63 }).notNull().unique(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    defaultLocale: varchar("default_locale", { length: 2 }).notNull(),
    defaultTimeZone: varchar("default_time_zone", { length: 255 }).notNull(),
    currentRetentionPolicyId: uuid("current_retention_policy_id"),
    ...mutableColumns(),
    closedAt: timestamp("closed_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table): PgTableExtraConfigValue[] => [
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
    foreignKey({
      columns: [table.id, table.currentRetentionPolicyId],
      foreignColumns: [retentionPolicies.organizationId, retentionPolicies.id],
      name: "organizations_current_retention_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("organizations_status_idx").on(table.status),
  ],
);

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
    invitedAt: timestamp("invited_at", { mode: "date", withTimezone: true }),
    activatedAt: timestamp("activated_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
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

export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    versionNo: integer("version_no").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    jurisdictionProfile: varchar("jurisdiction_profile", { length: 128 }).notNull(),
    effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }),
    publishedByUserId: uuid("published_by_user_id"),
    approvedByUserId: uuid("approved_by_user_id"),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "retention_policies_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("retention_policies_version_no_check", sql`${table.versionNo} > 0`),
    check(
      "retention_policies_status_check",
      sql`${table.status} in ('draft', 'published', 'retired')`,
    ),
    check(
      "retention_policies_jurisdiction_profile_check",
      sql`${table.jurisdictionProfile} = lower(btrim(${table.jurisdictionProfile}))
        and ${table.jurisdictionProfile} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'`,
    ),
    check(
      "retention_policies_publication_check",
      sql`${table.status} = 'draft'
        or (${table.effectiveFrom} is not null
          and ${table.publishedByUserId} is not null
          and ${table.approvedByUserId} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "retention_policies_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "retention_policies_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.approvedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "retention_policies_approver_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("retention_policies_organization_id_version_no_unique").on(
      table.organizationId,
      table.versionNo,
    ),
    unique("retention_policies_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("retention_policies_one_published_per_organization_unique")
      .on(table.organizationId)
      .where(sql`${table.status} = 'published'`),
    index("retention_policies_organization_status_effective_from_idx").on(
      table.organizationId,
      table.status,
      table.effectiveFrom.desc(),
    ),
  ],
);
