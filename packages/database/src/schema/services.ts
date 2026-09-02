import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import {
  binary,
  immutableCreatedAt,
  mutableColumns,
  searchVector,
  type LocaleMap,
} from "./common.js";
import { locations } from "./locations.js";
import { memberships, organizations } from "./tenant-control.js";

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    currentVersionId: uuid("current_version_id"),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "services_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "services_code_normalized_check",
      sql`${table.code} = lower(btrim(${table.code})) and ${table.code} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("services_status_check", sql`${table.status} in ('active', 'inactive')`),
    check("services_version_check", sql`${table.version} > 0`),
    check("services_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "services_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.id, table.currentVersionId],
      foreignColumns: [
        serviceVersions.organizationId,
        serviceVersions.serviceId,
        serviceVersions.id,
      ],
      name: "services_current_version_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("services_organization_id_code_unique").on(table.organizationId, table.code),
    unique("services_organization_id_id_unique").on(table.organizationId, table.id),
    index("services_organization_status_code_idx").on(
      table.organizationId,
      table.status,
      table.code,
    ),
  ],
);

export const serviceVersions = pgTable(
  "service_versions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    versionNo: integer("version_no").notNull(),
    nameI18n: jsonb("name_i18n").$type<LocaleMap>().notNull(),
    descriptionI18n: jsonb("description_i18n").$type<LocaleMap>().notNull(),
    durationGuidanceMinutes: integer("duration_guidance_minutes"),
    disclaimerI18n: jsonb("disclaimer_i18n").$type<LocaleMap>().notNull(),
    searchVectorUz: searchVector("search_vector_uz")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("name_i18n" ->> 'uz', '') || ' ' || coalesce("description_i18n" ->> 'uz', ''))`,
      )
      .notNull(),
    searchVectorRu: searchVector("search_vector_ru")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("name_i18n" ->> 'ru', '') || ' ' || coalesce("description_i18n" ->> 'ru', ''))`,
      )
      .notNull(),
    searchVectorEn: searchVector("search_vector_en")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("name_i18n" ->> 'en', '') || ' ' || coalesce("description_i18n" ->> 'en', ''))`,
      )
      .notNull(),
    contentHash: binary("content_hash").notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }).notNull(),
    publishedByUserId: uuid("published_by_user_id").notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "service_versions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("service_versions_version_no_check", sql`${table.versionNo} > 0`),
    check("service_versions_name_i18n_check", sql`is_bounded_locale_map(${table.nameI18n}, 4000)`),
    check(
      "service_versions_description_i18n_check",
      sql`is_bounded_locale_map(${table.descriptionI18n}, 4000)`,
    ),
    check(
      "service_versions_disclaimer_i18n_check",
      sql`is_bounded_locale_map(${table.disclaimerI18n}, 4000)`,
    ),
    check(
      "service_versions_duration_guidance_check",
      sql`${table.durationGuidanceMinutes} is null or ${table.durationGuidanceMinutes} > 0`,
    ),
    check(
      "service_versions_content_hash_check",
      sql`octet_length(${table.contentHash}) between 1 and 128`,
    ),
    check(
      "service_versions_publication_timestamps_check",
      sql`${table.publishedAt} >= ${table.createdAt}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "service_versions_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "service_versions_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("service_versions_organization_service_version_unique").on(
      table.organizationId,
      table.serviceId,
      table.versionNo,
    ),
    unique("service_versions_organization_id_id_unique").on(table.organizationId, table.id),
    unique("service_versions_organization_service_id_unique").on(
      table.organizationId,
      table.serviceId,
      table.id,
    ),
    index("service_versions_organization_service_version_idx").on(
      table.organizationId,
      table.serviceId,
      table.versionNo.desc(),
    ),
    index("service_versions_search_vector_uz_idx").using("gin", table.searchVectorUz),
    index("service_versions_search_vector_ru_idx").using("gin", table.searchVectorRu),
    index("service_versions_search_vector_en_idx").using("gin", table.searchVectorEn),
  ],
);

export const serviceLocations = pgTable(
  "service_locations",
  {
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { mode: "date", withTimezone: true }),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("service_locations_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "service_locations_effective_interval_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "service_locations_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "service_locations_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    primaryKey({
      columns: [table.organizationId, table.serviceId, table.locationId, table.effectiveFrom],
      name: "service_locations_pk",
    }),
    index("service_locations_organization_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
    ),
    index("service_locations_organization_service_status_idx").on(
      table.organizationId,
      table.serviceId,
      table.status,
    ),
  ],
);

export const servicePrices = pgTable(
  "service_prices",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    locationId: uuid("location_id"),
    priceType: varchar("price_type", { length: 16 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    minAmountMinor: bigint("min_amount_minor", { mode: "bigint" }),
    maxAmountMinor: bigint("max_amount_minor", { mode: "bigint" }),
    displayTextI18n: jsonb("display_text_i18n").$type<LocaleMap>().notNull(),
    effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }),
    effectiveTo: timestamp("effective_to", { mode: "date", withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull(),
    versionNo: integer("version_no").notNull(),
    publishedByUserId: uuid("published_by_user_id"),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "service_prices_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "service_prices_price_type_check",
      sql`${table.priceType} in ('fixed', 'from', 'range', 'quote_required')`,
    ),
    check("service_prices_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "service_prices_amount_shape_check",
      sql`(${table.priceType} = 'fixed'
          and ${table.minAmountMinor} is not null
          and ${table.maxAmountMinor} = ${table.minAmountMinor}
          and ${table.minAmountMinor} >= 0)
        or (${table.priceType} = 'from'
          and ${table.minAmountMinor} is not null
          and ${table.minAmountMinor} >= 0
          and ${table.maxAmountMinor} is null)
        or (${table.priceType} = 'range'
          and ${table.minAmountMinor} is not null
          and ${table.maxAmountMinor} is not null
          and ${table.minAmountMinor} >= 0
          and ${table.maxAmountMinor} >= ${table.minAmountMinor})
        or (${table.priceType} = 'quote_required'
          and ${table.minAmountMinor} is null
          and ${table.maxAmountMinor} is null)`,
    ),
    check(
      "service_prices_display_text_i18n_check",
      sql`is_bounded_locale_map(${table.displayTextI18n}, 4000)`,
    ),
    check("service_prices_status_check", sql`${table.status} in ('draft', 'published', 'retired')`),
    check("service_prices_version_no_check", sql`${table.versionNo} > 0`),
    check(
      "service_prices_effective_interval_check",
      sql`${table.effectiveTo} is null
        or (${table.effectiveFrom} is not null and ${table.effectiveTo} > ${table.effectiveFrom})`,
    ),
    check(
      "service_prices_publication_check",
      sql`${table.status} = 'draft'
        or (${table.effectiveFrom} is not null and ${table.publishedByUserId} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "service_prices_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "service_prices_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "service_prices_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("service_prices_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("service_prices_scope_currency_version_unique").on(
      table.organizationId,
      table.serviceId,
      sql`coalesce(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.currency,
      table.versionNo,
    ),
    index("service_prices_org_service_location_status_effective_idx").on(
      table.organizationId,
      table.serviceId,
      table.locationId,
      table.status,
      table.effectiveFrom.desc(),
    ),
  ],
);

export const faqs = pgTable(
  "faqs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    faqKey: varchar("faq_key", { length: 128 }).notNull(),
    versionNo: integer("version_no").notNull(),
    serviceId: uuid("service_id"),
    locationId: uuid("location_id"),
    questionI18n: jsonb("question_i18n").$type<LocaleMap>().notNull(),
    answerI18n: jsonb("answer_i18n").$type<LocaleMap>().notNull(),
    searchVectorUz: searchVector("search_vector_uz")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("question_i18n" ->> 'uz', '') || ' ' || coalesce("answer_i18n" ->> 'uz', ''))`,
      )
      .notNull(),
    searchVectorRu: searchVector("search_vector_ru")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("question_i18n" ->> 'ru', '') || ' ' || coalesce("answer_i18n" ->> 'ru', ''))`,
      )
      .notNull(),
    searchVectorEn: searchVector("search_vector_en")
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce("question_i18n" ->> 'en', '') || ' ' || coalesce("answer_i18n" ->> 'en', ''))`,
      )
      .notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }),
    effectiveTo: timestamp("effective_to", { mode: "date", withTimezone: true }),
    contentHash: binary("content_hash").notNull(),
    publishedByUserId: uuid("published_by_user_id"),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "faqs_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "faqs_key_normalized_check",
      sql`${table.faqKey} = lower(btrim(${table.faqKey}))
        and ${table.faqKey} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'`,
    ),
    check("faqs_version_no_check", sql`${table.versionNo} > 0`),
    check("faqs_question_i18n_check", sql`is_bounded_locale_map(${table.questionI18n}, 4000)`),
    check("faqs_answer_i18n_check", sql`is_bounded_locale_map(${table.answerI18n}, 4000)`),
    check("faqs_status_check", sql`${table.status} in ('draft', 'published', 'retired')`),
    check(
      "faqs_effective_interval_check",
      sql`${table.effectiveTo} is null
        or (${table.effectiveFrom} is not null and ${table.effectiveTo} > ${table.effectiveFrom})`,
    ),
    check("faqs_content_hash_check", sql`octet_length(${table.contentHash}) between 1 and 128`),
    check(
      "faqs_publication_check",
      sql`${table.status} = 'draft'
        or (${table.effectiveFrom} is not null and ${table.publishedByUserId} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "faqs_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "faqs_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "faqs_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("faqs_organization_key_version_unique").on(
      table.organizationId,
      table.faqKey,
      table.versionNo,
    ),
    unique("faqs_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("faqs_one_published_per_key_scope_unique")
      .on(
        table.organizationId,
        table.faqKey,
        sql`coalesce(${table.serviceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'published'`),
    index("faqs_organization_status_scope_effective_idx").on(
      table.organizationId,
      table.status,
      table.serviceId,
      table.locationId,
      table.effectiveFrom.desc(),
    ),
    index("faqs_search_vector_uz_idx").using("gin", table.searchVectorUz),
    index("faqs_search_vector_ru_idx").using("gin", table.searchVectorRu),
    index("faqs_search_vector_en_idx").using("gin", table.searchVectorEn),
  ],
);

export const businessPolicies = pgTable(
  "business_policies",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    policyKey: varchar("policy_key", { length: 128 }).notNull(),
    versionNo: integer("version_no").notNull(),
    policyType: varchar("policy_type", { length: 32 }).notNull(),
    schemaVersion: integer("schema_version").notNull(),
    rules: jsonb("rules_jsonb").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }),
    effectiveTo: timestamp("effective_to", { mode: "date", withTimezone: true }),
    contentHash: binary("content_hash").notNull(),
    publishedByUserId: uuid("published_by_user_id"),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "business_policies_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "business_policies_key_normalized_check",
      sql`${table.policyKey} = lower(btrim(${table.policyKey}))
        and ${table.policyKey} ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'`,
    ),
    check("business_policies_version_no_check", sql`${table.versionNo} > 0`),
    check(
      "business_policies_type_check",
      sql`${table.policyType} in ('qualification', 'booking', 'handoff', 'safety', 'consent')`,
    ),
    check("business_policies_schema_version_check", sql`${table.schemaVersion} > 0`),
    check(
      "business_policies_rules_check",
      sql`jsonb_typeof(${table.rules}) = 'object'
        and ${table.rules} <> '{}'::jsonb
        and pg_column_size(${table.rules}) <= 65536`,
    ),
    check(
      "business_policies_status_check",
      sql`${table.status} in ('draft', 'published', 'retired')`,
    ),
    check(
      "business_policies_effective_interval_check",
      sql`${table.effectiveTo} is null
        or (${table.effectiveFrom} is not null and ${table.effectiveTo} > ${table.effectiveFrom})`,
    ),
    check(
      "business_policies_content_hash_check",
      sql`octet_length(${table.contentHash}) between 1 and 128`,
    ),
    check(
      "business_policies_publication_check",
      sql`${table.status} = 'draft'
        or (${table.effectiveFrom} is not null and ${table.publishedByUserId} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "business_policies_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.publishedByUserId],
      foreignColumns: [memberships.organizationId, memberships.userId],
      name: "business_policies_publisher_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("business_policies_organization_key_version_unique").on(
      table.organizationId,
      table.policyKey,
      table.versionNo,
    ),
    unique("business_policies_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("business_policies_one_published_per_key_type_unique")
      .on(table.organizationId, table.policyKey, table.policyType)
      .where(sql`${table.status} = 'published'`),
    index("business_policies_organization_type_status_effective_idx").on(
      table.organizationId,
      table.policyType,
      table.status,
      table.effectiveFrom.desc(),
    ),
  ],
);
