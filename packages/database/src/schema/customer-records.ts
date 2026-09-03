import { sql } from "drizzle-orm";
import {
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

import { channelConnections } from "./channel-connections.js";
import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { conversations, messages } from "./conversation-records.js";
import { leads } from "./leads.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { businessPolicies } from "./services.js";

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    identityType: varchar("identity_type", { length: 32 }).notNull(),
    channelConnectionId: uuid("channel_connection_id"),
    valueCiphertext: binary("value_ciphertext"),
    lookupHash: binary("lookup_hash"),
    hashKeyVersion: integer("hash_key_version").default(1).notNull(),
    displayRedacted: varchar("display_redacted", { length: 255 }),
    validationStatus: varchar("validation_status", { length: 16 }).notNull(),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull(),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "contact_identities_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "contact_identities_identity_type_check",
      sql`${table.identityType} in ('widget_participant', 'telegram_user', 'phone', 'email')`,
    ),
    check(
      "contact_identities_value_ciphertext_check",
      sql`${table.valueCiphertext} is null or octet_length(${table.valueCiphertext}) between 1 and 8192`,
    ),
    check(
      "contact_identities_lookup_hash_check",
      sql`${table.lookupHash} is null or octet_length(${table.lookupHash}) between 16 and 128`,
    ),
    check("contact_identities_hash_key_version_check", sql`${table.hashKeyVersion} > 0`),
    check(
      "contact_identities_display_redacted_check",
      sql`${table.displayRedacted} is null
        or (${table.displayRedacted} = btrim(${table.displayRedacted})
          and length(${table.displayRedacted}) between 1 and 255)`,
    ),
    check(
      "contact_identities_validation_status_check",
      sql`${table.validationStatus} in ('unverified', 'valid', 'verified', 'invalid')`,
    ),
    check(
      "contact_identities_verification_check",
      sql`${table.validationStatus} <> 'verified' or ${table.verifiedAt} is not null`,
    ),
    check(
      "contact_identities_status_check",
      sql`${table.status} in ('active', 'withdrawn', 'anonymized')`,
    ),
    check(
      "contact_identities_anonymized_shape_check",
      sql`(${table.status} = 'anonymized'
          and ${table.valueCiphertext} is null
          and ${table.lookupHash} is null
          and ${table.displayRedacted} is null)
        or (${table.status} <> 'anonymized' and ${table.lookupHash} is not null)`,
    ),
    check("contact_identities_version_check", sql`${table.version} > 0`),
    check("contact_identities_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "contact_identities_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "contact_identities_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "contact_identities_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("contact_identities_organization_id_id_unique").on(table.organizationId, table.id),
    unique("contact_identities_contact_id_id_unique").on(
      table.organizationId,
      table.contactId,
      table.id,
    ),
    uniqueIndex("contact_identities_active_lookup_unique")
      .on(
        table.organizationId,
        table.identityType,
        sql`coalesce(${table.channelConnectionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.lookupHash,
      )
      .where(sql`${table.status} = 'active'`),
    index("contact_identities_organization_contact_status_idx").on(
      table.organizationId,
      table.contactId,
      table.status,
    ),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id"),
    conversationId: uuid("conversation_id"),
    contactIdentityId: uuid("contact_identity_id"),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    lawfulBasisCode: varchar("lawful_basis_code", { length: 100 }),
    noticeKey: varchar("notice_key", { length: 128 }).notNull(),
    noticeVersion: integer("notice_version").notNull(),
    policyUrl: varchar("policy_url", { length: 2048 }),
    locale: varchar("locale", { length: 2 }).notNull(),
    captureChannel: varchar("capture_channel", { length: 16 }).notNull(),
    channelConnectionId: uuid("channel_connection_id"),
    sourceMessageId: uuid("source_message_id"),
    capturedByType: varchar("captured_by_type", { length: 16 }).notNull(),
    capturedById: uuid("captured_by_id"),
    capturedAt: timestamp("captured_at", { mode: "date", withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { mode: "date", withTimezone: true }),
    supersedesConsentId: uuid("supersedes_consent_id"),
    evidenceHash: binary("evidence_hash").notNull(),
    evidenceCiphertext: binary("evidence_ciphertext"),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "consent_records_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "consent_records_conversation_uuid_v7_check",
      sql`${table.conversationId} is null
        or ${table.conversationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "consent_records_source_message_uuid_v7_check",
      sql`${table.sourceMessageId} is null
        or ${table.sourceMessageId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "consent_records_captured_by_uuid_v7_check",
      sql`${table.capturedById} is null
        or ${table.capturedById}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "consent_records_purpose_check",
      sql`${table.purpose} in ('booking_follow_up', 'service_messages', 'analytics_optional', 'marketing')`,
    ),
    check(
      "consent_records_status_check",
      sql`${table.status} in ('granted', 'declined', 'withdrawn', 'not_required')`,
    ),
    check(
      "consent_records_lawful_basis_code_check",
      sql`${table.lawfulBasisCode} is null
        or (${table.lawfulBasisCode} = lower(btrim(${table.lawfulBasisCode}))
          and ${table.lawfulBasisCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')`,
    ),
    check(
      "consent_records_notice_key_check",
      sql`${table.noticeKey} = lower(btrim(${table.noticeKey}))
        and ${table.noticeKey} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check("consent_records_notice_version_check", sql`${table.noticeVersion} > 0`),
    check(
      "consent_records_policy_url_check",
      sql`${table.policyUrl} is null
        or (${table.policyUrl} = btrim(${table.policyUrl})
          and length(${table.policyUrl}) between 1 and 2048)`,
    ),
    check("consent_records_locale_check", sql`${table.locale} in ('uz', 'ru', 'en')`),
    check(
      "consent_records_capture_channel_check",
      sql`${table.captureChannel} in ('widget', 'telegram', 'staff')`,
    ),
    check(
      "consent_records_captured_by_type_check",
      sql`${table.capturedByType} in ('customer', 'member', 'system')`,
    ),
    check(
      "consent_records_subject_anchor_check",
      sql`${table.contactId} is not null
        or ${table.contactIdentityId} is not null
        or ${table.conversationId} is not null`,
    ),
    check(
      "consent_records_withdrawal_check",
      sql`(${table.status} = 'withdrawn'
          and ${table.withdrawnAt} is not null
          and ${table.withdrawnAt} >= ${table.capturedAt})
        or (${table.status} <> 'withdrawn' and ${table.withdrawnAt} is null)`,
    ),
    check(
      "consent_records_supersedes_check",
      sql`${table.supersedesConsentId} is null or ${table.supersedesConsentId} <> ${table.id}`,
    ),
    check(
      "consent_records_evidence_hash_check",
      sql`octet_length(${table.evidenceHash}) between 16 and 128`,
    ),
    check(
      "consent_records_evidence_ciphertext_check",
      sql`${table.evidenceCiphertext} is null
        or octet_length(${table.evidenceCiphertext}) between 1 and 65536`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "consent_records_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "consent_records_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactIdentityId],
      foreignColumns: [contactIdentities.organizationId, contactIdentities.id],
      name: "consent_records_contact_identity_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId, table.contactIdentityId],
      foreignColumns: [
        contactIdentities.organizationId,
        contactIdentities.contactId,
        contactIdentities.id,
      ],
      name: "consent_records_contact_identity_subject_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "consent_records_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "consent_records_conversation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.contactId, conversations.id],
      name: "consent_records_conversation_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceMessageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: "consent_records_source_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId, table.sourceMessageId],
      foreignColumns: [messages.organizationId, messages.conversationId, messages.id],
      name: "consent_records_conversation_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.supersedesConsentId],
      foreignColumns: [table.organizationId, table.id],
      name: "consent_records_superseded_record_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("consent_records_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("consent_records_source_event_dedupe_unique")
      .on(table.organizationId, table.contactId, table.purpose, table.sourceMessageId, table.status)
      .where(sql`${table.sourceMessageId} is not null`),
    index("consent_records_organization_contact_purpose_captured_idx").on(
      table.organizationId,
      table.contactId,
      table.purpose,
      table.capturedAt.desc(),
    ),
    index("consent_records_organization_identity_purpose_captured_idx").on(
      table.organizationId,
      table.contactIdentityId,
      table.purpose,
      table.capturedAt.desc(),
    ),
    index("consent_records_organization_purpose_status_idx").on(
      table.organizationId,
      table.purpose,
      table.status,
    ),
  ],
);

export const leadQualificationEvaluations = pgTable(
  "lead_qualification_evaluations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    businessPolicyId: uuid("business_policy_id").notNull(),
    result: varchar("result", { length: 16 }).notNull(),
    reasonCodes: varchar("reason_codes", { length: 100 })
      .array()
      .default(sql`array[]::varchar(100)[]`)
      .notNull(),
    facts: jsonb("facts_jsonb").notNull(),
    evaluatedBy: varchar("evaluated_by", { length: 16 }).notNull(),
    memberId: uuid("member_id"),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "lead_qualification_evaluations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "lead_qualification_evaluations_result_check",
      sql`${table.result} in ('qualified', 'disqualified', 'incomplete')`,
    ),
    check(
      "lead_qualification_evaluations_reason_codes_check",
      sql`cardinality(${table.reasonCodes}) between 0 and 16
        and array_position(${table.reasonCodes}, null) is null
        and (cardinality(${table.reasonCodes}) = 0
          or array_to_string(${table.reasonCodes}, ',')
            ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:,[a-z][a-z0-9]*(?:_[a-z0-9]+)*)*$')`,
    ),
    check(
      "lead_qualification_evaluations_facts_check",
      sql`jsonb_typeof(${table.facts}) = 'object'
        and pg_column_size(${table.facts}) <= 65536`,
    ),
    check(
      "lead_qualification_evaluations_evaluator_check",
      sql`(${table.evaluatedBy} = 'system' and ${table.memberId} is null)
        or (${table.evaluatedBy} = 'member' and ${table.memberId} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "lead_qualification_evaluations_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId],
      foreignColumns: [leads.organizationId, leads.id],
      name: "lead_qualification_evaluations_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.businessPolicyId],
      foreignColumns: [businessPolicies.organizationId, businessPolicies.id],
      name: "lead_qualification_evaluations_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.memberId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "lead_qualification_evaluations_member_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("lead_qualification_evaluations_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    unique("lead_qualification_evaluations_lead_id_unique").on(
      table.organizationId,
      table.leadId,
      table.id,
    ),
    index("lead_qualification_evaluations_lead_occurred_idx").on(
      table.organizationId,
      table.leadId,
      table.occurredAt.desc(),
    ),
    index("lead_qualification_evaluations_policy_idx").on(
      table.organizationId,
      table.businessPolicyId,
    ),
  ],
);

export { leads };

export const leadQualificationEvidence = pgTable(
  "lead_qualification_evidence",
  {
    organizationId: uuid("organization_id").notNull(),
    evaluationId: uuid("evaluation_id").notNull(),
    messageId: uuid("message_id").notNull(),
    fieldKey: varchar("field_key", { length: 128 }).notNull(),
    evidenceKind: varchar("evidence_kind", { length: 32 }).notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "lead_qualification_evidence_message_uuid_v7_check",
      sql`${table.messageId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "lead_qualification_evidence_field_key_check",
      sql`${table.fieldKey} = lower(btrim(${table.fieldKey}))
        and ${table.fieldKey} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check(
      "lead_qualification_evidence_kind_check",
      sql`${table.evidenceKind} in ('customer_statement', 'staff_entry', 'derived')`,
    ),
    primaryKey({
      columns: [table.organizationId, table.evaluationId, table.messageId, table.fieldKey],
      name: "lead_qualification_evidence_pk",
    }),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "lead_qualification_evidence_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.evaluationId],
      foreignColumns: [
        leadQualificationEvaluations.organizationId,
        leadQualificationEvaluations.id,
      ],
      name: "lead_qualification_evidence_evaluation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.messageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: "lead_qualification_evidence_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("lead_qualification_evidence_message_evaluation_idx").on(
      table.organizationId,
      table.messageId,
      table.evaluationId,
    ),
  ],
);
