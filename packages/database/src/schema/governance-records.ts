import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  cidr,
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

import { appointmentRequests } from "./appointment-records.js";
import { binary, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { conversations } from "./conversation-records.js";
import { leads } from "./leads.js";
import { locations } from "./locations.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { services } from "./services.js";
import { users } from "./users.js";

const uuidV7Pattern = sql.raw(
  "'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
);
const boundedCodePattern = sql.raw("'^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'");
const requestIdPattern = sql.raw("'^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$'");

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    actorType: varchar("actor_type", { length: 24 }).notNull(),
    actorId: uuid("actor_id"),
    actorMembershipId: uuid("actor_membership_id"),
    impersonationSessionId: uuid("impersonation_session_id"),
    supportGrantId: uuid("support_grant_id"),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: uuid("target_id"),
    action: varchar("action", { length: 128 }).notNull(),
    result: varchar("result", { length: 16 }).notNull(),
    reasonCode: varchar("reason_code", { length: 100 }),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    traceId: varchar("trace_id", { length: 128 }),
    correlationId: uuid("correlation_id").notNull(),
    sourceIpPrefix: cidr("source_ip_prefix"),
    userAgentHash: binary("user_agent_hash"),
    metadataRedacted: jsonb("metadata_redacted_jsonb")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("audit_events_id_uuid_v7_check", sql`${table.id}::text ~ ${uuidV7Pattern}`),
    check(
      "audit_events_event_action_target_check",
      sql`${table.eventType} = lower(btrim(${table.eventType}))
        and ${table.eventType} ~ ${boundedCodePattern}
        and ${table.action} = lower(btrim(${table.action}))
        and ${table.action} ~ ${boundedCodePattern}
        and ${table.targetType} = lower(btrim(${table.targetType}))
        and ${table.targetType} ~ ${boundedCodePattern}`,
    ),
    check(
      "audit_events_actor_check",
      sql`(${table.actorType} = 'system'
          and ${table.actorId} is null
          and ${table.actorMembershipId} is null)
        or (${table.actorType} = 'member'
          and ${table.actorId} is not null
          and ${table.actorMembershipId} is not null)
        or (${table.actorType} in ('customer', 'platform_operator')
          and ${table.actorId} is not null
          and ${table.actorMembershipId} is null)`,
    ),
    check(
      "audit_events_reference_uuid_v7_check",
      sql`(${table.actorId} is null or ${table.actorId}::text ~ ${uuidV7Pattern})
        and (${table.targetId} is null or ${table.targetId}::text ~ ${uuidV7Pattern})
        and (${table.impersonationSessionId} is null
          or ${table.impersonationSessionId}::text ~ ${uuidV7Pattern})
        and (${table.supportGrantId} is null
          or ${table.supportGrantId}::text ~ ${uuidV7Pattern})
        and ${table.correlationId}::text ~ ${uuidV7Pattern}`,
    ),
    check("audit_events_result_check", sql`${table.result} in ('succeeded', 'denied', 'failed')`),
    check(
      "audit_events_reason_code_check",
      sql`${table.reasonCode} is null or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "audit_events_request_trace_check",
      sql`${table.requestId} ~ ${requestIdPattern}
        and (${table.traceId} is null or ${table.traceId} ~ ${requestIdPattern})`,
    ),
    check(
      "audit_events_source_ip_prefix_check",
      sql`${table.sourceIpPrefix} is null
        or (family(${table.sourceIpPrefix}) = 4 and masklen(${table.sourceIpPrefix}) <= 24)
        or (family(${table.sourceIpPrefix}) = 6 and masklen(${table.sourceIpPrefix}) <= 64)`,
    ),
    check(
      "audit_events_user_agent_hash_check",
      sql`${table.userAgentHash} is null
        or octet_length(${table.userAgentHash}) between 16 and 128`,
    ),
    check(
      "audit_events_metadata_check",
      sql`jsonb_typeof(${table.metadataRedacted}) = 'object'
        and pg_column_size(${table.metadataRedacted}) <= 16384`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "audit_events_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "audit_events_actor_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("audit_events_organization_id_id_unique").on(table.organizationId, table.id),
    index("audit_events_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt.desc(),
    ),
    index("audit_events_organization_target_occurred_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
      table.occurredAt.desc(),
    ),
    index("audit_events_organization_actor_occurred_idx").on(
      table.organizationId,
      table.actorType,
      table.actorId,
      table.occurredAt.desc(),
    ),
  ],
);

export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey(),
    operatorPrincipalId: uuid("operator_principal_id").notNull(),
    action: varchar("action", { length: 128 }).notNull(),
    targetOrganizationId: uuid("target_organization_id"),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: uuid("target_id"),
    approvalReference: varchar("approval_reference", { length: 255 }).notNull(),
    reasonCode: varchar("reason_code", { length: 100 }).notNull(),
    result: varchar("result", { length: 16 }).notNull(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    sourceIpHash: binary("source_ip_hash").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    metadata: jsonb("metadata_jsonb")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("platform_audit_events_id_uuid_v7_check", sql`${table.id}::text ~ ${uuidV7Pattern}`),
    check(
      "platform_audit_events_operator_target_uuid_v7_check",
      sql`${table.operatorPrincipalId}::text ~ ${uuidV7Pattern}
        and (${table.targetId} is null or ${table.targetId}::text ~ ${uuidV7Pattern})`,
    ),
    check(
      "platform_audit_events_action_target_check",
      sql`${table.action} = lower(btrim(${table.action}))
        and ${table.action} ~ ${boundedCodePattern}
        and ${table.targetType} = lower(btrim(${table.targetType}))
        and ${table.targetType} ~ ${boundedCodePattern}`,
    ),
    check(
      "platform_audit_events_reference_reason_check",
      sql`${table.approvalReference} = btrim(${table.approvalReference})
        and length(${table.approvalReference}) between 1 and 255
        and ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "platform_audit_events_result_check",
      sql`${table.result} in ('succeeded', 'denied', 'failed')`,
    ),
    check("platform_audit_events_request_id_check", sql`${table.requestId} ~ ${requestIdPattern}`),
    check(
      "platform_audit_events_source_ip_hash_check",
      sql`octet_length(${table.sourceIpHash}) between 16 and 128`,
    ),
    check(
      "platform_audit_events_metadata_check",
      sql`jsonb_typeof(${table.metadata}) = 'object'
        and pg_column_size(${table.metadata}) <= 16384`,
    ),
    foreignKey({
      columns: [table.targetOrganizationId],
      foreignColumns: [organizations.id],
      name: "platform_audit_events_target_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("platform_audit_events_operator_occurred_idx").on(
      table.operatorPrincipalId,
      table.occurredAt.desc(),
    ),
    index("platform_audit_events_target_organization_occurred_idx").on(
      table.targetOrganizationId,
      table.occurredAt.desc(),
    ),
  ],
);

export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    contactId: uuid("contact_id"),
    requestType: varchar("request_type", { length: 16 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    requestedAt: timestamp("requested_at", { mode: "date", withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { mode: "date", withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    requestChannel: varchar("request_channel", { length: 64 }).notNull(),
    handledByMembershipId: uuid("handled_by_membership_id"),
    reasonCode: varchar("reason_code", { length: 100 }),
    requestDetailsCiphertext: binary("request_details_ciphertext").notNull(),
    exportArtifactRef: varchar("export_artifact_ref", { length: 512 }),
    artifactExpiresAt: timestamp("artifact_expires_at", { mode: "date", withTimezone: true }),
    legalHoldBlocked: boolean("legal_hold_blocked").default(false).notNull(),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("privacy_requests_id_uuid_v7_check", sql`${table.id}::text ~ ${uuidV7Pattern}`),
    check(
      "privacy_requests_request_type_check",
      sql`${table.requestType} in ('access', 'export', 'correct', 'restrict', 'erase')`,
    ),
    check(
      "privacy_requests_status_check",
      sql`${table.status} in ('received', 'identity_verification', 'in_progress', 'completed', 'rejected', 'cancelled')`,
    ),
    check(
      "privacy_requests_timestamps_check",
      sql`${table.dueAt} >= ${table.requestedAt}
        and (${table.verifiedAt} is null or ${table.verifiedAt} >= ${table.requestedAt})
        and (${table.completedAt} is null or ${table.completedAt} >= ${table.requestedAt})
        and (${table.status} = 'completed') = (${table.completedAt} is not null)
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "privacy_requests_request_channel_check",
      sql`${table.requestChannel} = lower(btrim(${table.requestChannel}))
        and ${table.requestChannel} ~ ${boundedCodePattern}`,
    ),
    check(
      "privacy_requests_reason_code_check",
      sql`${table.reasonCode} is null or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "privacy_requests_details_check",
      sql`octet_length(${table.requestDetailsCiphertext}) between 1 and 65536`,
    ),
    check(
      "privacy_requests_artifact_check",
      sql`(${table.exportArtifactRef} is null and ${table.artifactExpiresAt} is null)
        or (${table.exportArtifactRef} is not null
          and ${table.exportArtifactRef} = btrim(${table.exportArtifactRef})
          and length(${table.exportArtifactRef}) between 1 and 512
          and ${table.artifactExpiresAt} is not null
          and ${table.artifactExpiresAt} > ${table.requestedAt})`,
    ),
    check("privacy_requests_version_check", sql`${table.version} > 0`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "privacy_requests_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "privacy_requests_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.handledByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "privacy_requests_handler_membership_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("privacy_requests_organization_id_id_unique").on(table.organizationId, table.id),
    index("privacy_requests_organization_status_due_idx").on(
      table.organizationId,
      table.status,
      table.dueAt,
    ),
    index("privacy_requests_organization_contact_requested_idx").on(
      table.organizationId,
      table.contactId,
      table.requestedAt.desc(),
    ),
  ],
);

export const legalHolds = pgTable(
  "legal_holds",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    scopeType: varchar("scope_type", { length: 32 }).notNull(),
    scopeId: uuid("scope_id"),
    dataClass: varchar("data_class", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull(),
    reasonCiphertext: binary("reason_ciphertext").notNull(),
    placedByUserId: uuid("placed_by_user_id").notNull(),
    placedAt: timestamp("placed_at", { mode: "date", withTimezone: true }).notNull(),
    releasedByUserId: uuid("released_by_user_id"),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    approvalReference: varchar("approval_reference", { length: 255 }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("legal_holds_id_uuid_v7_check", sql`${table.id}::text ~ ${uuidV7Pattern}`),
    check(
      "legal_holds_scope_check",
      sql`(${table.scopeType} = 'organization'
          and ${table.scopeId} is null
          and ${table.dataClass} is null)
        or (${table.scopeType} in ('contact', 'conversation', 'appointment_request')
          and ${table.scopeId} is not null
          and ${table.scopeId}::text ~ ${uuidV7Pattern}
          and ${table.dataClass} is null)
        or (${table.scopeType} = 'data_class'
          and ${table.scopeId} is null
          and ${table.dataClass} is not null
          and ${table.dataClass} = lower(btrim(${table.dataClass}))
          and ${table.dataClass} ~ ${boundedCodePattern})`,
    ),
    check("legal_holds_status_check", sql`${table.status} in ('active', 'released')`),
    check(
      "legal_holds_reason_check",
      sql`octet_length(${table.reasonCiphertext}) between 1 and 65536`,
    ),
    check(
      "legal_holds_release_check",
      sql`(${table.status} = 'active'
          and ${table.releasedByUserId} is null
          and ${table.releasedAt} is null)
        or (${table.status} = 'released'
          and ${table.releasedByUserId} is not null
          and ${table.releasedAt} is not null
          and ${table.releasedAt} >= ${table.placedAt})`,
    ),
    check(
      "legal_holds_approval_reference_check",
      sql`${table.approvalReference} = btrim(${table.approvalReference})
        and length(${table.approvalReference}) between 1 and 255`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "legal_holds_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.placedByUserId],
      foreignColumns: [users.id],
      name: "legal_holds_placed_by_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.releasedByUserId],
      foreignColumns: [users.id],
      name: "legal_holds_released_by_user_id_users_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("legal_holds_organization_id_id_unique").on(table.organizationId, table.id),
    uniqueIndex("legal_holds_equivalent_active_unique")
      .on(
        table.organizationId,
        table.scopeType,
        sql`coalesce(${table.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${table.dataClass}, '')`,
      )
      .where(sql`${table.status} = 'active'`),
    index("legal_holds_organization_status_scope_idx").on(
      table.organizationId,
      table.status,
      table.scopeType,
      table.scopeId,
    ),
    index("legal_holds_organization_data_class_status_idx").on(
      table.organizationId,
      table.dataClass,
      table.status,
    ),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 6 }).notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    leadId: uuid("lead_id"),
    conversationId: uuid("conversation_id"),
    appointmentRequestId: uuid("appointment_request_id"),
    channelType: varchar("channel_type", { length: 16 }),
    locale: varchar("locale", { length: 2 }),
    campaignKey: varchar("campaign_key", { length: 128 }),
    serviceId: uuid("service_id"),
    locationId: uuid("location_id"),
    confirmationSource: varchar("confirmation_source", { length: 32 }),
    dimensions: jsonb("dimensions_jsonb")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    numericValueMinor: bigint("numeric_value_minor", { mode: "bigint" }),
    currency: varchar("currency", { length: 3 }),
    projectedAt: timestamp("projected_at", { mode: "date", withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("analytics_events_id_uuid_v7_check", sql`${table.id}::text ~ ${uuidV7Pattern}`),
    check(
      "analytics_events_source_event_uuid_v7_check",
      sql`${table.sourceEventId}::text ~ ${uuidV7Pattern}`,
    ),
    check(
      "analytics_events_event_type_check",
      sql`${table.eventType} in (
        'organization.created', 'organization.status_changed',
        'membership.activated', 'membership.scope_changed', 'membership.revoked',
        'location.changed', 'service.published', 'service.deactivated', 'service_price.published',
        'faq.published', 'business_policy.published',
        'channel_connection.activated', 'channel_connection.disabled', 'channel_connection.credential_rotated',
        'contact.created', 'contact.identity_added', 'contact.anonymized',
        'consent.granted', 'consent.declined', 'consent.withdrawn', 'consent.not_required_recorded',
        'lead.created', 'lead.engaged', 'lead.qualified', 'lead.disqualified',
        'lead.booking_requested', 'lead.converted', 'lead.closed', 'lead.reopened',
        'conversation.started', 'message.received', 'message.response_queued', 'message.sent',
        'conversation.status_changed', 'conversation.automation_mode_changed',
        'conversation.active_handoff_changed', 'conversation.resolved', 'conversation.closed',
        'appointment_request.created', 'appointment_request.staff_accepted',
        'appointment_request.customer_confirmation_requested', 'appointment_request.confirmed',
        'appointment_request.rejected', 'appointment_request.cancelled', 'appointment_request.expired',
        'appointment.attendance_recorded', 'appointment.attendance_corrected',
        'appointment.revenue_attributed', 'appointment.revenue_reversed',
        'handoff.requested', 'handoff.assigned', 'handoff.started', 'handoff.resolved',
        'handoff.cancelled', 'handoff.expired',
        'notification.created', 'notification.delivered', 'notification.failed', 'notification.dead_lettered',
        'ai_run.completed', 'ai_run.failed', 'ai_run.schema_rejected', 'ai_run.policy_denied')`,
    ),
    check(
      "analytics_events_schema_version_check",
      sql`(${table.eventType} = 'lead.reopened' and ${table.schemaVersion} in ('1', '2'))
        or (${table.eventType} <> 'lead.reopened' and ${table.schemaVersion} = '1')`,
    ),
    check(
      "analytics_events_channel_locale_check",
      sql`(${table.channelType} is null
          or ${table.channelType} in ('widget', 'telegram', 'instagram', 'whatsapp'))
        and (${table.locale} is null or ${table.locale} in ('uz', 'ru', 'en'))`,
    ),
    check(
      "analytics_events_campaign_key_check",
      sql`${table.campaignKey} is null
        or (${table.campaignKey} = lower(btrim(${table.campaignKey}))
          and ${table.campaignKey} ~ ${boundedCodePattern})`,
    ),
    check(
      "analytics_events_confirmation_source_check",
      sql`${table.confirmationSource} is null
        or ${table.confirmationSource} in ('customer_session', 'telegram', 'staff_attested_external')`,
    ),
    check(
      "analytics_events_dimensions_check",
      sql`jsonb_typeof(${table.dimensions}) = 'object'
        and pg_column_size(${table.dimensions}) <= 16384`,
    ),
    check(
      "analytics_events_money_shape_check",
      sql`(${table.numericValueMinor} is null and ${table.currency} is null)
        or (${table.numericValueMinor} is not null
          and ${table.currency} is not null
          and ${table.currency} ~ '^[A-Z]{3}$')`,
    ),
    check("analytics_events_timestamps_check", sql`${table.projectedAt} >= ${table.occurredAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "analytics_events_organization_id_organizations_id_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId],
      foreignColumns: [leads.organizationId, leads.id],
      name: "analytics_events_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "analytics_events_conversation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "analytics_events_appointment_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "analytics_events_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "analytics_events_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("analytics_events_organization_id_id_unique").on(table.organizationId, table.id),
    unique("analytics_events_source_projection_unique").on(
      table.organizationId,
      table.sourceEventId,
      table.eventType,
      table.schemaVersion,
    ),
    index("analytics_events_organization_occurred_event_idx").on(
      table.organizationId,
      table.occurredAt,
      table.eventType,
    ),
    index("analytics_events_organization_lead_occurred_idx").on(
      table.organizationId,
      table.leadId,
      table.occurredAt,
    ),
    index("analytics_events_organization_appointment_occurred_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.occurredAt,
    ),
  ],
);
