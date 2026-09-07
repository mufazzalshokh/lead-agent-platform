import {
  ActorRefSchema,
  AggregateVersionSchema,
  AppointmentRequestIdSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  DomainEventSchemasByVersion,
  EventIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  RequestIdSchema,
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
  type CorrelationId,
  type EventId,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type OrganizationId,
  type RequestId,
  type ResourceId,
  type ServiceId,
  type UtcTimestamp,
} from "../../packages/contracts/src/index.js";
import { createTenantDatabaseRuntimeConfig } from "../../packages/config/src/index.js";
import {
  InvalidRepositoryMutationPlanError,
  RepositoryNotFoundError,
  RepositoryOwnershipValidationError,
  RepositoryStructuralConflictError,
  RepositoryVersionConflictError,
  createTenantDatabaseRuntime,
  persistDomainMutationPlan,
  withTenantTransaction,
  type CoreDomainEvent,
  type CoreDomainEventDraft,
  type DomainEventAppend,
  type DomainMutationPlan,
  type TenantDatabaseRuntime,
  type TenantMutationAudit,
  type TenantMutationAuditTarget,
} from "../../packages/database/src/index.js";
import {
  confirmAppointmentRequestWorkflow,
  createAppointmentRequestWorkflow,
  createConversation,
  createLead,
  endAppointmentRequestWorkflow,
  prepareCustomerConfirmation,
  recordAppointmentRequest,
  replaceHandoffWithSuccessorWorkflow,
  requestHandoffWorkflow,
  staffAcceptAppointmentRequest,
  takeHandoffStaffOwnershipWorkflow,
  validateHandoffQueueKey,
  validateHandoffReasonCode,
  validateIanaTimeZone,
  validateAppointmentRequestReasonCode,
  validateLeadReasonCode,
  type AppointmentRequest,
  type AppointmentRequestTransitionRecord,
  type Conversation,
  type ConversationTransitionRecord,
  type Handoff,
  type HandoffTransitionRecord,
  type Lead,
  type LeadTransitionRecord,
  type Transition,
} from "../../packages/domain/src/index.js";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

type MutationFixtureStrings = Readonly<{
  appointmentA: string;
  businessPolicyA: string;
  channelA: string;
  channelB: string;
  contactA: string;
  contactB: string;
  conversationA: string;
  conversationB: string;
  leadA: string;
  leadB: string;
  locationA: string;
  locationVersionA: string;
  membershipA: string;
  membershipB: string;
  messageA: string;
  organizationA: string;
  organizationB: string;
  serviceA: string;
  serviceVersionA: string;
}>;

type TenantMutationTestHarness = Readonly<{
  fixtures: MutationFixtureStrings;
  privilegedPool: () => Pool;
  runtime: () => TenantDatabaseRuntime;
  runtimeConnectionString: () => string;
  seed: () => Promise<void>;
}>;

const requireValue = <Value>(
  schema: Parameters<typeof isSchemaValue>[0],
  value: unknown,
): Value => {
  if (!isSchemaValue(schema, value)) {
    throw new Error("Invalid synthetic S5.5 fixture value");
  }
  return value as Value;
};

const syntheticUuid = (value: number): string => {
  const suffix = value.toString(16).padStart(12, "0");
  return `0194a555-0000-7000-8000-${suffix}`;
};

let identitySequence = 0x100;
const nextResourceId = (): ResourceId =>
  requireValue(ResourceIdSchema, syntheticUuid(identitySequence++));
const nextEventId = (): EventId => requireValue(EventIdSchema, syntheticUuid(identitySequence++));
const nextCorrelationId = (): CorrelationId =>
  requireValue(CorrelationIdSchema, syntheticUuid(identitySequence++));

const aggregateVersion = (value: number): AggregateVersion =>
  requireValue(AggregateVersionSchema, value);

const requestId = requireValue<RequestId>(RequestIdSchema, "s55-request-0001");
const occurredAt = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-06T10:00:00.000Z");
const laterAt = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-06T10:05:00.000Z");
const staffAcceptedAt = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-06T10:10:00.000Z");
const confirmationIssuedAt = requireValue<UtcTimestamp>(
  UtcTimestampSchema,
  "2026-09-06T10:15:00.000Z",
);
const confirmationExpiresAt = requireValue<UtcTimestamp>(
  UtcTimestampSchema,
  "2026-09-06T11:15:00.000Z",
);
const confirmedAt = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-06T10:20:00.000Z");
const handoffDueAt = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-06T11:00:00.000Z");
const slotStart = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-07T09:00:00.000Z");
const slotEnd = requireValue<UtcTimestamp>(UtcTimestampSchema, "2026-09-07T10:00:00.000Z");

type MutationFixtures = Readonly<{
  appointmentA: AppointmentRequestId;
  businessPolicyA: ResourceId;
  channelA: ChannelConnectionId;
  channelB: ChannelConnectionId;
  contactA: ContactId;
  contactB: ContactId;
  conversationA: ConversationId;
  conversationB: ConversationId;
  leadA: LeadId;
  leadB: LeadId;
  locationA: LocationId;
  locationVersionA: ResourceId;
  membershipA: MembershipId;
  membershipB: MembershipId;
  messageA: MessageId;
  organizationA: OrganizationId;
  organizationB: OrganizationId;
  serviceA: ServiceId;
  serviceVersionA: ResourceId;
}>;

const mapFixtures = (fixtures: MutationFixtureStrings): MutationFixtures => ({
  appointmentA: requireValue(AppointmentRequestIdSchema, fixtures.appointmentA),
  businessPolicyA: requireValue(ResourceIdSchema, fixtures.businessPolicyA),
  channelA: requireValue(ChannelConnectionIdSchema, fixtures.channelA),
  channelB: requireValue(ChannelConnectionIdSchema, fixtures.channelB),
  contactA: requireValue(ContactIdSchema, fixtures.contactA),
  contactB: requireValue(ContactIdSchema, fixtures.contactB),
  conversationA: requireValue(ConversationIdSchema, fixtures.conversationA),
  conversationB: requireValue(ConversationIdSchema, fixtures.conversationB),
  leadA: requireValue(LeadIdSchema, fixtures.leadA),
  leadB: requireValue(LeadIdSchema, fixtures.leadB),
  locationA: requireValue(LocationIdSchema, fixtures.locationA),
  locationVersionA: requireValue(ResourceIdSchema, fixtures.locationVersionA),
  membershipA: requireValue(MembershipIdSchema, fixtures.membershipA),
  membershipB: requireValue(MembershipIdSchema, fixtures.membershipB),
  messageA: requireValue(MessageIdSchema, fixtures.messageA),
  organizationA: requireValue(OrganizationIdSchema, fixtures.organizationA),
  organizationB: requireValue(OrganizationIdSchema, fixtures.organizationB),
  serviceA: requireValue(ServiceIdSchema, fixtures.serviceA),
  serviceVersionA: requireValue(ResourceIdSchema, fixtures.serviceVersionA),
});

const systemActor = Object.freeze({ actor_id: null, actor_type: "system" } as const);

const memberActor = (membershipId: MembershipId): ActorRef =>
  requireValue(ActorRefSchema, { actor_id: membershipId, actor_type: "member" });

const customerActor = (contactId: ContactId): ActorRef =>
  requireValue(ActorRefSchema, { actor_id: contactId, actor_type: "customer" });

const qualifiedLead = (fixtures: MutationFixtures, leadId = fixtures.leadA): Lead =>
  Object.freeze({
    appointmentRequestId: null,
    contactId: fixtures.contactA,
    leadId,
    organizationId: fixtures.organizationA,
    qualification: Object.freeze({
      evaluationId: nextResourceId(),
      policyId: fixtures.businessPolicyA,
      reasonCodes: [] as const,
      result: "qualified" as const,
    }),
    status: "qualified" as const,
    version: 1,
  });

const eventSchemaFor = (
  eventType: string,
  schemaVersion: string,
): Parameters<typeof isSchemaValue>[0] | undefined => {
  const versionMap: unknown = Reflect.get(DomainEventSchemasByVersion, eventType);
  if (typeof versionMap !== "object" || versionMap === null) {
    return undefined;
  }
  const schema: unknown = Reflect.get(versionMap, schemaVersion);
  return typeof schema === "object" && schema !== null ? schema : undefined;
};

const eventAppend = (
  draft: CoreDomainEventDraft,
  aggregateType: CoreDomainEvent["aggregate_type"],
  aggregateId: string,
  actor: ActorRef,
  correlationId: CorrelationId,
  eventId = nextEventId(),
): DomainEventAppend => {
  const candidate = Object.freeze({
    actor,
    aggregate_id: aggregateId,
    aggregate_type: aggregateType,
    aggregate_version: draft.aggregate_version,
    causation_id: null,
    correlation_id: correlationId,
    event_id: eventId,
    event_type: draft.event_type,
    occurred_at: laterAt,
    organization_id:
      aggregateType === "lead" ||
      aggregateType === "conversation" ||
      aggregateType === "appointment_request" ||
      aggregateType === "handoff"
        ? undefined
        : undefined,
    payload: draft.payload,
    request_id: requestId,
    schema_id: draft.schema_id,
    schema_version: draft.schema_version,
  });
  if (eventSchemaFor(candidate.event_type, candidate.schema_version) === undefined) {
    throw new Error("Missing canonical event schema");
  }
  return Object.freeze({ draft, envelope: candidate as unknown as CoreDomainEvent });
};

const bindEventOrganization = (
  append: DomainEventAppend,
  organizationId: OrganizationId,
): DomainEventAppend => {
  const envelope = Object.freeze({ ...append.envelope, organization_id: organizationId });
  const schema = eventSchemaFor(envelope.event_type, envelope.schema_version);
  if (schema === undefined || !isSchemaValue(schema, envelope)) {
    throw new Error("Synthetic event does not satisfy the canonical contract");
  }
  return Object.freeze({ draft: append.draft, envelope });
};

const auditFor = (
  target: TenantMutationAuditTarget,
  actor: ActorRef,
  correlationId: CorrelationId,
  actorMembershipId: MembershipId | null = null,
  metadataRedacted: Readonly<Record<string, unknown>> = {},
): TenantMutationAudit => ({
  actor: actor as Exclude<ActorRef, { actor_type: "platform_operator" }>,
  actorMembershipId,
  auditId: nextResourceId(),
  correlationId,
  metadataRedacted,
  occurredAt: laterAt,
  requestId,
  target,
});

const requireTransition = <Aggregate, Event, Record>(
  result:
    | Readonly<{ ok: false; error: unknown }>
    | Readonly<{ ok: true; value: Transition<Aggregate, Event, Record> }>,
): Transition<Aggregate, Event, Record> => {
  if (!result.ok) {
    throw new Error(`Synthetic Stage 3 transition failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

const requireValidated = <Value>(
  result: Readonly<{ ok: false; error: unknown }> | Readonly<{ ok: true; value: Value }>,
): Value => {
  if (!result.ok) {
    throw new Error(`Synthetic Stage 3 value failed validation: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

const requireItem = <Value>(values: readonly Value[], index: number): Value =>
  values[index] ??
  (() => {
    throw new Error("Synthetic Stage 3 plan has an unexpected shape");
  })();

const eventAppends = (
  drafts: readonly CoreDomainEventDraft[],
  aggregateType: CoreDomainEvent["aggregate_type"],
  aggregateId: string,
  actor: ActorRef,
  correlationId: CorrelationId,
  organizationId: OrganizationId,
): readonly [DomainEventAppend, ...DomainEventAppend[]] => {
  const first = requireItem(drafts, 0);
  return Object.freeze([
    bindEventOrganization(
      eventAppend(first, aggregateType, aggregateId, actor, correlationId),
      organizationId,
    ),
    ...drafts
      .slice(1)
      .map((draft) =>
        bindEventOrganization(
          eventAppend(draft, aggregateType, aggregateId, actor, correlationId),
          organizationId,
        ),
      ),
  ]);
};

const leadCreateConflictPlan = (fixtures: MutationFixtures): DomainMutationPlan => {
  const leadId = requireValue<LeadId>(LeadIdSchema, syntheticUuid(identitySequence++));
  const transition = requireTransition(
    createLead({
      actor: systemActor,
      contact: { contactId: fixtures.contactA, organizationId: fixtures.organizationA },
      leadId,
      occurredAt,
      organizationId: fixtures.organizationA,
    }),
  );
  const correlationId = nextCorrelationId();
  return {
    aggregates: [
      {
        aggregateType: "lead",
        mode: "create",
        nextAggregate: transition.nextAggregate,
        storage: {
          assignedMembershipId: null,
          campaignKey: null,
          locationId: fixtures.locationA,
          serviceId: fixtures.serviceA,
          sourceChannelConnectionId: fixtures.channelA,
        },
      },
    ],
    audits: [auditFor({ targetId: leadId, targetType: "lead" }, systemActor, correlationId)],
    events: eventAppends(
      transition.events,
      "lead",
      leadId,
      systemActor,
      correlationId,
      fixtures.organizationA,
    ),
    transitions: [{ record: requireItem(transition.transitionRecords, 0), transitionType: "lead" }],
  };
};

const conversationCreateConflictPlan = (fixtures: MutationFixtures): DomainMutationPlan => {
  const conversationId = requireValue<ConversationId>(
    ConversationIdSchema,
    syntheticUuid(identitySequence++),
  );
  const transition = requireTransition(
    createConversation({
      actor: systemActor,
      channelConnection: {
        channelConnectionId: fixtures.channelA,
        organizationId: fixtures.organizationA,
      },
      contact: { contactId: fixtures.contactA, organizationId: fixtures.organizationA },
      conversationId,
      initialMessage: { messageId: fixtures.messageA, organizationId: fixtures.organizationA },
      lead: { leadId: fixtures.leadA, organizationId: fixtures.organizationA },
      occurredAt,
      organizationId: fixtures.organizationA,
    }),
  );
  const correlationId = nextCorrelationId();
  return {
    aggregates: [
      {
        aggregateType: "conversation",
        mode: "create",
        nextAggregate: transition.nextAggregate,
        storage: {
          externalThreadHash: Buffer.from(`synthetic-thread-hash-${fixtures.conversationA}`),
          preferredLocale: "en",
        },
      },
    ],
    audits: [
      auditFor(
        { targetId: conversationId, targetType: "conversation" },
        systemActor,
        correlationId,
      ),
    ],
    events: eventAppends(
      transition.events,
      "conversation",
      conversationId,
      systemActor,
      correlationId,
      fixtures.organizationA,
    ),
    transitions: [
      {
        record: requireItem(transition.transitionRecords, 0),
        transitionType: "conversation",
      },
    ],
  };
};

const openConversation = (fixtures: MutationFixtures): Conversation =>
  Object.freeze({
    activeHandoff: null,
    automationMode: "ai",
    channelConnectionId: fixtures.channelA,
    contactId: fixtures.contactA,
    conversationId: fixtures.conversationA,
    leadId: fixtures.leadA,
    organizationId: fixtures.organizationA,
    status: "open",
    version: aggregateVersion(1),
  });

const appointmentWorkflowPlan = (
  fixtures: MutationFixtures,
  sourceMessageId: MessageId = fixtures.messageA,
) => {
  const lead = qualifiedLead(fixtures);
  const appointmentRequestId = requireValue<AppointmentRequestId>(
    AppointmentRequestIdSchema,
    syntheticUuid(identitySequence++),
  );
  const actor = customerActor(fixtures.contactA);
  const workflow = requireValidated(
    createAppointmentRequestWorkflow(lead, {
      appointmentRequest: {
        actor,
        appointmentRequestId,
        businessPolicy: {
          businessPolicyId: fixtures.businessPolicyA,
          organizationId: fixtures.organizationA,
        },
        contact: { contactId: fixtures.contactA, organizationId: fixtures.organizationA },
        conversation: {
          conversationId: fixtures.conversationA,
          organizationId: fixtures.organizationA,
        },
        initiator: {
          contact: { contactId: fixtures.contactA, organizationId: fixtures.organizationA },
          kind: "customer",
        },
        lead: { leadId: fixtures.leadA, organizationId: fixtures.organizationA },
        location: {
          locationId: fixtures.locationA,
          locationVersionId: fixtures.locationVersionA,
          organizationId: fixtures.organizationA,
        },
        occurredAt,
        organizationId: fixtures.organizationA,
        preferences: [
          {
            endAt: slotEnd,
            localEnd: "2026-09-07T15:00:00",
            localStart: "2026-09-07T14:00:00",
            precision: "exact",
            preferenceId: nextResourceId(),
            preferenceOrder: 1,
            startAt: slotStart,
            timeZone: requireValidated(validateIanaTimeZone("Asia/Tashkent")),
          },
        ],
        service: {
          organizationId: fixtures.organizationA,
          serviceId: fixtures.serviceA,
          serviceVersionId: fixtures.serviceVersionA,
        },
        sourceMessage: { messageId: sourceMessageId, organizationId: fixtures.organizationA },
      },
      lead: {
        actor,
        expectedVersion: aggregateVersion(1),
        occurredAt,
        organizationId: fixtures.organizationA,
      },
    }),
  );
  const appointmentTransition = workflow.transitionRecords.find(
    (record): record is AppointmentRequestTransitionRecord =>
      record.command === "create_appointment_request",
  );
  const leadTransition = workflow.transitionRecords.find(
    (record): record is LeadTransitionRecord => record.command === "record_appointment_request",
  );
  if (appointmentTransition === undefined || leadTransition === undefined) {
    throw new Error("Unexpected Appointment workflow transition plan");
  }
  const correlationId = nextCorrelationId();
  const plan: DomainMutationPlan = {
    aggregates: [
      {
        aggregateType: "appointment_request",
        mode: "create",
        nextAggregate: workflow.appointmentRequest,
        storage: {
          customerNotesCiphertext: null,
          requestDedupeKey: `s55-${appointmentRequestId}`,
        },
      },
      {
        aggregateType: "lead",
        expectedVersion: aggregateVersion(1),
        mode: "update",
        nextAggregate: workflow.lead,
      },
    ],
    audits: [
      auditFor(
        { targetId: appointmentRequestId, targetType: "appointment_request" },
        actor,
        correlationId,
      ),
    ],
    events: [
      ...eventAppends(
        [requireItem(workflow.events, 0)],
        "appointment_request",
        appointmentRequestId,
        actor,
        correlationId,
        fixtures.organizationA,
      ),
      ...eventAppends(
        [requireItem(workflow.events, 1)],
        "lead",
        fixtures.leadA,
        actor,
        correlationId,
        fixtures.organizationA,
      ),
    ],
    transitions: [
      {
        correlationId,
        record: appointmentTransition,
        sourceMessageId,
        transitionId: nextResourceId(),
        transitionType: "appointment_request",
      },
      { record: leadTransition, transitionType: "lead" },
    ],
  };
  return Object.freeze({
    appointmentRequest: workflow.appointmentRequest,
    lead: workflow.lead,
    plan,
  });
};

const handoffRequestPlan = (fixtures: MutationFixtures) => {
  const conversation = openConversation(fixtures);
  const handoffId = requireValue<HandoffId>(HandoffIdSchema, syntheticUuid(identitySequence++));
  const workflow = requireValidated(
    requestHandoffWorkflow(conversation, {
      conversation: {
        actor: systemActor,
        expectedVersion: conversation.version,
        occurredAt: laterAt,
        organizationId: fixtures.organizationA,
      },
      handoff: {
        actor: systemActor,
        conversation: {
          conversationId: fixtures.conversationA,
          organizationId: fixtures.organizationA,
        },
        handoffId,
        lead: { leadId: fixtures.leadA, organizationId: fixtures.organizationA },
        location: { locationId: fixtures.locationA, organizationId: fixtures.organizationA },
        occurredAt: laterAt,
        organizationId: fixtures.organizationA,
        queueKey: requireValidated(validateHandoffQueueKey("clinic_front_desk")),
        slaDueAt: handoffDueAt,
        triggerReason: "customer_requested",
      },
    }),
  );
  const handoffTransition = workflow.transitionRecords.find(
    (record): record is HandoffTransitionRecord => record.command === "request_handoff",
  );
  const conversationTransition = workflow.transitionRecords.find(
    (record): record is ConversationTransitionRecord => record.command === "route_to_human",
  );
  if (handoffTransition === undefined || conversationTransition === undefined) {
    throw new Error("Unexpected Handoff request workflow transition plan");
  }
  const correlationId = nextCorrelationId();
  const plan: DomainMutationPlan = {
    aggregates: [
      { aggregateType: "handoff", mode: "create", nextAggregate: workflow.handoff },
      {
        aggregateType: "conversation",
        expectedVersion: conversation.version,
        mode: "update",
        nextAggregate: workflow.conversation,
      },
    ],
    audits: [auditFor({ targetId: handoffId, targetType: "handoff" }, systemActor, correlationId)],
    events: [
      ...eventAppends(
        [requireItem(workflow.events, 0)],
        "handoff",
        handoffId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
      ...eventAppends(
        [requireItem(workflow.events, 1)],
        "conversation",
        fixtures.conversationA,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
    ],
    transitions: [
      {
        conversationDisposition: null,
        correlationId,
        record: handoffTransition,
        transitionId: nextResourceId(),
        transitionType: "handoff",
      },
      { record: conversationTransition, transitionType: "conversation" },
    ],
  };
  return Object.freeze({ conversation: workflow.conversation, handoff: workflow.handoff, plan });
};

const appointmentUpdatePlan = (
  fixtures: MutationFixtures,
  request: AppointmentRequest,
  transition: AppointmentRequestTransitionRecord,
  draft: CoreDomainEventDraft,
  actor: ActorRef,
  expectedVersion: AggregateVersion,
  storage?: Readonly<{
    confirmationTokenConsumedAt?: UtcTimestamp | null;
    confirmationTokenHash?: Uint8Array | null;
  }>,
): DomainMutationPlan => {
  const correlationId = nextCorrelationId();
  return {
    aggregates: [
      {
        aggregateType: "appointment_request",
        expectedVersion,
        mode: "update",
        nextAggregate: request,
        ...(storage === undefined ? {} : { storage }),
      },
    ],
    audits: [
      auditFor(
        { targetId: request.appointmentRequestId, targetType: "appointment_request" },
        actor,
        correlationId,
        actor.actor_type === "member" ? fixtures.membershipA : null,
      ),
    ],
    events: eventAppends(
      [draft],
      "appointment_request",
      request.appointmentRequestId,
      actor,
      correlationId,
      fixtures.organizationA,
    ),
    transitions: [
      {
        correlationId,
        record: transition,
        sourceMessageId: request.sourceMessageId,
        transitionId: nextResourceId(),
        transitionType: "appointment_request",
      },
    ],
  };
};

const handoffOwnershipPlan = (
  fixtures: MutationFixtures,
  handoff: Handoff,
  conversation: Conversation,
) => {
  const workflow = requireValidated(
    takeHandoffStaffOwnershipWorkflow(handoff, conversation, {
      conversation: {
        actor: systemActor,
        expectedVersion: conversation.version,
        occurredAt: staffAcceptedAt,
        organizationId: fixtures.organizationA,
      },
      handoff: {
        action: "claim_and_start",
        command: {
          actor: systemActor,
          assignee: {
            membershipId: fixtures.membershipA,
            organizationId: fixtures.organizationA,
          },
          expectedVersion: handoff.version,
          occurredAt: staffAcceptedAt,
          organizationId: fixtures.organizationA,
        },
      },
    }),
  );
  const handoffTransitions = workflow.transitionRecords.filter(
    (record): record is HandoffTransitionRecord => record.command === "claim_and_start_handoff",
  );
  const conversationTransition = workflow.transitionRecords.find(
    (record): record is ConversationTransitionRecord => record.command === "record_staff_ownership",
  );
  if (handoffTransitions.length !== 2 || conversationTransition === undefined) {
    throw new Error("Unexpected Handoff ownership workflow transition plan");
  }
  const assignedTransition = requireItem(handoffTransitions, 0);
  const startedTransition = requireItem(handoffTransitions, 1);
  const correlationId = nextCorrelationId();
  const plan: DomainMutationPlan = {
    aggregates: [
      {
        aggregateType: "handoff",
        expectedVersion: handoff.version,
        mode: "update",
        nextAggregate: workflow.handoff,
      },
      {
        aggregateType: "conversation",
        expectedVersion: conversation.version,
        mode: "update",
        nextAggregate: workflow.conversation,
      },
    ],
    audits: [
      auditFor({ targetId: handoff.handoffId, targetType: "handoff" }, systemActor, correlationId),
    ],
    events: [
      ...eventAppends(
        [requireItem(workflow.events, 0), requireItem(workflow.events, 1)],
        "handoff",
        handoff.handoffId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
      ...eventAppends(
        [requireItem(workflow.events, 2)],
        "conversation",
        conversation.conversationId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
    ],
    transitions: [
      {
        conversationDisposition: null,
        correlationId,
        record: assignedTransition,
        transitionId: nextResourceId(),
        transitionType: "handoff",
      },
      {
        conversationDisposition: null,
        correlationId,
        record: startedTransition,
        transitionId: nextResourceId(),
        transitionType: "handoff",
      },
      { record: conversationTransition, transitionType: "conversation" },
    ],
  };
  return Object.freeze({ conversation: workflow.conversation, handoff: workflow.handoff, plan });
};

const successorHandoffPlan = (
  fixtures: MutationFixtures,
  handoff: Handoff,
  conversation: Conversation,
) => {
  const successorId = requireValue<HandoffId>(HandoffIdSchema, syntheticUuid(identitySequence++));
  const workflow = requireValidated(
    replaceHandoffWithSuccessorWorkflow(handoff, conversation, {
      conversation: {
        actor: systemActor,
        expectedVersion: conversation.version,
        occurredAt: staffAcceptedAt,
        organizationId: fixtures.organizationA,
      },
      disposition: "successor_handoff",
      handoff: {
        action: "cancelled",
        command: {
          actor: systemActor,
          expectedVersion: handoff.version,
          occurredAt: staffAcceptedAt,
          organizationId: fixtures.organizationA,
          reasonCode: requireValidated(validateHandoffReasonCode("customer_withdrew")),
        },
      },
      successorHandoff: {
        actor: systemActor,
        conversation: {
          conversationId: fixtures.conversationA,
          organizationId: fixtures.organizationA,
        },
        handoffId: successorId,
        lead: { leadId: fixtures.leadA, organizationId: fixtures.organizationA },
        location: { locationId: fixtures.locationA, organizationId: fixtures.organizationA },
        occurredAt: staffAcceptedAt,
        organizationId: fixtures.organizationA,
        queueKey: requireValidated(validateHandoffQueueKey("clinic_front_desk")),
        slaDueAt: handoffDueAt,
        triggerReason: "customer_requested",
      },
    }),
  );
  const terminalTransition = workflow.transitionRecords.find(
    (record): record is HandoffTransitionRecord =>
      record.command === "cancel_handoff" && record.handoffId === handoff.handoffId,
  );
  const successorTransition = workflow.transitionRecords.find(
    (record): record is HandoffTransitionRecord =>
      record.command === "request_handoff" && record.handoffId === successorId,
  );
  const conversationTransition = workflow.transitionRecords.find(
    (record): record is ConversationTransitionRecord =>
      record.command === "record_successor_handoff",
  );
  if (
    terminalTransition === undefined ||
    successorTransition === undefined ||
    conversationTransition === undefined
  ) {
    throw new Error("Unexpected successor Handoff workflow transition plan");
  }
  const correlationId = nextCorrelationId();
  const plan: DomainMutationPlan = {
    aggregates: [
      {
        aggregateType: "handoff",
        expectedVersion: handoff.version,
        mode: "update",
        nextAggregate: workflow.handoff,
      },
      { aggregateType: "handoff", mode: "create", nextAggregate: workflow.successorHandoff },
      {
        aggregateType: "conversation",
        expectedVersion: conversation.version,
        mode: "update",
        nextAggregate: workflow.conversation,
      },
    ],
    audits: [
      auditFor({ targetId: handoff.handoffId, targetType: "handoff" }, systemActor, correlationId),
    ],
    events: [
      ...eventAppends(
        [requireItem(workflow.events, 0)],
        "handoff",
        handoff.handoffId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
      ...eventAppends(
        [requireItem(workflow.events, 1)],
        "handoff",
        successorId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
      ...eventAppends(
        [requireItem(workflow.events, 2)],
        "conversation",
        conversation.conversationId,
        systemActor,
        correlationId,
        fixtures.organizationA,
      ),
    ],
    transitions: [
      {
        conversationDisposition: "successor_handoff",
        correlationId,
        record: terminalTransition,
        transitionId: nextResourceId(),
        transitionType: "handoff",
      },
      {
        conversationDisposition: null,
        correlationId,
        record: successorTransition,
        transitionId: nextResourceId(),
        transitionType: "handoff",
      },
      { record: conversationTransition, transitionType: "conversation" },
    ],
  };
  return Object.freeze({
    conversation: workflow.conversation,
    handoff: workflow.handoff,
    plan,
    successorHandoff: workflow.successorHandoff,
  });
};

const leadAppointmentPlan = (
  fixtures: MutationFixtures,
  correlationId = nextCorrelationId(),
  actor: ActorRef = systemActor,
): DomainMutationPlan => {
  const lead = qualifiedLead(fixtures);
  const result = requireTransition(
    recordAppointmentRequest(lead, {
      actor,
      appointmentRequest: {
        appointmentRequestId: fixtures.appointmentA,
        organizationId: fixtures.organizationA,
      },
      expectedVersion: 1,
      occurredAt: laterAt,
      organizationId: fixtures.organizationA,
    }),
  );
  const transition = requireItem(result.transitionRecords, 0);
  const draft = requireItem(result.events, 0);
  return {
    aggregates: [
      {
        aggregateType: "lead",
        expectedVersion: 1,
        mode: "update",
        nextAggregate: result.nextAggregate,
      },
    ],
    audits: [
      auditFor(
        { targetId: fixtures.leadA, targetType: "lead" },
        actor,
        correlationId,
        actor.actor_type === "member" ? requireValue(MembershipIdSchema, actor.actor_id) : null,
      ),
    ],
    events: [
      bindEventOrganization(
        eventAppend(draft, "lead", fixtures.leadA, actor, correlationId),
        fixtures.organizationA,
      ),
    ],
    transitions: [{ record: transition, transitionType: "lead" }],
  };
};

const countRows = async (pool: Pool, table: string): Promise<number> => {
  const result = await pool.query<{ count: number }>(
    `select count(*)::integer as count from ${table}`,
  );
  return result.rows[0]?.count ?? -1;
};

export const registerTenantMutationTests = (harness: TenantMutationTestHarness): void => {
  const fixtures = mapFixtures(harness.fixtures);

  describe("S5.5 atomic tenant mutations", () => {
    it("persists a Stage 3 Lead CAS, required audit, and canonical envelope atomically", async () => {
      await harness.seed();
      const plan = leadAppointmentPlan(fixtures);
      const result = await withTenantTransaction(
        harness.runtime(),
        fixtures.organizationA,
        (session) => persistDomainMutationPlan(session, plan),
      );

      expect(result).toMatchObject({ aggregateCount: 1, auditCount: 1, transitionCount: 1 });
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(lead.rows[0]).toEqual({ status: "booking_requested", version: "2" });
      const outbox = await harness
        .privilegedPool()
        .query<{ payload: unknown }>(
          "select payload_jsonb as payload from outbox_events where id=$1",
          [plan.events[0].envelope.event_id],
        );
      expect(outbox.rows[0]?.payload).toEqual(plan.events[0].envelope);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(1);
    });

    it("allows exactly one of two same-version writers and leaves no losing side effects", async () => {
      await harness.seed();
      const firstPlan = leadAppointmentPlan(fixtures, nextCorrelationId());
      const secondPlan = leadAppointmentPlan(fixtures, nextCorrelationId());
      const runtimes = [0, 1].map(() =>
        createTenantDatabaseRuntime(
          createTenantDatabaseRuntimeConfig({
            connectionString: harness.runtimeConnectionString(),
            maxConnections: 1,
            statementTimeoutMilliseconds: 30_000,
          }),
          { onUnexpectedPoolError: () => undefined },
        ),
      );
      try {
        const firstRuntime = requireItem(runtimes, 0);
        const secondRuntime = requireItem(runtimes, 1);
        const outcomes = await Promise.allSettled([
          withTenantTransaction(firstRuntime, fixtures.organizationA, (session) =>
            persistDomainMutationPlan(session, firstPlan),
          ),
          withTenantTransaction(secondRuntime, fixtures.organizationA, (session) =>
            persistDomainMutationPlan(session, secondPlan),
          ),
        ]);
        expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find(({ status }) => status === "rejected");
        expect(rejected?.status === "rejected" ? rejected.reason : undefined).toBeInstanceOf(
          RepositoryVersionConflictError,
        );
        expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(1);
        expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(1);
      } finally {
        await Promise.all(runtimes.map((runtime) => runtime.close()));
      }
    });

    it("maps a foreign-tenant CAS target to tenant-local not-found without residue", async () => {
      await harness.seed();
      const foreignLead: Lead = {
        ...qualifiedLead(fixtures, fixtures.leadB),
        contactId: fixtures.contactB,
        organizationId: fixtures.organizationA,
      };
      const result = requireTransition(
        recordAppointmentRequest(foreignLead, {
          actor: systemActor,
          appointmentRequest: {
            appointmentRequestId: fixtures.appointmentA,
            organizationId: fixtures.organizationA,
          },
          expectedVersion: 1,
          occurredAt: laterAt,
          organizationId: fixtures.organizationA,
        }),
      );
      const correlationId = nextCorrelationId();
      const plan: DomainMutationPlan = {
        aggregates: [
          {
            aggregateType: "lead",
            expectedVersion: 1,
            mode: "update",
            nextAggregate: result.nextAggregate,
          },
        ],
        audits: [
          auditFor({ targetId: fixtures.leadB, targetType: "lead" }, systemActor, correlationId),
        ],
        events: [
          bindEventOrganization(
            eventAppend(
              requireItem(result.events, 0),
              "lead",
              fixtures.leadB,
              systemActor,
              correlationId,
            ),
            fixtures.organizationA,
          ),
        ],
        transitions: [{ record: requireItem(result.transitionRecords, 0), transitionType: "lead" }],
      };
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, plan),
        ),
      ).rejects.toBeInstanceOf(RepositoryNotFoundError);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it.each([
      ["member", memberActor(fixtures.membershipB)],
      ["customer", customerActor(fixtures.contactB)],
    ] as const)("rejects a foreign tenant %s actor before any business write", async (_, actor) => {
      await harness.seed();
      const plan = leadAppointmentPlan(fixtures, nextCorrelationId(), actor);
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, plan),
        ),
      ).rejects.toBeInstanceOf(RepositoryOwnershipValidationError);
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(lead.rows[0]).toEqual({ status: "qualified", version: "1" });
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("rolls back aggregate state when required audit insertion fails", async () => {
      await harness.seed();
      const plan = leadAppointmentPlan(fixtures);
      const oversizedAudit = {
        ...plan.audits[0],
        metadataRedacted: { bounded_failure: "x".repeat(17_000) },
      };
      const invalidAuditPlan: DomainMutationPlan = { ...plan, audits: [oversizedAudit] };
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, async (session) => {
          try {
            await persistDomainMutationPlan(session, invalidAuditPlan);
          } catch {
            // Even if an application catches the repository error, the tenant
            // transaction remains rollback-only.
          }
        }),
      ).rejects.toBeInstanceOf(RepositoryStructuralConflictError);
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(lead.rows[0]).toEqual({ status: "qualified", version: "1" });
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("fails closed when a canonical event is attached to a different aggregate", async () => {
      await harness.seed();
      const plan = leadAppointmentPlan(fixtures);
      const mismatched = {
        ...plan.events[0],
        envelope: { ...plan.events[0].envelope, aggregate_id: fixtures.leadB },
      } as DomainEventAppend;
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, { ...plan, events: [mismatched] }),
        ),
      ).rejects.toBeInstanceOf(InvalidRepositoryMutationPlanError);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("maps active Lead uniqueness to a structural conflict and rolls back companions", async () => {
      await harness.seed();
      const plan = leadCreateConflictPlan(fixtures);
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, plan),
        ),
      ).rejects.toMatchObject({ reason: "active_record_conflict", resource: "lead" });
      expect(await countRows(harness.privilegedPool(), "leads")).toBe(2);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("maps active Conversation uniqueness to a structural conflict and rolls back companions", async () => {
      await harness.seed();
      const plan = conversationCreateConflictPlan(fixtures);
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, plan),
        ),
      ).rejects.toMatchObject({ reason: "active_record_conflict", resource: "conversation" });
      expect(await countRows(harness.privilegedPool(), "conversations")).toBe(2);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("persists AppointmentRequest creation plus Lead CAS as one Stage 3 workflow", async () => {
      await harness.seed();
      const { plan } = appointmentWorkflowPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, plan),
      );
      const rows = await harness
        .privilegedPool()
        .query<{ event_type: string }>(
          "select event_type from outbox_events where correlation_id=$1 order by ctid",
          [plan.events[0].envelope.correlation_id],
        );
      expect(rows.rows.map(({ event_type }) => event_type)).toEqual([
        "appointment_request.created",
        "lead.booking_requested",
      ]);
      expect(await countRows(harness.privilegedPool(), "appointment_request_preferences")).toBe(1);
      expect(await countRows(harness.privilegedPool(), "appointment_request_transitions")).toBe(1);
    });

    it("persists request rejection plus Lead retry restore with lead.reopened V2", async () => {
      await harness.seed();
      const created = appointmentWorkflowPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, created.plan),
      );
      const staffActor = memberActor(fixtures.membershipA);
      const ended = requireValidated(
        endAppointmentRequestWorkflow(created.appointmentRequest, created.lead, {
          appointmentRequest: {
            action: "rejected",
            command: {
              actor: staffActor,
              expectedVersion: created.appointmentRequest.version,
              occurredAt: laterAt,
              organizationId: fixtures.organizationA,
              reasonCode: requireValidated(
                validateAppointmentRequestReasonCode("service_unavailable"),
              ),
              staff: {
                membershipId: fixtures.membershipA,
                organizationId: fixtures.organizationA,
              },
            },
          },
          lead: {
            actor: systemActor,
            expectedVersion: created.lead.version,
            occurredAt: laterAt,
            organizationId: fixtures.organizationA,
          },
          retryPolicy: {
            approved: true,
            organizationId: fixtures.organizationA,
            policyId: fixtures.businessPolicyA,
            reasonCode: requireValidated(validateLeadReasonCode("request_ended_retry_allowed")),
          },
        }),
      );
      const appointmentTransition = ended.transitionRecords.find(
        (record): record is AppointmentRequestTransitionRecord =>
          record.command === "reject_appointment_request",
      );
      const leadTransition = ended.transitionRecords.find(
        (record): record is LeadTransitionRecord =>
          record.command === "restore_after_appointment_request",
      );
      if (appointmentTransition === undefined || leadTransition === undefined) {
        throw new Error("Unexpected ended Appointment workflow persistence plan");
      }
      const correlationId = nextCorrelationId();
      const plan: DomainMutationPlan = {
        aggregates: [
          {
            aggregateType: "appointment_request",
            expectedVersion: created.appointmentRequest.version,
            mode: "update",
            nextAggregate: ended.appointmentRequest,
          },
          {
            aggregateType: "lead",
            expectedVersion: created.lead.version,
            mode: "update",
            nextAggregate: ended.lead,
          },
        ],
        audits: [
          auditFor(
            {
              targetId: ended.appointmentRequest.appointmentRequestId,
              targetType: "appointment_request",
            },
            staffActor,
            correlationId,
            fixtures.membershipA,
          ),
        ],
        events: [
          ...eventAppends(
            [requireItem(ended.events, 0)],
            "appointment_request",
            ended.appointmentRequest.appointmentRequestId,
            staffActor,
            correlationId,
            fixtures.organizationA,
          ),
          ...eventAppends(
            [requireItem(ended.events, 1)],
            "lead",
            ended.lead.leadId,
            systemActor,
            correlationId,
            fixtures.organizationA,
          ),
        ],
        transitions: [
          {
            correlationId,
            record: appointmentTransition,
            sourceMessageId: ended.appointmentRequest.sourceMessageId,
            transitionId: nextResourceId(),
            transitionType: "appointment_request",
          },
          { record: leadTransition, transitionType: "lead" },
        ],
      };
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, plan),
      );
      const events = await harness.privilegedPool().query<{
        event_type: string;
        payload: Readonly<Record<string, unknown>>;
      }>(
        `select event_type, payload_jsonb as payload
           from outbox_events where correlation_id=$1 order by ctid`,
        [correlationId],
      );
      expect(events.rows.map(({ event_type }) => event_type)).toEqual([
        "appointment_request.rejected",
        "lead.reopened",
      ]);
      expect(events.rows[1]?.payload).toMatchObject({
        schema_id: "LeadReopenedDomainEvent.v2",
        schema_version: "2",
      });
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(lead.rows[0]).toEqual({ status: "qualified", version: "3" });
    });

    it("rolls back both aggregates when an Appointment history append fails late", async () => {
      await harness.seed();
      const created = appointmentWorkflowPlan(fixtures);
      const appointmentTransition = created.plan.transitions.find(
        (transition) => transition.transitionType === "appointment_request",
      );
      const leadTransition = created.plan.transitions.find(
        (transition) => transition.transitionType === "lead",
      );
      if (appointmentTransition === undefined || leadTransition === undefined) {
        throw new Error("Unexpected Appointment persistence plan");
      }
      const invalidSourceMessageId = requireValue<MessageId>(
        MessageIdSchema,
        syntheticUuid(identitySequence++),
      );
      const invalidPlan: DomainMutationPlan = {
        ...created.plan,
        transitions: [
          { ...appointmentTransition, sourceMessageId: invalidSourceMessageId },
          leadTransition,
        ],
      };
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, invalidPlan),
        ),
      ).rejects.toBeInstanceOf(RepositoryStructuralConflictError);
      const request = await harness
        .privilegedPool()
        .query("select id from appointment_requests where id=$1", [
          created.appointmentRequest.appointmentRequestId,
        ]);
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(request.rowCount).toBe(0);
      expect(lead.rows[0]).toEqual({ status: "qualified", version: "1" });
      expect(await countRows(harness.privilegedPool(), "appointment_request_preferences")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "appointment_request_transitions")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(0);
    });

    it("rolls back aggregate and audit when the final Outbox append conflicts", async () => {
      await harness.seed();
      const plan = leadAppointmentPlan(fixtures);
      const envelope = plan.events[0].envelope;
      await harness.privilegedPool().query(
        `insert into outbox_events
          (id, organization_id, event_type, schema_version, aggregate_type,
           aggregate_id, aggregate_version, payload_jsonb, correlation_id,
           causation_id, occurred_at, status, attempt_count, available_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'pending',0,$11)`,
        [
          envelope.event_id,
          envelope.organization_id,
          envelope.event_type,
          envelope.schema_version,
          envelope.aggregate_type,
          envelope.aggregate_id,
          envelope.aggregate_version,
          JSON.stringify(envelope),
          envelope.correlation_id,
          envelope.causation_id,
          envelope.occurred_at,
        ],
      );
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, plan),
        ),
      ).rejects.toBeInstanceOf(RepositoryStructuralConflictError);
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      expect(lead.rows[0]).toEqual({ status: "qualified", version: "1" });
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(0);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(1);
    });

    it("persists Handoff request plus Conversation ownership in one transaction", async () => {
      await harness.seed();
      const requested = handoffRequestPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, requested.plan),
      );
      const handoff = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from handoffs where id=$1",
          [requested.handoff.handoffId],
        );
      const conversation = await harness.privilegedPool().query<{
        active_handoff_id: string;
        automation_mode: string;
        status: string;
        version: string;
      }>(
        `select active_handoff_id::text, automation_mode, status, version
           from conversations where id=$1`,
        [fixtures.conversationA],
      );
      expect(handoff.rows[0]).toEqual({ status: "requested", version: "1" });
      expect(conversation.rows[0]).toEqual({
        active_handoff_id: requested.handoff.handoffId,
        automation_mode: "paused",
        status: "awaiting_staff",
        version: "2",
      });
      expect(await countRows(harness.privilegedPool(), "handoff_transitions")).toBe(1);
    });

    it("persists both claim/start edges and the Conversation companion exactly", async () => {
      await harness.seed();
      const requested = handoffRequestPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, requested.plan),
      );
      const ownership = handoffOwnershipPlan(fixtures, requested.handoff, requested.conversation);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, ownership.plan),
      );
      const eventTypes = await harness
        .privilegedPool()
        .query<{ event_type: string }>(
          "select event_type from outbox_events where correlation_id=$1 order by ctid",
          [ownership.plan.events[0].envelope.correlation_id],
        );
      expect(eventTypes.rows.map(({ event_type }) => event_type)).toEqual([
        "handoff.assigned",
        "handoff.started",
        "conversation.automation_mode_changed",
      ]);
      const handoff = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from handoffs where id=$1",
          [ownership.handoff.handoffId],
        );
      expect(handoff.rows[0]).toEqual({ status: "in_progress", version: "3" });
      expect(await countRows(harness.privilegedPool(), "handoff_transitions")).toBe(3);
    });

    it("rolls back both claim/start edges when the second history append conflicts", async () => {
      await harness.seed();
      const requested = handoffRequestPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, requested.plan),
      );
      const ownership = handoffOwnershipPlan(fixtures, requested.handoff, requested.conversation);
      const firstHandoffTransition = ownership.plan.transitions.find(
        (transition) => transition.transitionType === "handoff",
      );
      const conversationTransition = ownership.plan.transitions.find(
        (transition) => transition.transitionType === "conversation",
      );
      const handoffTransitions = ownership.plan.transitions.filter(
        (transition) => transition.transitionType === "handoff",
      );
      const secondHandoffTransition = handoffTransitions[1];
      if (
        firstHandoffTransition === undefined ||
        secondHandoffTransition === undefined ||
        conversationTransition === undefined
      ) {
        throw new Error("Unexpected claim/start persistence plan");
      }
      const invalidPlan: DomainMutationPlan = {
        ...ownership.plan,
        transitions: [
          firstHandoffTransition,
          {
            ...secondHandoffTransition,
            transitionId: firstHandoffTransition.transitionId,
          },
          conversationTransition,
        ],
      };
      await expect(
        withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
          persistDomainMutationPlan(session, invalidPlan),
        ),
      ).rejects.toBeInstanceOf(RepositoryStructuralConflictError);
      const handoff = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from handoffs where id=$1",
          [requested.handoff.handoffId],
        );
      const conversation = await harness.privilegedPool().query<{
        automation_mode: string;
        version: string;
      }>("select automation_mode, version from conversations where id=$1", [fixtures.conversationA]);
      expect(handoff.rows[0]).toEqual({ status: "requested", version: "1" });
      expect(conversation.rows[0]).toEqual({ automation_mode: "paused", version: "2" });
      expect(await countRows(harness.privilegedPool(), "handoff_transitions")).toBe(1);
      expect(await countRows(harness.privilegedPool(), "audit_events")).toBe(1);
      expect(await countRows(harness.privilegedPool(), "outbox_events")).toBe(2);
    });

    it("preserves paused-to-paused successor Handoff event order and provenance", async () => {
      await harness.seed();
      const requested = handoffRequestPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, requested.plan),
      );
      const successor = successorHandoffPlan(fixtures, requested.handoff, requested.conversation);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, successor.plan),
      );
      const eventTypes = await harness
        .privilegedPool()
        .query<{ event_type: string }>(
          "select event_type from outbox_events where correlation_id=$1 order by ctid",
          [successor.plan.events[0].envelope.correlation_id],
        );
      expect(eventTypes.rows.map(({ event_type }) => event_type)).toEqual([
        "handoff.cancelled",
        "handoff.requested",
        "conversation.active_handoff_changed",
      ]);
      const conversation = await harness.privilegedPool().query<{
        active_handoff_id: string;
        automation_mode: string;
        version: string;
      }>("select active_handoff_id::text, automation_mode, version from conversations where id=$1", [fixtures.conversationA]);
      expect(conversation.rows[0]).toEqual({
        active_handoff_id: successor.successorHandoff.handoffId,
        automation_mode: "paused",
        version: "3",
      });
    });

    it("confirms an AppointmentRequest with evidence and Lead conversion atomically", async () => {
      await harness.seed();
      const created = appointmentWorkflowPlan(fixtures);
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, created.plan),
      );

      const staffActor = memberActor(fixtures.membershipA);
      const accepted = requireTransition(
        staffAcceptAppointmentRequest(created.appointmentRequest, {
          actor: staffActor,
          expectedVersion: created.appointmentRequest.version,
          location: {
            locationId: fixtures.locationA,
            locationVersionId: fixtures.locationVersionA,
            organizationId: fixtures.organizationA,
          },
          occurredAt: staffAcceptedAt,
          offeredSlot: {
            endAt: slotEnd,
            localEnd: "2026-09-07T15:00:00",
            localStart: "2026-09-07T14:00:00",
            startAt: slotStart,
            timeZone: requireValidated(validateIanaTimeZone("Asia/Tashkent")),
          },
          organizationId: fixtures.organizationA,
          staff: {
            membershipId: fixtures.membershipA,
            organizationId: fixtures.organizationA,
          },
        }),
      );
      const acceptedPlan = appointmentUpdatePlan(
        fixtures,
        accepted.nextAggregate,
        requireItem(accepted.transitionRecords, 0),
        requireItem(accepted.events, 0),
        staffActor,
        created.appointmentRequest.version,
      );
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, acceptedPlan),
      );

      const offerVersion = accepted.nextAggregate.offer?.offerVersion;
      if (offerVersion === undefined) {
        throw new Error("Accepted AppointmentRequest has no offer version");
      }
      const awaiting = requireTransition(
        prepareCustomerConfirmation(accepted.nextAggregate, {
          actor: systemActor,
          expectedVersion: accepted.nextAggregate.version,
          expiresAt: confirmationExpiresAt,
          issuedAt: confirmationIssuedAt,
          offerVersion,
          organizationId: fixtures.organizationA,
        }),
      );
      const awaitingPlan = appointmentUpdatePlan(
        fixtures,
        awaiting.nextAggregate,
        requireItem(awaiting.transitionRecords, 0),
        requireItem(awaiting.events, 0),
        systemActor,
        accepted.nextAggregate.version,
        { confirmationTokenHash: Buffer.from("s55-confirmation-token-hash") },
      );
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, awaitingPlan),
      );

      const customer = customerActor(fixtures.contactA);
      const confirmed = requireValidated(
        confirmAppointmentRequestWorkflow(awaiting.nextAggregate, created.lead, {
          appointmentRequest: {
            actor: customer,
            evidence: {
              appointmentRequest: {
                appointmentRequestId: awaiting.nextAggregate.appointmentRequestId,
                organizationId: fixtures.organizationA,
              },
              contact: { contactId: fixtures.contactA, organizationId: fixtures.organizationA },
              customerActedAt: confirmedAt,
              evidence: {
                evidenceId: nextResourceId(),
                organizationId: fixtures.organizationA,
              },
              offerVersion,
              source: "customer_session",
            },
            expectedVersion: awaiting.nextAggregate.version,
            now: confirmedAt,
            organizationId: fixtures.organizationA,
          },
          lead: {
            actor: customer,
            expectedVersion: created.lead.version,
            occurredAt: confirmedAt,
            organizationId: fixtures.organizationA,
          },
        }),
      );
      const appointmentTransition = confirmed.transitionRecords.find(
        (record): record is AppointmentRequestTransitionRecord =>
          record.command === "confirm_appointment_request",
      );
      const leadTransition = confirmed.transitionRecords.find(
        (record): record is LeadTransitionRecord => record.command === "convert_lead",
      );
      const evidence = confirmed.appointmentRequest.confirmationEvidence;
      if (
        appointmentTransition === undefined ||
        leadTransition === undefined ||
        evidence === null
      ) {
        throw new Error("Unexpected confirmation workflow persistence plan");
      }
      const correlationId = nextCorrelationId();
      const confirmationPlan: DomainMutationPlan = {
        aggregates: [
          {
            aggregateType: "appointment_request",
            expectedVersion: awaiting.nextAggregate.version,
            mode: "update",
            nextAggregate: confirmed.appointmentRequest,
            storage: { confirmationTokenConsumedAt: confirmedAt },
          },
          {
            aggregateType: "lead",
            expectedVersion: created.lead.version,
            mode: "update",
            nextAggregate: confirmed.lead,
          },
        ],
        audits: [
          auditFor(
            {
              targetId: confirmed.appointmentRequest.appointmentRequestId,
              targetType: "appointment_request",
            },
            customer,
            correlationId,
          ),
        ],
        confirmationEvidence: [{ correlationId, evidence }],
        events: [
          ...eventAppends(
            [requireItem(confirmed.events, 0)],
            "appointment_request",
            confirmed.appointmentRequest.appointmentRequestId,
            customer,
            correlationId,
            fixtures.organizationA,
          ),
          ...eventAppends(
            [requireItem(confirmed.events, 1)],
            "lead",
            confirmed.lead.leadId,
            customer,
            correlationId,
            fixtures.organizationA,
          ),
        ],
        transitions: [
          {
            correlationId,
            record: appointmentTransition,
            sourceMessageId: confirmed.appointmentRequest.sourceMessageId,
            transitionId: nextResourceId(),
            transitionType: "appointment_request",
          },
          { record: leadTransition, transitionType: "lead" },
        ],
      };
      await withTenantTransaction(harness.runtime(), fixtures.organizationA, (session) =>
        persistDomainMutationPlan(session, confirmationPlan),
      );
      const request = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from appointment_requests where id=$1",
          [confirmed.appointmentRequest.appointmentRequestId],
        );
      const lead = await harness
        .privilegedPool()
        .query<{ status: string; version: string }>(
          "select status, version from leads where id=$1",
          [fixtures.leadA],
        );
      const eventTypes = await harness
        .privilegedPool()
        .query<{ event_type: string }>(
          "select event_type from outbox_events where correlation_id=$1 order by ctid",
          [correlationId],
        );
      expect(request.rows[0]).toEqual({ status: "confirmed", version: "4" });
      expect(lead.rows[0]).toEqual({ status: "converted", version: "3" });
      expect(eventTypes.rows.map(({ event_type }) => event_type)).toEqual([
        "appointment_request.confirmed",
        "lead.converted",
      ]);
      expect(await countRows(harness.privilegedPool(), "appointment_confirmation_evidence")).toBe(
        1,
      );
      expect(await countRows(harness.privilegedPool(), "appointment_request_transitions")).toBe(4);
    });
  });
};
