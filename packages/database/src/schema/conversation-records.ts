import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { channelConnections } from "./channels.js";
import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { leads } from "./customer-records.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    externalThreadHash: binary("external_thread_hash"),
    status: varchar("status", { length: 24 }).notNull(),
    preferredLocale: varchar("preferred_locale", { length: 2 }).notNull(),
    automationMode: varchar("automation_mode", { length: 16 }).notNull(),
    activeHandoffId: uuid("active_handoff_id"),
    nextSequenceNo: bigint("next_sequence_no", { mode: "bigint" })
      .default(sql`1`)
      .notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    closedAt: timestamp("closed_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "conversations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "conversations_active_handoff_uuid_v7_check",
      sql`${table.activeHandoffId} is null
        or ${table.activeHandoffId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "conversations_external_thread_hash_check",
      sql`${table.externalThreadHash} is null
        or octet_length(${table.externalThreadHash}) between 16 and 128`,
    ),
    check(
      "conversations_status_check",
      sql`${table.status} in ('open', 'awaiting_lead', 'awaiting_staff', 'resolved', 'closed')`,
    ),
    check(
      "conversations_preferred_locale_check",
      sql`${table.preferredLocale} in ('uz', 'ru', 'en')`,
    ),
    check(
      "conversations_automation_mode_check",
      sql`${table.automationMode} in ('ai', 'paused', 'staff')`,
    ),
    check(
      "conversations_state_ownership_shape_check",
      sql`(${table.status} = 'open'
          and ${table.automationMode} = 'ai'
          and ${table.activeHandoffId} is null)
        or (${table.status} = 'awaiting_lead'
          and ((${table.automationMode} = 'ai' and ${table.activeHandoffId} is null)
            or (${table.automationMode} = 'staff' and ${table.activeHandoffId} is not null)))
        or (${table.status} = 'awaiting_staff'
          and ${table.automationMode} in ('paused', 'staff')
          and ${table.activeHandoffId} is not null)
        or (${table.status} in ('resolved', 'closed')
          and ${table.automationMode} = 'paused'
          and ${table.activeHandoffId} is null)`,
    ),
    check("conversations_next_sequence_no_check", sql`${table.nextSequenceNo} > 0`),
    check(
      "conversations_activity_timestamps_check",
      sql`${table.lastActivityAt} >= ${table.startedAt}`,
    ),
    check(
      "conversations_lifecycle_timestamps_check",
      sql`(${table.status} in ('resolved', 'closed')) = (${table.resolvedAt} is not null)
        and (${table.status} = 'closed') = (${table.closedAt} is not null)
        and (${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.startedAt})
        and (${table.closedAt} is null
          or (${table.resolvedAt} is not null and ${table.closedAt} >= ${table.resolvedAt}))`,
    ),
    check("conversations_version_check", sql`${table.version} > 0`),
    check("conversations_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "conversations_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "conversations_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId],
      foreignColumns: [leads.organizationId, leads.id],
      name: "conversations_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId, table.leadId],
      foreignColumns: [leads.organizationId, leads.contactId, leads.id],
      name: "conversations_lead_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "conversations_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("conversations_organization_id_id_unique").on(table.organizationId, table.id),
    unique("conversations_organization_channel_id_unique").on(
      table.organizationId,
      table.channelConnectionId,
      table.id,
    ),
    unique("conversations_organization_contact_id_unique").on(
      table.organizationId,
      table.contactId,
      table.id,
    ),
    unique("conversations_organization_contact_lead_id_unique").on(
      table.organizationId,
      table.contactId,
      table.leadId,
      table.id,
    ),
    index("conversations_organization_status_activity_idx").on(
      table.organizationId,
      table.status,
      table.lastActivityAt.desc(),
    ),
    index("conversations_organization_lead_started_idx").on(
      table.organizationId,
      table.leadId,
      table.startedAt.desc(),
    ),
    index("conversations_organization_contact_started_idx").on(
      table.organizationId,
      table.contactId,
      table.startedAt.desc(),
    ),
    index("conversations_organization_connection_activity_idx").on(
      table.organizationId,
      table.channelConnectionId,
      table.lastActivityAt.desc(),
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    direction: varchar("direction", { length: 16 }).notNull(),
    senderType: varchar("sender_type", { length: 16 }).notNull(),
    senderContactId: uuid("sender_contact_id"),
    senderMembershipId: uuid("sender_membership_id"),
    sequenceNo: bigint("sequence_no", { mode: "bigint" }).notNull(),
    externalEventId: varchar("external_event_id", { length: 255 }),
    externalMessageId: varchar("external_message_id", { length: 255 }),
    externalSentAt: timestamp("external_sent_at", { mode: "date", withTimezone: true }),
    externalSequence: bigint("external_sequence", { mode: "bigint" }),
    contentType: varchar("content_type", { length: 32 }).notNull(),
    bodyCiphertext: binary("body_ciphertext"),
    bodyHash: binary("body_hash").notNull(),
    locale: varchar("locale", { length: 2 }),
    processingStatus: varchar("processing_status", { length: 16 }).notNull(),
    deliveryStatus: varchar("delivery_status", { length: 16 }).notNull(),
    replyToMessageId: uuid("reply_to_message_id"),
    aiRunId: uuid("ai_run_id"),
    knowledgeManifest: jsonb("knowledge_manifest_jsonb"),
    redactedAt: timestamp("redacted_at", { mode: "date", withTimezone: true }),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "messages_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "messages_ai_run_uuid_v7_check",
      sql`${table.aiRunId} is null
        or ${table.aiRunId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "messages_direction_check",
      sql`${table.direction} in ('inbound', 'outbound', 'staff_internal')`,
    ),
    check(
      "messages_sender_type_check",
      sql`${table.senderType} in ('customer', 'member', 'system')`,
    ),
    check(
      "messages_sender_shape_check",
      sql`(${table.senderType} = 'customer'
          and ${table.direction} = 'inbound'
          and ${table.senderContactId} is not null
          and ${table.senderMembershipId} is null)
        or (${table.senderType} = 'member'
          and ${table.direction} in ('outbound', 'staff_internal')
          and ${table.senderContactId} is null
          and ${table.senderMembershipId} is not null)
        or (${table.senderType} = 'system'
          and ${table.direction} = 'outbound'
          and ${table.senderContactId} is null
          and ${table.senderMembershipId} is null)`,
    ),
    check("messages_sequence_no_check", sql`${table.sequenceNo} > 0`),
    check(
      "messages_external_event_id_check",
      sql`${table.externalEventId} is null
        or (${table.externalEventId} = btrim(${table.externalEventId})
          and length(${table.externalEventId}) between 1 and 255)`,
    ),
    check(
      "messages_external_message_id_check",
      sql`${table.externalMessageId} is null
        or (${table.externalMessageId} = btrim(${table.externalMessageId})
          and length(${table.externalMessageId}) between 1 and 255)`,
    ),
    check(
      "messages_external_sequence_check",
      sql`${table.externalSequence} is null or ${table.externalSequence} >= 0`,
    ),
    check(
      "messages_content_type_check",
      sql`${table.contentType} = btrim(${table.contentType})
        and length(${table.contentType}) between 1 and 32`,
    ),
    check(
      "messages_body_ciphertext_check",
      sql`${table.bodyCiphertext} is null
        or octet_length(${table.bodyCiphertext}) between 1 and 65536`,
    ),
    check("messages_body_hash_check", sql`octet_length(${table.bodyHash}) between 16 and 128`),
    check(
      "messages_locale_check",
      sql`${table.locale} is null or ${table.locale} in ('uz', 'ru', 'en')`,
    ),
    check(
      "messages_processing_status_check",
      sql`${table.processingStatus} in ('accepted', 'processing', 'processed', 'failed', 'suppressed')`,
    ),
    check(
      "messages_delivery_status_check",
      sql`${table.deliveryStatus} in ('not_applicable', 'queued', 'sent', 'delivered', 'failed')`,
    ),
    check(
      "messages_delivery_direction_check",
      sql`${table.direction} = 'outbound' or ${table.deliveryStatus} = 'not_applicable'`,
    ),
    check(
      "messages_knowledge_manifest_check",
      sql`${table.knowledgeManifest} is null
        or (jsonb_typeof(${table.knowledgeManifest}) = 'object'
          and pg_column_size(${table.knowledgeManifest}) <= 65536)`,
    ),
    check(
      "messages_redaction_check",
      sql`${table.redactedAt} is null or ${table.bodyCiphertext} is null`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "messages_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "messages_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId, table.conversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.channelConnectionId,
        conversations.id,
      ],
      name: "messages_conversation_channel_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.senderContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "messages_sender_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.senderMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "messages_sender_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId, table.replyToMessageId],
      foreignColumns: [table.organizationId, table.conversationId, table.id],
      name: "messages_reply_to_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("messages_organization_id_id_unique").on(table.organizationId, table.id),
    unique("messages_organization_conversation_id_unique").on(
      table.organizationId,
      table.conversationId,
      table.id,
    ),
    unique("messages_organization_conversation_sequence_unique").on(
      table.organizationId,
      table.conversationId,
      table.sequenceNo,
    ),
    uniqueIndex("messages_external_message_dedupe_unique")
      .on(table.organizationId, table.channelConnectionId, table.externalMessageId)
      .where(sql`${table.externalMessageId} is not null`),
    uniqueIndex("messages_external_event_dedupe_unique")
      .on(table.organizationId, table.channelConnectionId, table.externalEventId)
      .where(sql`${table.externalEventId} is not null`),
    index("messages_organization_conversation_sequence_idx").on(
      table.organizationId,
      table.conversationId,
      table.sequenceNo,
    ),
    index("messages_organization_processing_created_idx").on(
      table.organizationId,
      table.processingStatus,
      table.createdAt,
    ),
    index("messages_organization_delivery_created_idx").on(
      table.organizationId,
      table.deliveryStatus,
      table.createdAt,
    ),
  ],
);
