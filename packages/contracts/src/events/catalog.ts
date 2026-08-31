import Type from "typebox";

import {
  AiRunIdSchema,
  AppointmentRequestIdSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  SchemaIdSchema,
  ServiceIdSchema,
} from "../shared/identifiers.js";
import { LocaleSchema } from "../shared/localization.js";
import { MoneySchema, type Money } from "../shared/money.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { AggregateVersionSchema, SchemaVersionSchema } from "../shared/version.js";
import {
  boundedCodeArraySchema,
  boundedCodeSchema,
  defineDomainEvent,
  embedSchema,
  embedSchemaAs,
  type JsonWire,
} from "./internal.js";

const organizationStatusSchema = () =>
  Type.Union([Type.Literal("active"), Type.Literal("suspended"), Type.Literal("closed")]);

const membershipStatusSchema = () =>
  Type.Union([
    Type.Literal("invited"),
    Type.Literal("active"),
    Type.Literal("suspended"),
    Type.Literal("revoked"),
  ]);

const leadStatusSchema = () =>
  Type.Union([
    Type.Literal("new"),
    Type.Literal("engaged"),
    Type.Literal("qualified"),
    Type.Literal("booking_requested"),
    Type.Literal("converted"),
    Type.Literal("disqualified"),
    Type.Literal("closed"),
  ]);

const conversationStatusSchema = () =>
  Type.Union([
    Type.Literal("open"),
    Type.Literal("awaiting_lead"),
    Type.Literal("awaiting_staff"),
    Type.Literal("resolved"),
    Type.Literal("closed"),
  ]);

const appointmentStatusSchema = () =>
  Type.Union([
    Type.Literal("requested"),
    Type.Literal("staff_accepted"),
    Type.Literal("awaiting_customer_confirmation"),
    Type.Literal("confirmed"),
    Type.Literal("rejected"),
    Type.Literal("cancelled"),
    Type.Literal("expired"),
  ]);

const handoffStatusSchema = () =>
  Type.Union([
    Type.Literal("requested"),
    Type.Literal("assigned"),
    Type.Literal("in_progress"),
    Type.Literal("resolved"),
    Type.Literal("cancelled"),
    Type.Literal("expired"),
  ]);

const channelTypeSchema = () => Type.Union([Type.Literal("widget"), Type.Literal("telegram")]);

const notificationAttemptCountSchema = () =>
  Type.Integer({
    description: "Positive safe integer delivery-attempt count.",
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 1,
  });

const consentPurposeSchema = () =>
  Type.Union([
    Type.Literal("booking_follow_up"),
    Type.Literal("service_messages"),
    Type.Literal("analytics_optional"),
    Type.Literal("marketing"),
  ]);

const actionTypeSchema = () =>
  Type.Union([
    Type.Literal("none"),
    Type.Literal("request_information"),
    Type.Literal("create_appointment_request"),
    Type.Literal("confirm_appointment"),
    Type.Literal("decline_appointment"),
    Type.Literal("request_handoff"),
  ]);

export const domainEventDefinitions = {
  "organization.created": defineDomainEvent(
    "organization.created",
    "organization",
    OrganizationIdSchema,
    {
      default_locale: embedSchema(LocaleSchema),
      organization_status: organizationStatusSchema(),
    },
  ),
  "organization.status_changed": defineDomainEvent(
    "organization.status_changed",
    "organization",
    OrganizationIdSchema,
    {
      organization_status: organizationStatusSchema(),
      previous_organization_status: organizationStatusSchema(),
      reason_code: boundedCodeSchema(),
    },
  ),
  "membership.activated": defineDomainEvent(
    "membership.activated",
    "membership",
    MembershipIdSchema,
    {
      membership_status: Type.Literal("active"),
      previous_membership_status: Type.Union([Type.Literal("invited"), Type.Literal("suspended")]),
    },
  ),
  "membership.scope_changed": defineDomainEvent(
    "membership.scope_changed",
    "membership",
    MembershipIdSchema,
    {
      changed_scope_fields: Type.Array(
        Type.Union([Type.Literal("role"), Type.Literal("allowed_location_ids")]),
        { maxItems: 2, minItems: 1, uniqueItems: true },
      ),
    },
  ),
  "membership.revoked": defineDomainEvent("membership.revoked", "membership", MembershipIdSchema, {
    membership_status: Type.Literal("revoked"),
    previous_membership_status: membershipStatusSchema(),
    reason_code: boundedCodeSchema(),
  }),

  "location.changed": defineDomainEvent("location.changed", "location", LocationIdSchema, {
    changed_location_fields: Type.Array(
      Type.Union([
        Type.Literal("details"),
        Type.Literal("business_hours"),
        Type.Literal("closures"),
        Type.Literal("status"),
        Type.Literal("time_zone"),
      ]),
      { maxItems: 5, minItems: 1, uniqueItems: true },
    ),
  }),
  "service.published": defineDomainEvent("service.published", "service", ServiceIdSchema, {
    service_version: embedSchema(AggregateVersionSchema),
  }),
  "service.deactivated": defineDomainEvent("service.deactivated", "service", ServiceIdSchema, {
    reason_code: boundedCodeSchema(),
    service_active: Type.Literal(false),
  }),
  "service_price.published": defineDomainEvent(
    "service_price.published",
    "service",
    ServiceIdSchema,
    {
      price_type: Type.Union([
        Type.Literal("fixed"),
        Type.Literal("from"),
        Type.Literal("range"),
        Type.Literal("quote_required"),
      ]),
      service_price_id: embedSchema(ResourceIdSchema),
    },
  ),
  "faq.published": defineDomainEvent("faq.published", "faq", ResourceIdSchema, {
    faq_version: embedSchema(AggregateVersionSchema),
  }),
  "business_policy.published": defineDomainEvent(
    "business_policy.published",
    "business_policy",
    ResourceIdSchema,
    {
      business_policy_version: embedSchema(AggregateVersionSchema),
    },
  ),

  "channel_connection.activated": defineDomainEvent(
    "channel_connection.activated",
    "channel_connection",
    ChannelConnectionIdSchema,
    {
      channel_connection_status: Type.Literal("active"),
      channel_type: channelTypeSchema(),
    },
  ),
  "channel_connection.disabled": defineDomainEvent(
    "channel_connection.disabled",
    "channel_connection",
    ChannelConnectionIdSchema,
    {
      channel_connection_status: Type.Literal("disabled"),
      reason_code: boundedCodeSchema(),
    },
  ),
  "channel_connection.credential_rotated": defineDomainEvent(
    "channel_connection.credential_rotated",
    "channel_connection",
    ChannelConnectionIdSchema,
    {
      credential_version: embedSchema(AggregateVersionSchema),
    },
  ),

  "contact.created": defineDomainEvent("contact.created", "contact", ContactIdSchema, {
    preferred_locale: Type.Union([embedSchema(LocaleSchema), Type.Null()]),
  }),
  "contact.identity_added": defineDomainEvent(
    "contact.identity_added",
    "contact",
    ContactIdSchema,
    {
      contact_identity_id: embedSchema(ResourceIdSchema),
      identity_type: Type.Union([
        Type.Literal("phone"),
        Type.Literal("email"),
        Type.Literal("widget_participant"),
        Type.Literal("telegram_user"),
      ]),
    },
  ),
  "contact.anonymized": defineDomainEvent("contact.anonymized", "contact", ContactIdSchema, {
    anonymized: Type.Literal(true),
    reason_code: boundedCodeSchema(),
  }),
  "consent.granted": defineDomainEvent("consent.granted", "contact", ContactIdSchema, {
    consent_decision: Type.Literal("granted"),
    consent_record_id: embedSchema(ResourceIdSchema),
    purpose: consentPurposeSchema(),
  }),
  "consent.declined": defineDomainEvent("consent.declined", "contact", ContactIdSchema, {
    consent_decision: Type.Literal("declined"),
    consent_record_id: embedSchema(ResourceIdSchema),
    purpose: consentPurposeSchema(),
  }),
  "consent.withdrawn": defineDomainEvent("consent.withdrawn", "contact", ContactIdSchema, {
    consent_decision: Type.Literal("withdrawn"),
    consent_record_id: embedSchema(ResourceIdSchema),
    purpose: consentPurposeSchema(),
  }),
  "consent.not_required_recorded": defineDomainEvent(
    "consent.not_required_recorded",
    "contact",
    ContactIdSchema,
    {
      consent_decision: Type.Literal("not_required"),
      consent_record_id: embedSchema(ResourceIdSchema),
      purpose: consentPurposeSchema(),
    },
  ),

  "lead.created": defineDomainEvent("lead.created", "lead", LeadIdSchema, {
    contact_id: embedSchema(ContactIdSchema),
    lead_status: Type.Literal("new"),
  }),
  "lead.engaged": defineDomainEvent("lead.engaged", "lead", LeadIdSchema, {
    lead_status: Type.Literal("engaged"),
    source_message_id: embedSchema(MessageIdSchema),
  }),
  "lead.qualified": defineDomainEvent("lead.qualified", "lead", LeadIdSchema, {
    lead_status: Type.Literal("qualified"),
    policy_id: embedSchema(ResourceIdSchema),
    qualification_evaluation_id: embedSchema(ResourceIdSchema),
  }),
  "lead.disqualified": defineDomainEvent("lead.disqualified", "lead", LeadIdSchema, {
    lead_status: Type.Literal("disqualified"),
    policy_id: embedSchema(ResourceIdSchema),
    qualification_evaluation_id: embedSchema(ResourceIdSchema),
    reason_codes: boundedCodeArraySchema(),
  }),
  "lead.booking_requested": defineDomainEvent("lead.booking_requested", "lead", LeadIdSchema, {
    appointment_request_id: embedSchema(AppointmentRequestIdSchema),
    lead_status: Type.Literal("booking_requested"),
  }),
  "lead.converted": defineDomainEvent("lead.converted", "lead", LeadIdSchema, {
    appointment_request_id: embedSchema(AppointmentRequestIdSchema),
    lead_status: Type.Literal("converted"),
  }),
  "lead.closed": defineDomainEvent("lead.closed", "lead", LeadIdSchema, {
    lead_status: Type.Literal("closed"),
    previous_lead_status: leadStatusSchema(),
    reason_code: boundedCodeSchema(),
  }),
  "lead.reopened": defineDomainEvent("lead.reopened", "lead", LeadIdSchema, {
    lead_status: Type.Literal("engaged"),
    previous_lead_status: Type.Union([
      Type.Literal("disqualified"),
      Type.Literal("booking_requested"),
    ]),
    reason_code: boundedCodeSchema(),
  }),

  "conversation.started": defineDomainEvent(
    "conversation.started",
    "conversation",
    ConversationIdSchema,
    {
      channel_connection_id: embedSchema(ChannelConnectionIdSchema),
      contact_id: embedSchema(ContactIdSchema),
      conversation_status: Type.Literal("open"),
      lead_id: embedSchema(LeadIdSchema),
    },
  ),
  "message.received": defineDomainEvent("message.received", "conversation", ConversationIdSchema, {
    message_direction: Type.Literal("inbound"),
    message_id: embedSchema(MessageIdSchema),
  }),
  "message.response_queued": defineDomainEvent(
    "message.response_queued",
    "conversation",
    ConversationIdSchema,
    {
      message_direction: Type.Literal("outbound"),
      message_id: embedSchema(MessageIdSchema),
      message_status: Type.Literal("queued"),
    },
  ),
  "message.sent": defineDomainEvent("message.sent", "conversation", ConversationIdSchema, {
    message_id: embedSchema(MessageIdSchema),
    message_status: Type.Literal("sent"),
  }),
  "conversation.status_changed": defineDomainEvent(
    "conversation.status_changed",
    "conversation",
    ConversationIdSchema,
    {
      conversation_status: conversationStatusSchema(),
      previous_conversation_status: conversationStatusSchema(),
    },
  ),
  "conversation.resolved": defineDomainEvent(
    "conversation.resolved",
    "conversation",
    ConversationIdSchema,
    {
      conversation_status: Type.Literal("resolved"),
      previous_conversation_status: Type.Union([
        Type.Literal("open"),
        Type.Literal("awaiting_lead"),
        Type.Literal("awaiting_staff"),
      ]),
      resolution_code: boundedCodeSchema(),
    },
  ),
  "conversation.closed": defineDomainEvent(
    "conversation.closed",
    "conversation",
    ConversationIdSchema,
    {
      closure_code: boundedCodeSchema(),
      conversation_status: Type.Literal("closed"),
      previous_conversation_status: Type.Literal("resolved"),
    },
  ),

  "appointment_request.created": defineDomainEvent(
    "appointment_request.created",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("requested"),
      conversation_id: embedSchema(ConversationIdSchema),
      lead_id: embedSchema(LeadIdSchema),
      location_id: embedSchema(LocationIdSchema),
      service_id: embedSchema(ServiceIdSchema),
    },
  ),
  "appointment_request.staff_accepted": defineDomainEvent(
    "appointment_request.staff_accepted",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("staff_accepted"),
      location_id: embedSchema(LocationIdSchema),
      offer_version: embedSchema(AggregateVersionSchema),
      scheduled_start_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    },
  ),
  "appointment_request.customer_confirmation_requested": defineDomainEvent(
    "appointment_request.customer_confirmation_requested",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("awaiting_customer_confirmation"),
      confirmation_expires_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      offer_version: embedSchema(AggregateVersionSchema),
    },
  ),
  "appointment_request.confirmed": defineDomainEvent(
    "appointment_request.confirmed",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("confirmed"),
      confirmation_source: Type.Union([
        Type.Literal("customer_session"),
        Type.Literal("telegram"),
        Type.Literal("staff_attested_external"),
      ]),
      customer_confirmed_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      offer_version: embedSchema(AggregateVersionSchema),
    },
  ),
  "appointment_request.rejected": defineDomainEvent(
    "appointment_request.rejected",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("rejected"),
      reason_code: boundedCodeSchema(),
    },
  ),
  "appointment_request.cancelled": defineDomainEvent(
    "appointment_request.cancelled",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("cancelled"),
      previous_appointment_status: appointmentStatusSchema(),
      reason_code: boundedCodeSchema(),
    },
  ),
  "appointment_request.expired": defineDomainEvent(
    "appointment_request.expired",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      appointment_status: Type.Literal("expired"),
      previous_appointment_status: Type.Union([
        Type.Literal("requested"),
        Type.Literal("staff_accepted"),
        Type.Literal("awaiting_customer_confirmation"),
      ]),
      reason_code: boundedCodeSchema(),
    },
  ),

  "handoff.requested": defineDomainEvent("handoff.requested", "handoff", HandoffIdSchema, {
    conversation_id: embedSchema(ConversationIdSchema),
    handoff_status: Type.Literal("requested"),
    lead_id: embedSchema(LeadIdSchema),
    trigger_reason: Type.Union([
      Type.Literal("customer_requested"),
      Type.Literal("missing_authoritative_information"),
      Type.Literal("medical_or_safety"),
      Type.Literal("low_confidence"),
      Type.Literal("policy_blocked"),
      Type.Literal("ai_unavailable"),
      Type.Literal("delivery_problem"),
      Type.Literal("staff_created"),
      Type.Literal("other"),
    ]),
  }),
  "handoff.assigned": defineDomainEvent("handoff.assigned", "handoff", HandoffIdSchema, {
    assignee_membership_id: embedSchema(MembershipIdSchema),
    handoff_status: Type.Literal("assigned"),
  }),
  "handoff.started": defineDomainEvent("handoff.started", "handoff", HandoffIdSchema, {
    assignee_membership_id: embedSchema(MembershipIdSchema),
    handoff_status: Type.Literal("in_progress"),
  }),
  "handoff.resolved": defineDomainEvent("handoff.resolved", "handoff", HandoffIdSchema, {
    handoff_status: Type.Literal("resolved"),
    resolution_code: boundedCodeSchema(),
  }),
  "handoff.cancelled": defineDomainEvent("handoff.cancelled", "handoff", HandoffIdSchema, {
    handoff_status: Type.Literal("cancelled"),
    previous_handoff_status: handoffStatusSchema(),
    reason_code: boundedCodeSchema(),
  }),
  "handoff.expired": defineDomainEvent("handoff.expired", "handoff", HandoffIdSchema, {
    handoff_status: Type.Literal("expired"),
    previous_handoff_status: handoffStatusSchema(),
    reason_code: boundedCodeSchema(),
  }),

  "notification.created": defineDomainEvent(
    "notification.created",
    "notification",
    ResourceIdSchema,
    {
      notification_status: Type.Literal("pending"),
      notification_type: Type.Union([
        Type.Literal("staff_task"),
        Type.Literal("customer_message"),
        Type.Literal("staff_alert"),
      ]),
      related_resource_id: embedSchema(ResourceIdSchema),
      related_resource_type: Type.Union([
        Type.Literal("appointment_request"),
        Type.Literal("handoff"),
        Type.Literal("conversation"),
        Type.Literal("lead"),
        Type.Literal("channel_connection"),
        Type.Literal("ai_run"),
      ]),
    },
  ),
  "notification.delivered": defineDomainEvent(
    "notification.delivered",
    "notification",
    ResourceIdSchema,
    {
      attempt_count: notificationAttemptCountSchema(),
      notification_status: Type.Literal("delivered"),
    },
  ),
  "notification.failed": defineDomainEvent(
    "notification.failed",
    "notification",
    ResourceIdSchema,
    {
      attempt_count: notificationAttemptCountSchema(),
      failure_category: boundedCodeSchema(),
      notification_status: Type.Literal("failed"),
    },
  ),
  "notification.dead_lettered": defineDomainEvent(
    "notification.dead_lettered",
    "notification",
    ResourceIdSchema,
    {
      attempt_count: notificationAttemptCountSchema(),
      failure_category: boundedCodeSchema(),
      notification_status: Type.Literal("dead_lettered"),
    },
  ),

  "ai_run.completed": defineDomainEvent("ai_run.completed", "ai_run", AiRunIdSchema, {
    ai_run_outcome: Type.Literal("completed"),
    proposed_action: actionTypeSchema(),
  }),
  "ai_run.failed": defineDomainEvent("ai_run.failed", "ai_run", AiRunIdSchema, {
    ai_run_outcome: Type.Literal("failed"),
    failure_category: boundedCodeSchema(),
  }),
  "ai_run.schema_rejected": defineDomainEvent("ai_run.schema_rejected", "ai_run", AiRunIdSchema, {
    ai_run_outcome: Type.Literal("schema_rejected"),
    decision_schema_id: embedSchema(SchemaIdSchema),
    decision_schema_version: embedSchema(SchemaVersionSchema),
  }),
  "ai_run.policy_denied": defineDomainEvent("ai_run.policy_denied", "ai_run", AiRunIdSchema, {
    ai_run_outcome: Type.Literal("policy_denied"),
    proposed_action: actionTypeSchema(),
    reason_code: boundedCodeSchema(),
  }),

  "appointment.attendance_recorded": defineDomainEvent(
    "appointment.attendance_recorded",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      attendance_record_id: embedSchema(ResourceIdSchema),
      outcome: Type.Union([
        Type.Literal("attended"),
        Type.Literal("did_not_attend"),
        Type.Literal("unknown"),
      ]),
      source: Type.Union([Type.Literal("staff_manual"), Type.Literal("approved_import")]),
    },
  ),
  "appointment.attendance_corrected": defineDomainEvent(
    "appointment.attendance_corrected",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      attendance_record_id: embedSchema(ResourceIdSchema),
      outcome: Type.Union([
        Type.Literal("attended"),
        Type.Literal("did_not_attend"),
        Type.Literal("unknown"),
      ]),
      reason_code: boundedCodeSchema(),
      source: Type.Union([Type.Literal("staff_manual"), Type.Literal("approved_import")]),
      supersedes_attendance_record_id: embedSchema(ResourceIdSchema),
    },
  ),
  "appointment.revenue_attributed": defineDomainEvent(
    "appointment.revenue_attributed",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      category_code: boundedCodeSchema(),
      entry_type: Type.Union([Type.Literal("charge"), Type.Literal("adjustment")]),
      money: embedSchemaAs<JsonWire<Money>>(MoneySchema),
      revenue_attribution_id: embedSchema(ResourceIdSchema),
      source: Type.Union([Type.Literal("staff_manual"), Type.Literal("approved_import")]),
    },
  ),
  "appointment.revenue_reversed": defineDomainEvent(
    "appointment.revenue_reversed",
    "appointment_request",
    AppointmentRequestIdSchema,
    {
      money: embedSchemaAs<JsonWire<Money>>(MoneySchema),
      reason_code: boundedCodeSchema(),
      revenue_attribution_id: embedSchema(ResourceIdSchema),
      reverses_revenue_attribution_id: embedSchema(ResourceIdSchema),
      source: Type.Union([Type.Literal("staff_manual"), Type.Literal("approved_import")]),
    },
  ),
} as const;
