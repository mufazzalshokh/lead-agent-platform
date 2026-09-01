import { describe, expect, it } from "vitest";

import {
  ActorRefSchema,
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
  ServiceIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type AppointmentRequestId,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import {
  cancelConfirmedAppointmentRequestWorkflow,
  confirmAppointmentRequestWorkflow,
  createAppointmentRequestWorkflow,
  createConversation,
  createLead,
  endAppointmentRequestWorkflow,
  prepareCustomerConfirmation,
  qualifyLead,
  queueAiResponse,
  recordEngagement,
  replaceHandoffWithSuccessorWorkflow,
  requestHandoffWorkflow,
  staffAcceptAppointmentRequest,
  takeHandoffStaffOwnershipWorkflow,
  terminateHandoffAndResolveConversationWorkflow,
  terminateHandoffAndResumeAiWorkflow,
  validateAppointmentOfferVersion,
  validateAppointmentRequestReasonCode,
  validateConversationResolutionCode,
  validateHandoffQueueKey,
  validateHandoffReasonCode,
  validateHandoffResolutionCode,
  validateIanaTimeZone,
  validateLeadReasonCode,
  type AppointmentOfferVersion,
  type AppointmentPreference,
  type AppointmentRequest,
  type AppointmentRequestReasonCode,
  type Conversation,
  type ConversationCommandContext,
  type ConversationResolutionCode,
  type CreateAppointmentRequestCommand,
  type CreateHandoffCommand,
  type Handoff,
  type HandoffCommandContext,
  type HandoffQueueKey,
  type HandoffReasonCode,
  type HandoffResolutionCode,
  type IanaTimeZone,
  type Lead,
  type LeadCommandContext,
  type LeadReasonCode,
  type Result,
} from "../../packages/domain/src/index.js";

const requireOrganizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) throw new TypeError("Invalid organization");
  return value;
};
const requireAppointmentRequestId = (value: string): AppointmentRequestId => {
  if (!isSchemaValue(AppointmentRequestIdSchema, value)) throw new TypeError("Invalid request");
  return value;
};
const requireChannelConnectionId = (value: string): ChannelConnectionId => {
  if (!isSchemaValue(ChannelConnectionIdSchema, value)) throw new TypeError("Invalid channel");
  return value;
};
const requireContactId = (value: string): ContactId => {
  if (!isSchemaValue(ContactIdSchema, value)) throw new TypeError("Invalid contact");
  return value;
};
const requireConversationId = (value: string): ConversationId => {
  if (!isSchemaValue(ConversationIdSchema, value)) throw new TypeError("Invalid conversation");
  return value;
};
const requireHandoffId = (value: string): HandoffId => {
  if (!isSchemaValue(HandoffIdSchema, value)) throw new TypeError("Invalid handoff");
  return value;
};
const requireLeadId = (value: string): LeadId => {
  if (!isSchemaValue(LeadIdSchema, value)) throw new TypeError("Invalid lead");
  return value;
};
const requireLocationId = (value: string): LocationId => {
  if (!isSchemaValue(LocationIdSchema, value)) throw new TypeError("Invalid location");
  return value;
};
const requireMembershipId = (value: string): MembershipId => {
  if (!isSchemaValue(MembershipIdSchema, value)) throw new TypeError("Invalid membership");
  return value;
};
const requireMessageId = (value: string): MessageId => {
  if (!isSchemaValue(MessageIdSchema, value)) throw new TypeError("Invalid message");
  return value;
};
const requireResourceId = (value: string): ResourceId => {
  if (!isSchemaValue(ResourceIdSchema, value)) throw new TypeError("Invalid resource");
  return value;
};
const requireServiceId = (value: string): ServiceId => {
  if (!isSchemaValue(ServiceIdSchema, value)) throw new TypeError("Invalid service");
  return value;
};
const requireTimestamp = (value: string): UtcTimestamp => {
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new TypeError("Invalid timestamp");
  return value;
};
const requireActor = (value: unknown): ActorRef => {
  if (!isSchemaValue(ActorRefSchema, value)) throw new TypeError("Invalid actor");
  return value;
};
const requireAppointmentReason = (value: string): AppointmentRequestReasonCode => {
  const result = validateAppointmentRequestReasonCode(value);
  if (!result.ok) throw new TypeError("Invalid appointment reason");
  return result.value;
};
const requireConversationResolution = (value: string): ConversationResolutionCode => {
  const result = validateConversationResolutionCode(value);
  if (!result.ok) throw new TypeError("Invalid conversation resolution");
  return result.value;
};
const requireHandoffQueue = (value: string): HandoffQueueKey => {
  const result = validateHandoffQueueKey(value);
  if (!result.ok) throw new TypeError("Invalid handoff queue");
  return result.value;
};
const requireHandoffReason = (value: string): HandoffReasonCode => {
  const result = validateHandoffReasonCode(value);
  if (!result.ok) throw new TypeError("Invalid handoff reason");
  return result.value;
};
const requireHandoffResolution = (value: string): HandoffResolutionCode => {
  const result = validateHandoffResolutionCode(value);
  if (!result.ok) throw new TypeError("Invalid handoff resolution");
  return result.value;
};
const requireLeadReason = (value: string): LeadReasonCode => {
  const result = validateLeadReasonCode(value);
  if (!result.ok) throw new TypeError("Invalid lead reason");
  return result.value;
};
const requireOfferVersion = (value: number): AppointmentOfferVersion => {
  const result = validateAppointmentOfferVersion(value);
  if (!result.ok) throw new TypeError("Invalid offer version");
  return result.value;
};
const requireTimeZone = (value: string): IanaTimeZone => {
  const result = validateIanaTimeZone(value);
  if (!result.ok) throw new TypeError("Invalid time zone");
  return result.value;
};

const requireSuccess = <Value, Error>(result: Result<Value, Error>): Value => {
  if (!result.ok) throw new TypeError("Expected successful fixture transition");
  return result.value;
};

const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c43001");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c43002");
const APPOINTMENT_REQUEST_ID = requireAppointmentRequestId("0193f1a8-7f65-7c28-a434-a10796c43003");
const CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c43004");
const CONVERSATION_ID = requireConversationId("0193f1a8-7f65-7c28-a434-a10796c43005");
const LEAD_ID = requireLeadId("0193f1a8-7f65-7c28-a434-a10796c43006");
const LOCATION_ID = requireLocationId("0193f1a8-7f65-7c28-a434-a10796c43007");
const SERVICE_ID = requireServiceId("0193f1a8-7f65-7c28-a434-a10796c43008");
const STAFF_ID = requireMembershipId("0193f1a8-7f65-7c28-a434-a10796c43009");
const SOURCE_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c4300a");
const RESPONSE_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c4300b");
const CHANNEL_CONNECTION_ID = requireChannelConnectionId("0193f1a8-7f65-7c28-a434-a10796c4300c");
const HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c4300d");
const SUCCESSOR_HANDOFF_ID = requireHandoffId("0193f1a8-7f65-7c28-a434-a10796c4300e");
const SERVICE_VERSION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c4300f");
const LOCATION_VERSION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43010");
const BUSINESS_POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43011");
const PREFERENCE_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43012");
const QUALIFICATION_POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43013");
const QUALIFICATION_EVALUATION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43014");
const CONFIRMATION_EVIDENCE_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43015");
const RETRY_POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c43016");

const CREATED_AT = requireTimestamp("2026-09-02T08:00:00Z");
const STAFF_ACCEPTED_AT = requireTimestamp("2026-09-02T08:05:00Z");
const CONFIRMATION_ISSUED_AT = requireTimestamp("2026-09-02T08:06:00Z");
const CUSTOMER_ACTED_AT = requireTimestamp("2026-09-02T08:07:00Z");
const CONFIRMED_AT = requireTimestamp("2026-09-02T08:08:00Z");
const COMMAND_AT = requireTimestamp("2026-09-02T08:15:00Z");
const CONFIRMATION_EXPIRES_AT = requireTimestamp("2026-09-02T09:00:00Z");
const OFFER_START_AT = requireTimestamp("2026-09-03T09:00:00Z");
const OFFER_END_AT = requireTimestamp("2026-09-03T09:30:00Z");
const PREFERENCE_START_AT = requireTimestamp("2026-09-04T09:00:00Z");
const PREFERENCE_END_AT = requireTimestamp("2026-09-04T12:00:00Z");
const HANDOFF_REQUESTED_AT = requireTimestamp("2026-09-02T10:00:00Z");
const HANDOFF_OWNED_AT = requireTimestamp("2026-09-02T10:05:00Z");
const HANDOFF_TERMINATED_AT = requireTimestamp("2026-09-02T10:10:00Z");
const HANDOFF_SLA_DUE_AT = requireTimestamp("2026-09-02T10:30:00Z");
const SUCCESSOR_REQUESTED_AT = requireTimestamp("2026-09-02T10:11:00Z");
const SUCCESSOR_SLA_DUE_AT = requireTimestamp("2026-09-02T10:45:00Z");

const OFFER_VERSION = requireOfferVersion(1);
const TIME_ZONE = requireTimeZone("Asia/Tashkent");
const APPOINTMENT_CANCEL_REASON = requireAppointmentReason("customer_declined");
const APPOINTMENT_EXPIRE_REASON = requireAppointmentReason("request_timed_out");
const APPOINTMENT_REJECT_REASON = requireAppointmentReason("service_unavailable");
const LEAD_RESTORE_REASON = requireLeadReason("request_ended_retry_allowed");
const HANDOFF_CANCEL_REASON = requireHandoffReason("customer_withdrew");
const HANDOFF_EXPIRE_REASON = requireHandoffReason("sla_elapsed");
const HANDOFF_RESOLUTION = requireHandoffResolution("answered_by_staff");
const CONVERSATION_RESOLUTION = requireConversationResolution("answered_by_staff");
const HANDOFF_QUEUE = requireHandoffQueue("clinic_front_desk");

const SYSTEM_ACTOR = requireActor({ actor_id: null, actor_type: "system" });
const CUSTOMER_ACTOR = requireActor({ actor_id: CONTACT_ID, actor_type: "customer" });
const STAFF_ACTOR = requireActor({ actor_id: STAFF_ID, actor_type: "member" });

const sourceMessage = Object.freeze({
  messageId: SOURCE_MESSAGE_ID,
  organizationId: ORGANIZATION_A,
});
const contact = Object.freeze({ contactId: CONTACT_ID, organizationId: ORGANIZATION_A });
const staff = Object.freeze({ membershipId: STAFF_ID, organizationId: ORGANIZATION_A });
const location = Object.freeze({
  locationId: LOCATION_ID,
  locationVersionId: LOCATION_VERSION_ID,
  organizationId: ORGANIZATION_A,
});
const preferences = Object.freeze([
  Object.freeze({
    endAt: PREFERENCE_END_AT,
    localEnd: "2026-09-04T17:00:00",
    localStart: "2026-09-04T14:00:00",
    precision: "exact",
    preferenceId: PREFERENCE_ID,
    preferenceOrder: 1,
    startAt: PREFERENCE_START_AT,
    timeZone: TIME_ZONE,
  }),
] satisfies readonly AppointmentPreference[]);

const leadContext = (
  lead: Lead,
  expectedVersion: AggregateVersion = lead.version,
): LeadCommandContext => ({
  actor: SYSTEM_ACTOR,
  expectedVersion,
  occurredAt: COMMAND_AT,
  organizationId: ORGANIZATION_A,
});

const conversationContext = (
  conversation: Conversation,
  expectedVersion: AggregateVersion = conversation.version,
): ConversationCommandContext => ({
  actor: SYSTEM_ACTOR,
  expectedVersion,
  occurredAt: HANDOFF_TERMINATED_AT,
  organizationId: ORGANIZATION_A,
});

const handoffContext = (
  handoff: Handoff,
  actor: ActorRef = SYSTEM_ACTOR,
  occurredAt: UtcTimestamp = HANDOFF_TERMINATED_AT,
  expectedVersion: AggregateVersion = handoff.version,
): HandoffCommandContext => ({
  actor,
  expectedVersion,
  occurredAt,
  organizationId: ORGANIZATION_A,
});

const createQualifiedLead = (): Lead => {
  const created = requireSuccess(
    createLead({
      actor: SYSTEM_ACTOR,
      contact,
      leadId: LEAD_ID,
      occurredAt: CREATED_AT,
      organizationId: ORGANIZATION_A,
    }),
  ).nextAggregate;
  const engaged = requireSuccess(
    recordEngagement(created, { ...leadContext(created), sourceMessage }),
  ).nextAggregate;
  return requireSuccess(
    qualifyLead(engaged, {
      ...leadContext(engaged),
      qualification: {
        evaluationId: QUALIFICATION_EVALUATION_ID,
        organizationId: ORGANIZATION_A,
        policyId: QUALIFICATION_POLICY_ID,
      },
    }),
  ).nextAggregate;
};

const appointmentCreateCommand = (
  changes: Partial<CreateAppointmentRequestCommand> = {},
): CreateAppointmentRequestCommand => ({
  actor: CUSTOMER_ACTOR,
  appointmentRequestId: APPOINTMENT_REQUEST_ID,
  businessPolicy: { businessPolicyId: BUSINESS_POLICY_ID, organizationId: ORGANIZATION_A },
  contact,
  conversation: { conversationId: CONVERSATION_ID, organizationId: ORGANIZATION_A },
  initiator: { contact, kind: "customer" },
  lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
  location,
  occurredAt: CREATED_AT,
  organizationId: ORGANIZATION_A,
  preferences,
  service: {
    organizationId: ORGANIZATION_A,
    serviceId: SERVICE_ID,
    serviceVersionId: SERVICE_VERSION_ID,
  },
  sourceMessage,
  ...changes,
});

const createBookingRequestedPair = (): Readonly<{
  appointmentRequest: AppointmentRequest;
  lead: Lead;
}> => {
  const lead = createQualifiedLead();
  const result = requireSuccess(
    createAppointmentRequestWorkflow(lead, {
      appointmentRequest: appointmentCreateCommand(),
      lead: leadContext(lead),
    }),
  );
  return Object.freeze({ appointmentRequest: result.appointmentRequest, lead: result.lead });
};

const createAwaitingConfirmationPair = () => {
  const pair = createBookingRequestedPair();
  const accepted = requireSuccess(
    staffAcceptAppointmentRequest(pair.appointmentRequest, {
      actor: STAFF_ACTOR,
      expectedVersion: pair.appointmentRequest.version,
      location,
      occurredAt: STAFF_ACCEPTED_AT,
      offeredSlot: {
        endAt: OFFER_END_AT,
        localEnd: "2026-09-03T14:30:00",
        localStart: "2026-09-03T14:00:00",
        startAt: OFFER_START_AT,
        timeZone: TIME_ZONE,
      },
      organizationId: ORGANIZATION_A,
      staff,
    }),
  ).nextAggregate;
  const awaiting = requireSuccess(
    prepareCustomerConfirmation(accepted, {
      actor: SYSTEM_ACTOR,
      expectedVersion: accepted.version,
      expiresAt: CONFIRMATION_EXPIRES_AT,
      issuedAt: CONFIRMATION_ISSUED_AT,
      offerVersion: accepted.offer?.offerVersion ?? OFFER_VERSION,
      organizationId: ORGANIZATION_A,
    }),
  ).nextAggregate;
  return Object.freeze({ appointmentRequest: awaiting, lead: pair.lead });
};

const confirmationCommand = (appointmentRequest: AppointmentRequest) => ({
  actor: CUSTOMER_ACTOR,
  evidence: {
    appointmentRequest: {
      appointmentRequestId: appointmentRequest.appointmentRequestId,
      organizationId: ORGANIZATION_A,
    },
    contact,
    customerActedAt: CUSTOMER_ACTED_AT,
    evidence: { evidenceId: CONFIRMATION_EVIDENCE_ID, organizationId: ORGANIZATION_A },
    offerVersion: appointmentRequest.offer?.offerVersion ?? OFFER_VERSION,
    source: "customer_session" as const,
  },
  expectedVersion: appointmentRequest.version,
  now: CONFIRMED_AT,
  organizationId: ORGANIZATION_A,
});

const createConfirmedPair = () => {
  const pair = createAwaitingConfirmationPair();
  const result = requireSuccess(
    confirmAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: confirmationCommand(pair.appointmentRequest),
      lead: leadContext(pair.lead),
    }),
  );
  return Object.freeze({ appointmentRequest: result.appointmentRequest, lead: result.lead });
};

const createOpenConversation = (): Conversation =>
  requireSuccess(
    createConversation({
      actor: SYSTEM_ACTOR,
      channelConnection: {
        channelConnectionId: CHANNEL_CONNECTION_ID,
        organizationId: ORGANIZATION_A,
      },
      contact,
      conversationId: CONVERSATION_ID,
      initialMessage: sourceMessage,
      lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
      occurredAt: CREATED_AT,
      organizationId: ORGANIZATION_A,
    }),
  ).nextAggregate;

const createHandoffCommand = (
  handoffId: HandoffId = HANDOFF_ID,
  changes: Partial<CreateHandoffCommand> = {},
): CreateHandoffCommand => ({
  actor: SYSTEM_ACTOR,
  conversation: { conversationId: CONVERSATION_ID, organizationId: ORGANIZATION_A },
  handoffId,
  lead: { leadId: LEAD_ID, organizationId: ORGANIZATION_A },
  location: { locationId: LOCATION_ID, organizationId: ORGANIZATION_A },
  occurredAt: handoffId === HANDOFF_ID ? HANDOFF_REQUESTED_AT : SUCCESSOR_REQUESTED_AT,
  organizationId: ORGANIZATION_A,
  queueKey: HANDOFF_QUEUE,
  slaDueAt: handoffId === HANDOFF_ID ? HANDOFF_SLA_DUE_AT : SUCCESSOR_SLA_DUE_AT,
  triggerReason: "customer_requested",
  ...changes,
});

const createRequestedHandoffPair = (conversation = createOpenConversation()) => {
  const result = requireSuccess(
    requestHandoffWorkflow(conversation, {
      conversation: conversationContext(conversation),
      handoff: createHandoffCommand(),
    }),
  );
  return Object.freeze({ conversation: result.conversation, handoff: result.handoff });
};

const createStaffOwnedHandoffPair = (action: "assign" | "claim_and_start") => {
  const pair = createRequestedHandoffPair();
  const ownership =
    action === "assign"
      ? {
          action,
          command: {
            ...handoffContext(pair.handoff, SYSTEM_ACTOR, HANDOFF_OWNED_AT),
            assignee: staff,
          },
        }
      : {
          action,
          command: {
            ...handoffContext(pair.handoff, SYSTEM_ACTOR, HANDOFF_OWNED_AT),
            assignee: staff,
          },
        };
  const result = requireSuccess(
    takeHandoffStaffOwnershipWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation),
      handoff: ownership,
    }),
  );
  return Object.freeze({ conversation: result.conversation, handoff: result.handoff });
};

const cancelHandoffAction = (handoff: Handoff) => ({
  action: "cancelled" as const,
  command: { ...handoffContext(handoff), reasonCode: HANDOFF_CANCEL_REASON },
});
const expireHandoffAction = (handoff: Handoff) => ({
  action: "expired" as const,
  command: {
    actor: SYSTEM_ACTOR,
    expectedVersion: handoff.version,
    now: HANDOFF_SLA_DUE_AT,
    organizationId: ORGANIZATION_A,
    reasonCode: HANDOFF_EXPIRE_REASON,
  },
});
const resolveHandoffAction = (handoff: Handoff) => ({
  action: "resolved" as const,
  command: {
    ...handoffContext(handoff, STAFF_ACTOR),
    resolutionCode: HANDOFF_RESOLUTION,
  },
});

describe("appointment cross-machine workflows", () => {
  it("creates the request before moving the qualified Lead to booking_requested", () => {
    const lead = createQualifiedLead();
    const before = JSON.stringify(lead);
    const result = createAppointmentRequestWorkflow(lead, {
      appointmentRequest: appointmentCreateCommand(),
      lead: leadContext(lead),
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(lead)).toBe(before);
    if (result.ok) {
      expect(result.value.appointmentRequest.status).toBe("requested");
      expect(result.value.lead.status).toBe("booking_requested");
      expect(result.value.lead.appointmentRequestId).toBe(APPOINTMENT_REQUEST_ID);
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "appointment_request.created",
        "lead.booking_requested",
      ]);
      expect(result.value.transitionRecords.map((record) => record.command)).toEqual([
        "create_appointment_request",
        "record_appointment_request",
      ]);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.events)).toBe(true);
    }
  });

  it("returns no partial plan when Lead version validation fails after request creation", () => {
    const lead = createQualifiedLead();
    const before = JSON.stringify(lead);
    const result = createAppointmentRequestWorkflow(lead, {
      appointmentRequest: appointmentCreateCommand(),
      lead: leadContext(lead, lead.version + 1),
    });

    expect(result).toEqual({
      error: { code: "concurrency_conflict", currentVersion: lead.version },
      ok: false,
    });
    expect(JSON.stringify(lead)).toBe(before);
    expect("value" in result).toBe(false);
  });

  it("rejects foreign-tenant and mismatched Lead references before producing output", () => {
    const lead = createQualifiedLead();
    const foreign = createAppointmentRequestWorkflow(lead, {
      appointmentRequest: appointmentCreateCommand({ organizationId: ORGANIZATION_B }),
      lead: leadContext(lead),
    });
    const mismatched = createAppointmentRequestWorkflow(lead, {
      appointmentRequest: appointmentCreateCommand({
        lead: {
          leadId: requireLeadId("0193f1a8-7f65-7c28-a434-a10796c43017"),
          organizationId: ORGANIZATION_A,
        },
      }),
      lead: leadContext(lead),
    });

    expect(foreign).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(mismatched).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
  });

  it("confirms the request before converting the linked Lead", () => {
    const pair = createAwaitingConfirmationPair();
    const result = confirmAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: confirmationCommand(pair.appointmentRequest),
      lead: leadContext(pair.lead),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointmentRequest.status).toBe("confirmed");
      expect(result.value.lead.status).toBe("converted");
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "appointment_request.confirmed",
        "lead.converted",
      ]);
      expect(result.value.transitionRecords.map((record) => record.command)).toEqual([
        "confirm_appointment_request",
        "convert_lead",
      ]);
    }
  });

  it("returns no confirmation output when the later Lead version is stale", () => {
    const pair = createAwaitingConfirmationPair();
    const before = JSON.stringify(pair);
    const result = confirmAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: confirmationCommand(pair.appointmentRequest),
      lead: leadContext(pair.lead, pair.lead.version + 1),
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(pair)).toBe(before);
    expect("value" in result).toBe(false);
  });

  it("preserves confirmation safety failures without converting the Lead", () => {
    const pair = createAwaitingConfirmationPair();
    const result = confirmAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: {
        ...confirmationCommand(pair.appointmentRequest),
        now: CONFIRMATION_EXPIRES_AT,
      },
      lead: leadContext(pair.lead),
    });

    expect(result).toEqual({ error: { code: "offer_expired" }, ok: false });
    expect(pair.lead.status).toBe("booking_requested");
  });

  it.each(["rejected", "cancelled", "expired"] as const)(
    "ends a request as %s and restores the Lead only with approved retry policy",
    (outcome) => {
      const pair = createBookingRequestedPair();
      const appointmentRequest =
        outcome === "rejected"
          ? {
              action: outcome,
              command: {
                actor: STAFF_ACTOR,
                expectedVersion: pair.appointmentRequest.version,
                occurredAt: COMMAND_AT,
                organizationId: ORGANIZATION_A,
                reasonCode: APPOINTMENT_REJECT_REASON,
                staff,
              },
            }
          : outcome === "cancelled"
            ? {
                action: outcome,
                command: {
                  actor: CUSTOMER_ACTOR,
                  expectedVersion: pair.appointmentRequest.version,
                  initiator: { contact, kind: "customer" as const },
                  occurredAt: COMMAND_AT,
                  organizationId: ORGANIZATION_A,
                  reasonCode: APPOINTMENT_CANCEL_REASON,
                },
              }
            : {
                action: outcome,
                command: {
                  actor: SYSTEM_ACTOR,
                  expectedVersion: pair.appointmentRequest.version,
                  now: COMMAND_AT,
                  organizationId: ORGANIZATION_A,
                  reasonCode: APPOINTMENT_EXPIRE_REASON,
                },
              };
      const result = endAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
        appointmentRequest,
        lead: leadContext(pair.lead),
        retryPolicy: {
          approved: true,
          organizationId: ORGANIZATION_A,
          policyId: RETRY_POLICY_ID,
          reasonCode: LEAD_RESTORE_REASON,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appointmentRequest.status).toBe(outcome);
        expect(result.value.lead.status).toBe("qualified");
        expect(result.value.lead.appointmentRequestId).toBeNull();
        expect(result.value.events.map((event) => event.event_type)).toEqual([
          `appointment_request.${outcome}`,
          "lead.reopened",
        ]);
        expect(result.value.events[1]).toMatchObject({
          payload: {
            appointment_request_id: APPOINTMENT_REQUEST_ID,
            lead_status: "qualified",
            previous_lead_status: "booking_requested",
            reason_code: LEAD_RESTORE_REASON,
          },
          schema_id: "LeadReopenedDomainEvent.v2",
          schema_version: "2",
        });
      }
    },
  );

  it("ends the request but leaves the Lead unchanged when retry is denied", () => {
    const pair = createBookingRequestedPair();
    const result = endAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: {
        action: "cancelled",
        command: {
          actor: CUSTOMER_ACTOR,
          expectedVersion: pair.appointmentRequest.version,
          initiator: { contact, kind: "customer" },
          occurredAt: COMMAND_AT,
          organizationId: ORGANIZATION_A,
          reasonCode: APPOINTMENT_CANCEL_REASON,
        },
      },
      lead: leadContext(pair.lead),
      retryPolicy: { approved: false, organizationId: ORGANIZATION_A },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointmentRequest.status).toBe("cancelled");
      expect(result.value.lead).toEqual(pair.lead);
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "appointment_request.cancelled",
      ]);
    }
  });

  it("rejects foreign retry approval atomically", () => {
    const pair = createBookingRequestedPair();
    const result = endAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: {
        action: "cancelled",
        command: {
          actor: CUSTOMER_ACTOR,
          expectedVersion: pair.appointmentRequest.version,
          initiator: { contact, kind: "customer" },
          occurredAt: COMMAND_AT,
          organizationId: ORGANIZATION_A,
          reasonCode: APPOINTMENT_CANCEL_REASON,
        },
      },
      lead: leadContext(pair.lead),
      retryPolicy: {
        approved: true,
        organizationId: ORGANIZATION_B,
        policyId: RETRY_POLICY_ID,
        reasonCode: LEAD_RESTORE_REASON,
      },
    });

    expect(result).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(pair.appointmentRequest.status).toBe("requested");
    expect(pair.lead.status).toBe("booking_requested");
  });

  it("cancels a confirmed request without rolling back the converted Lead", () => {
    const pair = createConfirmedPair();
    const result = cancelConfirmedAppointmentRequestWorkflow(pair.appointmentRequest, pair.lead, {
      appointmentRequest: {
        actor: CUSTOMER_ACTOR,
        expectedVersion: pair.appointmentRequest.version,
        initiator: { contact, kind: "customer" },
        occurredAt: COMMAND_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: APPOINTMENT_CANCEL_REASON,
      },
      lead: leadContext(pair.lead),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.appointmentRequest.status).toBe("cancelled");
      expect(result.value.lead.status).toBe("converted");
      expect(result.value.lead.version).toBe(pair.lead.version);
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "appointment_request.cancelled",
      ]);
    }
  });
});

describe("Handoff and Conversation cross-machine workflows", () => {
  it.each(["open", "awaiting_lead"] as const)(
    "requests a Handoff before routing an %s AI Conversation",
    (state) => {
      const open = createOpenConversation();
      const conversation =
        state === "open"
          ? open
          : requireSuccess(
              queueAiResponse(open, {
                ...conversationContext(open),
                message: { messageId: RESPONSE_MESSAGE_ID, organizationId: ORGANIZATION_A },
              }),
            ).nextAggregate;
      const result = requestHandoffWorkflow(conversation, {
        conversation: conversationContext(conversation),
        handoff: createHandoffCommand(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.handoff.status).toBe("requested");
        expect(result.value.conversation).toMatchObject({
          automationMode: "paused",
          status: "awaiting_staff",
        });
        expect(result.value.events.map((event) => event.event_type)).toEqual([
          "handoff.requested",
          "conversation.status_changed",
        ]);
        expect(result.value.transitionRecords.map((record) => record.command)).toEqual([
          "request_handoff",
          "route_to_human",
        ]);
      }
    },
  );

  it("returns no partial Handoff when later Conversation version validation fails", () => {
    const conversation = createOpenConversation();
    const before = JSON.stringify(conversation);
    const result = requestHandoffWorkflow(conversation, {
      conversation: conversationContext(conversation, conversation.version + 1),
      handoff: createHandoffCommand(),
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(conversation)).toBe(before);
    expect("value" in result).toBe(false);
  });

  it("rejects foreign-tenant and mismatched Conversation references", () => {
    const conversation = createOpenConversation();
    const foreign = requestHandoffWorkflow(conversation, {
      conversation: conversationContext(conversation),
      handoff: createHandoffCommand(HANDOFF_ID, { organizationId: ORGANIZATION_B }),
    });
    const mismatch = requestHandoffWorkflow(conversation, {
      conversation: conversationContext(conversation),
      handoff: createHandoffCommand(HANDOFF_ID, {
        conversation: {
          conversationId: requireConversationId("0193f1a8-7f65-7c28-a434-a10796c43018"),
          organizationId: ORGANIZATION_A,
        },
      }),
    });

    expect(foreign).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(mismatch).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
  });

  it.each(["assign", "claim_and_start"] as const)(
    "takes staff ownership with the exact %s event and record order",
    (action) => {
      const pair = createRequestedHandoffPair();
      const result = takeHandoffStaffOwnershipWorkflow(pair.handoff, pair.conversation, {
        conversation: conversationContext(pair.conversation),
        handoff: {
          action,
          command: {
            ...handoffContext(pair.handoff, SYSTEM_ACTOR, HANDOFF_OWNED_AT),
            assignee: staff,
          },
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.handoff.status).toBe(action === "assign" ? "assigned" : "in_progress");
        expect(result.value.conversation.automationMode).toBe("staff");
        expect(result.value.events.map((event) => event.event_type)).toEqual(
          action === "assign"
            ? ["handoff.assigned", "conversation.automation_mode_changed"]
            : ["handoff.assigned", "handoff.started", "conversation.automation_mode_changed"],
        );
        expect(result.value.transitionRecords.map((record) => record.command)).toEqual(
          action === "assign"
            ? ["assign_handoff", "record_staff_ownership"]
            : ["claim_and_start_handoff", "claim_and_start_handoff", "record_staff_ownership"],
        );
      }
    },
  );

  it("returns no partial ownership when the later Conversation version is stale", () => {
    const pair = createRequestedHandoffPair();
    const before = JSON.stringify(pair);
    const result = takeHandoffStaffOwnershipWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation, pair.conversation.version + 1),
      handoff: {
        action: "assign",
        command: {
          ...handoffContext(pair.handoff, SYSTEM_ACTOR, HANDOFF_OWNED_AT),
          assignee: staff,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(pair)).toBe(before);
    expect("value" in result).toBe(false);
  });

  it.each(["resolved", "cancelled", "expired"] as const)(
    "terminalizes a %s Handoff before explicitly resuming AI",
    (outcome) => {
      const pair =
        outcome === "resolved"
          ? createStaffOwnedHandoffPair("claim_and_start")
          : createRequestedHandoffPair();
      const action =
        outcome === "resolved"
          ? resolveHandoffAction(pair.handoff)
          : outcome === "cancelled"
            ? cancelHandoffAction(pair.handoff)
            : expireHandoffAction(pair.handoff);
      const result = terminateHandoffAndResumeAiWorkflow(pair.handoff, pair.conversation, {
        conversation: conversationContext(pair.conversation),
        disposition: "resume_ai",
        handoff: action,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.handoff.status).toBe(outcome);
        expect(result.value.conversation).toMatchObject({
          activeHandoff: null,
          automationMode: "ai",
          status: "open",
        });
        expect(result.value.events.map((event) => event.event_type)).toEqual([
          `handoff.${outcome}`,
          "conversation.status_changed",
        ]);
      }
    },
  );

  it("terminalizes the Handoff before resolving the Conversation with one specialized event", () => {
    const pair = createStaffOwnedHandoffPair("claim_and_start");
    const result = terminateHandoffAndResolveConversationWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation),
      disposition: "resolve_conversation",
      handoff: resolveHandoffAction(pair.handoff),
      resolutionCode: CONVERSATION_RESOLUTION,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conversation).toMatchObject({
        activeHandoff: null,
        automationMode: "paused",
        status: "resolved",
      });
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "handoff.resolved",
        "conversation.resolved",
      ]);
      expect(result.value.events.map((event) => event.event_type)).not.toContain(
        "conversation.status_changed",
      );
    }
  });

  it("does not expose terminal output when the later disposition transition fails", () => {
    const pair = createRequestedHandoffPair();
    const result = terminateHandoffAndResumeAiWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation, pair.conversation.version + 1),
      disposition: "resume_ai",
      handoff: cancelHandoffAction(pair.handoff),
    });

    expect(result.ok).toBe(false);
    expect(pair.handoff.status).toBe("requested");
    expect(pair.conversation.automationMode).toBe("paused");
    expect("value" in result).toBe(false);
  });

  it("replaces a staff-owned Handoff with terminal, requested, then staff-to-paused events", () => {
    const pair = createStaffOwnedHandoffPair("assign");
    const result = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation),
      disposition: "successor_handoff",
      handoff: cancelHandoffAction(pair.handoff),
      successorHandoff: createHandoffCommand(SUCCESSOR_HANDOFF_ID),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handoff.status).toBe("cancelled");
      expect(result.value.successorHandoff.status).toBe("requested");
      expect(result.value.conversation).toMatchObject({
        automationMode: "paused",
        status: "awaiting_staff",
      });
      expect(result.value.conversation.activeHandoff?.handoffId).toBe(SUCCESSOR_HANDOFF_ID);
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "handoff.cancelled",
        "handoff.requested",
        "conversation.automation_mode_changed",
      ]);
      expect(result.value.transitionRecords.map((record) => record.command)).toEqual([
        "cancel_handoff",
        "request_handoff",
        "record_successor_handoff",
      ]);
    }
  });

  it("replaces a requested Handoff while paused with exact active-Handoff provenance", () => {
    const pair = createRequestedHandoffPair();
    const result = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation),
      disposition: "successor_handoff",
      handoff: cancelHandoffAction(pair.handoff),
      successorHandoff: createHandoffCommand(SUCCESSOR_HANDOFF_ID),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events.map((event) => event.event_type)).toEqual([
        "handoff.cancelled",
        "handoff.requested",
        "conversation.active_handoff_changed",
      ]);
      expect(result.value.events[2]).toMatchObject({
        payload: {
          automation_mode: "paused",
          conversation_status: "awaiting_staff",
          handoff_id: SUCCESSOR_HANDOFF_ID,
          previous_handoff_id: HANDOFF_ID,
          reason: "successor_handoff",
        },
        schema_id: "ConversationActiveHandoffChangedDomainEvent.v1",
      });
      expect(result.value.transitionRecords[2]).toMatchObject({
        activeHandoffId: SUCCESSOR_HANDOFF_ID,
        fromHandoffId: HANDOFF_ID,
        handoffDisposition: "successor_handoff",
      });
    }
  });

  it("rejects same-ID, foreign-tenant, and mismatched successor references", () => {
    const pair = createRequestedHandoffPair();
    const base = {
      conversation: conversationContext(pair.conversation),
      disposition: "successor_handoff" as const,
      handoff: cancelHandoffAction(pair.handoff),
    };
    const sameId = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      ...base,
      successorHandoff: createHandoffCommand(HANDOFF_ID),
    });
    const foreign = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      ...base,
      successorHandoff: createHandoffCommand(SUCCESSOR_HANDOFF_ID, {
        organizationId: ORGANIZATION_B,
      }),
    });
    const mismatch = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      ...base,
      successorHandoff: createHandoffCommand(SUCCESSOR_HANDOFF_ID, {
        location: null,
      }),
    });

    expect(sameId).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
    expect(foreign).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(mismatch).toEqual({
      error: { code: "invariant_violation", reason: "invalid_reference" },
      ok: false,
    });
  });

  it("returns no terminal or successor output when the final Conversation version is stale", () => {
    const pair = createRequestedHandoffPair();
    const before = JSON.stringify(pair);
    const result = replaceHandoffWithSuccessorWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation, pair.conversation.version + 1),
      disposition: "successor_handoff",
      handoff: cancelHandoffAction(pair.handoff),
      successorHandoff: createHandoffCommand(SUCCESSOR_HANDOFF_ID),
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(pair)).toBe(before);
    expect("value" in result).toBe(false);
  });

  it("deep-freezes composed outputs and never mutates loaded aggregates", () => {
    const pair = createRequestedHandoffPair();
    const before = JSON.stringify(pair);
    const result = terminateHandoffAndResumeAiWorkflow(pair.handoff, pair.conversation, {
      conversation: conversationContext(pair.conversation),
      disposition: "resume_ai",
      handoff: cancelHandoffAction(pair.handoff),
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(pair)).toBe(before);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.handoff)).toBe(true);
      expect(Object.isFrozen(result.value.conversation)).toBe(true);
      expect(Object.isFrozen(result.value.events)).toBe(true);
      expect(Object.isFrozen(result.value.transitionRecords)).toBe(true);
    }
  });
});
