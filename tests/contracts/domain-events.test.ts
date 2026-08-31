import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DOMAIN_EVENT_NAMES,
  DomainAggregateTypeSchema,
  DomainEventNameSchema,
  DomainEventPayloadSchemas,
  DomainEventPayloadSchemasByVersion,
  DomainEventSchema,
  DomainEventSchemas,
  DomainEventSchemasByVersion,
  LeadReopenedDomainEventPayloadV2Schema,
  LeadReopenedDomainEventV2Schema,
  SchemaIdSchema,
  isSchemaValue,
  type DomainEvent,
  type DomainEventFor,
  type DomainEventName,
  type LeadReopenedDomainEventV2,
  type LeadId,
  type OrganizationId,
} from "../../packages/contracts/src/index.js";

const ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const OTHER_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const REQUEST_ID = "req_01JQ4Z7YRXG8M4NP6V2C3D5E6F";
const OCCURRED_AT = "2026-08-30T12:34:56.123Z";

const EXPECTED_EVENT_NAMES = [
  "organization.created",
  "organization.status_changed",
  "membership.activated",
  "membership.scope_changed",
  "membership.revoked",
  "location.changed",
  "service.published",
  "service.deactivated",
  "service_price.published",
  "faq.published",
  "business_policy.published",
  "channel_connection.activated",
  "channel_connection.disabled",
  "channel_connection.credential_rotated",
  "contact.created",
  "contact.identity_added",
  "contact.anonymized",
  "consent.granted",
  "consent.declined",
  "consent.withdrawn",
  "consent.not_required_recorded",
  "lead.created",
  "lead.engaged",
  "lead.qualified",
  "lead.disqualified",
  "lead.booking_requested",
  "lead.converted",
  "lead.closed",
  "lead.reopened",
  "conversation.started",
  "message.received",
  "message.response_queued",
  "message.sent",
  "conversation.status_changed",
  "conversation.resolved",
  "conversation.closed",
  "appointment_request.created",
  "appointment_request.staff_accepted",
  "appointment_request.customer_confirmation_requested",
  "appointment_request.confirmed",
  "appointment_request.rejected",
  "appointment_request.cancelled",
  "appointment_request.expired",
  "handoff.requested",
  "handoff.assigned",
  "handoff.started",
  "handoff.resolved",
  "handoff.cancelled",
  "handoff.expired",
  "notification.created",
  "notification.delivered",
  "notification.failed",
  "notification.dead_lettered",
  "ai_run.completed",
  "ai_run.failed",
  "ai_run.schema_rejected",
  "ai_run.policy_denied",
  "appointment.attendance_recorded",
  "appointment.attendance_corrected",
  "appointment.revenue_attributed",
  "appointment.revenue_reversed",
] as const satisfies readonly DomainEventName[];

const PAYLOAD_FIXTURES = {
  "organization.created": {
    default_locale: "en",
    organization_status: "active",
  },
  "organization.status_changed": {
    organization_status: "suspended",
    previous_organization_status: "active",
    reason_code: "owner_requested",
  },
  "membership.activated": {
    membership_status: "active",
    previous_membership_status: "invited",
  },
  "membership.scope_changed": {
    changed_scope_fields: ["allowed_location_ids"],
  },
  "membership.revoked": {
    membership_status: "revoked",
    previous_membership_status: "active",
    reason_code: "access_removed",
  },
  "location.changed": {
    changed_location_fields: ["business_hours", "time_zone"],
  },
  "service.published": { service_version: 2 },
  "service.deactivated": { reason_code: "no_longer_offered", service_active: false },
  "service_price.published": { price_type: "fixed", service_price_id: ID },
  "faq.published": { faq_version: 3 },
  "business_policy.published": { business_policy_version: 4 },
  "channel_connection.activated": {
    channel_connection_status: "active",
    channel_type: "telegram",
  },
  "channel_connection.disabled": {
    channel_connection_status: "disabled",
    reason_code: "owner_requested",
  },
  "channel_connection.credential_rotated": { credential_version: 2 },
  "contact.created": { preferred_locale: null },
  "contact.identity_added": { contact_identity_id: ID, identity_type: "telegram_user" },
  "contact.anonymized": { anonymized: true, reason_code: "subject_request" },
  "consent.granted": {
    consent_decision: "granted",
    consent_record_id: ID,
    purpose: "booking_follow_up",
  },
  "consent.declined": {
    consent_decision: "declined",
    consent_record_id: ID,
    purpose: "marketing",
  },
  "consent.withdrawn": {
    consent_decision: "withdrawn",
    consent_record_id: ID,
    purpose: "marketing",
  },
  "consent.not_required_recorded": {
    consent_decision: "not_required",
    consent_record_id: ID,
    purpose: "service_messages",
  },
  "lead.created": { contact_id: ID, lead_status: "new" },
  "lead.engaged": { lead_status: "engaged", source_message_id: ID },
  "lead.qualified": {
    lead_status: "qualified",
    policy_id: ID,
    qualification_evaluation_id: OTHER_ID,
  },
  "lead.disqualified": {
    lead_status: "disqualified",
    policy_id: ID,
    qualification_evaluation_id: OTHER_ID,
    reason_codes: ["outside_service_area"],
  },
  "lead.booking_requested": { appointment_request_id: ID, lead_status: "booking_requested" },
  "lead.converted": { appointment_request_id: ID, lead_status: "converted" },
  "lead.closed": {
    lead_status: "closed",
    previous_lead_status: "engaged",
    reason_code: "staff_closed",
  },
  "lead.reopened": {
    lead_status: "engaged",
    previous_lead_status: "disqualified",
    reason_code: "new_evidence",
  },
  "conversation.started": {
    channel_connection_id: ID,
    contact_id: OTHER_ID,
    conversation_status: "open",
    lead_id: ID,
  },
  "message.received": { message_direction: "inbound", message_id: ID },
  "message.response_queued": {
    message_direction: "outbound",
    message_id: ID,
    message_status: "queued",
  },
  "message.sent": { message_id: ID, message_status: "sent" },
  "conversation.status_changed": {
    conversation_status: "awaiting_lead",
    previous_conversation_status: "open",
  },
  "conversation.resolved": {
    conversation_status: "resolved",
    previous_conversation_status: "awaiting_lead",
    resolution_code: "workflow_complete",
  },
  "conversation.closed": {
    closure_code: "retention_policy",
    conversation_status: "closed",
    previous_conversation_status: "resolved",
  },
  "appointment_request.created": {
    appointment_status: "requested",
    conversation_id: ID,
    lead_id: OTHER_ID,
    location_id: ID,
    service_id: OTHER_ID,
  },
  "appointment_request.staff_accepted": {
    appointment_status: "staff_accepted",
    location_id: ID,
    offer_version: 1,
    scheduled_start_at: "2026-09-01T08:00:00Z",
  },
  "appointment_request.customer_confirmation_requested": {
    appointment_status: "awaiting_customer_confirmation",
    confirmation_expires_at: "2026-09-01T07:00:00Z",
    offer_version: 1,
  },
  "appointment_request.confirmed": {
    appointment_status: "confirmed",
    confirmation_source: "customer_session",
    customer_confirmed_at: "2026-08-31T13:00:00Z",
    offer_version: 1,
  },
  "appointment_request.rejected": {
    appointment_status: "rejected",
    reason_code: "slot_unavailable",
  },
  "appointment_request.cancelled": {
    appointment_status: "cancelled",
    previous_appointment_status: "confirmed",
    reason_code: "customer_withdrew",
  },
  "appointment_request.expired": {
    appointment_status: "expired",
    previous_appointment_status: "awaiting_customer_confirmation",
    reason_code: "offer_expired",
  },
  "handoff.requested": {
    conversation_id: ID,
    handoff_status: "requested",
    lead_id: OTHER_ID,
    trigger_reason: "customer_requested",
  },
  "handoff.assigned": { assignee_membership_id: ID, handoff_status: "assigned" },
  "handoff.started": { assignee_membership_id: ID, handoff_status: "in_progress" },
  "handoff.resolved": { handoff_status: "resolved", resolution_code: "answered" },
  "handoff.cancelled": {
    handoff_status: "cancelled",
    previous_handoff_status: "assigned",
    reason_code: "customer_withdrew",
  },
  "handoff.expired": {
    handoff_status: "expired",
    previous_handoff_status: "requested",
    reason_code: "sla_expired",
  },
  "notification.created": {
    notification_status: "pending",
    notification_type: "staff_task",
    related_resource_id: ID,
    related_resource_type: "appointment_request",
  },
  "notification.delivered": { attempt_count: 1, notification_status: "delivered" },
  "notification.failed": {
    attempt_count: 2,
    failure_category: "provider_unavailable",
    notification_status: "failed",
  },
  "notification.dead_lettered": {
    attempt_count: 5,
    failure_category: "permanent_rejection",
    notification_status: "dead_lettered",
  },
  "ai_run.completed": {
    ai_run_outcome: "completed",
    proposed_action: "request_information",
  },
  "ai_run.failed": { ai_run_outcome: "failed", failure_category: "provider_timeout" },
  "ai_run.schema_rejected": {
    ai_run_outcome: "schema_rejected",
    decision_schema_id: "AgentDecision.v1",
    decision_schema_version: "1",
  },
  "ai_run.policy_denied": {
    ai_run_outcome: "policy_denied",
    proposed_action: "confirm_appointment",
    reason_code: "customer_binding_invalid",
  },
  "appointment.attendance_recorded": {
    attendance_record_id: ID,
    outcome: "attended",
    source: "staff_manual",
  },
  "appointment.attendance_corrected": {
    attendance_record_id: ID,
    outcome: "did_not_attend",
    reason_code: "staff_correction",
    source: "staff_manual",
    supersedes_attendance_record_id: OTHER_ID,
  },
  "appointment.revenue_attributed": {
    category_code: "treatment",
    entry_type: "charge",
    money: { amount_minor: 125_00, currency: "USD" },
    revenue_attribution_id: ID,
    source: "staff_manual",
  },
  "appointment.revenue_reversed": {
    money: { amount_minor: -125_00, currency: "USD" },
    reason_code: "charge_reversed",
    revenue_attribution_id: ID,
    reverses_revenue_attribution_id: OTHER_ID,
    source: "staff_manual",
  },
} as const satisfies Record<DomainEventName, unknown>;

const schemaIdentityOf = (schema: object, label: string) => {
  const schemaId: unknown = Reflect.get(schema, "$id");

  if (typeof schemaId !== "string") {
    throw new TypeError(`Missing schema ID for ${label}`);
  }

  return schemaId;
};

const schemaIdFor = (eventName: DomainEventName) => {
  return schemaIdentityOf(DomainEventSchemas[eventName], eventName);
};

const payloadSchemaIdFor = (eventName: DomainEventName) => {
  return schemaIdentityOf(DomainEventPayloadSchemas[eventName], `${eventName} payload`);
};

const aggregateTypeFor = (eventName: DomainEventName) => {
  const schema: unknown = DomainEventSchemas[eventName];

  if (typeof schema !== "object" || schema === null) {
    throw new TypeError(`Missing event schema for ${eventName}`);
  }

  const properties: unknown = Reflect.get(schema, "properties");

  if (typeof properties !== "object" || properties === null) {
    throw new TypeError(`Missing event properties for ${eventName}`);
  }

  const aggregateTypeSchema: unknown = Reflect.get(properties, "aggregate_type");

  if (typeof aggregateTypeSchema !== "object" || aggregateTypeSchema === null) {
    throw new TypeError(`Missing aggregate type schema for ${eventName}`);
  }

  const aggregateType: unknown = Reflect.get(aggregateTypeSchema, "const");

  if (typeof aggregateType !== "string") {
    throw new TypeError(`Missing aggregate type for ${eventName}`);
  }

  return aggregateType;
};

const createEvent = (
  eventName: DomainEventName,
  payload: unknown = PAYLOAD_FIXTURES[eventName],
): Record<string, unknown> => ({
  actor: { actor_id: null, actor_type: "system" },
  aggregate_id: ID,
  aggregate_type: aggregateTypeFor(eventName),
  aggregate_version: 1,
  causation_id: OTHER_ID,
  correlation_id: ID,
  event_id: OTHER_ID,
  event_type: eventName,
  occurred_at: OCCURRED_AT,
  organization_id: ID,
  payload,
  request_id: REQUEST_ID,
  schema_id: schemaIdFor(eventName),
  schema_version: "1",
});

const createLeadReopenedV2Event = (payload: unknown): Record<string, unknown> => ({
  ...createEvent("lead.reopened", payload),
  schema_id: schemaIdentityOf(LeadReopenedDomainEventV2Schema, "lead.reopened V2"),
  schema_version: "2",
});

const withoutMember = (candidate: Record<string, unknown>, member: string) => {
  const clone = structuredClone(candidate);
  Reflect.deleteProperty(clone, member);
  return clone;
};

describe("domain event catalog and source-of-truth strategy", () => {
  it("matches the complete accepted Stage 0 event vocabulary", () => {
    expect(DOMAIN_EVENT_NAMES).toEqual(EXPECTED_EVENT_NAMES);
    expect(DOMAIN_EVENT_NAMES).toHaveLength(61);
    expect(Object.keys(DomainEventPayloadSchemas)).toEqual(EXPECTED_EVENT_NAMES);
    expect(Object.keys(DomainEventSchemasByVersion)).toEqual(EXPECTED_EVENT_NAMES);
    expect(Object.keys(DomainEventPayloadSchemasByVersion)).toEqual(EXPECTED_EVENT_NAMES);
    expect(Object.keys(DomainEventSchemasByVersion["lead.reopened"])).toEqual(["1", "2"]);
    expect(Object.keys(DomainEventPayloadSchemasByVersion["lead.reopened"])).toEqual(["1", "2"]);
    for (const eventName of EXPECTED_EVENT_NAMES) {
      if (eventName !== "lead.reopened") {
        expect(Object.keys(DomainEventSchemasByVersion[eventName])).toEqual(["1"]);
        expect(Object.keys(DomainEventPayloadSchemasByVersion[eventName])).toEqual(["1"]);
      }
    }
    expect(DomainEventSchemasByVersion["lead.reopened"]["1"]).toBe(
      DomainEventSchemas["lead.reopened"],
    );
    expect(DomainEventPayloadSchemasByVersion["lead.reopened"]["1"]).toBe(
      DomainEventPayloadSchemas["lead.reopened"],
    );
  });

  it("publishes the exact aggregate-root provenance vocabulary", () => {
    expect(
      [
        "ai_run",
        "appointment_request",
        "business_policy",
        "channel_connection",
        "contact",
        "conversation",
        "faq",
        "handoff",
        "lead",
        "location",
        "membership",
        "notification",
        "organization",
        "service",
      ].every((aggregateType) => isSchemaValue(DomainAggregateTypeSchema, aggregateType)),
    ).toBe(true);
    expect(isSchemaValue(DomainAggregateTypeSchema, "message")).toBe(false);
    expect(isSchemaValue(DomainAggregateTypeSchema, "service_price")).toBe(false);
  });

  it("publishes unique deterministic schema identities and JSON schemas", () => {
    const eventSchemaIds = DOMAIN_EVENT_NAMES.map(schemaIdFor);
    const payloadSchemaIds = DOMAIN_EVENT_NAMES.map(payloadSchemaIdFor);
    const allSchemaIds = [
      schemaIdentityOf(DomainEventNameSchema, "domain event name"),
      schemaIdentityOf(DomainAggregateTypeSchema, "domain aggregate type"),
      schemaIdentityOf(DomainEventSchema, "domain event union"),
      ...eventSchemaIds,
      ...payloadSchemaIds,
      schemaIdentityOf(LeadReopenedDomainEventV2Schema, "lead.reopened V2"),
      schemaIdentityOf(LeadReopenedDomainEventPayloadV2Schema, "lead.reopened V2 payload"),
    ];

    expect(allSchemaIds).toHaveLength(new Set(allSchemaIds).size);
    expect(allSchemaIds.every((schemaId) => isSchemaValue(SchemaIdSchema, schemaId))).toBe(true);
    expect(schemaIdFor("organization.created")).toBe("OrganizationCreatedDomainEvent.v1");
    expect(schemaIdFor("appointment.revenue_reversed")).toBe(
      "AppointmentRevenueReversedDomainEvent.v1",
    );
    expect(schemaIdFor("lead.reopened")).toBe("LeadReopenedDomainEvent.v1");
    expect(payloadSchemaIdFor("lead.reopened")).toBe("LeadReopenedDomainEventPayload.v1");
    expect(schemaIdentityOf(LeadReopenedDomainEventV2Schema, "lead.reopened V2")).toBe(
      "LeadReopenedDomainEvent.v2",
    );
    expect(
      schemaIdentityOf(LeadReopenedDomainEventPayloadV2Schema, "lead.reopened V2 payload"),
    ).toBe("LeadReopenedDomainEventPayload.v2");
    expect(
      Reflect.get(Reflect.get(LeadReopenedDomainEventV2Schema, "properties"), "schema_version"),
    ).toMatchObject({ const: "2" });
    expect(() => JSON.stringify(DomainEventSchema)).not.toThrow();
  });

  it("derives discriminated and nominal TypeScript types from runtime schemas", () => {
    expectTypeOf<DomainEvent["event_type"]>().toEqualTypeOf<DomainEventName>();
    expectTypeOf<DomainEventFor<"lead.created">["event_type"]>().toEqualTypeOf<"lead.created">();
    expectTypeOf<DomainEventFor<"lead.created">["aggregate_id"]>().toEqualTypeOf<LeadId>();
    expectTypeOf<
      DomainEventFor<"lead.created">["aggregate_id"]
    >().not.toEqualTypeOf<OrganizationId>();
    expectTypeOf<LeadReopenedDomainEventV2["event_type"]>().toEqualTypeOf<"lead.reopened">();
    expectTypeOf<LeadReopenedDomainEventV2["aggregate_id"]>().toEqualTypeOf<LeadId>();
  });
});

describe("lead.reopened version compatibility", () => {
  const disqualifiedToEngaged = {
    lead_status: "engaged",
    previous_lead_status: "disqualified",
    reason_code: "new_evidence",
  };
  const bookingRequestedToQualified = {
    appointment_request_id: ID,
    lead_status: "qualified",
    previous_lead_status: "booking_requested",
    reason_code: "request_ended_retry_allowed",
  };

  it("preserves the exact V1 identity, version, and accepted wire behavior", () => {
    const legacyBookingReopen = {
      lead_status: "engaged",
      previous_lead_status: "booking_requested",
      reason_code: "request_ended",
    };

    expect(isSchemaValue(DomainEventSchemas["lead.reopened"], createEvent("lead.reopened"))).toBe(
      true,
    );
    expect(
      isSchemaValue(
        DomainEventSchemasByVersion["lead.reopened"]["1"],
        createEvent("lead.reopened", legacyBookingReopen),
      ),
    ).toBe(true);
    expect(
      Reflect.get(Reflect.get(DomainEventSchemas["lead.reopened"], "properties"), "schema_version"),
    ).toMatchObject({ const: "1" });
  });

  it.each([disqualifiedToEngaged, bookingRequestedToQualified])(
    "accepts an exact V2 transition variant %#",
    (payload) => {
      const event = createLeadReopenedV2Event(payload);

      expect(isSchemaValue(LeadReopenedDomainEventPayloadV2Schema, payload)).toBe(true);
      expect(isSchemaValue(LeadReopenedDomainEventV2Schema, event)).toBe(true);
      expect(isSchemaValue(DomainEventSchemasByVersion["lead.reopened"]["2"], event)).toBe(true);
      expect(isSchemaValue(DomainEventSchema, event)).toBe(false);
    },
  );

  it.each([
    {
      lead_status: "qualified",
      previous_lead_status: "disqualified",
      reason_code: "invalid_pair",
    },
    {
      lead_status: "engaged",
      previous_lead_status: "booking_requested",
      reason_code: "invalid_pair",
    },
    {
      lead_status: "qualified",
      previous_lead_status: "booking_requested",
      reason_code: "missing_request",
    },
    {
      appointment_request_id: "not-a-uuid",
      lead_status: "qualified",
      previous_lead_status: "booking_requested",
      reason_code: "invalid_request",
    },
    {
      ...disqualifiedToEngaged,
      appointment_request_id: ID,
    },
    {
      lead_status: "new",
      previous_lead_status: "disqualified",
      reason_code: "unknown_current_state",
    },
    {
      lead_status: "engaged",
      previous_lead_status: "closed",
      reason_code: "unknown_previous_state",
    },
    {
      ...bookingRequestedToQualified,
      unexpected: true,
    },
  ])("rejects an invalid or ambiguous V2 payload %#", (payload) => {
    expect(isSchemaValue(LeadReopenedDomainEventPayloadV2Schema, payload)).toBe(false);
    expect(isSchemaValue(LeadReopenedDomainEventV2Schema, createLeadReopenedV2Event(payload))).toBe(
      false,
    );
  });

  it("rejects cross-version envelope identities", () => {
    const v2Event = createLeadReopenedV2Event(bookingRequestedToQualified);

    expect(
      isSchemaValue(LeadReopenedDomainEventV2Schema, { ...v2Event, schema_version: "1" }),
    ).toBe(false);
    expect(
      isSchemaValue(LeadReopenedDomainEventV2Schema, {
        ...v2Event,
        schema_id: "LeadReopenedDomainEvent.v1",
      }),
    ).toBe(false);
  });
});

describe("valid domain event envelopes and payloads", () => {
  it.each(EXPECTED_EVENT_NAMES)("accepts %s with its canonical payload", (eventName) => {
    const event = createEvent(eventName);

    expect(isSchemaValue(DomainEventNameSchema, eventName)).toBe(true);
    expect(isSchemaValue(DomainEventPayloadSchemas[eventName], event["payload"])).toBe(true);
    expect(isSchemaValue(DomainEventSchemas[eventName], event)).toBe(true);
    expect(isSchemaValue(DomainEventSchema, event)).toBe(true);
  });

  it.each(EXPECTED_EVENT_NAMES)("round-trips %s through JSON", (eventName) => {
    const event = createEvent(eventName);
    const roundTripped: unknown = JSON.parse(JSON.stringify(event));

    expect(isSchemaValue(DomainEventSchemas[eventName], roundTripped)).toBe(true);
    expect(isSchemaValue(DomainEventSchema, roundTripped)).toBe(true);
  });

  it.each([
    { actor_id: ID, actor_type: "customer" },
    { actor_id: ID, actor_type: "member" },
    { actor_id: null, actor_type: "system" },
    { actor_id: ID, actor_type: "platform_operator" },
  ])("accepts actor attribution variant $actor_type without granting authority", (actor) => {
    expect(
      isSchemaValue(DomainEventSchemas["organization.status_changed"], {
        ...createEvent("organization.status_changed"),
        actor,
      }),
    ).toBe(true);
  });

  it("represents a non-HTTP root event with explicit nullable request and causation", () => {
    const rootSystemEvent = {
      ...createEvent("appointment_request.expired"),
      causation_id: null,
      request_id: null,
    };

    expect(isSchemaValue(DomainEventSchemas["appointment_request.expired"], rootSystemEvent)).toBe(
      true,
    );
  });
});

describe("domain event envelope rejection", () => {
  const baseEvent = createEvent("appointment_request.confirmed");

  it.each([
    "event_id",
    "event_type",
    "schema_id",
    "schema_version",
    "occurred_at",
    "organization_id",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "actor",
    "request_id",
    "correlation_id",
    "causation_id",
    "payload",
  ])("rejects an event missing required envelope member %s", (member) => {
    expect(
      isSchemaValue(
        DomainEventSchemas["appointment_request.confirmed"],
        withoutMember(baseEvent, member),
      ),
    ).toBe(false);
  });

  it.each([
    { ...baseEvent, event_id: "not-a-uuid" },
    { ...baseEvent, event_type: "entity.updated" },
    { ...baseEvent, schema_id: "AppointmentRequestConfirmedDomainEvent.v2" },
    { ...baseEvent, schema_version: "2" },
    { ...baseEvent, occurred_at: "2026-08-30T17:34:56+05:00" },
    { ...baseEvent, occurred_at: "2026-02-30T12:34:56Z" },
    { ...baseEvent, organization_id: "550e8400-e29b-41d4-a716-446655440000" },
    { ...baseEvent, aggregate_type: "appointment" },
    { ...baseEvent, aggregate_id: "not-a-uuid" },
    { ...baseEvent, aggregate_version: 0 },
    { ...baseEvent, aggregate_version: "1" },
    { ...baseEvent, actor: { actor_id: ID, actor_type: "model" } },
    { ...baseEvent, actor: { actor_id: ID, actor_type: "member", role: "owner" } },
    { ...baseEvent, request_id: "customer@example.com" },
    { ...baseEvent, correlation_id: "not-a-uuid" },
    { ...baseEvent, causation_id: "550e8400-e29b-41d4-a716-446655440000" },
    { ...baseEvent, payload: [] },
    { ...baseEvent, payload: "confirmed" },
    { ...baseEvent, unexpected: true },
  ])("rejects malformed, wrong-primitive, or open-envelope input %#", (candidate) => {
    expect(isSchemaValue(DomainEventSchemas["appointment_request.confirmed"], candidate)).toBe(
      false,
    );
  });

  it("rejects a valid nominal ID used with the wrong aggregate provenance", () => {
    const leadEventWithOrganizationAggregate = {
      ...createEvent("lead.created"),
      aggregate_type: "organization",
    };

    expect(
      isSchemaValue(DomainEventSchemas["lead.created"], leadEventWithOrganizationAggregate),
    ).toBe(false);
  });

  it.each([
    { ...baseEvent, occurred_at: new Date(OCCURRED_AT) },
    { ...baseEvent, aggregate_version: 1n },
    { ...baseEvent, payload: new Map([["appointment_status", "confirmed"]]) },
    { ...baseEvent, payload: new Set(["confirmed"]) },
    { ...baseEvent, payload: undefined },
    { ...baseEvent, payload: () => "confirmed" },
  ])("rejects non-JSON wire values %#", (candidate) => {
    expect(isSchemaValue(DomainEventSchemas["appointment_request.confirmed"], candidate)).toBe(
      false,
    );
  });
});

describe("event and payload runtime discrimination", () => {
  it("rejects every event when paired with every other event payload", () => {
    for (const eventName of EXPECTED_EVENT_NAMES) {
      for (const payloadEventName of EXPECTED_EVENT_NAMES) {
        if (payloadEventName === eventName) {
          continue;
        }

        expect(
          isSchemaValue(DomainEventPayloadSchemas[eventName], PAYLOAD_FIXTURES[payloadEventName]),
          `${eventName} accepted ${payloadEventName} payload`,
        ).toBe(false);
      }
    }
  });

  it.each(EXPECTED_EVENT_NAMES)("rejects incomplete %s payloads", (eventName) => {
    const payload = structuredClone(PAYLOAD_FIXTURES[eventName]) as Record<string, unknown>;
    const firstMember = Object.keys(payload)[0];

    if (firstMember === undefined) {
      throw new TypeError(`Expected at least one required payload member for ${eventName}`);
    }

    Reflect.deleteProperty(payload, firstMember);

    expect(isSchemaValue(DomainEventSchemas[eventName], createEvent(eventName, payload))).toBe(
      false,
    );
  });

  it("rejects event name, schema identity, and payload combinations from different events", () => {
    const source = createEvent("lead.converted");
    const mismatched = {
      ...source,
      event_type: "lead.booking_requested",
    };

    expect(isSchemaValue(DomainEventSchema, mismatched)).toBe(false);
  });
});

describe("domain event payload security", () => {
  const hostileFields = [
    "organizationId",
    "tenantId",
    "organization_id",
    "role",
    "permissions",
    "isAdmin",
    "platformOperator",
    "token",
    "authorization",
    "cookie",
    "secret",
    "providerBody",
    "sql",
    "query",
    "constraint",
    "stack",
    "debug",
    "metadata",
    "rawInput",
    "databaseRow",
  ] as const;

  it.each(hostileFields)("rejects payload authority/internal-state member %s", (field) => {
    const payload = {
      ...PAYLOAD_FIXTURES["lead.created"],
      [field]: field === "organization_id" ? OTHER_ID : { injected: true },
    };

    expect(
      isSchemaValue(DomainEventSchemas["lead.created"], createEvent("lead.created", payload)),
    ).toBe(false);
  });

  it.each(hostileFields)("rejects envelope authority/internal-state member %s", (field) => {
    const event = {
      ...createEvent("lead.created"),
      [field]: { injected: true },
    };

    expect(isSchemaValue(DomainEventSchemas["lead.created"], event)).toBe(false);
  });

  it.each([
    {
      ...PAYLOAD_FIXTURES["lead.created"],
      nested: { authorization: { role: "owner", token: "secret" } },
    },
    {
      ...PAYLOAD_FIXTURES["lead.created"],
      breadth: Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`f${index}`, true])),
    },
    JSON.parse(`{"contact_id":"${ID}","lead_status":"new","__proto__":{"polluted":true}}`),
  ])("rejects arbitrary nested, excessive-breadth, or prototype-shaped payload %#", (payload) => {
    expect(
      isSchemaValue(DomainEventSchemas["lead.created"], createEvent("lead.created", payload)),
    ).toBe(false);
  });

  it.each([
    {
      ...PAYLOAD_FIXTURES["appointment_request.rejected"],
      reason_code: "r".repeat(101),
    },
    {
      ...PAYLOAD_FIXTURES["lead.disqualified"],
      reason_codes: Array.from({ length: 17 }, (_, index) => `reason_${index}`),
    },
    {
      ...PAYLOAD_FIXTURES["location.changed"],
      changed_location_fields: Array.from({ length: 1_000 }, () => "status"),
    },
    {
      ...PAYLOAD_FIXTURES["appointment_request.rejected"],
      reason_code: ["slot_unavailable"],
    },
  ])("rejects oversized or wrong-shape bounded payload input %#", (payload) => {
    const eventName =
      "reason_codes" in payload
        ? "lead.disqualified"
        : "reason_code" in payload
          ? "appointment_request.rejected"
          : "location.changed";

    expect(isSchemaValue(DomainEventSchemas[eventName], createEvent(eventName, payload))).toBe(
      false,
    );
  });
});
