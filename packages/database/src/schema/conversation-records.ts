import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

import { channelConnections } from "./channel-connections.js";
import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { leads } from "./leads.js";
import { locations } from "./locations.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { retentionPolicies } from "./retention-policies.js";

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
    foreignKey({
      columns: [table.organizationId, table.id, table.activeHandoffId],
      foreignColumns: [handoffs.organizationId, handoffs.conversationId, handoffs.id],
      name: "conversations_active_handoff_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("conversations_organization_id_id_unique").on(table.organizationId, table.id),
    unique("conversations_organization_lead_id_unique").on(
      table.organizationId,
      table.leadId,
      table.id,
    ),
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

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    locationId: uuid("location_id"),
    status: varchar("status", { length: 24 }).notNull(),
    triggerReason: varchar("trigger_reason", { length: 48 }).notNull(),
    queueKey: varchar("queue_key", { length: 100 }).notNull(),
    assignedMembershipId: uuid("assigned_membership_id"),
    requestedAt: timestamp("requested_at", { mode: "date", withTimezone: true }).notNull(),
    assignedAt: timestamp("assigned_at", { mode: "date", withTimezone: true }),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    slaDueAt: timestamp("sla_due_at", { mode: "date", withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    resolutionCode: varchar("resolution_code", { length: 100 }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "handoffs_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "handoffs_status_check",
      sql`${table.status} in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired')`,
    ),
    check(
      "handoffs_trigger_reason_check",
      sql`${table.triggerReason} in ('customer_requested', 'missing_authoritative_information', 'medical_or_safety', 'low_confidence', 'policy_blocked', 'ai_unavailable', 'delivery_problem', 'staff_created', 'other')`,
    ),
    check(
      "handoffs_queue_key_check",
      sql`${table.queueKey} = lower(btrim(${table.queueKey}))
        and ${table.queueKey} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "handoffs_resolution_code_check",
      sql`${table.resolutionCode} is null
        or ${table.resolutionCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "handoffs_lifecycle_shape_check",
      sql`(${table.status} = 'requested'
          and ${table.assignedMembershipId} is null
          and ${table.assignedAt} is null
          and ${table.startedAt} is null
          and ${table.resolvedAt} is null
          and ${table.resolutionCode} is null)
        or (${table.status} = 'assigned'
          and ${table.assignedMembershipId} is not null
          and ${table.assignedAt} is not null
          and ${table.startedAt} is null
          and ${table.resolvedAt} is null
          and ${table.resolutionCode} is null)
        or (${table.status} = 'in_progress'
          and ${table.assignedMembershipId} is not null
          and ${table.assignedAt} is not null
          and ${table.startedAt} is not null
          and ${table.resolvedAt} is null
          and ${table.resolutionCode} is null)
        or (${table.status} = 'resolved'
          and ${table.assignedMembershipId} is not null
          and ${table.assignedAt} is not null
          and ${table.startedAt} is not null
          and ${table.resolvedAt} is not null
          and ${table.resolutionCode} is not null)
        or (${table.status} in ('cancelled', 'expired')
          and ${table.resolvedAt} is null
          and ${table.resolutionCode} is null
          and ((${table.assignedMembershipId} is null
              and ${table.assignedAt} is null
              and ${table.startedAt} is null)
            or (${table.assignedMembershipId} is not null
              and ${table.assignedAt} is not null)))`,
    ),
    check(
      "handoffs_lifecycle_timestamps_check",
      sql`${table.slaDueAt} > ${table.requestedAt}
        and (${table.assignedAt} is null or ${table.assignedAt} >= ${table.requestedAt})
        and (${table.startedAt} is null
          or (${table.assignedAt} is not null and ${table.startedAt} >= ${table.assignedAt}))
        and (${table.resolvedAt} is null
          or (${table.startedAt} is not null and ${table.resolvedAt} >= ${table.startedAt}))`,
    ),
    check("handoffs_version_check", sql`${table.version} > 0`),
    check("handoffs_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "handoffs_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "handoffs_conversation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId],
      foreignColumns: [leads.organizationId, leads.id],
      name: "handoffs_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.leadId, conversations.id],
      name: "handoffs_conversation_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "handoffs_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.assignedMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "handoffs_assigned_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("handoffs_organization_id_id_unique").on(table.organizationId, table.id),
    unique("handoffs_organization_conversation_id_unique").on(
      table.organizationId,
      table.conversationId,
      table.id,
    ),
    uniqueIndex("handoffs_one_active_per_conversation_unique")
      .on(table.organizationId, table.conversationId)
      .where(sql`${table.status} in ('requested', 'assigned', 'in_progress')`),
    index("handoffs_organization_status_sla_due_idx").on(
      table.organizationId,
      table.status,
      table.slaDueAt,
    ),
    index("handoffs_organization_queue_status_requested_idx").on(
      table.organizationId,
      table.queueKey,
      table.status,
      table.requestedAt,
    ),
    index("handoffs_organization_assignee_status_idx").on(
      table.organizationId,
      table.assignedMembershipId,
      table.status,
    ),
    index("handoffs_organization_lead_requested_idx").on(
      table.organizationId,
      table.leadId,
      table.requestedAt.desc(),
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
    foreignKey({
      columns: [table.organizationId, table.aiRunId],
      foreignColumns: [aiRuns.organizationId, aiRuns.id],
      name: "messages_ai_run_fk",
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

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    triggerMessageId: uuid("trigger_message_id").notNull(),
    expectedConversationVersion: bigint("expected_conversation_version", {
      mode: "bigint",
    }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    requestedModelId: varchar("requested_model_id", { length: 255 }).notNull(),
    modelProfileVersion: varchar("model_profile_version", { length: 128 }).notNull(),
    providerResolvedModelId: varchar("provider_resolved_model_id", { length: 255 }),
    orchestratorVersion: varchar("orchestrator_version", { length: 128 }).notNull(),
    promptTemplateVersion: varchar("prompt_template_version", { length: 128 }).notNull(),
    decisionSchemaVersion: varchar("decision_schema_version", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 128 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    inputUnits: bigint("input_units", { mode: "bigint" }),
    outputUnits: bigint("output_units", { mode: "bigint" }),
    cachedInputUnits: bigint("cached_input_units", { mode: "bigint" }),
    reasoningUnits: bigint("reasoning_units", { mode: "bigint" }),
    totalUnits: bigint("total_units", { mode: "bigint" }),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "bigint" }),
    costCurrency: varchar("cost_currency", { length: 3 }).notNull(),
    costCatalogVersion: varchar("cost_catalog_version", { length: 128 }).notNull(),
    latencyMs: integer("latency_ms"),
    attemptNo: integer("attempt_no").notNull(),
    failureCategory: varchar("failure_category", { length: 100 }),
    knowledgeManifest: jsonb("knowledge_manifest_jsonb").$type<Record<string, unknown>>().notNull(),
    inputHash: binary("input_hash").notNull(),
    outputHash: binary("output_hash"),
    inputSnapshotCiphertext: binary("input_snapshot_ciphertext"),
    outputSnapshotCiphertext: binary("output_snapshot_ciphertext"),
    snapshotCapturePolicyId: uuid("snapshot_capture_policy_id"),
    schemaValid: boolean("schema_valid"),
    policyAllowed: boolean("policy_allowed"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    correlationId: uuid("correlation_id").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "ai_runs_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "ai_runs_correlation_uuid_v7_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "ai_runs_expected_conversation_version_check",
      sql`${table.expectedConversationVersion} > 0`,
    ),
    check(
      "ai_runs_provider_id_check",
      sql`${table.providerId} = lower(btrim(${table.providerId}))
        and ${table.providerId} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check(
      "ai_runs_model_identifiers_check",
      sql`${table.requestedModelId} = btrim(${table.requestedModelId})
        and length(${table.requestedModelId}) between 1 and 255
        and ${table.requestedModelId} !~ '[[:space:]]'
        and lower(${table.requestedModelId}) <> 'latest'
        and (${table.providerResolvedModelId} is null
          or (${table.providerResolvedModelId} = btrim(${table.providerResolvedModelId})
            and length(${table.providerResolvedModelId}) between 1 and 255
            and ${table.providerResolvedModelId} !~ '[[:space:]]'))`,
    ),
    check(
      "ai_runs_versions_check",
      sql`${table.modelProfileVersion} = btrim(${table.modelProfileVersion})
        and ${table.modelProfileVersion} !~ '[[:space:]]'
        and ${table.orchestratorVersion} = btrim(${table.orchestratorVersion})
        and ${table.orchestratorVersion} !~ '[[:space:]]'
        and ${table.promptTemplateVersion} = btrim(${table.promptTemplateVersion})
        and ${table.promptTemplateVersion} !~ '[[:space:]]'
        and ${table.decisionSchemaVersion} = btrim(${table.decisionSchemaVersion})
        and ${table.decisionSchemaVersion} !~ '[[:space:]]'
        and ${table.policyVersion} = btrim(${table.policyVersion})
        and ${table.policyVersion} !~ '[[:space:]]'
        and ${table.costCatalogVersion} = btrim(${table.costCatalogVersion})
        and ${table.costCatalogVersion} !~ '[[:space:]]'`,
    ),
    check(
      "ai_runs_status_check",
      sql`${table.status} in ('started', 'succeeded', 'failed', 'schema_rejected', 'policy_denied', 'stale')`,
    ),
    check(
      "ai_runs_usage_check",
      sql`(${table.inputUnits} is null or ${table.inputUnits} >= 0)
        and (${table.outputUnits} is null or ${table.outputUnits} >= 0)
        and (${table.cachedInputUnits} is null or ${table.cachedInputUnits} >= 0)
        and (${table.reasoningUnits} is null or ${table.reasoningUnits} >= 0)
        and (${table.totalUnits} is null or ${table.totalUnits} >= 0)`,
    ),
    check(
      "ai_runs_cost_check",
      sql`${table.estimatedCostMicros} is null or ${table.estimatedCostMicros} >= 0`,
    ),
    check("ai_runs_cost_currency_check", sql`${table.costCurrency} ~ '^[A-Z]{3}$'`),
    check("ai_runs_attempt_no_check", sql`${table.attemptNo} > 0`),
    check(
      "ai_runs_failure_category_check",
      sql`${table.failureCategory} is null
        or ${table.failureCategory} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "ai_runs_knowledge_manifest_check",
      sql`jsonb_typeof(${table.knowledgeManifest}) = 'object'
        and pg_column_size(${table.knowledgeManifest}) <= 65536`,
    ),
    check("ai_runs_input_hash_check", sql`octet_length(${table.inputHash}) between 16 and 128`),
    check(
      "ai_runs_output_hash_check",
      sql`${table.outputHash} is null or octet_length(${table.outputHash}) between 16 and 128`,
    ),
    check(
      "ai_runs_snapshot_ciphertext_check",
      sql`(${table.inputSnapshotCiphertext} is null
          or octet_length(${table.inputSnapshotCiphertext}) between 1 and 65536)
        and (${table.outputSnapshotCiphertext} is null
          or octet_length(${table.outputSnapshotCiphertext}) between 1 and 65536)`,
    ),
    check(
      "ai_runs_snapshot_capture_policy_check",
      sql`(${table.inputSnapshotCiphertext} is null
          and ${table.outputSnapshotCiphertext} is null
          and ${table.snapshotCapturePolicyId} is null)
        or ((${table.inputSnapshotCiphertext} is not null
            or ${table.outputSnapshotCiphertext} is not null)
          and ${table.snapshotCapturePolicyId} is not null)`,
    ),
    check(
      "ai_runs_validation_order_check",
      sql`${table.policyAllowed} is null or ${table.schemaValid} is true`,
    ),
    check(
      "ai_runs_lifecycle_check",
      sql`(${table.status} = 'started'
          and ${table.finishedAt} is null
          and ${table.latencyMs} is null)
        or (${table.status} <> 'started'
          and ${table.finishedAt} is not null
          and ${table.finishedAt} >= ${table.startedAt}
          and ${table.latencyMs} >= 0)`,
    ),
    check(
      "ai_runs_outcome_shape_check",
      sql`(${table.status} = 'succeeded'
          and ${table.schemaValid} is true
          and ${table.policyAllowed} is true
          and ${table.providerResolvedModelId} is not null
          and ${table.outputHash} is not null
          and ${table.failureCategory} is null)
        or (${table.status} = 'schema_rejected'
          and ${table.schemaValid} is false
          and ${table.policyAllowed} is null
          and ${table.providerResolvedModelId} is not null
          and ${table.outputHash} is not null)
        or (${table.status} = 'policy_denied'
          and ${table.schemaValid} is true
          and ${table.policyAllowed} is false
          and ${table.providerResolvedModelId} is not null
          and ${table.outputHash} is not null)
        or (${table.status} = 'failed' and ${table.failureCategory} is not null)
        or ${table.status} in ('started', 'stale')`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "ai_runs_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "ai_runs_conversation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId, table.triggerMessageId],
      foreignColumns: [messages.organizationId, messages.conversationId, messages.id],
      name: "ai_runs_trigger_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.snapshotCapturePolicyId],
      foreignColumns: [retentionPolicies.organizationId, retentionPolicies.id],
      name: "ai_runs_snapshot_capture_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("ai_runs_organization_id_id_unique").on(table.organizationId, table.id),
    unique("ai_runs_trigger_attempt_provider_unique").on(
      table.organizationId,
      table.triggerMessageId,
      table.attemptNo,
      table.providerId,
    ),
    index("ai_runs_organization_conversation_started_idx").on(
      table.organizationId,
      table.conversationId,
      table.startedAt.desc(),
    ),
    index("ai_runs_organization_status_started_idx").on(
      table.organizationId,
      table.status,
      table.startedAt,
    ),
    index("ai_runs_organization_model_started_idx").on(
      table.organizationId,
      table.requestedModelId,
      table.startedAt,
    ),
  ],
);

export const aiActionEvaluations = pgTable(
  "ai_action_evaluations",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    aiRunId: uuid("ai_run_id").notNull(),
    actionName: varchar("action_name", { length: 40 }).notNull(),
    actionSchemaVersion: varchar("action_schema_version", { length: 64 }).notNull(),
    proposalHash: binary("proposal_hash").notNull(),
    argumentsCiphertext: binary("arguments_ciphertext").notNull(),
    validationStatus: varchar("validation_status", { length: 16 }).notNull(),
    policyReasonCode: varchar("policy_reason_code", { length: 100 }),
    applicationStatus: varchar("application_status", { length: 16 }).notNull(),
    targetAggregateType: varchar("target_aggregate_type", { length: 32 }),
    targetAggregateId: uuid("target_aggregate_id"),
    resultHash: binary("result_hash"),
    resultCiphertext: binary("result_ciphertext"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "ai_action_evaluations_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "ai_action_evaluations_action_name_check",
      sql`${table.actionName} in ('none', 'request_information', 'create_appointment_request', 'confirm_appointment', 'decline_appointment', 'request_handoff')`,
    ),
    check(
      "ai_action_evaluations_action_schema_version_check",
      sql`${table.actionSchemaVersion} = btrim(${table.actionSchemaVersion})
        and ${table.actionSchemaVersion} !~ '[[:space:]]'`,
    ),
    check(
      "ai_action_evaluations_proposal_hash_check",
      sql`octet_length(${table.proposalHash}) between 16 and 128`,
    ),
    check(
      "ai_action_evaluations_arguments_ciphertext_check",
      sql`octet_length(${table.argumentsCiphertext}) between 1 and 65536`,
    ),
    check(
      "ai_action_evaluations_validation_status_check",
      sql`${table.validationStatus} in ('pending', 'allowed', 'denied', 'malformed')`,
    ),
    check(
      "ai_action_evaluations_policy_reason_check",
      sql`(${table.validationStatus} = 'pending' and ${table.policyReasonCode} is null)
        or (${table.validationStatus} in ('denied', 'malformed')
          and ${table.policyReasonCode} is not null
          and ${table.policyReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        or (${table.validationStatus} = 'allowed'
          and (${table.policyReasonCode} is null
            or ${table.policyReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'))`,
    ),
    check(
      "ai_action_evaluations_application_status_check",
      sql`${table.applicationStatus} in ('not_applied', 'applied', 'failed', 'stale')`,
    ),
    check(
      "ai_action_evaluations_authority_shape_check",
      sql`${table.validationStatus} = 'allowed'
        or ${table.applicationStatus} = 'not_applied'`,
    ),
    check(
      "ai_action_evaluations_target_shape_check",
      sql`(${table.targetAggregateType} is null and ${table.targetAggregateId} is null)
        or (${table.targetAggregateType} in ('conversation', 'appointment_request', 'handoff')
          and ${table.targetAggregateId} is not null
          and ${table.targetAggregateId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`,
    ),
    check(
      "ai_action_evaluations_result_hash_check",
      sql`${table.resultHash} is null or octet_length(${table.resultHash}) between 16 and 128`,
    ),
    check(
      "ai_action_evaluations_result_ciphertext_check",
      sql`${table.resultCiphertext} is null
        or (${table.resultHash} is not null
          and octet_length(${table.resultCiphertext}) between 1 and 65536)`,
    ),
    check(
      "ai_action_evaluations_lifecycle_check",
      sql`(${table.validationStatus} = 'pending'
          and ${table.finishedAt} is null
          and ${table.applicationStatus} = 'not_applied')
        or (${table.validationStatus} <> 'pending'
          and ${table.finishedAt} is not null
          and ${table.finishedAt} >= ${table.startedAt})`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "ai_action_evaluations_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.aiRunId],
      foreignColumns: [aiRuns.organizationId, aiRuns.id],
      name: "ai_action_evaluations_ai_run_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("ai_action_evaluations_organization_id_id_unique").on(table.organizationId, table.id),
    unique("ai_action_evaluations_organization_ai_run_unique").on(
      table.organizationId,
      table.aiRunId,
    ),
    index("ai_action_evaluations_org_action_validation_started_idx").on(
      table.organizationId,
      table.actionName,
      table.validationStatus,
      table.startedAt,
    ),
  ],
);
