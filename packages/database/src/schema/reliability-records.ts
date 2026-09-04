import { sql } from "drizzle-orm";
import {
  bigint,
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
import { binary, immutableCreatedAt } from "./common.js";
import { messages } from "./conversation-records.js";
import { organizations } from "./organizations.js";

export const webhookReceipts = pgTable(
  "webhook_receipts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    externalEventId: varchar("external_event_id", { length: 255 }).notNull(),
    externalMessageId: varchar("external_message_id", { length: 255 }),
    payloadHash: binary("payload_hash").notNull(),
    payloadCiphertext: binary("payload_ciphertext"),
    signatureVerifiedAt: timestamp("signature_verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    providerSentAt: timestamp("provider_sent_at", { mode: "date", withTimezone: true }),
    providerSequence: bigint("provider_sequence", { mode: "bigint" }),
    status: varchar("status", { length: 32 }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true }),
    processedMessageId: uuid("processed_message_id"),
    firstReceivedAt: timestamp("first_received_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    lastReceivedAt: timestamp("last_received_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    lastErrorCategory: varchar("last_error_category", { length: 100 }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "webhook_receipts_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "webhook_receipts_correlation_uuid_v7_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "webhook_receipts_provider_check",
      sql`${table.provider} = lower(btrim(${table.provider}))
        and ${table.provider} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check(
      "webhook_receipts_external_ids_check",
      sql`${table.externalEventId} = btrim(${table.externalEventId})
        and length(${table.externalEventId}) between 1 and 255
        and (${table.externalMessageId} is null
          or (${table.externalMessageId} = btrim(${table.externalMessageId})
            and length(${table.externalMessageId}) between 1 and 255))`,
    ),
    check(
      "webhook_receipts_payload_hash_check",
      sql`octet_length(${table.payloadHash}) between 16 and 128`,
    ),
    check(
      "webhook_receipts_payload_ciphertext_check",
      sql`${table.payloadCiphertext} is null
        or octet_length(${table.payloadCiphertext}) between 1 and 65536`,
    ),
    check(
      "webhook_receipts_provider_sequence_check",
      sql`${table.providerSequence} is null or ${table.providerSequence} >= 0`,
    ),
    check(
      "webhook_receipts_status_check",
      sql`${table.status} in ('received', 'processing', 'processed', 'retryable_failure', 'permanent_failure')`,
    ),
    check("webhook_receipts_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "webhook_receipts_timestamps_check",
      sql`${table.lastReceivedAt} >= ${table.firstReceivedAt}
        and (${table.nextAttemptAt} is null or ${table.nextAttemptAt} >= ${table.lastReceivedAt})`,
    ),
    check(
      "webhook_receipts_processing_shape_check",
      sql`(${table.status} = 'retryable_failure'
          and ${table.nextAttemptAt} is not null
          and ${table.lastErrorCategory} is not null)
        or (${table.status} = 'permanent_failure'
          and ${table.nextAttemptAt} is null
          and ${table.lastErrorCategory} is not null)
        or (${table.status} in ('received', 'processing', 'processed')
          and ${table.nextAttemptAt} is null)`,
    ),
    check(
      "webhook_receipts_processed_message_shape_check",
      sql`${table.processedMessageId} is null or ${table.status} = 'processed'`,
    ),
    check(
      "webhook_receipts_last_error_category_check",
      sql`${table.lastErrorCategory} is null
        or ${table.lastErrorCategory} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "webhook_receipts_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.channelConnectionId],
      foreignColumns: [channelConnections.organizationId, channelConnections.id],
      name: "webhook_receipts_channel_connection_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.processedMessageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: "webhook_receipts_processed_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("webhook_receipts_organization_id_id_unique").on(table.organizationId, table.id),
    unique("webhook_receipts_connection_external_event_unique").on(
      table.organizationId,
      table.channelConnectionId,
      table.externalEventId,
    ),
    uniqueIndex("webhook_receipts_connection_external_message_unique")
      .on(table.organizationId, table.channelConnectionId, table.externalMessageId)
      .where(sql`${table.externalMessageId} is not null`),
    index("webhook_receipts_organization_status_next_attempt_idx").on(
      table.organizationId,
      table.status,
      table.nextAttemptAt,
    ),
    index("webhook_receipts_organization_connection_provider_sent_idx").on(
      table.organizationId,
      table.channelConnectionId,
      table.providerSentAt,
    ),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    scope: varchar("scope", { length: 128 }).notNull(),
    keyHash: binary("key_hash").notNull(),
    principalType: varchar("principal_type", { length: 24 }).notNull(),
    principalIdHash: binary("principal_id_hash").notNull(),
    requestHash: binary("request_hash").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    responseStatus: integer("response_status"),
    responseCiphertext: binary("response_ciphertext"),
    resourceType: varchar("resource_type", { length: 64 }),
    resourceId: uuid("resource_id"),
    lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: immutableCreatedAt(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "idempotency_keys_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "idempotency_keys_scope_check",
      sql`${table.scope} = lower(btrim(${table.scope}))
        and length(${table.scope}) between 1 and 128
        and ${table.scope} !~ '[[:space:]]'`,
    ),
    check(
      "idempotency_keys_hashes_check",
      sql`octet_length(${table.keyHash}) between 16 and 128
        and octet_length(${table.principalIdHash}) between 16 and 128
        and octet_length(${table.requestHash}) between 16 and 128`,
    ),
    check(
      "idempotency_keys_principal_type_check",
      sql`${table.principalType} in ('user', 'widget_session', 'channel_participant', 'system')`,
    ),
    check(
      "idempotency_keys_status_check",
      sql`${table.status} in ('in_progress', 'succeeded', 'failed')`,
    ),
    check(
      "idempotency_keys_response_status_check",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "idempotency_keys_response_ciphertext_check",
      sql`${table.responseCiphertext} is null
        or octet_length(${table.responseCiphertext}) between 1 and 65536`,
    ),
    check(
      "idempotency_keys_resource_shape_check",
      sql`(${table.resourceType} is null and ${table.resourceId} is null)
        or (${table.resourceType} is not null
          and ${table.resourceType} = lower(btrim(${table.resourceType}))
          and ${table.resourceType} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'
          and ${table.resourceId} is not null
          and ${table.resourceId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`,
    ),
    check(
      "idempotency_keys_timestamps_check",
      sql`${table.expiresAt} >= ${table.createdAt} + interval '24 hours'
        and (${table.lockedUntil} is null or ${table.lockedUntil} >= ${table.createdAt})
        and (${table.completedAt} is null
          or (${table.completedAt} >= ${table.createdAt}
            and ${table.completedAt} < ${table.expiresAt}))`,
    ),
    check(
      "idempotency_keys_lifecycle_check",
      sql`(${table.status} = 'in_progress'
          and ${table.lockedUntil} is not null
          and ${table.completedAt} is null
          and ${table.responseStatus} is null
          and ${table.responseCiphertext} is null)
        or (${table.status} in ('succeeded', 'failed')
          and ${table.lockedUntil} is null
          and ${table.completedAt} is not null
          and ${table.responseStatus} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "idempotency_keys_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("idempotency_keys_organization_id_id_unique").on(table.organizationId, table.id),
    unique("idempotency_keys_tenant_principal_scope_key_unique").on(
      table.organizationId,
      table.principalType,
      table.principalIdHash,
      table.scope,
      table.keyHash,
    ),
    index("idempotency_keys_organization_expires_idx").on(table.organizationId, table.expiresAt),
    index("idempotency_keys_organization_status_locked_idx").on(
      table.organizationId,
      table.status,
      table.lockedUntil,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 6 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 32 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    payload: jsonb("payload_jsonb").$type<Record<string, unknown>>().notNull(),
    correlationId: uuid("correlation_id").notNull(),
    causationId: uuid("causation_id"),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true }).notNull(),
    lockedBy: varchar("locked_by", { length: 128 }),
    lockedUntil: timestamp("locked_until", { mode: "date", withTimezone: true }),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    lastErrorCategory: varchar("last_error_category", { length: 100 }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "outbox_events_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "outbox_events_aggregate_id_uuid_v7_check",
      sql`${table.aggregateId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "outbox_events_correlation_uuid_v7_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "outbox_events_causation_uuid_v7_check",
      sql`${table.causationId} is null
        or ${table.causationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "outbox_events_event_aggregate_check",
      sql`(${table.aggregateType} = 'organization'
          and ${table.eventType} in ('organization.created', 'organization.status_changed'))
        or (${table.aggregateType} = 'membership'
          and ${table.eventType} in ('membership.activated', 'membership.scope_changed', 'membership.revoked'))
        or (${table.aggregateType} = 'location'
          and ${table.eventType} = 'location.changed')
        or (${table.aggregateType} = 'service'
          and ${table.eventType} in ('service.published', 'service.deactivated', 'service_price.published'))
        or (${table.aggregateType} = 'faq'
          and ${table.eventType} = 'faq.published')
        or (${table.aggregateType} = 'business_policy'
          and ${table.eventType} = 'business_policy.published')
        or (${table.aggregateType} = 'channel_connection'
          and ${table.eventType} in ('channel_connection.activated', 'channel_connection.disabled', 'channel_connection.credential_rotated'))
        or (${table.aggregateType} = 'contact'
          and ${table.eventType} in ('contact.created', 'contact.identity_added', 'contact.anonymized', 'consent.granted', 'consent.declined', 'consent.withdrawn', 'consent.not_required_recorded'))
        or (${table.aggregateType} = 'lead'
          and ${table.eventType} in ('lead.created', 'lead.engaged', 'lead.qualified', 'lead.disqualified', 'lead.booking_requested', 'lead.converted', 'lead.closed', 'lead.reopened'))
        or (${table.aggregateType} = 'conversation'
          and ${table.eventType} in ('conversation.started', 'message.received', 'message.response_queued', 'message.sent', 'conversation.status_changed', 'conversation.automation_mode_changed', 'conversation.active_handoff_changed', 'conversation.resolved', 'conversation.closed'))
        or (${table.aggregateType} = 'appointment_request'
          and ${table.eventType} in ('appointment_request.created', 'appointment_request.staff_accepted', 'appointment_request.customer_confirmation_requested', 'appointment_request.confirmed', 'appointment_request.rejected', 'appointment_request.cancelled', 'appointment_request.expired', 'appointment.attendance_recorded', 'appointment.attendance_corrected', 'appointment.revenue_attributed', 'appointment.revenue_reversed'))
        or (${table.aggregateType} = 'handoff'
          and ${table.eventType} in ('handoff.requested', 'handoff.assigned', 'handoff.started', 'handoff.resolved', 'handoff.cancelled', 'handoff.expired'))
        or (${table.aggregateType} = 'notification'
          and ${table.eventType} in ('notification.created', 'notification.delivered', 'notification.failed', 'notification.dead_lettered'))
        or (${table.aggregateType} = 'ai_run'
          and ${table.eventType} in ('ai_run.completed', 'ai_run.failed', 'ai_run.schema_rejected', 'ai_run.policy_denied'))`,
    ),
    check(
      "outbox_events_schema_version_check",
      sql`(${table.eventType} = 'lead.reopened' and ${table.schemaVersion} in ('1', '2'))
        or (${table.eventType} <> 'lead.reopened' and ${table.schemaVersion} = '1')`,
    ),
    check("outbox_events_aggregate_version_check", sql`${table.aggregateVersion} > 0`),
    check(
      "outbox_events_payload_check",
      sql`jsonb_typeof(${table.payload}) = 'object' and pg_column_size(${table.payload}) <= 65536`,
    ),
    check(
      "outbox_events_status_check",
      sql`${table.status} in ('pending', 'processing', 'published', 'dead_lettered')`,
    ),
    check("outbox_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "outbox_events_locked_by_check",
      sql`${table.lockedBy} is null
        or (${table.lockedBy} = btrim(${table.lockedBy})
          and ${table.lockedBy} ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$')`,
    ),
    check(
      "outbox_events_last_error_category_check",
      sql`${table.lastErrorCategory} is null
        or ${table.lastErrorCategory} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "outbox_events_timestamps_check",
      sql`${table.availableAt} >= ${table.occurredAt}
        and (${table.lockedUntil} is null or ${table.lockedUntil} >= ${table.availableAt})
        and (${table.publishedAt} is null or ${table.publishedAt} >= ${table.occurredAt})`,
    ),
    check(
      "outbox_events_lifecycle_check",
      sql`(${table.status} = 'pending'
          and ${table.lockedBy} is null
          and ${table.lockedUntil} is null
          and ${table.publishedAt} is null)
        or (${table.status} = 'processing'
          and ${table.lockedBy} is not null
          and ${table.lockedUntil} is not null
          and ${table.publishedAt} is null)
        or (${table.status} = 'published'
          and ${table.lockedBy} is null
          and ${table.lockedUntil} is null
          and ${table.publishedAt} is not null
          and ${table.lastErrorCategory} is null)
        or (${table.status} = 'dead_lettered'
          and ${table.lockedBy} is null
          and ${table.lockedUntil} is null
          and ${table.publishedAt} is null
          and ${table.lastErrorCategory} is not null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "outbox_events_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("outbox_events_organization_id_id_unique").on(table.organizationId, table.id),
    unique("outbox_events_aggregate_version_event_unique").on(
      table.organizationId,
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
      table.eventType,
    ),
    index("outbox_events_pending_available_idx")
      .on(table.status, table.availableAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    index("outbox_events_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt.desc(),
    ),
    index("outbox_events_locked_until_idx")
      .on(table.lockedUntil)
      .where(sql`${table.lockedUntil} is not null`),
  ],
);
