import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActorRefSchema,
  AppointmentRequestIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  EventIdSchema,
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
  type ContactId,
  type ConversationId,
  type CorrelationId,
  type EventId,
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
  cancelAppointmentRequest,
  confirmAppointmentRequest,
  createAppointmentRequest,
  expireAppointmentRequest,
  isAppointmentConfirmationSource,
  isAppointmentRequestStatus,
  prepareCustomerConfirmation,
  rejectAppointmentRequest,
  staffAcceptAppointmentRequest,
  validateAppointmentOfferVersion,
  validateAppointmentRequest,
  validateAppointmentRequestReasonCode,
  validateIanaTimeZone,
  type AppointmentBusinessPolicyReference,
  type AppointmentCommandContext,
  type AppointmentConfirmationEvidenceInput,
  type AppointmentContactReference,
  type AppointmentConversationReference,
  type AppointmentEvidenceReference,
  type AppointmentInitiator,
  type AppointmentLeadReference,
  type AppointmentLocationReference,
  type AppointmentMessageReference,
  type AppointmentOfferVersion,
  type AppointmentPreference,
  type AppointmentRequest,
  type AppointmentRequestCommandResult,
  type AppointmentRequestCreationResult,
  type AppointmentRequestEventDraft,
  type AppointmentRequestReasonCode,
  type AppointmentRequestReference,
  type AppointmentRequestStatus,
  type AppointmentServiceReference,
  type AppointmentStaffReference,
  type CreateAppointmentRequestCommand,
  type CustomerSessionConfirmationEvidenceInput,
  type ExistingAppointmentRequestCommandName,
  type IanaTimeZone,
} from "../../packages/domain/src/index.js";

const requireOrganizationId = (value: string): OrganizationId => {
  if (!isSchemaValue(OrganizationIdSchema, value)) throw new TypeError("Invalid organization");
  return value;
};
const requireAppointmentRequestId = (value: string): AppointmentRequestId => {
  if (!isSchemaValue(AppointmentRequestIdSchema, value)) throw new TypeError("Invalid request");
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
const requireLeadId = (value: string): LeadId => {
  if (!isSchemaValue(LeadIdSchema, value)) throw new TypeError("Invalid lead");
  return value;
};
const requireLocationId = (value: string): LocationId => {
  if (!isSchemaValue(LocationIdSchema, value)) throw new TypeError("Invalid location");
  return value;
};
const requireServiceId = (value: string): ServiceId => {
  if (!isSchemaValue(ServiceIdSchema, value)) throw new TypeError("Invalid service");
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
const requireEventId = (value: string): EventId => {
  if (!isSchemaValue(EventIdSchema, value)) throw new TypeError("Invalid event");
  return value;
};
const requireCorrelationId = (value: string): CorrelationId => {
  if (!isSchemaValue(CorrelationIdSchema, value)) throw new TypeError("Invalid correlation");
  return value;
};
const requireUtcTimestamp = (value: string): UtcTimestamp => {
  if (!isSchemaValue(UtcTimestampSchema, value)) throw new TypeError("Invalid timestamp");
  return value;
};
const requireActor = (value: unknown): ActorRef => {
  if (!isSchemaValue(ActorRefSchema, value)) throw new TypeError("Invalid actor");
  return value;
};
const requireOfferVersion = (value: number): AppointmentOfferVersion => {
  const result = validateAppointmentOfferVersion(value);
  if (!result.ok) throw new TypeError("Invalid offer version");
  return result.value;
};
const requireReasonCode = (value: string): AppointmentRequestReasonCode => {
  const result = validateAppointmentRequestReasonCode(value);
  if (!result.ok) throw new TypeError("Invalid reason code");
  return result.value;
};
const requireTimeZone = (value: string): IanaTimeZone => {
  const result = validateIanaTimeZone(value);
  if (!result.ok) throw new TypeError("Invalid time zone");
  return result.value;
};

const ORGANIZATION_A = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c42e01");
const ORGANIZATION_B = requireOrganizationId("0193f1a8-7f65-7c28-a434-a10796c42e02");
const APPOINTMENT_REQUEST_ID = requireAppointmentRequestId("0193f1a8-7f65-7c28-a434-a10796c42e03");
const OTHER_APPOINTMENT_REQUEST_ID = requireAppointmentRequestId(
  "0193f1a8-7f65-7c28-a434-a10796c42e04",
);
const CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c42e05");
const OTHER_CONTACT_ID = requireContactId("0193f1a8-7f65-7c28-a434-a10796c42e06");
const CONVERSATION_ID = requireConversationId("0193f1a8-7f65-7c28-a434-a10796c42e07");
const LEAD_ID = requireLeadId("0193f1a8-7f65-7c28-a434-a10796c42e08");
const LOCATION_ID = requireLocationId("0193f1a8-7f65-7c28-a434-a10796c42e09");
const SERVICE_ID = requireServiceId("0193f1a8-7f65-7c28-a434-a10796c42e0a");
const STAFF_ID = requireMembershipId("0193f1a8-7f65-7c28-a434-a10796c42e0b");
const OTHER_STAFF_ID = requireMembershipId("0193f1a8-7f65-7c28-a434-a10796c42e0c");
const SOURCE_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c42e0d");
const CONFIRMATION_MESSAGE_ID = requireMessageId("0193f1a8-7f65-7c28-a434-a10796c42e0e");
const SERVICE_VERSION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e0f");
const LOCATION_VERSION_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e10");
const BUSINESS_POLICY_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e11");
const PREFERENCE_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e12");
const EVIDENCE_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e13");
const PROTECTED_EVIDENCE_ID = requireResourceId("0193f1a8-7f65-7c28-a434-a10796c42e14");
const EVENT_ID = requireEventId("0193f1a8-7f65-7c28-a434-a10796c42e15");
const CORRELATION_ID = requireCorrelationId("0193f1a8-7f65-7c28-a434-a10796c42e16");

const CREATED_AT = requireUtcTimestamp("2026-09-01T10:00:00Z");
const BEFORE_CREATED_AT = requireUtcTimestamp("2026-09-01T09:59:59Z");
const STAFF_ACCEPTED_AT = requireUtcTimestamp("2026-09-01T10:05:00Z");
const ISSUED_AT = requireUtcTimestamp("2026-09-01T10:06:00Z");
const BEFORE_ISSUED_AT = requireUtcTimestamp("2026-09-01T10:05:59.999999999Z");
const CUSTOMER_ACTED_AT = requireUtcTimestamp("2026-09-01T10:07:00Z");
const CONFIRMED_AT = requireUtcTimestamp("2026-09-01T10:08:00Z");
const COMMAND_AT = requireUtcTimestamp("2026-09-01T10:30:00Z");
const JUST_BEFORE_EXPIRY = requireUtcTimestamp("2026-09-01T10:59:59.999999999Z");
const EXPIRES_AT = requireUtcTimestamp("2026-09-01T11:00:00Z");
const AFTER_EXPIRY = requireUtcTimestamp("2026-09-01T11:00:00.000000001Z");
const OFFER_START_AT = requireUtcTimestamp("2026-09-02T09:00:00Z");
const OFFER_END_AT = requireUtcTimestamp("2026-09-02T09:30:00Z");
const PREFERENCE_START_AT = requireUtcTimestamp("2026-09-03T09:00:00Z");
const PREFERENCE_END_AT = requireUtcTimestamp("2026-09-03T12:00:00Z");

const OFFER_VERSION = requireOfferVersion(1);
const NEXT_OFFER_VERSION = requireOfferVersion(2);
const REJECTION_REASON = requireReasonCode("service_unavailable");
const CANCELLATION_REASON = requireReasonCode("customer_declined");
const EXPIRY_REASON = requireReasonCode("offer_expired");
const ATTESTATION_REASON = requireReasonCode("customer_confirmed_by_phone");
const TIME_ZONE = requireTimeZone("Asia/Tashkent");

const SYSTEM_ACTOR = requireActor({ actor_id: null, actor_type: "system" });
const CUSTOMER_ACTOR = requireActor({ actor_id: CONTACT_ID, actor_type: "customer" });
const OTHER_CUSTOMER_ACTOR = requireActor({
  actor_id: OTHER_CONTACT_ID,
  actor_type: "customer",
});
const STAFF_ACTOR = requireActor({ actor_id: STAFF_ID, actor_type: "member" });
const OTHER_STAFF_ACTOR = requireActor({ actor_id: OTHER_STAFF_ID, actor_type: "member" });

const CONTACT = Object.freeze({
  contactId: CONTACT_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentContactReference);
const LEAD = Object.freeze({
  leadId: LEAD_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentLeadReference);
const CONVERSATION = Object.freeze({
  conversationId: CONVERSATION_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentConversationReference);
const LOCATION = Object.freeze({
  locationId: LOCATION_ID,
  locationVersionId: LOCATION_VERSION_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentLocationReference);
const SERVICE = Object.freeze({
  organizationId: ORGANIZATION_A,
  serviceId: SERVICE_ID,
  serviceVersionId: SERVICE_VERSION_ID,
} satisfies AppointmentServiceReference);
const BUSINESS_POLICY = Object.freeze({
  businessPolicyId: BUSINESS_POLICY_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentBusinessPolicyReference);
const SOURCE_MESSAGE = Object.freeze({
  messageId: SOURCE_MESSAGE_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentMessageReference);
const CONFIRMATION_MESSAGE = Object.freeze({
  messageId: CONFIRMATION_MESSAGE_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentMessageReference);
const STAFF = Object.freeze({
  membershipId: STAFF_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentStaffReference);
const EVIDENCE = Object.freeze({
  evidenceId: EVIDENCE_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentEvidenceReference);
const PROTECTED_EVIDENCE = Object.freeze({
  evidenceId: PROTECTED_EVIDENCE_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentEvidenceReference);
const REQUEST_REFERENCE = Object.freeze({
  appointmentRequestId: APPOINTMENT_REQUEST_ID,
  organizationId: ORGANIZATION_A,
} satisfies AppointmentRequestReference);
const CUSTOMER_INITIATOR = Object.freeze({
  contact: CONTACT,
  kind: "customer",
} satisfies AppointmentInitiator);
const STAFF_INITIATOR = Object.freeze({
  kind: "staff",
  staff: STAFF,
} satisfies AppointmentInitiator);
const PREFERENCES = Object.freeze([
  Object.freeze({
    endAt: PREFERENCE_END_AT,
    localEnd: "2026-09-03T17:00:00",
    localStart: "2026-09-03T14:00:00",
    precision: "exact",
    preferenceId: PREFERENCE_ID,
    preferenceOrder: 1,
    startAt: PREFERENCE_START_AT,
    timeZone: TIME_ZONE,
  }),
] satisfies readonly AppointmentPreference[]);

const createCommand = (
  changes: Partial<CreateAppointmentRequestCommand> = {},
): CreateAppointmentRequestCommand => ({
  actor: CUSTOMER_ACTOR,
  appointmentRequestId: APPOINTMENT_REQUEST_ID,
  businessPolicy: BUSINESS_POLICY,
  contact: CONTACT,
  conversation: CONVERSATION,
  initiator: CUSTOMER_INITIATOR,
  lead: LEAD,
  location: LOCATION,
  occurredAt: CREATED_AT,
  organizationId: ORGANIZATION_A,
  preferences: PREFERENCES,
  service: SERVICE,
  sourceMessage: SOURCE_MESSAGE,
  ...changes,
});

const commandContext = (
  request: AppointmentRequest,
  actor: ActorRef = SYSTEM_ACTOR,
  occurredAt: UtcTimestamp = COMMAND_AT,
  expectedVersion: AggregateVersion = request.version,
): AppointmentCommandContext => ({
  actor,
  expectedVersion,
  occurredAt,
  organizationId: ORGANIZATION_A,
});

const requireNextRequest = (
  result: AppointmentRequestCommandResult | AppointmentRequestCreationResult,
): AppointmentRequest => {
  if (!result.ok) throw new TypeError(`Expected successful transition: ${result.error.code}`);
  return result.value.nextAggregate;
};

const createRequested = (): AppointmentRequest =>
  requireNextRequest(createAppointmentRequest(createCommand()));

const accept = (request: AppointmentRequest): AppointmentRequest =>
  requireNextRequest(
    staffAcceptAppointmentRequest(request, {
      ...commandContext(request, STAFF_ACTOR, STAFF_ACCEPTED_AT),
      location: LOCATION,
      offeredSlot: {
        endAt: OFFER_END_AT,
        localEnd: "2026-09-02T14:30:00",
        localStart: "2026-09-02T14:00:00",
        startAt: OFFER_START_AT,
        timeZone: TIME_ZONE,
      },
      staff: STAFF,
    }),
  );

const prepare = (request: AppointmentRequest): AppointmentRequest =>
  requireNextRequest(
    prepareCustomerConfirmation(request, {
      actor: SYSTEM_ACTOR,
      expectedVersion: request.version,
      expiresAt: EXPIRES_AT,
      issuedAt: ISSUED_AT,
      offerVersion: request.offer?.offerVersion ?? OFFER_VERSION,
      organizationId: ORGANIZATION_A,
    }),
  );

const directEvidence = (
  changes: Partial<CustomerSessionConfirmationEvidenceInput> = {},
): CustomerSessionConfirmationEvidenceInput => ({
  appointmentRequest: REQUEST_REFERENCE,
  contact: CONTACT,
  customerActedAt: CUSTOMER_ACTED_AT,
  evidence: EVIDENCE,
  offerVersion: OFFER_VERSION,
  source: "customer_session",
  ...changes,
});

const confirm = (request: AppointmentRequest): AppointmentRequest =>
  requireNextRequest(
    confirmAppointmentRequest(request, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence({ offerVersion: request.offer?.offerVersion ?? OFFER_VERSION }),
      expectedVersion: request.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
    }),
  );

const cancel = (request: AppointmentRequest): AppointmentRequest =>
  requireNextRequest(
    cancelAppointmentRequest(request, {
      ...commandContext(request, CUSTOMER_ACTOR),
      initiator: CUSTOMER_INITIATOR,
      reasonCode: CANCELLATION_REASON,
    }),
  );

const expire = (request: AppointmentRequest): AppointmentRequest =>
  requireNextRequest(
    expireAppointmentRequest(request, {
      actor: SYSTEM_ACTOR,
      expectedVersion: request.version,
      now: EXPIRES_AT,
      organizationId: ORGANIZATION_A,
      reasonCode: EXPIRY_REASON,
    }),
  );

const stateFixtures = (): Readonly<Record<AppointmentRequestStatus, AppointmentRequest>> => {
  const requested = createRequested();
  const staffAccepted = accept(requested);
  const awaiting = prepare(staffAccepted);
  const confirmed = confirm(awaiting);
  const rejected = requireNextRequest(
    rejectAppointmentRequest(requested, {
      ...commandContext(requested, STAFF_ACTOR, STAFF_ACCEPTED_AT),
      reasonCode: REJECTION_REASON,
      staff: STAFF,
    }),
  );
  const cancelled = cancel(requested);
  const expired = expire(requested);

  return Object.freeze({
    awaiting_customer_confirmation: awaiting,
    cancelled,
    confirmed,
    expired,
    rejected,
    requested,
    staff_accepted: staffAccepted,
  });
};

type ExpectedTransition = Readonly<{
  eventType: AppointmentRequestEventDraft["event_type"];
  toStatus: AppointmentRequestStatus;
}>;

type CommandCase = Readonly<{
  name: ExistingAppointmentRequestCommandName;
  run: (
    request: AppointmentRequest,
    expectedVersion?: AggregateVersion,
  ) => AppointmentRequestCommandResult;
  successes: Partial<Record<AppointmentRequestStatus, ExpectedTransition>>;
}>;

const COMMAND_CASES = [
  {
    name: "staff_accept_appointment_request",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      staffAcceptAppointmentRequest(request, {
        ...commandContext(request, STAFF_ACTOR, COMMAND_AT, expectedVersion),
        location: LOCATION,
        offeredSlot: {
          endAt: OFFER_END_AT,
          localEnd: "2026-09-02T14:30:00",
          localStart: "2026-09-02T14:00:00",
          startAt: OFFER_START_AT,
          timeZone: TIME_ZONE,
        },
        staff: STAFF,
      }),
    successes: {
      requested: {
        eventType: "appointment_request.staff_accepted",
        toStatus: "staff_accepted",
      },
    },
  },
  {
    name: "reject_appointment_request",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      rejectAppointmentRequest(request, {
        ...commandContext(request, STAFF_ACTOR, COMMAND_AT, expectedVersion),
        reasonCode: REJECTION_REASON,
        staff: STAFF,
      }),
    successes: {
      requested: { eventType: "appointment_request.rejected", toStatus: "rejected" },
    },
  },
  {
    name: "prepare_customer_confirmation",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      prepareCustomerConfirmation(request, {
        actor: SYSTEM_ACTOR,
        expectedVersion,
        expiresAt: EXPIRES_AT,
        issuedAt: COMMAND_AT,
        offerVersion: request.offer?.offerVersion ?? OFFER_VERSION,
        organizationId: ORGANIZATION_A,
      }),
    successes: {
      staff_accepted: {
        eventType: "appointment_request.customer_confirmation_requested",
        toStatus: "awaiting_customer_confirmation",
      },
    },
  },
  {
    name: "confirm_appointment_request",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      confirmAppointmentRequest(request, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence({ offerVersion: request.offer?.offerVersion ?? OFFER_VERSION }),
        expectedVersion,
        now: COMMAND_AT,
        organizationId: ORGANIZATION_A,
      }),
    successes: {
      awaiting_customer_confirmation: {
        eventType: "appointment_request.confirmed",
        toStatus: "confirmed",
      },
    },
  },
  {
    name: "cancel_appointment_request",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      cancelAppointmentRequest(request, {
        ...commandContext(request, CUSTOMER_ACTOR, COMMAND_AT, expectedVersion),
        initiator: CUSTOMER_INITIATOR,
        reasonCode: CANCELLATION_REASON,
      }),
    successes: Object.fromEntries(
      (["requested", "staff_accepted", "awaiting_customer_confirmation", "confirmed"] as const).map(
        (status) => [status, { eventType: "appointment_request.cancelled", toStatus: "cancelled" }],
      ),
    ),
  },
  {
    name: "expire_appointment_request",
    run: (request: AppointmentRequest, expectedVersion = request.version) =>
      expireAppointmentRequest(request, {
        actor: SYSTEM_ACTOR,
        expectedVersion,
        now: EXPIRES_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRY_REASON,
      }),
    successes: Object.fromEntries(
      (["requested", "staff_accepted", "awaiting_customer_confirmation"] as const).map((status) => [
        status,
        { eventType: "appointment_request.expired", toStatus: "expired" },
      ]),
    ),
  },
] as const satisfies readonly CommandCase[];

const STATUSES = [
  "requested",
  "staff_accepted",
  "awaiting_customer_confirmation",
  "confirmed",
  "rejected",
  "cancelled",
  "expired",
] as const satisfies readonly AppointmentRequestStatus[];

const MATRIX_CASES = STATUSES.flatMap((status) =>
  COMMAND_CASES.map((command) => ({ command, status })),
);
const expectedFor = (
  command: CommandCase,
  status: AppointmentRequestStatus,
): ExpectedTransition | undefined => command.successes[status];
const LEGAL_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedFor(command, status) !== undefined,
);
const INVALID_CASES = MATRIX_CASES.filter(
  ({ command, status }) => expectedFor(command, status) === undefined,
);

const eventEnvelope = (
  request: AppointmentRequest,
  draft: AppointmentRequestEventDraft,
): Record<string, unknown> => ({
  actor: SYSTEM_ACTOR,
  aggregate_id: request.appointmentRequestId,
  aggregate_type: "appointment_request",
  aggregate_version: draft.aggregate_version,
  causation_id: null,
  correlation_id: CORRELATION_ID,
  event_id: EVENT_ID,
  event_type: draft.event_type,
  occurred_at: COMMAND_AT,
  organization_id: request.organizationId,
  payload: draft.payload,
  request_id: null,
  schema_id: draft.schema_id,
  schema_version: draft.schema_version,
});

const expectCanonicalDraft = (
  request: AppointmentRequest,
  draft: AppointmentRequestEventDraft,
): void => {
  expect(isSchemaValue(DomainEventPayloadSchemas[draft.event_type], draft.payload)).toBe(true);
  expect(isSchemaValue(DomainEventSchemas[draft.event_type], eventEnvelope(request, draft))).toBe(
    true,
  );
};

const expectFailureWithoutEffects = (
  request: AppointmentRequest,
  result: unknown,
  expectedError: unknown,
): void => {
  const before = JSON.stringify(request);
  expect(result).toEqual({ error: expectedError, ok: false });
  expect(result).not.toHaveProperty("value");
  expect(result).not.toHaveProperty("events");
  expect(result).not.toHaveProperty("transitionRecords");
  expect(JSON.stringify(request)).toBe(before);
};

describe("AppointmentRequest creation and canonical model", () => {
  it("creates immutable requested state with exact normalized preferences and one canonical event", () => {
    const result = createAppointmentRequest(createCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.nextAggregate).toEqual({
      appointmentRequestId: APPOINTMENT_REQUEST_ID,
      businessPolicyId: BUSINESS_POLICY_ID,
      cancellation: null,
      confirmationEvidence: null,
      confirmationOffer: null,
      confirmedAt: null,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
      createdAt: CREATED_AT,
      expiration: null,
      leadId: LEAD_ID,
      locationId: LOCATION_ID,
      locationVersionId: LOCATION_VERSION_ID,
      offer: null,
      organizationId: ORGANIZATION_A,
      preferences: PREFERENCES,
      serviceId: SERVICE_ID,
      serviceVersionId: SERVICE_VERSION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      staffDecision: null,
      status: "requested",
      version: 1,
    });
    expect(result.value.events).toEqual([
      {
        aggregate_version: 1,
        event_type: "appointment_request.created",
        payload: {
          appointment_status: "requested",
          conversation_id: CONVERSATION_ID,
          lead_id: LEAD_ID,
          location_id: LOCATION_ID,
          service_id: SERVICE_ID,
        },
        schema_id: "AppointmentRequestCreatedDomainEvent.v1",
        schema_version: "1",
      },
    ]);
    expect(result.value.transitionRecords).toEqual([
      {
        actor: CUSTOMER_ACTOR,
        appointmentRequestId: APPOINTMENT_REQUEST_ID,
        command: "create_appointment_request",
        fromStatus: null,
        occurredAt: CREATED_AT,
        offerVersion: null,
        organizationId: ORGANIZATION_A,
        reasonCode: null,
        toStatus: "requested",
        version: 1,
      },
    ]);
    expectCanonicalDraft(result.value.nextAggregate, result.value.events[0]!);
  });

  it("supports explicitly attributed staff-assisted creation without treating AI as actor", () => {
    const result = createAppointmentRequest(
      createCommand({ actor: STAFF_ACTOR, initiator: STAFF_INITIATOR }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.transitionRecords[0]?.actor).toEqual(STAFF_ACTOR);
  });

  it.each(STATUSES)("recognizes only canonical status %s", (status) => {
    expect(isAppointmentRequestStatus(status)).toBe(true);
  });

  it.each(["customer_session", "telegram", "staff_attested_external"] as const)(
    "recognizes canonical confirmation source %s",
    (source) => expect(isAppointmentConfirmationSource(source)).toBe(true),
  );
});

describe("exhaustive AppointmentRequest state by command matrix", () => {
  it("covers seven states, six existing commands, eleven legal edges, and thirty-one invalid pairs", () => {
    expect(STATUSES).toHaveLength(7);
    expect(COMMAND_CASES).toHaveLength(6);
    expect(MATRIX_CASES).toHaveLength(42);
    expect(LEGAL_CASES).toHaveLength(11);
    expect(INVALID_CASES).toHaveLength(31);
  });

  it.each(LEGAL_CASES)("allows $status → $command.name", ({ command, status }) => {
    const request = stateFixtures()[status];
    const expected = expectedFor(command, status)!;
    const result = command.run(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextAggregate.status).toBe(expected.toStatus);
    expect(result.value.nextAggregate.version).toBe(request.version + 1);
    expect(result.value.events.map((event) => event.event_type)).toEqual([expected.eventType]);
    expect(result.value.transitionRecords).toHaveLength(1);
    expect(result.value.transitionRecords[0]?.version).toBe(request.version + 1);
    expectCanonicalDraft(request, result.value.events[0]!);
  });

  it.each(INVALID_CASES)(
    "rejects $status → $command.name without effects",
    ({ command, status }) => {
      const request = stateFixtures()[status];
      expectFailureWithoutEffects(request, command.run(request), {
        code: "invalid_state_transition",
        command: command.name,
        currentState: status,
      });
    },
  );
});

describe("staff acceptance is never customer confirmation", () => {
  it("records an approved offer and only the intermediate staff_accepted fact", () => {
    const requested = createRequested();
    const result = staffAcceptAppointmentRequest(requested, {
      ...commandContext(requested, STAFF_ACTOR, STAFF_ACCEPTED_AT),
      location: LOCATION,
      offeredSlot: {
        endAt: OFFER_END_AT,
        localEnd: "2026-09-02T14:30:00",
        localStart: "2026-09-02T14:00:00",
        startAt: OFFER_START_AT,
        timeZone: TIME_ZONE,
      },
      staff: STAFF,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextAggregate.status).toBe("staff_accepted");
    expect(result.value.nextAggregate.confirmationEvidence).toBeNull();
    expect(result.value.nextAggregate.confirmedAt).toBeNull();
    expect(result.value.nextAggregate.offer).toEqual({
      endAt: OFFER_END_AT,
      localEnd: "2026-09-02T14:30:00",
      localStart: "2026-09-02T14:00:00",
      locationId: LOCATION_ID,
      offerVersion: OFFER_VERSION,
      startAt: OFFER_START_AT,
      timeZone: TIME_ZONE,
    });
    expect(result.value.events.map((event) => event.event_type)).toEqual([
      "appointment_request.staff_accepted",
    ]);
    expect(JSON.stringify(result.value)).not.toContain("appointment_request.confirmed");
    expect(result.value.nextAggregate).not.toHaveProperty("calendar");
    expect(result.value.nextAggregate).not.toHaveProperty("availability");
  });

  it("requires matching staff actor, same-tenant staff and the frozen request location", () => {
    const requested = createRequested();
    const base = {
      ...commandContext(requested, STAFF_ACTOR, STAFF_ACCEPTED_AT),
      location: LOCATION,
      offeredSlot: {
        endAt: OFFER_END_AT,
        localEnd: "2026-09-02T14:30:00",
        localStart: "2026-09-02T14:00:00",
        startAt: OFFER_START_AT,
        timeZone: TIME_ZONE,
      },
      staff: STAFF,
    };
    expectFailureWithoutEffects(
      requested,
      staffAcceptAppointmentRequest(requested, { ...base, actor: OTHER_STAFF_ACTOR }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
    expectFailureWithoutEffects(
      requested,
      staffAcceptAppointmentRequest(requested, {
        ...base,
        staff: { ...STAFF, organizationId: ORGANIZATION_B },
      }),
      { code: "tenant_scope_violation" },
    );
  });
});

describe("offer preparation and offer-version independence", () => {
  it("prepares the durable confirmation offer through its own versioned edge", () => {
    const staffAccepted = accept(createRequested());
    const result = prepareCustomerConfirmation(staffAccepted, {
      actor: SYSTEM_ACTOR,
      expectedVersion: staffAccepted.version,
      expiresAt: EXPIRES_AT,
      issuedAt: ISSUED_AT,
      offerVersion: OFFER_VERSION,
      organizationId: ORGANIZATION_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextAggregate).toMatchObject({
      confirmationOffer: {
        expiresAt: EXPIRES_AT,
        issuedAt: ISSUED_AT,
        offerVersion: OFFER_VERSION,
      },
      status: "awaiting_customer_confirmation",
      version: staffAccepted.version + 1,
    });
    expect(result.value.events[0]).toEqual({
      aggregate_version: staffAccepted.version + 1,
      event_type: "appointment_request.customer_confirmation_requested",
      payload: {
        appointment_status: "awaiting_customer_confirmation",
        confirmation_expires_at: EXPIRES_AT,
        offer_version: OFFER_VERSION,
      },
      schema_id: "AppointmentRequestCustomerConfirmationRequestedDomainEvent.v1",
      schema_version: "1",
    });
  });

  it("rejects non-system preparation, wrong offer version and invalid interval", () => {
    const request = accept(createRequested());
    const command = {
      actor: SYSTEM_ACTOR,
      expectedVersion: request.version,
      expiresAt: EXPIRES_AT,
      issuedAt: ISSUED_AT,
      offerVersion: OFFER_VERSION,
      organizationId: ORGANIZATION_A,
    };
    expectFailureWithoutEffects(
      request,
      prepareCustomerConfirmation(request, { ...command, actor: STAFF_ACTOR }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
    expectFailureWithoutEffects(
      request,
      prepareCustomerConfirmation(request, { ...command, offerVersion: NEXT_OFFER_VERSION }),
      { code: "invariant_violation", reason: "invalid_reference" },
    );
    expectFailureWithoutEffects(
      request,
      prepareCustomerConfirmation(request, { ...command, expiresAt: ISSUED_AT }),
      { code: "invariant_violation", reason: "invalid_appointment_request" },
    );
  });

  it("keeps offer version type and state independent from aggregate version", () => {
    const awaiting = prepare(accept(createRequested()));
    expect(awaiting.version).toBe(3);
    expect(awaiting.offer?.offerVersion).toBe(1);
    expect(awaiting.confirmationOffer?.offerVersion).toBe(1);
    expectTypeOf<AppointmentOfferVersion>().not.toEqualTypeOf<AggregateVersion>();
  });
});

describe("customer confirmation evidence and safety", () => {
  const sourceCases = [
    {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(),
      source: "customer_session",
    },
    {
      actor: CUSTOMER_ACTOR,
      evidence: {
        appointmentRequest: REQUEST_REFERENCE,
        contact: CONTACT,
        customerActedAt: CUSTOMER_ACTED_AT,
        evidence: EVIDENCE,
        offerVersion: OFFER_VERSION,
        source: "telegram",
        sourceMessage: CONFIRMATION_MESSAGE,
      } satisfies AppointmentConfirmationEvidenceInput,
      source: "telegram",
    },
    {
      actor: STAFF_ACTOR,
      evidence: {
        appointmentRequest: REQUEST_REFERENCE,
        attestationMethod: "phone",
        attestationReasonCode: ATTESTATION_REASON,
        contact: CONTACT,
        customerAct: "explicit_confirmation",
        customerActedAt: CUSTOMER_ACTED_AT,
        evidence: EVIDENCE,
        offerVersion: OFFER_VERSION,
        protectedEvidence: PROTECTED_EVIDENCE,
        source: "staff_attested_external",
        staff: STAFF,
      } satisfies AppointmentConfirmationEvidenceInput,
      source: "staff_attested_external",
    },
  ] as const;

  it.each(sourceCases)(
    "confirms with explicit typed $source evidence",
    ({ actor, evidence, source }) => {
      const awaiting = prepare(accept(createRequested()));
      const result = confirmAppointmentRequest(awaiting, {
        actor,
        evidence,
        expectedVersion: awaiting.version,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nextAggregate.status).toBe("confirmed");
      expect(result.value.nextAggregate.confirmationEvidence).toMatchObject({
        appointmentRequestId: APPOINTMENT_REQUEST_ID,
        contactId: CONTACT_ID,
        customerActedAt: CUSTOMER_ACTED_AT,
        evidenceId: EVIDENCE_ID,
        offerVersion: OFFER_VERSION,
        organizationId: ORGANIZATION_A,
        recordedAt: CONFIRMED_AT,
        source,
      });
      expect(result.value.events).toEqual([
        {
          aggregate_version: awaiting.version + 1,
          event_type: "appointment_request.confirmed",
          payload: {
            appointment_status: "confirmed",
            confirmation_source: source,
            customer_confirmed_at: CUSTOMER_ACTED_AT,
            offer_version: OFFER_VERSION,
          },
          schema_id: "AppointmentRequestConfirmedDomainEvent.v1",
          schema_version: "1",
        },
      ]);
      expectCanonicalDraft(awaiting, result.value.events[0]!);
    },
  );

  it.each([
    [
      "wrong request",
      {
        appointmentRequest: {
          ...REQUEST_REFERENCE,
          appointmentRequestId: OTHER_APPOINTMENT_REQUEST_ID,
        },
      },
    ],
    ["wrong contact", { contact: { ...CONTACT, contactId: OTHER_CONTACT_ID } }],
    ["stale offer", { offerVersion: NEXT_OFFER_VERSION }],
    ["customer act before issue", { customerActedAt: BEFORE_ISSUED_AT }],
  ] as const)("rejects %s evidence without a confirmation event", (_name, changes) => {
    const awaiting = prepare(accept(createRequested()));
    const result = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(changes),
      expectedVersion: awaiting.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
    });
    expectFailureWithoutEffects(awaiting, result, { code: "confirmation_evidence_invalid" });
    expect(JSON.stringify(result)).not.toContain("appointment_request.confirmed");
  });

  it.each([
    ["command", { organizationId: ORGANIZATION_B }],
    [
      "request evidence",
      {
        evidence: directEvidence({
          appointmentRequest: { ...REQUEST_REFERENCE, organizationId: ORGANIZATION_B },
        }),
      },
    ],
    [
      "contact evidence",
      { evidence: directEvidence({ contact: { ...CONTACT, organizationId: ORGANIZATION_B } }) },
    ],
    [
      "evidence record",
      { evidence: directEvidence({ evidence: { ...EVIDENCE, organizationId: ORGANIZATION_B } }) },
    ],
  ] as const)("rejects foreign tenant %s without leaking IDs", (_name, changes) => {
    const awaiting = prepare(accept(createRequested()));
    const result = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(),
      expectedVersion: awaiting.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
      ...changes,
    });
    expectFailureWithoutEffects(awaiting, result, { code: "tenant_scope_violation" });
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
  });

  it.each([
    ["missing evidence", undefined],
    ["unknown source", { ...directEvidence(), source: "model" }],
    ["extra model authority", { ...directEvidence(), agentDecision: { confidence: 1 } }],
    ["wrong customer actor", directEvidence()],
  ] as const)("rejects malformed or non-authoritative case: %s", (name, evidence) => {
    const awaiting = prepare(accept(createRequested()));
    const result: unknown = Reflect.apply(confirmAppointmentRequest, undefined, [
      awaiting,
      {
        actor: name === "wrong customer actor" ? OTHER_CUSTOMER_ACTOR : CUSTOMER_ACTOR,
        evidence,
        expectedVersion: awaiting.version,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      },
    ]);
    expectFailureWithoutEffects(awaiting, result, { code: "confirmation_evidence_invalid" });
  });

  it.each([
    ["missing separate customer act", { customerAct: undefined }],
    ["false separate customer act", { customerAct: "staff_action" }],
    ["unsupported method", { attestationMethod: "email" }],
    ["missing reason", { attestationReasonCode: undefined }],
    ["wrong staff actor", { actor: OTHER_STAFF_ACTOR }],
  ] as const)("rejects invalid staff attestation: %s", (_name, changes) => {
    const awaiting = prepare(accept(createRequested()));
    const evidence = {
      appointmentRequest: REQUEST_REFERENCE,
      attestationMethod: "phone",
      attestationReasonCode: ATTESTATION_REASON,
      contact: CONTACT,
      customerAct: "explicit_confirmation",
      customerActedAt: CUSTOMER_ACTED_AT,
      evidence: EVIDENCE,
      offerVersion: OFFER_VERSION,
      protectedEvidence: null,
      source: "staff_attested_external",
      staff: STAFF,
      ...changes,
    };
    const result: unknown = Reflect.apply(confirmAppointmentRequest, undefined, [
      awaiting,
      {
        actor: "actor" in changes ? changes.actor : STAFF_ACTOR,
        evidence,
        expectedVersion: awaiting.version,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      },
    ]);
    expectFailureWithoutEffects(awaiting, result, { code: "confirmation_evidence_invalid" });
  });

  it("rejects replayed evidence after confirmation through terminal state", () => {
    const awaiting = prepare(accept(createRequested()));
    const first = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(),
      expectedVersion: awaiting.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const confirmed = first.value.nextAggregate;
    expectFailureWithoutEffects(
      confirmed,
      confirmAppointmentRequest(confirmed, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence(),
        expectedVersion: confirmed.version,
        now: COMMAND_AT,
        organizationId: ORGANIZATION_A,
      }),
      {
        code: "invalid_state_transition",
        command: "confirm_appointment_request",
        currentState: "confirmed",
      },
    );
  });
});

describe("confirmation aggregate and offer version matrix", () => {
  it("allows current aggregate plus current offer version", () => {
    const awaiting = prepare(accept(createRequested()));
    const result = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(),
      expectedVersion: awaiting.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects stale aggregate plus current offer version as concurrency conflict", () => {
    const awaiting = prepare(accept(createRequested()));
    expectFailureWithoutEffects(
      awaiting,
      confirmAppointmentRequest(awaiting, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence(),
        expectedVersion: awaiting.version - 1,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      }),
      { code: "concurrency_conflict", currentVersion: awaiting.version },
    );
  });

  it("rejects current aggregate plus noncurrent offer version", () => {
    const awaiting = prepare(accept(createRequested()));
    expectFailureWithoutEffects(
      awaiting,
      confirmAppointmentRequest(awaiting, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence({ offerVersion: NEXT_OFFER_VERSION }),
        expectedVersion: awaiting.version,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      }),
      { code: "confirmation_evidence_invalid" },
    );
  });

  it("rejects stale aggregate plus stale offer at concurrency boundary first", () => {
    const awaiting = prepare(accept(createRequested()));
    expectFailureWithoutEffects(
      awaiting,
      confirmAppointmentRequest(awaiting, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence({ offerVersion: NEXT_OFFER_VERSION }),
        expectedVersion: awaiting.version - 1,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      }),
      { code: "concurrency_conflict", currentVersion: awaiting.version },
    );
  });

  it("rejects an old offer against a structurally current replacement offer", () => {
    const awaiting = prepare(accept(createRequested()));
    const replacement: AppointmentRequest = Object.freeze({
      ...awaiting,
      confirmationOffer: Object.freeze({
        ...awaiting.confirmationOffer!,
        offerVersion: NEXT_OFFER_VERSION,
      }),
      offer: Object.freeze({ ...awaiting.offer!, offerVersion: NEXT_OFFER_VERSION }),
    });
    expect(validateAppointmentRequest(replacement).ok).toBe(true);
    expectFailureWithoutEffects(
      replacement,
      confirmAppointmentRequest(replacement, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence({ offerVersion: OFFER_VERSION }),
        expectedVersion: replacement.version,
        now: CONFIRMED_AT,
        organizationId: ORGANIZATION_A,
      }),
      { code: "confirmation_evidence_invalid" },
    );
  });
});

describe("half-open expiry and deterministic clock", () => {
  it("allows confirmation one instant before expiry", () => {
    const awaiting = prepare(accept(createRequested()));
    const result = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: directEvidence(),
      expectedVersion: awaiting.version,
      now: JUST_BEFORE_EXPIRY,
      organizationId: ORGANIZATION_A,
    });
    expect(result.ok).toBe(true);
  });

  it.each([EXPIRES_AT, AFTER_EXPIRY])("rejects confirmation at/after expiry %s", (now) => {
    const awaiting = prepare(accept(createRequested()));
    expectFailureWithoutEffects(
      awaiting,
      confirmAppointmentRequest(awaiting, {
        actor: CUSTOMER_ACTOR,
        evidence: directEvidence(),
        expectedVersion: awaiting.version,
        now,
        organizationId: ORGANIZATION_A,
      }),
      { code: "offer_expired" },
    );
  });

  it("rejects offer expiry immediately before due and allows equality", () => {
    const awaiting = prepare(accept(createRequested()));
    expectFailureWithoutEffects(
      awaiting,
      expireAppointmentRequest(awaiting, {
        actor: SYSTEM_ACTOR,
        expectedVersion: awaiting.version,
        now: JUST_BEFORE_EXPIRY,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRY_REASON,
      }),
      { code: "invariant_violation", reason: "appointment_request_not_due" },
    );
    expect(
      expireAppointmentRequest(awaiting, {
        actor: SYSTEM_ACTOR,
        expectedVersion: awaiting.version,
        now: EXPIRES_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRY_REASON,
      }).ok,
    ).toBe(true);
  });

  it.each(["requested", "staff_accepted"] as const)(
    "accepts explicit application-policy expiry for %s",
    (status) => {
      const request = stateFixtures()[status];
      const result = expireAppointmentRequest(request, {
        actor: SYSTEM_ACTOR,
        expectedVersion: request.version,
        now: COMMAND_AT,
        organizationId: ORGANIZATION_A,
        reasonCode: EXPIRY_REASON,
      });
      expect(result.ok).toBe(true);
    },
  );
});

describe("rejection, cancellation, terminal states and replay-like commands", () => {
  it("rejects only requested and emits the bounded canonical reason", () => {
    const requested = createRequested();
    const result = rejectAppointmentRequest(requested, {
      ...commandContext(requested, STAFF_ACTOR, STAFF_ACCEPTED_AT),
      reasonCode: REJECTION_REASON,
      staff: STAFF,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events[0]?.payload).toEqual({
        appointment_status: "rejected",
        reason_code: REJECTION_REASON,
      });
    }
  });

  it.each(["requested", "staff_accepted", "awaiting_customer_confirmation", "confirmed"] as const)(
    "cancels %s with exact previous status and preserves prior facts",
    (status) => {
      const request = stateFixtures()[status];
      const result = cancelAppointmentRequest(request, {
        ...commandContext(request, CUSTOMER_ACTOR),
        initiator: CUSTOMER_INITIATOR,
        reasonCode: CANCELLATION_REASON,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.events[0]?.payload).toEqual({
        appointment_status: "cancelled",
        previous_appointment_status: status,
        reason_code: CANCELLATION_REASON,
      });
      if (status === "confirmed") {
        expect(result.value.nextAggregate.confirmationEvidence).toEqual(
          request.confirmationEvidence,
        );
        expect(result.value.nextAggregate.confirmedAt).toBe(request.confirmedAt);
      }
    },
  );

  it.each(["rejected", "cancelled", "expired"] as const)(
    "keeps %s terminal against every existing command",
    (status) => {
      const request = stateFixtures()[status];
      for (const command of COMMAND_CASES) {
        expectFailureWithoutEffects(request, command.run(request), {
          code: "invalid_state_transition",
          command: command.name,
          currentState: status,
        });
      }
    },
  );

  it("permits only explicit cancellation from confirmed", () => {
    const confirmed = stateFixtures().confirmed;
    for (const command of COMMAND_CASES.filter(
      (candidate) => candidate.name !== "cancel_appointment_request",
    )) {
      expectFailureWithoutEffects(confirmed, command.run(confirmed), {
        code: "invalid_state_transition",
        command: command.name,
        currentState: "confirmed",
      });
    }
    expect(
      COMMAND_CASES.find((command) => command.name === "cancel_appointment_request")!.run(confirmed)
        .ok,
    ).toBe(true);
  });
});

describe("versioning, failure atomicity and immutable values", () => {
  it.each(LEGAL_CASES)(
    "$status → $command.name rejects stale version and increments once",
    ({ command, status }) => {
      const request = stateFixtures()[status];
      const stale = request.version === 1 ? request.version + 1 : request.version - 1;
      expectFailureWithoutEffects(request, command.run(request, stale), {
        code: "concurrency_conflict",
        currentVersion: request.version,
      });
      const result = command.run(request, request.version);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.nextAggregate.version).toBe(request.version + 1);
        expect(result.value.events[0]?.aggregate_version).toBe(request.version + 1);
      }
    },
  );

  it("fails version overflow without state, event or transition effects", () => {
    const requested: AppointmentRequest = Object.freeze({
      ...createRequested(),
      version: Number.MAX_SAFE_INTEGER,
    });
    expectFailureWithoutEffects(requested, COMMAND_CASES[0].run(requested, requested.version), {
      code: "invariant_violation",
      reason: "version_overflow",
    });
  });

  it("deep-copies and freezes preferences, offers, evidence, events and transition records", () => {
    const preference = PREFERENCES.at(0);
    if (preference === undefined) throw new TypeError("Missing preference fixture");
    const mutablePreference: {
      endAt: UtcTimestamp;
      localEnd: string;
      localStart: string;
      precision: "exact";
      preferenceId: ResourceId;
      preferenceOrder: number;
      startAt: UtcTimestamp;
      timeZone: IanaTimeZone;
    } = { ...preference };
    const createResult = createAppointmentRequest(
      createCommand({ preferences: [mutablePreference] }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    mutablePreference.localStart = "changed";
    expect(createResult.value.nextAggregate.preferences[0]?.localStart).toBe("2026-09-03T14:00:00");

    const awaiting = prepare(accept(createResult.value.nextAggregate));
    const mutableEvidence = {
      appointmentRequest: { ...REQUEST_REFERENCE },
      contact: { ...CONTACT },
      customerActedAt: CUSTOMER_ACTED_AT,
      evidence: { ...EVIDENCE },
      offerVersion: OFFER_VERSION,
      source: "customer_session" as const,
    };
    const result = confirmAppointmentRequest(awaiting, {
      actor: CUSTOMER_ACTOR,
      evidence: mutableEvidence,
      expectedVersion: awaiting.version,
      now: CONFIRMED_AT,
      organizationId: ORGANIZATION_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    mutableEvidence.customerActedAt = COMMAND_AT;
    expect(result.value.nextAggregate.confirmationEvidence?.customerActedAt).toBe(
      CUSTOMER_ACTED_AT,
    );
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate.preferences)).toBe(true);
    expect(Object.isFrozen(result.value.nextAggregate.confirmationEvidence)).toBe(true);
    expect(Object.isFrozen(result.value.events)).toBe(true);
    expect(Object.isFrozen(result.value.events[0]?.payload)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords)).toBe(true);
    expect(Object.isFrozen(result.value.transitionRecords[0])).toBe(true);
  });
});

describe("tenant isolation, aggregate validation and cross-aggregate boundary", () => {
  it.each([
    ["contact", { contact: { ...CONTACT, organizationId: ORGANIZATION_B } }],
    ["lead", { lead: { ...LEAD, organizationId: ORGANIZATION_B } }],
    ["conversation", { conversation: { ...CONVERSATION, organizationId: ORGANIZATION_B } }],
    ["location", { location: { ...LOCATION, organizationId: ORGANIZATION_B } }],
    ["service", { service: { ...SERVICE, organizationId: ORGANIZATION_B } }],
    ["policy", { businessPolicy: { ...BUSINESS_POLICY, organizationId: ORGANIZATION_B } }],
    ["source message", { sourceMessage: { ...SOURCE_MESSAGE, organizationId: ORGANIZATION_B } }],
  ] as const)("rejects foreign-tenant creation %s reference", (_name, changes) => {
    const result = createAppointmentRequest(createCommand(changes));
    expect(result).toEqual({ error: { code: "tenant_scope_violation" }, ok: false });
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_A);
    expect(JSON.stringify(result)).not.toContain(ORGANIZATION_B);
  });

  it.each([
    { confirmationOffer: null, status: "awaiting_customer_confirmation" },
    { confirmationEvidence: null, status: "confirmed" },
    { offer: null, status: "staff_accepted" },
    { cancellation: null, status: "cancelled" },
    { expiration: null, status: "expired" },
  ] as const)("rejects impossible lifecycle shape %#", (changes) => {
    const candidate: AppointmentRequest = { ...stateFixtures()[changes.status], ...changes };
    expect(validateAppointmentRequest(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_appointment_request" },
      ok: false,
    });
  });

  it.each([
    [
      "staff decision before creation",
      "rejected",
      {
        staffDecision: { ...stateFixtures().rejected.staffDecision!, decidedAt: BEFORE_CREATED_AT },
      },
    ],
    [
      "cancellation before creation",
      "cancelled",
      {
        cancellation: {
          ...stateFixtures().cancelled.cancellation!,
          cancelledAt: BEFORE_CREATED_AT,
        },
      },
    ],
    [
      "expiry before creation",
      "expired",
      { expiration: { ...stateFixtures().expired.expiration!, expiredAt: BEFORE_CREATED_AT } },
    ],
    [
      "offer expiry before the offer boundary",
      "expired",
      {
        ...stateFixtures().expired,
        ...stateFixtures().awaiting_customer_confirmation,
        expiration: { expiredAt: JUST_BEFORE_EXPIRY, reasonCode: EXPIRY_REASON },
        status: "expired",
      },
    ],
  ] as const)("rejects invalid chronology: %s", (_name, status, changes) => {
    const candidate: AppointmentRequest = { ...stateFixtures()[status], ...changes };
    expect(validateAppointmentRequest(candidate)).toEqual({
      error: { code: "invariant_violation", reason: "invalid_appointment_request" },
      ok: false,
    });
  });

  it("emits only AppointmentRequest events and never mutates Lead, Conversation, or Handoff", () => {
    const related = Object.freeze({
      conversation: Object.freeze({ conversationId: CONVERSATION_ID, status: "open" }),
      handoff: Object.freeze({ status: "requested" }),
      lead: Object.freeze({ leadId: LEAD_ID, status: "booking_requested" }),
    });
    const before = JSON.stringify(related);
    for (const { command, status } of LEGAL_CASES) {
      const result = command.run(stateFixtures()[status]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.value.events.every((event) => event.event_type.startsWith("appointment_request.")),
        ).toBe(true);
      }
    }
    expect(JSON.stringify(related)).toBe(before);
  });

  it("contains no AI authority, calendar claim, availability guess, auth or permission state", () => {
    const aggregateKeys = Object.keys(stateFixtures().confirmed);
    const forbidden = [
      "agentDecision",
      "confidence",
      "reasoning",
      "prompt",
      "toolCalls",
      "calendar",
      "isAvailable",
      "slotAvailable",
      "authToken",
      "permissions",
      "tenantOverride",
    ];
    forbidden.forEach((key) => expect(aggregateKeys).not.toContain(key));
  });
});
