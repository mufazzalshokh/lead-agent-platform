import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { binary, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { handoffs } from "./conversation-records.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { outboxEvents } from "./reliability-records.js";

export const handoffTransitions = pgTable(
  "handoff_transitions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    handoffId: uuid("handoff_id").notNull(),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }).notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorContactId: uuid("actor_contact_id"),
    actorMembershipId: uuid("actor_membership_id"),
    fromAssigneeId: uuid("from_assignee_id"),
    toAssigneeId: uuid("to_assignee_id"),
    conversationDisposition: varchar("conversation_disposition", { length: 32 }),
    reasonCode: varchar("reason_code", { length: 100 }),
    correlationId: uuid("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "handoff_transitions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "handoff_transitions_correlation_uuid_v7_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "handoff_transitions_status_check",
      sql`(${table.fromStatus} is null
          or ${table.fromStatus} in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired'))
        and ${table.toStatus} in ('requested', 'assigned', 'in_progress', 'resolved', 'cancelled', 'expired')`,
    ),
    check(
      "handoff_transitions_creation_shape_check",
      sql`(${table.fromStatus} is null) = (${table.toStatus} = 'requested' and ${table.aggregateVersion} = 1)`,
    ),
    check("handoff_transitions_version_check", sql`${table.aggregateVersion} > 0`),
    check(
      "handoff_transitions_actor_shape_check",
      sql`(${table.actorType} = 'customer'
          and ${table.actorContactId} is not null
          and ${table.actorMembershipId} is null)
        or (${table.actorType} = 'member'
          and ${table.actorContactId} is null
          and ${table.actorMembershipId} is not null)
        or (${table.actorType} = 'system'
          and ${table.actorContactId} is null
          and ${table.actorMembershipId} is null)`,
    ),
    check(
      "handoff_transitions_reassignment_check",
      sql`${table.fromStatus} <> 'assigned'
        or ${table.toStatus} <> 'assigned'
        or (${table.fromAssigneeId} is not null
          and ${table.toAssigneeId} is not null
          and ${table.fromAssigneeId} <> ${table.toAssigneeId})`,
    ),
    check(
      "handoff_transitions_disposition_check",
      sql`(${table.toStatus} in ('resolved', 'cancelled', 'expired')
          and ${table.conversationDisposition} in ('resume_ai', 'resolve_conversation', 'successor_handoff')
          and ${table.reasonCode} is not null)
        or (${table.toStatus} in ('requested', 'assigned', 'in_progress')
          and ${table.conversationDisposition} is null
          and ${table.reasonCode} is null)`,
    ),
    check(
      "handoff_transitions_reason_code_check",
      sql`${table.reasonCode} is null
        or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "handoff_transitions_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.handoffId],
      foreignColumns: [handoffs.organizationId, handoffs.id],
      name: "handoff_transitions_handoff_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.actorContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "handoff_transitions_actor_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "handoff_transitions_actor_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.fromAssigneeId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "handoff_transitions_from_assignee_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.toAssigneeId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "handoff_transitions_to_assignee_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("handoff_transitions_organization_id_unique").on(table.organizationId, table.id),
    unique("handoff_transitions_handoff_version_unique").on(
      table.organizationId,
      table.handoffId,
      table.aggregateVersion,
    ),
    index("handoff_transitions_handoff_occurred_idx").on(
      table.organizationId,
      table.handoffId,
      table.occurredAt,
    ),
    index("handoff_transitions_assignee_occurred_idx").on(
      table.organizationId,
      table.toAssigneeId,
      table.occurredAt.desc(),
    ),
  ],
);

export { handoffs };

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    notificationType: varchar("notification_type", { length: 24 }).notNull(),
    audienceType: varchar("audience_type", { length: 16 }).notNull(),
    recipientMembershipId: uuid("recipient_membership_id"),
    recipientContactId: uuid("recipient_contact_id"),
    queueKey: varchar("queue_key", { length: 100 }),
    relatedResourceType: varchar("related_resource_type", { length: 32 }).notNull(),
    relatedResourceId: uuid("related_resource_id").notNull(),
    originatingOutboxEventId: uuid("originating_outbox_event_id").notNull(),
    templateKey: varchar("template_key", { length: 128 }).notNull(),
    templateVersion: integer("template_version").notNull(),
    payloadCiphertext: binary("payload_ciphertext"),
    status: varchar("status", { length: 24 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 128 }).notNull(),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true }),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    claimedByMembershipId: uuid("claimed_by_membership_id"),
    lastErrorCategory: varchar("last_error_category", { length: 100 }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "notifications_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "notifications_related_resource_uuid_v7_check",
      sql`${table.relatedResourceId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "notifications_originating_outbox_uuid_v7_check",
      sql`${table.originatingOutboxEventId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "notifications_type_check",
      sql`${table.notificationType} in ('staff_task', 'customer_message', 'staff_alert')`,
    ),
    check(
      "notifications_audience_shape_check",
      sql`(${table.audienceType} = 'membership'
          and ${table.recipientMembershipId} is not null
          and ${table.recipientContactId} is null
          and ${table.queueKey} is null)
        or (${table.audienceType} = 'contact'
          and ${table.recipientMembershipId} is null
          and ${table.recipientContactId} is not null
          and ${table.queueKey} is null)
        or (${table.audienceType} = 'queue'
          and ${table.recipientMembershipId} is null
          and ${table.recipientContactId} is null
          and ${table.queueKey} is not null)`,
    ),
    check(
      "notifications_queue_key_check",
      sql`${table.queueKey} is null
        or (${table.queueKey} = lower(btrim(${table.queueKey}))
          and ${table.queueKey} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')`,
    ),
    check(
      "notifications_related_resource_type_check",
      sql`${table.relatedResourceType} in ('appointment_request', 'handoff', 'conversation', 'lead', 'channel_connection', 'ai_run')`,
    ),
    check(
      "notifications_template_check",
      sql`${table.templateKey} = lower(btrim(${table.templateKey}))
        and ${table.templateKey} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'
        and ${table.templateVersion} > 0`,
    ),
    check(
      "notifications_payload_ciphertext_check",
      sql`${table.payloadCiphertext} is null
        or octet_length(${table.payloadCiphertext}) between 1 and 65536`,
    ),
    check(
      "notifications_status_check",
      sql`${table.status} in ('pending', 'processing', 'delivered', 'failed', 'dead_lettered', 'cancelled')`,
    ),
    check(
      "notifications_dedupe_key_check",
      sql`${table.dedupeKey} = btrim(${table.dedupeKey})
        and length(${table.dedupeKey}) between 8 and 128`,
    ),
    check("notifications_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "notifications_delivery_shape_check",
      sql`(${table.status} = 'delivered') = (${table.deliveredAt} is not null)`,
    ),
    check(
      "notifications_retry_timestamps_check",
      sql`${table.nextAttemptAt} is null or ${table.nextAttemptAt} >= ${table.availableAt}`,
    ),
    check(
      "notifications_last_error_category_check",
      sql`${table.lastErrorCategory} is null
        or ${table.lastErrorCategory} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check("notifications_version_check", sql`${table.version} > 0`),
    check("notifications_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "notifications_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.recipientMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "notifications_recipient_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.recipientContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "notifications_recipient_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.claimedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "notifications_claimer_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.originatingOutboxEventId],
      foreignColumns: [outboxEvents.organizationId, outboxEvents.id],
      name: "notifications_originating_outbox_event_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("notifications_organization_id_id_unique").on(table.organizationId, table.id),
    unique("notifications_organization_dedupe_key_unique").on(
      table.organizationId,
      table.dedupeKey,
    ),
    index("notifications_organization_status_available_idx").on(
      table.organizationId,
      table.status,
      table.availableAt,
    ),
    index("notifications_organization_queue_status_created_idx").on(
      table.organizationId,
      table.queueKey,
      table.status,
      table.createdAt,
    ),
    index("notifications_organization_recipient_read_created_idx").on(
      table.organizationId,
      table.recipientMembershipId,
      table.readAt,
      table.createdAt.desc(),
    ),
    index("notifications_organization_resource_created_idx").on(
      table.organizationId,
      table.relatedResourceType,
      table.relatedResourceId,
      table.createdAt.desc(),
    ),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    notificationId: uuid("notification_id").notNull(),
    adapter: varchar("adapter", { length: 16 }).notNull(),
    attemptNo: integer("attempt_no").notNull(),
    providerRequestKey: varchar("provider_request_key", { length: 255 }).notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    providerStatusCode: integer("provider_status_code"),
    errorCategory: varchar("error_category", { length: 100 }),
    providerMessageIdHash: binary("provider_message_id_hash"),
    latencyMs: integer("latency_ms").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "notification_attempts_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "notification_attempts_adapter_check",
      sql`${table.adapter} in ('in_app', 'widget', 'telegram', 'email', 'sms', 'push')`,
    ),
    check("notification_attempts_attempt_no_check", sql`${table.attemptNo} > 0`),
    check(
      "notification_attempts_provider_request_key_check",
      sql`${table.providerRequestKey} = btrim(${table.providerRequestKey})
        and length(${table.providerRequestKey}) between 8 and 255`,
    ),
    check(
      "notification_attempts_outcome_check",
      sql`${table.outcome} in ('delivered', 'retryable_failure', 'permanent_failure')`,
    ),
    check(
      "notification_attempts_error_shape_check",
      sql`(${table.outcome} = 'delivered' and ${table.errorCategory} is null)
        or (${table.outcome} in ('retryable_failure', 'permanent_failure')
          and ${table.errorCategory} is not null)`,
    ),
    check(
      "notification_attempts_error_category_check",
      sql`${table.errorCategory} is null
        or ${table.errorCategory} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "notification_attempts_provider_status_code_check",
      sql`${table.providerStatusCode} is null or ${table.providerStatusCode} between 100 and 599`,
    ),
    check(
      "notification_attempts_provider_message_hash_check",
      sql`${table.providerMessageIdHash} is null
        or octet_length(${table.providerMessageIdHash}) between 16 and 128`,
    ),
    check(
      "notification_attempts_timing_check",
      sql`${table.finishedAt} >= ${table.startedAt} and ${table.latencyMs} >= 0`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "notification_attempts_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.notificationId],
      foreignColumns: [notifications.organizationId, notifications.id],
      name: "notification_attempts_notification_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("notification_attempts_organization_id_unique").on(table.organizationId, table.id),
    unique("notification_attempts_notification_adapter_attempt_unique").on(
      table.organizationId,
      table.notificationId,
      table.adapter,
      table.attemptNo,
    ),
    unique("notification_attempts_provider_request_key_unique").on(
      table.organizationId,
      table.adapter,
      table.providerRequestKey,
    ),
    index("notification_attempts_notification_attempt_idx").on(
      table.organizationId,
      table.notificationId,
      table.attemptNo,
    ),
    index("notification_attempts_outcome_finished_idx").on(
      table.organizationId,
      table.outcome,
      table.finishedAt,
    ),
    index("notification_attempts_provider_message_hash_idx").on(
      table.organizationId,
      table.adapter,
      table.providerMessageIdHash,
    ),
  ],
);
