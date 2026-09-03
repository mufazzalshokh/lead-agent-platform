import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

import { binary, immutableCreatedAt, mutableColumns } from "./common.js";
import { contacts } from "./contacts.js";
import { conversations, messages } from "./conversation-records.js";
import { leads } from "./customer-records.js";
import { locationVersions, locations } from "./locations.js";
import { memberships } from "./memberships.js";
import { organizations } from "./organizations.js";
import { businessPolicies, serviceVersions, services } from "./services.js";

export const appointmentRequests = pgTable(
  "appointment_requests",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    sourceMessageId: uuid("source_message_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    serviceVersionId: uuid("service_version_id").notNull(),
    locationId: uuid("location_id").notNull(),
    locationVersionId: uuid("location_version_id").notNull(),
    businessPolicyId: uuid("business_policy_id").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    requestDedupeKey: varchar("request_dedupe_key", { length: 128 }).notNull(),
    customerNotesCiphertext: binary("customer_notes_ciphertext"),
    staffDecidedByMembershipId: uuid("staff_decided_by_membership_id"),
    staffDecidedAt: timestamp("staff_decided_at", { mode: "date", withTimezone: true }),
    staffDecisionReasonCode: varchar("staff_decision_reason_code", { length: 100 }),
    startAt: timestamp("start_at", { mode: "date", withTimezone: true }),
    endAt: timestamp("end_at", { mode: "date", withTimezone: true }),
    offeredTimeZone: varchar("offered_time_zone", { length: 255 }),
    offeredLocalStart: timestamp("offered_local_start", {
      mode: "string",
      withTimezone: false,
    }),
    offerVersion: integer("offer_version").default(0).notNull(),
    confirmationIssuedAt: timestamp("confirmation_issued_at", {
      mode: "date",
      withTimezone: true,
    }),
    offerExpiresAt: timestamp("offer_expires_at", { mode: "date", withTimezone: true }),
    confirmationTokenHash: binary("confirmation_token_hash"),
    confirmationTokenConsumedAt: timestamp("confirmation_token_consumed_at", {
      mode: "date",
      withTimezone: true,
    }),
    confirmedAt: timestamp("confirmed_at", { mode: "date", withTimezone: true }),
    confirmationSource: varchar("confirmation_source", { length: 32 }),
    rejectionReasonCode: varchar("rejection_reason_code", { length: 100 }),
    cancellationReasonCode: varchar("cancellation_reason_code", { length: 100 }),
    cancelledByType: varchar("cancelled_by_type", { length: 16 }),
    expiredAt: timestamp("expired_at", { mode: "date", withTimezone: true }),
    ...mutableColumns(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_requests_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "appointment_requests_status_check",
      sql`${table.status} in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')`,
    ),
    check(
      "appointment_requests_dedupe_key_check",
      sql`${table.requestDedupeKey} = btrim(${table.requestDedupeKey})
        and length(${table.requestDedupeKey}) between 8 and 128`,
    ),
    check(
      "appointment_requests_notes_ciphertext_check",
      sql`${table.customerNotesCiphertext} is null
        or octet_length(${table.customerNotesCiphertext}) between 1 and 65536`,
    ),
    check(
      "appointment_requests_staff_decision_check",
      sql`(${table.staffDecidedByMembershipId} is null) = (${table.staffDecidedAt} is null)`,
    ),
    check(
      "appointment_requests_reason_codes_check",
      sql`(${table.staffDecisionReasonCode} is null
          or ${table.staffDecisionReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        and (${table.rejectionReasonCode} is null
          or ${table.rejectionReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')
        and (${table.cancellationReasonCode} is null
          or ${table.cancellationReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$')`,
    ),
    check(
      "appointment_requests_offer_shape_check",
      sql`(${table.startAt} is null
          and ${table.endAt} is null
          and ${table.offeredTimeZone} is null
          and ${table.offeredLocalStart} is null
          and ${table.offerVersion} = 0)
        or (${table.startAt} is not null
          and ${table.endAt} is not null
          and ${table.startAt} < ${table.endAt}
          and ${table.offeredTimeZone} is not null
          and ${table.offeredLocalStart} is not null
          and ${table.offerVersion} > 0)`,
    ),
    check(
      "appointment_requests_offered_time_zone_check",
      sql`${table.offeredTimeZone} is null
        or (${table.offeredTimeZone} = btrim(${table.offeredTimeZone})
          and length(${table.offeredTimeZone}) between 1 and 255
          and (${table.offeredTimeZone} = 'UTC'
            or ${table.offeredTimeZone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
          and timezone(${table.offeredTimeZone}, timestamptz '2000-01-01 00:00:00+00') is not null)`,
    ),
    check(
      "appointment_requests_confirmation_interval_check",
      sql`(${table.confirmationIssuedAt} is null and ${table.offerExpiresAt} is null)
        or (${table.confirmationIssuedAt} is not null
          and ${table.offerExpiresAt} is not null
          and ${table.confirmationIssuedAt} < ${table.offerExpiresAt}
          and ${table.offerVersion} > 0)`,
    ),
    check(
      "appointment_requests_confirmation_token_check",
      sql`(${table.confirmationTokenHash} is null
          or octet_length(${table.confirmationTokenHash}) between 16 and 128)
        and (${table.confirmationTokenConsumedAt} is null
          or (${table.confirmationTokenHash} is not null
            and ${table.confirmationIssuedAt} is not null
            and ${table.offerExpiresAt} is not null
            and ${table.confirmationTokenConsumedAt} >= ${table.confirmationIssuedAt}
            and ${table.confirmationTokenConsumedAt} < ${table.offerExpiresAt}))`,
    ),
    check(
      "appointment_requests_confirmation_source_check",
      sql`${table.confirmationSource} is null
        or ${table.confirmationSource} in ('customer_session', 'telegram', 'staff_attested_external')`,
    ),
    check(
      "appointment_requests_confirmation_result_check",
      sql`(${table.confirmedAt} is null and ${table.confirmationSource} is null)
        or (${table.confirmedAt} is not null
          and ${table.confirmationSource} is not null
          and ${table.confirmationIssuedAt} is not null
          and ${table.offerExpiresAt} is not null
          and ${table.confirmedAt} >= ${table.confirmationIssuedAt}
          and ${table.confirmedAt} < ${table.offerExpiresAt})`,
    ),
    check(
      "appointment_requests_terminal_reason_shape_check",
      sql`(${table.status} = 'rejected') = (${table.rejectionReasonCode} is not null)
        and (${table.status} = 'cancelled') = (${table.cancellationReasonCode} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelledByType} is not null)
        and (${table.status} = 'expired') = (${table.expiredAt} is not null)
        and (${table.cancelledByType} is null
          or ${table.cancelledByType} in ('customer', 'member'))`,
    ),
    check(
      "appointment_requests_lifecycle_shape_check",
      sql`(${table.status} = 'requested'
          and ${table.staffDecidedAt} is null
          and ${table.startAt} is null
          and ${table.confirmationIssuedAt} is null
          and ${table.confirmedAt} is null)
        or (${table.status} = 'rejected'
          and ${table.staffDecidedAt} is not null
          and ${table.staffDecisionReasonCode} is not null
          and ${table.staffDecisionReasonCode} = ${table.rejectionReasonCode}
          and ${table.startAt} is null
          and ${table.confirmationIssuedAt} is null
          and ${table.confirmedAt} is null)
        or (${table.status} in ('staff_accepted', 'awaiting_customer_confirmation', 'confirmed')
          and ${table.staffDecidedAt} is not null
          and ${table.startAt} is not null
          and (${table.status} <> 'staff_accepted' or ${table.confirmationIssuedAt} is null)
          and (${table.status} <> 'awaiting_customer_confirmation'
            or (${table.confirmationIssuedAt} is not null and ${table.confirmedAt} is null))
          and (${table.status} <> 'confirmed' or ${table.confirmedAt} is not null))
        or ${table.status} in ('cancelled', 'expired')`,
    ),
    check(
      "appointment_requests_chronology_check",
      sql`(${table.staffDecidedAt} is null or ${table.staffDecidedAt} >= ${table.createdAt})
        and (${table.startAt} is null
          or ${table.staffDecidedAt} is null
          or ${table.startAt} > ${table.staffDecidedAt})
        and (${table.confirmationIssuedAt} is null
          or ${table.staffDecidedAt} is null
          or ${table.confirmationIssuedAt} >= ${table.staffDecidedAt})
        and (${table.expiredAt} is null or ${table.expiredAt} >= ${table.createdAt})`,
    ),
    check("appointment_requests_version_check", sql`${table.version} > 0`),
    check("appointment_requests_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_requests_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: "appointment_requests_contact_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.leadId],
      foreignColumns: [leads.organizationId, leads.id],
      name: "appointment_requests_lead_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: "appointment_requests_conversation_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.contactId, table.leadId, table.conversationId],
      foreignColumns: [
        conversations.organizationId,
        conversations.contactId,
        conversations.leadId,
        conversations.id,
      ],
      name: "appointment_requests_conversation_context_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.conversationId, table.sourceMessageId],
      foreignColumns: [messages.organizationId, messages.conversationId, messages.id],
      name: "appointment_requests_source_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "appointment_requests_service_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.serviceId, table.serviceVersionId],
      foreignColumns: [
        serviceVersions.organizationId,
        serviceVersions.serviceId,
        serviceVersions.id,
      ],
      name: "appointment_requests_service_version_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: "appointment_requests_location_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.locationId, table.locationVersionId],
      foreignColumns: [
        locationVersions.organizationId,
        locationVersions.locationId,
        locationVersions.id,
      ],
      name: "appointment_requests_location_version_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.businessPolicyId],
      foreignColumns: [businessPolicies.organizationId, businessPolicies.id],
      name: "appointment_requests_business_policy_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.staffDecidedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "appointment_requests_staff_decider_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_requests_organization_id_id_unique").on(table.organizationId, table.id),
    unique("appointment_requests_organization_contact_id_unique").on(
      table.organizationId,
      table.contactId,
      table.id,
    ),
    unique("appointment_requests_organization_dedupe_unique").on(
      table.organizationId,
      table.requestDedupeKey,
    ),
    uniqueIndex("appointment_requests_source_message_unique")
      .on(table.organizationId, table.sourceMessageId)
      .where(sql`${table.sourceMessageId} is not null`),
    uniqueIndex("appointment_requests_confirmation_token_unique")
      .on(table.confirmationTokenHash)
      .where(sql`${table.confirmationTokenHash} is not null`),
    index("appointment_requests_organization_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("appointment_requests_organization_location_status_idx").on(
      table.organizationId,
      table.locationId,
      table.status,
      table.createdAt,
    ),
    index("appointment_requests_organization_lead_created_idx").on(
      table.organizationId,
      table.leadId,
      table.createdAt.desc(),
    ),
    index("appointment_requests_organization_offer_expiry_idx")
      .on(table.organizationId, table.offerExpiresAt)
      .where(sql`${table.status} in ('staff_accepted', 'awaiting_customer_confirmation')`),
    index("appointment_requests_organization_staff_decision_idx").on(
      table.organizationId,
      table.staffDecidedByMembershipId,
      table.staffDecidedAt,
    ),
  ],
);

export const appointmentRequestPreferences = pgTable(
  "appointment_request_preferences",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    appointmentRequestId: uuid("appointment_request_id").notNull(),
    preferenceOrder: smallint("preference_order").notNull(),
    startAt: timestamp("start_at", { mode: "date", withTimezone: true }),
    endAt: timestamp("end_at", { mode: "date", withTimezone: true }),
    timeZone: varchar("time_zone", { length: 255 }).notNull(),
    originalLocalTextCiphertext: binary("original_local_text_ciphertext"),
    localStart: timestamp("local_start", { mode: "string", withTimezone: false }),
    localEnd: timestamp("local_end", { mode: "string", withTimezone: false }),
    precision: varchar("precision", { length: 16 }).notNull(),
    createdAt: immutableCreatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_request_preferences_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("appointment_request_preferences_order_check", sql`${table.preferenceOrder} > 0`),
    check(
      "appointment_request_preferences_time_zone_check",
      sql`${table.timeZone} = btrim(${table.timeZone})
        and length(${table.timeZone}) between 1 and 255
        and (${table.timeZone} = 'UTC'
          or ${table.timeZone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+$')
        and timezone(${table.timeZone}, timestamptz '2000-01-01 00:00:00+00') is not null`,
    ),
    check(
      "appointment_request_preferences_precision_check",
      sql`${table.precision} in ('exact', 'part_of_day', 'date_only', 'free_text')`,
    ),
    check(
      "appointment_request_preferences_ciphertext_check",
      sql`${table.originalLocalTextCiphertext} is null
        or octet_length(${table.originalLocalTextCiphertext}) between 1 and 8192`,
    ),
    check(
      "appointment_request_preferences_shape_check",
      sql`(${table.precision} in ('exact', 'part_of_day', 'date_only')
          and ${table.startAt} is not null
          and ${table.endAt} is not null
          and ${table.startAt} < ${table.endAt}
          and ${table.localStart} is not null
          and ${table.localEnd} is not null
          and ${table.localStart} < ${table.localEnd})
        or (${table.precision} = 'free_text'
          and ${table.originalLocalTextCiphertext} is not null
          and ${table.startAt} is null
          and ${table.endAt} is null
          and ${table.localStart} is null
          and ${table.localEnd} is null)`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_request_preferences_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "appointment_request_preferences_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_request_preferences_org_id_unique").on(table.organizationId, table.id),
    unique("appointment_request_preferences_request_order_unique").on(
      table.organizationId,
      table.appointmentRequestId,
      table.preferenceOrder,
    ),
    index("appointment_request_preferences_request_order_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.preferenceOrder,
    ),
    index("appointment_request_preferences_organization_start_idx").on(
      table.organizationId,
      table.startAt,
    ),
  ],
);

export const appointmentRequestTransitions = pgTable(
  "appointment_request_transitions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    appointmentRequestId: uuid("appointment_request_id").notNull(),
    fromStatus: varchar("from_status", { length: 40 }),
    toStatus: varchar("to_status", { length: 40 }).notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    command: varchar("command", { length: 48 }).notNull(),
    offerVersion: integer("offer_version"),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorContactId: uuid("actor_contact_id"),
    actorMembershipId: uuid("actor_membership_id"),
    reasonCode: varchar("reason_code", { length: 100 }),
    sourceMessageId: uuid("source_message_id"),
    correlationId: uuid("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    metadata: jsonb("metadata_jsonb")
      .default(sql`'{}'::jsonb`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_request_transitions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "appointment_request_transitions_correlation_uuid_v7_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "appointment_request_transitions_from_status_check",
      sql`${table.fromStatus} is null
        or ${table.fromStatus} in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')`,
    ),
    check(
      "appointment_request_transitions_to_status_check",
      sql`${table.toStatus} in ('requested', 'staff_accepted', 'awaiting_customer_confirmation', 'confirmed', 'rejected', 'cancelled', 'expired')`,
    ),
    check(
      "appointment_request_transitions_status_change_check",
      sql`${table.fromStatus} is null or ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "appointment_request_transitions_command_check",
      sql`${table.command} in ('create_appointment_request', 'staff_accept_appointment_request', 'reject_appointment_request', 'prepare_customer_confirmation', 'confirm_appointment_request', 'cancel_appointment_request', 'expire_appointment_request')`,
    ),
    check(
      "appointment_request_transitions_version_check",
      sql`${table.aggregateVersion} > 0
        and (${table.offerVersion} is null or ${table.offerVersion} > 0)`,
    ),
    check(
      "appointment_request_transitions_actor_type_check",
      sql`${table.actorType} in ('customer', 'member', 'system')`,
    ),
    check(
      "appointment_request_transitions_actor_shape_check",
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
      "appointment_request_transitions_reason_code_check",
      sql`${table.reasonCode} is null
        or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "appointment_request_transitions_metadata_check",
      sql`jsonb_typeof(${table.metadata}) = 'object'
        and pg_column_size(${table.metadata}) <= 16384`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_request_transitions_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "appointment_request_transitions_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.actorContactId, table.appointmentRequestId],
      foreignColumns: [
        appointmentRequests.organizationId,
        appointmentRequests.contactId,
        appointmentRequests.id,
      ],
      name: "appointment_request_transitions_customer_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "appointment_request_transitions_member_actor_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceMessageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: "appointment_request_transitions_source_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_request_transitions_org_id_unique").on(table.organizationId, table.id),
    unique("appointment_request_transitions_request_version_unique").on(
      table.organizationId,
      table.appointmentRequestId,
      table.aggregateVersion,
    ),
    index("appointment_request_transitions_request_occurred_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.occurredAt,
    ),
    index("appointment_request_transitions_status_occurred_idx").on(
      table.organizationId,
      table.toStatus,
      table.occurredAt,
    ),
  ],
);

export const appointmentConfirmationEvidence = pgTable(
  "appointment_confirmation_evidence",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    appointmentRequestId: uuid("appointment_request_id").notNull(),
    offerVersion: integer("offer_version").notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    customerContactId: uuid("customer_contact_id").notNull(),
    recordedByMembershipId: uuid("recorded_by_membership_id"),
    sourceMessageId: uuid("source_message_id"),
    externalReferenceHash: binary("external_reference_hash"),
    customerActedAt: timestamp("customer_acted_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true }).notNull(),
    attestationMethod: varchar("attestation_method", { length: 16 }),
    attestationReasonCode: varchar("attestation_reason_code", { length: 100 }),
    evidenceCiphertext: binary("evidence_ciphertext"),
    correlationId: uuid("correlation_id").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_confirmation_evidence_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "appointment_confirmation_evidence_correlation_uuid_check",
      sql`${table.correlationId}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("appointment_confirmation_evidence_offer_version_check", sql`${table.offerVersion} > 0`),
    check(
      "appointment_confirmation_evidence_outcome_check",
      sql`${table.outcome} in ('confirmed', 'declined')`,
    ),
    check(
      "appointment_confirmation_evidence_source_check",
      sql`${table.source} in ('customer_session', 'telegram', 'staff_attested_external')`,
    ),
    check(
      "appointment_confirmation_evidence_source_shape_check",
      sql`(${table.source} = 'customer_session'
          and ${table.recordedByMembershipId} is null
          and ${table.sourceMessageId} is null
          and ${table.attestationMethod} is null
          and ${table.attestationReasonCode} is null)
        or (${table.source} = 'telegram'
          and ${table.recordedByMembershipId} is null
          and ${table.sourceMessageId} is not null
          and ${table.attestationMethod} is null
          and ${table.attestationReasonCode} is null)
        or (${table.source} = 'staff_attested_external'
          and ${table.outcome} = 'confirmed'
          and ${table.recordedByMembershipId} is not null
          and ${table.sourceMessageId} is null
          and ${table.attestationMethod} in ('phone', 'in_person')
          and ${table.attestationReasonCode} is not null)`,
    ),
    check(
      "appointment_confirmation_evidence_reason_code_check",
      sql`${table.attestationReasonCode} is null
        or ${table.attestationReasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "appointment_confirmation_evidence_external_hash_check",
      sql`${table.externalReferenceHash} is null
        or octet_length(${table.externalReferenceHash}) between 16 and 128`,
    ),
    check(
      "appointment_confirmation_evidence_ciphertext_check",
      sql`${table.evidenceCiphertext} is null
        or octet_length(${table.evidenceCiphertext}) between 1 and 65536`,
    ),
    check(
      "appointment_confirmation_evidence_timestamps_check",
      sql`${table.recordedAt} >= ${table.customerActedAt}`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_confirmation_evidence_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "appointment_confirmation_evidence_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.customerContactId, table.appointmentRequestId],
      foreignColumns: [
        appointmentRequests.organizationId,
        appointmentRequests.contactId,
        appointmentRequests.id,
      ],
      name: "appointment_confirmation_evidence_customer_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.recordedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "appointment_confirmation_evidence_member_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceMessageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: "appointment_confirmation_evidence_message_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_confirmation_evidence_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("appointment_confirmation_evidence_offer_unique")
      .on(table.organizationId, table.appointmentRequestId, table.offerVersion)
      .where(sql`${table.outcome} in ('confirmed', 'declined')`),
    uniqueIndex("appointment_confirmation_evidence_external_unique")
      .on(table.organizationId, table.source, table.externalReferenceHash)
      .where(sql`${table.externalReferenceHash} is not null`),
    index("appointment_confirmation_evidence_request_recorded_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.recordedAt.desc(),
    ),
    index("appointment_confirmation_evidence_source_recorded_idx").on(
      table.organizationId,
      table.source,
      table.recordedAt,
    ),
  ],
);

export const appointmentRequestAttendance = pgTable(
  "appointment_request_attendance",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    appointmentRequestId: uuid("appointment_request_id").notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }),
    recordedByMembershipId: uuid("recorded_by_membership_id").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true }).notNull(),
    source: varchar("source", { length: 24 }).notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    supersedesId: uuid("supersedes_id"),
    reasonCode: varchar("reason_code", { length: 100 }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_request_attendance_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "appointment_request_attendance_outcome_check",
      sql`${table.outcome} in ('attended', 'did_not_attend', 'unknown')`,
    ),
    check(
      "appointment_request_attendance_source_check",
      sql`${table.source} in ('staff_manual', 'approved_import')`,
    ),
    check(
      "appointment_request_attendance_supersedes_check",
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
    check(
      "appointment_request_attendance_reason_code_check",
      sql`${table.reasonCode} is null
        or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_request_attendance_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "appointment_request_attendance_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.recordedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "appointment_request_attendance_member_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId, table.supersedesId],
      foreignColumns: [table.organizationId, table.appointmentRequestId, table.id],
      name: "appointment_request_attendance_superseded_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_request_attendance_org_id_unique").on(table.organizationId, table.id),
    unique("appointment_request_attendance_request_id_unique").on(
      table.organizationId,
      table.appointmentRequestId,
      table.id,
    ),
    uniqueIndex("appointment_request_attendance_one_current_unique")
      .on(table.organizationId, table.appointmentRequestId)
      .where(sql`${table.isCurrent} = true`),
    index("appointment_request_attendance_outcome_occurred_idx").on(
      table.organizationId,
      table.outcome,
      table.occurredAt,
    ),
    index("appointment_request_attendance_request_recorded_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.recordedAt.desc(),
    ),
  ],
);

export const appointmentRevenueAttributions = pgTable(
  "appointment_revenue_attributions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    appointmentRequestId: uuid("appointment_request_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    entryType: varchar("entry_type", { length: 16 }).notNull(),
    categoryCode: varchar("category_code", { length: 100 }).notNull(),
    recognizedAt: timestamp("recognized_at", { mode: "date", withTimezone: true }).notNull(),
    recordedByMembershipId: uuid("recorded_by_membership_id").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true }).notNull(),
    source: varchar("source", { length: 24 }).notNull(),
    reversesAttributionId: uuid("reverses_attribution_id"),
    externalReferenceHash: binary("external_reference_hash"),
    reasonCode: varchar("reason_code", { length: 100 }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "appointment_revenue_attributions_id_uuid_v7_check",
      sql`${table.id}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check("appointment_revenue_attributions_amount_check", sql`${table.amountMinor} > 0`),
    check("appointment_revenue_attributions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "appointment_revenue_attributions_entry_type_check",
      sql`${table.entryType} in ('charge', 'adjustment', 'reversal')`,
    ),
    check(
      "appointment_revenue_attributions_entry_shape_check",
      sql`(${table.entryType} = 'reversal' and ${table.reversesAttributionId} is not null)
        or (${table.entryType} in ('charge', 'adjustment')
          and ${table.reversesAttributionId} is null)`,
    ),
    check(
      "appointment_revenue_attributions_category_check",
      sql`${table.categoryCode} = lower(btrim(${table.categoryCode}))
        and ${table.categoryCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    check(
      "appointment_revenue_attributions_source_check",
      sql`${table.source} in ('staff_manual', 'approved_import')`,
    ),
    check(
      "appointment_revenue_attributions_external_hash_check",
      sql`${table.externalReferenceHash} is null
        or octet_length(${table.externalReferenceHash}) between 16 and 128`,
    ),
    check(
      "appointment_revenue_attributions_reason_code_check",
      sql`${table.reasonCode} is null
        or ${table.reasonCode} ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'`,
    ),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
      name: "appointment_revenue_attributions_organization_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.appointmentRequestId],
      foreignColumns: [appointmentRequests.organizationId, appointmentRequests.id],
      name: "appointment_revenue_attributions_request_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.organizationId, table.recordedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "appointment_revenue_attributions_member_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [
        table.organizationId,
        table.appointmentRequestId,
        table.currency,
        table.reversesAttributionId,
      ],
      foreignColumns: [table.organizationId, table.appointmentRequestId, table.currency, table.id],
      name: "appointment_revenue_attributions_reversed_entry_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("appointment_revenue_attributions_org_id_unique").on(table.organizationId, table.id),
    unique("appointment_revenue_attributions_request_currency_id_unique").on(
      table.organizationId,
      table.appointmentRequestId,
      table.currency,
      table.id,
    ),
    uniqueIndex("appointment_revenue_attributions_import_reference_unique")
      .on(table.organizationId, table.source, table.externalReferenceHash)
      .where(
        sql`${table.source} = 'approved_import' and ${table.externalReferenceHash} is not null`,
      ),
    uniqueIndex("appointment_revenue_attributions_one_reversal_unique")
      .on(table.organizationId, table.reversesAttributionId)
      .where(sql`${table.reversesAttributionId} is not null`),
    index("appointment_revenue_attributions_recognized_currency_idx").on(
      table.organizationId,
      table.recognizedAt,
      table.currency,
    ),
    index("appointment_revenue_attributions_request_recorded_idx").on(
      table.organizationId,
      table.appointmentRequestId,
      table.recordedAt,
    ),
  ],
);
