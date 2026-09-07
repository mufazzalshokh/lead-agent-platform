import type {
  ActorRef,
  AggregateVersion,
  CausationId,
  ChannelConnectionId,
  CorrelationId,
  DomainEvent,
  EventId,
  LeadReopenedDomainEventV2,
  MembershipId,
  MessageId,
  RequestId,
  ResourceId,
  ServiceId,
  LocationId,
  UtcTimestamp,
} from "@lead-agent/contracts";
import type {
  AppointmentConfirmationEvidence,
  AppointmentRequest,
  AppointmentRequestEventDraft,
  AppointmentRequestTransitionRecord,
  Conversation,
  ConversationEventDraft,
  ConversationHandoffDisposition,
  ConversationTransitionRecord,
  Handoff,
  HandoffEventDraft,
  HandoffTransitionRecord,
  Lead,
  LeadEventDraft,
  LeadTransitionRecord,
} from "@lead-agent/domain";

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]];

export type CoreDomainEvent = Extract<
  DomainEvent | LeadReopenedDomainEventV2,
  { aggregate_type: "appointment_request" | "conversation" | "handoff" | "lead" }
>;

export type CoreDomainEventDraft =
  AppointmentRequestEventDraft | ConversationEventDraft | HandoffEventDraft | LeadEventDraft;

export type DomainEventAppend = Readonly<{
  draft: CoreDomainEventDraft;
  envelope: CoreDomainEvent;
}>;

type CreateLeadMutation = Readonly<{
  aggregateType: "lead";
  mode: "create";
  nextAggregate: Lead;
  storage: Readonly<{
    assignedMembershipId: MembershipId | null;
    campaignKey: string | null;
    locationId: LocationId | null;
    serviceId: ServiceId | null;
    sourceChannelConnectionId: ChannelConnectionId;
  }>;
}>;

type UpdateLeadMutation = Readonly<{
  aggregateType: "lead";
  expectedVersion: AggregateVersion;
  mode: "update";
  nextAggregate: Lead;
}>;

type CreateConversationMutation = Readonly<{
  aggregateType: "conversation";
  mode: "create";
  nextAggregate: Conversation;
  storage: Readonly<{
    externalThreadHash: Uint8Array;
    preferredLocale: "en" | "ru" | "uz";
  }>;
}>;

type UpdateConversationMutation = Readonly<{
  aggregateType: "conversation";
  expectedVersion: AggregateVersion;
  mode: "update";
  nextAggregate: Conversation;
}>;

type CreateAppointmentRequestMutation = Readonly<{
  aggregateType: "appointment_request";
  mode: "create";
  nextAggregate: AppointmentRequest;
  storage: Readonly<{
    customerNotesCiphertext: Uint8Array | null;
    requestDedupeKey: string;
  }>;
}>;

type UpdateAppointmentRequestMutation = Readonly<{
  aggregateType: "appointment_request";
  expectedVersion: AggregateVersion;
  mode: "update";
  nextAggregate: AppointmentRequest;
  storage?: Readonly<{
    confirmationTokenConsumedAt?: UtcTimestamp | null;
    confirmationTokenHash?: Uint8Array | null;
  }>;
}>;

type CreateHandoffMutation = Readonly<{
  aggregateType: "handoff";
  mode: "create";
  nextAggregate: Handoff;
}>;

type UpdateHandoffMutation = Readonly<{
  aggregateType: "handoff";
  expectedVersion: AggregateVersion;
  mode: "update";
  nextAggregate: Handoff;
}>;

export type CoreAggregateMutation =
  | CreateAppointmentRequestMutation
  | CreateConversationMutation
  | CreateHandoffMutation
  | CreateLeadMutation
  | UpdateAppointmentRequestMutation
  | UpdateConversationMutation
  | UpdateHandoffMutation
  | UpdateLeadMutation;

export type LeadTransitionPersistence = Readonly<{
  record: LeadTransitionRecord;
  transitionType: "lead";
}>;

export type ConversationTransitionPersistence = Readonly<{
  record: ConversationTransitionRecord;
  transitionType: "conversation";
}>;

export type AppointmentTransitionPersistence = Readonly<{
  correlationId: CorrelationId;
  metadata?: Readonly<Record<string, unknown>>;
  record: AppointmentRequestTransitionRecord;
  sourceMessageId?: MessageId | null;
  transitionId: ResourceId;
  transitionType: "appointment_request";
}>;

export type HandoffTransitionPersistence = Readonly<{
  conversationDisposition: ConversationHandoffDisposition | null;
  correlationId: CorrelationId;
  record: HandoffTransitionRecord;
  transitionId: ResourceId;
  transitionType: "handoff";
}>;

export type CoreTransitionPersistence =
  | AppointmentTransitionPersistence
  | ConversationTransitionPersistence
  | HandoffTransitionPersistence
  | LeadTransitionPersistence;

export type AppointmentConfirmationEvidencePersistence = Readonly<{
  correlationId: CorrelationId;
  evidence: AppointmentConfirmationEvidence;
  evidenceCiphertext?: Uint8Array | null;
  externalReferenceHash?: Uint8Array | null;
}>;

export type TenantMutationAuditTarget = Readonly<
  | { targetId: AppointmentRequest["appointmentRequestId"]; targetType: "appointment_request" }
  | { targetId: Conversation["conversationId"]; targetType: "conversation" }
  | { targetId: Handoff["handoffId"]; targetType: "handoff" }
  | { targetId: Lead["leadId"]; targetType: "lead" }
>;

export type TenantMutationAudit = Readonly<{
  actor: Exclude<ActorRef, { actor_type: "platform_operator" }>;
  actorMembershipId: MembershipId | null;
  auditId: ResourceId;
  correlationId: CorrelationId;
  metadataRedacted?: Readonly<Record<string, unknown>>;
  occurredAt: UtcTimestamp;
  reasonCode?: string | null;
  requestId: RequestId;
  sourceIpPrefix?: string | null;
  target: TenantMutationAuditTarget;
  traceId?: string | null;
  userAgentHash?: Uint8Array | null;
}>;

export type DomainMutationPlan = Readonly<{
  aggregates: NonEmptyReadonlyArray<CoreAggregateMutation>;
  audits: NonEmptyReadonlyArray<TenantMutationAudit>;
  confirmationEvidence?: readonly AppointmentConfirmationEvidencePersistence[];
  events: NonEmptyReadonlyArray<DomainEventAppend>;
  transitions: NonEmptyReadonlyArray<CoreTransitionPersistence>;
}>;

export type PersistedDomainMutation = Readonly<{
  aggregateCount: number;
  auditCount: number;
  eventIds: readonly EventId[];
  transitionCount: number;
}>;

// Keep these contract identities reachable from generated declarations without
// introducing an infrastructure-owned event vocabulary.
export type DomainEventProvenance = Readonly<{
  causationId: CausationId | null;
  correlationId: CorrelationId;
  eventId: EventId;
  requestId: RequestId | null;
}>;
