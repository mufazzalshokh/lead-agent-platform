import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { binary, immutableCreatedAt, mutableColumns, type LocaleMap } from "./common.js";
import { memberships, organizations } from "./tenant-control.js";

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
  (table): PgTableExtraConfigValue[] => [
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
    foreignKey({
      columns: [table.organizationId, table.id, table.currentVersionId],
      foreignColumns: [
        locationVersions.organizationId,
        locationVersions.locationId,
        locationVersions.id,
      ],
      name: "locations_current_version_fk",
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

export const locationVersions = pgTable(
  "location_versions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    locationId: uuid("location_id").notNull(),
    versionNo: integer("version_no").notNull(),
    nameI18n: jsonb("name_i18n").$type<LocaleMap>().notNull(),
    addressI18n: jsonb("address_i18n").$type<LocaleMap>().notNull(),
    publicContact: jsonb("public_contact_jsonb").$type<Record<string, unknown>>().notNull(),
    timeZone: varchar("time_zone", { length: 255 }).notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }).notNull(),
    publishedByUserId: uuid("published_by_user_id").notNull(),
    contentHash: binary("content_hash").notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "location_versions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("location_versions_version_no_check", sql`${table.versionNo} > 0`),
    check("location_versions_name_i18n_check", sql`is_bounded_locale_map(${table.nameI18n}, 4000)`),
    check(
      "location_versions_address_i18n_check",
      sql`is_bounded_locale_map(${table.addressI18n}, 4000)`,
    ),
    check(
      "location_versions_public_contact_check",
      sql`jsonb_typeof(${table.publicContact}) = 'object'
        and pg_column_size(${table.publicContact}) <= 16384`,
    ),
    check(
      "location_versions_time_zone_check",
      sql`${table.timeZone} = btrim(${table.timeZone})
        and length(${table.timeZone}) between 1 and 255
        and (${table.timeZone} = 'UTC' or ${table.timeZone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone(${table.timeZone}, timestamptz '2000-01-01 00:00:00+00') is not null`,
    ),
    check(
      "location_versions_content_hash_check",
      sql`octet_length(${table.contentHash}) between 1 and 128`,
    ),
    check(
      "location_versions_publication_timestamps_check",
      sql`${table.publishedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "location_versions_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "location_versions_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("location_versions_organization_location_version_unique").on(
      table.organizationId,
      table.locationId,
      table.versionNo,
    ),
    unique("location_versions_organization_id_id_unique").on(table.organizationId, table.id),
    unique("location_versions_organization_location_id_unique").on(
      table.organizationId,
      table.locationId,
      table.id,
    ),
    index("location_versions_organization_location_version_idx").on(
      table.organizationId,
      table.locationId,
      table.versionNo.desc(),
    ),
  ],
);

export const locationBusinessHours = pgTable(
  "location_business_hours",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    locationVersionId: uuid("location_version_id").notNull(),
    dayOfWeek: smallint("day_of_week").notNull(),
    opensAtLocal: time("opens_at_local", { precision: 0 }).notNull(),
    closesAtLocal: time("closes_at_local", { precision: 0 }).notNull(),
    sequenceNo: smallint("sequence_no").notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "location_business_hours_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("location_business_hours_day_of_week_check", sql`${table.dayOfWeek} between 1 and 7`),
    check("location_business_hours_sequence_no_check", sql`${table.sequenceNo} > 0`),
    check(
      "location_business_hours_interval_check",
      sql`${table.opensAtLocal} < ${table.closesAtLocal}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.locationVersionId],
      foreignColumns: [locationVersions.organizationId, locationVersions.id],
      name: "location_business_hours_location_version_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("location_business_hours_schedule_unique").on(
      table.organizationId,
      table.locationVersionId,
      table.dayOfWeek,
      table.sequenceNo,
    ),
    unique("location_business_hours_organization_id_id_unique").on(table.organizationId, table.id),
    index("location_business_hours_organization_version_day_idx").on(
      table.organizationId,
      table.locationVersionId,
      table.dayOfWeek,
    ),
  ],
);

export const locationClosures = pgTable(
  "location_closures",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    locationId: uuid("location_id").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    opensAtLocal: time("opens_at_local", { precision: 0 }),
    closesAtLocal: time("closes_at_local", { precision: 0 }),
    reasonI18n: jsonb("reason_i18n").$type<LocaleMap>().notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    supersedesId: uuid("supersedes_id"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "location_closures_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("location_closures_kind_check", sql`${table.kind} in ('closed', 'override')`),
    check(
      "location_closures_interval_shape_check",
      sql`(${table.kind} = 'closed'
          and ${table.opensAtLocal} is null
          and ${table.closesAtLocal} is null)
        or (${table.kind} = 'override'
          and ${table.opensAtLocal} is not null
          and ${table.closesAtLocal} is not null
          and ${table.opensAtLocal} < ${table.closesAtLocal})`,
    ),
    check(
      "location_closures_reason_i18n_check",
      sql`is_bounded_locale_map(${table.reasonI18n}, 4000)`,
    ),
    check(
      "location_closures_status_check",
      sql`${table.status} in ('active', 'superseded', 'cancelled')`,
    ),
    check(
      "location_closures_supersedes_check",
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "location_closures_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId, table.supersedesId],
      foreignColumns: [table.organizationId, table.locationId, table.id],
      name: "location_closures_superseded_record_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "location_closures_creator_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("location_closures_organization_id_id_unique").on(table.organizationId, table.id),
    unique("location_closures_organization_location_id_unique").on(
      table.organizationId,
      table.locationId,
      table.id,
    ),
    uniqueIndex("location_closures_one_active_per_local_date_unique")
      .on(table.organizationId, table.locationId, table.localDate)
      .where(sql`${table.status} = 'active'`),
    index("location_closures_organization_location_date_idx").on(
      table.organizationId,
      table.locationId,
      table.localDate,
    ),
  ],
);
