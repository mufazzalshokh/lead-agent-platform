import {
  ActorRefSchema,
  AggregateVersionSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  DomainEventPayloadSchemas,
  DomainEventSchemas,
  HandoffIdSchema,
  LeadIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  ResourceIdSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type DomainEventFor,
  type HandoffId,
  type LeadId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type SchemaId,
  type SchemaVersion,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import {
  invalidStateTransition,
  invariantViolation,
  type ConcurrencyConflict,
  type InvalidStateTransition,
  type InvariantViolation,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import type { CanonicalDomainEvent, DomainEventDraft } from "../foundation/event-draft.js";
import { cloneAndFreeze } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  transitionFailure,
  transitionSuccess,
  type TransitionResult,
} from "../foundation/transition.js";
import { advanceAggregateVersion, initialAggregateVersion } from "../foundation/version.js";
import { requireSameOrganization } from "../values/tenant.js";
import {
  isActiveConversationHandoffStatus,
  validateConversation,
  type ActiveConversationHandoffStatus,
  type Conversation,
  type ConversationAutomationMode,
  type ConversationHandoffReference,
  type ConversationStatus,
} from "./conversation.js";

declare const conversationResolutionCodeBrand: unique symbol;
declare const conversationClosureCodeBrand: unique symbol;

export type ConversationResolutionCode = string & {
  readonly [conversationResolutionCodeBrand]: "ConversationResolutionCode";
};

export type ConversationClosureCode = string & {
  readonly [conversationClosureCodeBrand]: "ConversationClosureCode";
};

export type ConversationCommandName =
  | "create_conversation"
  | "accept_customer_message"
  | "queue_ai_response"
  | "route_to_human"
  | "record_staff_ownership"
  | "queue_staff_response"
  | "resume_ai"
  | "resolve_conversation"
  | "reopen_conversation"
  | "close_conversation"
  | "record_successor_handoff";

export type ExistingConversationCommandName = Exclude<
  ConversationCommandName,
  "create_conversation"
>;

export type ConversationStateKey =
  | "open_ai"
  | "awaiting_lead_ai"
  | "awaiting_lead_staff"
  | "awaiting_staff_paused"
  | "awaiting_staff_staff"
  | "resolved_paused"
  | "closed_paused";

type ConversationEvent =
  | DomainEventFor<"conversation.started">
  | DomainEventFor<"message.received">
  | DomainEventFor<"message.response_queued">
  | DomainEventFor<"conversation.status_changed">
  | DomainEventFor<"conversation.automation_mode_changed">
  | DomainEventFor<"conversation.resolved">
  | DomainEventFor<"conversation.closed">;

type DistributedDomainEventDraft<Event> = Event extends CanonicalDomainEvent
  ? DomainEventDraft<Event>
  : never;

export type ConversationEventDraft = DistributedDomainEventDraft<ConversationEvent>;

export type ConversationHandoffDisposition =
  "resume_ai" | "resolve_conversation" | "successor_handoff";

export type ConversationTransitionRecord = Readonly<{
  actor: ActorRef;
  activeHandoffId: HandoffId | null;
  command: ConversationCommandName;
  conversationId: ConversationId;
  fromAutomationMode: ConversationAutomationMode | null;
  fromHandoffId: HandoffId | null;
  fromStatus: ConversationStatus | null;
  handoffDisposition: ConversationHandoffDisposition | null;
  messageId: MessageId | null;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
  policyId: ResourceId | null;
  reasonCode: ConversationResolutionCode | ConversationClosureCode | null;
  toAutomationMode: ConversationAutomationMode;
  toStatus: ConversationStatus;
  version: AggregateVersion;
}>;

export type ConversationCommandError =
  | ConcurrencyConflict<AggregateVersion>
  | InvalidStateTransition<ConversationStateKey, ExistingConversationCommandName>
  | InvariantViolation
  | TenantScopeViolation;

export type ConversationCreationError = InvariantViolation | TenantScopeViolation;

export type ConversationCommandResult = TransitionResult<
  Conversation,
  ConversationEventDraft,
  ConversationCommandError,
  ConversationTransitionRecord
>;

export type ConversationCreationResult = TransitionResult<
  Conversation,
  ConversationEventDraft,
  ConversationCreationError,
  ConversationTransitionRecord
>;

export type ConversationChannelConnectionReference = Readonly<{
  channelConnectionId: ChannelConnectionId;
  organizationId: OrganizationId;
}>;

export type ConversationContactReference = Readonly<{
  contactId: ContactId;
  organizationId: OrganizationId;
}>;

export type ConversationLeadReference = Readonly<{
  leadId: LeadId;
  organizationId: OrganizationId;
}>;

export type ConversationMessageReference = Readonly<{
  messageId: MessageId;
  organizationId: OrganizationId;
}>;

export type RequestedConversationHandoffReference = ConversationHandoffReference &
  Readonly<{ status: "requested" }>;

export type StaffOwnedConversationHandoffReference = ConversationHandoffReference &
  Readonly<{ status: "assigned" | "in_progress" }>;

export type ResumeAiHandoffDisposition = Readonly<{
  disposition: "resume_ai";
  organizationId: OrganizationId;
  terminalizedHandoffId: HandoffId;
}>;

export type ResolveConversationHandoffDisposition = Readonly<{
  disposition: "resolve_conversation";
  organizationId: OrganizationId;
  terminalizedHandoffId: HandoffId;
}>;

export type SuccessorHandoffDisposition = Readonly<{
  disposition: "successor_handoff";
  organizationId: OrganizationId;
  successorHandoff: RequestedConversationHandoffReference;
  terminalizedHandoffId: HandoffId;
}>;

export type ConversationReopenApproval = Readonly<{
  approved: true;
  organizationId: OrganizationId;
  policyId: ResourceId;
}>;

export type ConversationCommandContext = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type CreateConversationCommand = Readonly<{
  actor: ActorRef;
  channelConnection: ConversationChannelConnectionReference;
  contact: ConversationContactReference;
  conversationId: ConversationId;
  initialMessage: ConversationMessageReference;
  lead: ConversationLeadReference;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type AcceptCustomerMessageCommand = ConversationCommandContext &
  Readonly<{ message: ConversationMessageReference }>;

export type QueueAiResponseCommand = ConversationCommandContext &
  Readonly<{ message: ConversationMessageReference }>;

export type RouteToHumanCommand = ConversationCommandContext &
  Readonly<{ handoff: RequestedConversationHandoffReference }>;

export type RecordStaffOwnershipCommand = ConversationCommandContext &
  Readonly<{ handoff: StaffOwnedConversationHandoffReference }>;

export type QueueStaffResponseCommand = ConversationCommandContext &
  Readonly<{ message: ConversationMessageReference }>;

export type ResumeAiCommand = ConversationCommandContext &
  Readonly<{ handoffDisposition: ResumeAiHandoffDisposition }>;

export type ResolveConversationCommand = ConversationCommandContext &
  Readonly<{
    handoffDisposition: ResolveConversationHandoffDisposition | null;
    resolutionCode: ConversationResolutionCode;
  }>;

export type ReopenConversationCommand = ConversationCommandContext &
  Readonly<{
    message: ConversationMessageReference;
    reopenApproval: ConversationReopenApproval;
  }>;

export type CloseConversationCommand = ConversationCommandContext &
  Readonly<{ closureCode: ConversationClosureCode }>;

export type RecordSuccessorHandoffCommand = ConversationCommandContext &
  Readonly<{ handoffDisposition: SuccessorHandoffDisposition }>;

type EventIdentity = Readonly<{
  schemaId: SchemaId;
  schemaVersion: SchemaVersion;
}>;

type ValidTransitionContext = Readonly<{
  actor: ActorRef;
  nextVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
}>;

type TransitionDetails = Readonly<{
  fromHandoffId?: HandoffId;
  handoffDisposition?: ConversationHandoffDisposition;
  messageId?: MessageId;
  policyId?: ResourceId;
  reasonCode?: ConversationResolutionCode | ConversationClosureCode;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventIdentity = (schema: object): EventIdentity => {
  const schemaId: unknown = Reflect.get(schema, "$id");
  const properties: unknown = Reflect.get(schema, "properties");
  const schemaVersion =
    isRecord(properties) && isRecord(properties["schema_version"])
      ? properties["schema_version"]["const"]
      : undefined;

  if (
    !isSchemaValue(SchemaIdSchema, schemaId) ||
    !isSchemaValue(SchemaVersionSchema, schemaVersion)
  ) {
    throw new TypeError("Invalid canonical Conversation event identity");
  }

  return Object.freeze({ schemaId, schemaVersion });
};

const EVENT_IDENTITIES = Object.freeze({
  "conversation.automation_mode_changed": eventIdentity(
    DomainEventSchemas["conversation.automation_mode_changed"],
  ),
  "conversation.closed": eventIdentity(DomainEventSchemas["conversation.closed"]),
  "conversation.resolved": eventIdentity(DomainEventSchemas["conversation.resolved"]),
  "conversation.started": eventIdentity(DomainEventSchemas["conversation.started"]),
  "conversation.status_changed": eventIdentity(DomainEventSchemas["conversation.status_changed"]),
  "message.received": eventIdentity(DomainEventSchemas["message.received"]),
  "message.response_queued": eventIdentity(DomainEventSchemas["message.response_queued"]),
});

const createEventDraft = <Event extends ConversationEvent>(
  eventType: Event["event_type"],
  aggregateVersion: AggregateVersion,
  payload: Event["payload"],
  identity: EventIdentity,
): DomainEventDraft<Event> =>
  Object.freeze({
    aggregate_version: aggregateVersion,
    event_type: eventType,
    payload: cloneAndFreeze(payload),
    schema_id: identity.schemaId,
    schema_version: identity.schemaVersion,
  });

const invalidReference = (): InvariantViolation<"invalid_reference"> =>
  invariantViolation("invalid_reference");

const invalidReasonCode = (): InvariantViolation<"invalid_reason_code"> =>
  invariantViolation("invalid_reason_code");

export const isConversationResolutionCode = (value: unknown): value is ConversationResolutionCode =>
  isSchemaValue(DomainEventPayloadSchemas["conversation.resolved"], {
    conversation_status: "resolved",
    previous_conversation_status: "open",
    resolution_code: value,
  });

export const validateConversationResolutionCode = (
  value: unknown,
): Result<ConversationResolutionCode, InvariantViolation<"invalid_reason_code">> =>
  isConversationResolutionCode(value) ? success(value) : failure(invalidReasonCode());

export const isConversationClosureCode = (value: unknown): value is ConversationClosureCode =>
  isSchemaValue(DomainEventPayloadSchemas["conversation.closed"], {
    closure_code: value,
    conversation_status: "closed",
    previous_conversation_status: "resolved",
  });

export const validateConversationClosureCode = (
  value: unknown,
): Result<ConversationClosureCode, InvariantViolation<"invalid_reason_code">> =>
  isConversationClosureCode(value) ? success(value) : failure(invalidReasonCode());

export const conversationStateKey = (conversation: Conversation): ConversationStateKey => {
  switch (conversation.status) {
    case "open":
      return "open_ai";
    case "awaiting_lead":
      return conversation.automationMode === "staff" ? "awaiting_lead_staff" : "awaiting_lead_ai";
    case "awaiting_staff":
      return conversation.automationMode === "staff"
        ? "awaiting_staff_staff"
        : "awaiting_staff_paused";
    case "resolved":
      return "resolved_paused";
    case "closed":
      return "closed_paused";
  }
};

const validateScopedReference = <Identifier>(
  reference: unknown,
  idMember: string,
  isIdentifier: (value: unknown) => value is Identifier,
  organizationId: OrganizationId,
): Result<Identifier, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  if (
    !isRecord(reference) ||
    !isIdentifier(reference[idMember]) ||
    !isSchemaValue(OrganizationIdSchema, reference["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, reference["organizationId"]);
  return sameOrganization.ok ? success(reference[idMember]) : sameOrganization;
};

const validateHandoffReference = (
  reference: unknown,
  organizationId: OrganizationId,
  allowedStatuses: readonly ActiveConversationHandoffStatus[],
): Result<
  ConversationHandoffReference,
  InvariantViolation<"invalid_reference"> | TenantScopeViolation
> => {
  if (
    !isRecord(reference) ||
    !isSchemaValue(HandoffIdSchema, reference["handoffId"]) ||
    !isSchemaValue(OrganizationIdSchema, reference["organizationId"]) ||
    !isActiveConversationHandoffStatus(reference["status"]) ||
    !allowedStatuses.some((status) => status === reference["status"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, reference["organizationId"]);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return success(
    Object.freeze({
      handoffId: reference["handoffId"],
      organizationId: reference["organizationId"],
      status: reference["status"],
    }),
  );
};

const validateReopenApproval = (
  approval: unknown,
  organizationId: OrganizationId,
): Result<
  ConversationReopenApproval,
  InvariantViolation<"invalid_reference"> | TenantScopeViolation
> => {
  if (
    !isRecord(approval) ||
    approval["approved"] !== true ||
    !isSchemaValue(OrganizationIdSchema, approval["organizationId"]) ||
    !isSchemaValue(ResourceIdSchema, approval["policyId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(organizationId, approval["organizationId"]);
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return success(
    Object.freeze({
      approved: true,
      organizationId: approval["organizationId"],
      policyId: approval["policyId"],
    }),
  );
};

const beginTransition = (
  conversation: Conversation,
  command: ConversationCommandContext,
  commandName: ExistingConversationCommandName,
  allowedStates: readonly ConversationStateKey[],
): Result<ValidTransitionContext, ConversationCommandError> => {
  const validConversation = validateConversation(conversation);
  if (!validConversation.ok) {
    return validConversation;
  }

  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(AggregateVersionSchema, command["expectedVersion"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(
    conversation.organizationId,
    command["organizationId"],
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const nextVersion = advanceAggregateVersion(conversation.version, command["expectedVersion"]);
  if (!nextVersion.ok) {
    return nextVersion;
  }

  const currentState = conversationStateKey(conversation);
  if (!allowedStates.includes(currentState)) {
    return failure(invalidStateTransition(currentState, commandName));
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      nextVersion: nextVersion.value,
      occurredAt: command["occurredAt"],
    }),
  );
};

const validateCreationContext = (
  command: CreateConversationCommand,
): Result<
  Readonly<{
    actor: ActorRef;
    channelConnectionId: ChannelConnectionId;
    contactId: ContactId;
    conversationId: ConversationId;
    leadId: LeadId;
    messageId: MessageId;
    occurredAt: UtcTimestamp;
    organizationId: OrganizationId;
  }>,
  ConversationCreationError
> => {
  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(ConversationIdSchema, command["conversationId"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"])
  ) {
    return failure(invalidReference());
  }

  const channelConnection = validateScopedReference(
    command["channelConnection"],
    "channelConnectionId",
    (value): value is ChannelConnectionId => isSchemaValue(ChannelConnectionIdSchema, value),
    command["organizationId"],
  );
  if (!channelConnection.ok) {
    return channelConnection;
  }

  const contact = validateScopedReference(
    command["contact"],
    "contactId",
    (value): value is ContactId => isSchemaValue(ContactIdSchema, value),
    command["organizationId"],
  );
  if (!contact.ok) {
    return contact;
  }

  const lead = validateScopedReference(
    command["lead"],
    "leadId",
    (value): value is LeadId => isSchemaValue(LeadIdSchema, value),
    command["organizationId"],
  );
  if (!lead.ok) {
    return lead;
  }

  const initialMessage = validateScopedReference(
    command["initialMessage"],
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    command["organizationId"],
  );
  if (!initialMessage.ok) {
    return initialMessage;
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      channelConnectionId: channelConnection.value,
      contactId: contact.value,
      conversationId: command["conversationId"],
      leadId: lead.value,
      messageId: initialMessage.value,
      occurredAt: command["occurredAt"],
      organizationId: command["organizationId"],
    }),
  );
};

const validateTerminalDisposition = <Disposition extends "resume_ai" | "resolve_conversation">(
  value: unknown,
  expectedDisposition: Disposition,
  conversation: Conversation,
): Result<
  Readonly<{
    disposition: Disposition;
    terminalizedHandoffId: HandoffId;
  }>,
  InvariantViolation<"invalid_reference"> | TenantScopeViolation
> => {
  if (
    !isRecord(value) ||
    value["disposition"] !== expectedDisposition ||
    !isSchemaValue(HandoffIdSchema, value["terminalizedHandoffId"]) ||
    !isSchemaValue(OrganizationIdSchema, value["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(
    conversation.organizationId,
    value["organizationId"],
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  if (conversation.activeHandoff?.handoffId !== value["terminalizedHandoffId"]) {
    return failure(invalidReference());
  }

  return success(
    Object.freeze({
      disposition: expectedDisposition,
      terminalizedHandoffId: value["terminalizedHandoffId"],
    }),
  );
};

const validateSuccessorDisposition = (
  value: unknown,
  conversation: Conversation,
): Result<
  Readonly<{
    successorHandoff: ConversationHandoffReference;
    terminalizedHandoffId: HandoffId;
  }>,
  InvariantViolation<"invalid_reference"> | TenantScopeViolation
> => {
  if (
    !isRecord(value) ||
    value["disposition"] !== "successor_handoff" ||
    !isSchemaValue(HandoffIdSchema, value["terminalizedHandoffId"]) ||
    !isSchemaValue(OrganizationIdSchema, value["organizationId"])
  ) {
    return failure(invalidReference());
  }

  const sameOrganization = requireSameOrganization(
    conversation.organizationId,
    value["organizationId"],
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  if (conversation.activeHandoff?.handoffId !== value["terminalizedHandoffId"]) {
    return failure(invalidReference());
  }

  const successorHandoff = validateHandoffReference(
    value["successorHandoff"],
    conversation.organizationId,
    ["requested"],
  );
  if (!successorHandoff.ok) {
    return successorHandoff;
  }

  if (successorHandoff.value.handoffId === value["terminalizedHandoffId"]) {
    return failure(invalidReference());
  }

  return success(
    Object.freeze({
      successorHandoff: successorHandoff.value,
      terminalizedHandoffId: value["terminalizedHandoffId"],
    }),
  );
};

const createTransitionRecord = (
  conversation: Pick<Conversation, "conversationId" | "organizationId">,
  context: Readonly<{ actor: ActorRef; occurredAt: UtcTimestamp }>,
  command: ConversationCommandName,
  fromStatus: ConversationStatus | null,
  fromAutomationMode: ConversationAutomationMode | null,
  toStatus: ConversationStatus,
  toAutomationMode: ConversationAutomationMode,
  activeHandoffId: HandoffId | null,
  version: AggregateVersion,
  details: TransitionDetails = {},
): ConversationTransitionRecord =>
  Object.freeze({
    actor: context.actor,
    activeHandoffId,
    command,
    conversationId: conversation.conversationId,
    fromAutomationMode,
    fromHandoffId: details.fromHandoffId ?? null,
    fromStatus,
    handoffDisposition: details.handoffDisposition ?? null,
    messageId: details.messageId ?? null,
    occurredAt: context.occurredAt,
    organizationId: conversation.organizationId,
    policyId: details.policyId ?? null,
    reasonCode: details.reasonCode ?? null,
    toAutomationMode,
    toStatus,
    version,
  });

const completeTransition = (
  conversation: Conversation,
  context: ValidTransitionContext,
  command: ExistingConversationCommandName,
  toStatus: ConversationStatus,
  toAutomationMode: ConversationAutomationMode,
  activeHandoff: ConversationHandoffReference | null,
  events: readonly ConversationEventDraft[],
  details: TransitionDetails = {},
): ConversationCommandResult => {
  const nextConversation: Conversation = {
    ...conversation,
    activeHandoff,
    automationMode: toAutomationMode,
    status: toStatus,
    version: context.nextVersion,
  };
  const fromHandoffId = details.fromHandoffId ?? conversation.activeHandoff?.handoffId;
  const recordDetails: TransitionDetails =
    fromHandoffId === undefined ? details : { ...details, fromHandoffId };
  const record = createTransitionRecord(
    conversation,
    context,
    command,
    conversation.status,
    conversation.automationMode,
    toStatus,
    toAutomationMode,
    activeHandoff?.handoffId ?? null,
    context.nextVersion,
    recordDetails,
  );

  return transitionSuccess(nextConversation, events, [record]);
};

const receivedEvent = (version: AggregateVersion, messageId: MessageId): ConversationEventDraft =>
  createEventDraft<DomainEventFor<"message.received">>(
    "message.received",
    version,
    { message_direction: "inbound", message_id: messageId },
    EVENT_IDENTITIES["message.received"],
  );

const responseQueuedEvent = (
  version: AggregateVersion,
  messageId: MessageId,
): ConversationEventDraft =>
  createEventDraft<DomainEventFor<"message.response_queued">>(
    "message.response_queued",
    version,
    { message_direction: "outbound", message_id: messageId, message_status: "queued" },
    EVENT_IDENTITIES["message.response_queued"],
  );

const statusChangedEvent = (
  version: AggregateVersion,
  previousStatus: ConversationStatus,
  status: ConversationStatus,
): ConversationEventDraft =>
  createEventDraft<DomainEventFor<"conversation.status_changed">>(
    "conversation.status_changed",
    version,
    { conversation_status: status, previous_conversation_status: previousStatus },
    EVENT_IDENTITIES["conversation.status_changed"],
  );

const automationModeChangedEvent = (
  version: AggregateVersion,
  handoffId: HandoffId,
  previousMode: "paused" | "staff",
  mode: "paused" | "staff",
): ConversationEventDraft => {
  const payload = {
    automation_mode: mode,
    conversation_status: "awaiting_staff",
    handoff_id: handoffId,
    previous_automation_mode: previousMode,
  };

  if (!isSchemaValue(DomainEventPayloadSchemas["conversation.automation_mode_changed"], payload)) {
    throw new TypeError("Invalid canonical Conversation ownership transition");
  }

  return createEventDraft<DomainEventFor<"conversation.automation_mode_changed">>(
    "conversation.automation_mode_changed",
    version,
    payload,
    EVENT_IDENTITIES["conversation.automation_mode_changed"],
  );
};

export const createConversation = (
  command: CreateConversationCommand,
): ConversationCreationResult => {
  const context = validateCreationContext(command);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const version = initialAggregateVersion();
  const conversation: Conversation = {
    activeHandoff: null,
    automationMode: "ai",
    channelConnectionId: context.value.channelConnectionId,
    contactId: context.value.contactId,
    conversationId: context.value.conversationId,
    leadId: context.value.leadId,
    organizationId: context.value.organizationId,
    status: "open",
    version,
  };
  const started = createEventDraft<DomainEventFor<"conversation.started">>(
    "conversation.started",
    version,
    {
      channel_connection_id: context.value.channelConnectionId,
      contact_id: context.value.contactId,
      conversation_status: "open",
      lead_id: context.value.leadId,
    },
    EVENT_IDENTITIES["conversation.started"],
  );
  const record = createTransitionRecord(
    conversation,
    context.value,
    "create_conversation",
    null,
    null,
    "open",
    "ai",
    null,
    version,
    { messageId: context.value.messageId },
  );

  return transitionSuccess(
    conversation,
    [started, receivedEvent(version, context.value.messageId)],
    [record],
  );
};

export const acceptCustomerMessage = (
  conversation: Conversation,
  command: AcceptCustomerMessageCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "accept_customer_message", [
    "awaiting_lead_ai",
    "awaiting_lead_staff",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const message = validateScopedReference(
    command.message,
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    conversation.organizationId,
  );
  if (!message.ok) {
    return transitionFailure(message.error);
  }

  const staffOwned = conversation.automationMode === "staff";
  const toStatus: ConversationStatus = staffOwned ? "awaiting_staff" : "open";

  return completeTransition(
    conversation,
    context.value,
    "accept_customer_message",
    toStatus,
    conversation.automationMode,
    conversation.activeHandoff,
    [
      receivedEvent(context.value.nextVersion, message.value),
      statusChangedEvent(context.value.nextVersion, conversation.status, toStatus),
    ],
    { messageId: message.value },
  );
};

export const queueAiResponse = (
  conversation: Conversation,
  command: QueueAiResponseCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "queue_ai_response", ["open_ai"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const message = validateScopedReference(
    command.message,
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    conversation.organizationId,
  );
  if (!message.ok) {
    return transitionFailure(message.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "queue_ai_response",
    "awaiting_lead",
    "ai",
    null,
    [
      responseQueuedEvent(context.value.nextVersion, message.value),
      statusChangedEvent(context.value.nextVersion, conversation.status, "awaiting_lead"),
    ],
    { messageId: message.value },
  );
};

export const routeToHuman = (
  conversation: Conversation,
  command: RouteToHumanCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "route_to_human", [
    "open_ai",
    "awaiting_lead_ai",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const handoff = validateHandoffReference(command.handoff, conversation.organizationId, [
    "requested",
  ]);
  if (!handoff.ok) {
    return transitionFailure(handoff.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "route_to_human",
    "awaiting_staff",
    "paused",
    handoff.value,
    [statusChangedEvent(context.value.nextVersion, conversation.status, "awaiting_staff")],
  );
};

export const recordStaffOwnership = (
  conversation: Conversation,
  command: RecordStaffOwnershipCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "record_staff_ownership", [
    "awaiting_staff_paused",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const handoff = validateHandoffReference(command.handoff, conversation.organizationId, [
    "assigned",
    "in_progress",
  ]);
  if (!handoff.ok) {
    return transitionFailure(handoff.error);
  }

  if (handoff.value.handoffId !== conversation.activeHandoff?.handoffId) {
    return transitionFailure(invalidReference());
  }

  return completeTransition(
    conversation,
    context.value,
    "record_staff_ownership",
    "awaiting_staff",
    "staff",
    handoff.value,
    [
      automationModeChangedEvent(
        context.value.nextVersion,
        handoff.value.handoffId,
        "paused",
        "staff",
      ),
    ],
  );
};

export const queueStaffResponse = (
  conversation: Conversation,
  command: QueueStaffResponseCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "queue_staff_response", [
    "awaiting_staff_staff",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const message = validateScopedReference(
    command.message,
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    conversation.organizationId,
  );
  if (!message.ok) {
    return transitionFailure(message.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "queue_staff_response",
    "awaiting_lead",
    "staff",
    conversation.activeHandoff,
    [
      responseQueuedEvent(context.value.nextVersion, message.value),
      statusChangedEvent(context.value.nextVersion, conversation.status, "awaiting_lead"),
    ],
    { messageId: message.value },
  );
};

export const resumeAi = (
  conversation: Conversation,
  command: ResumeAiCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "resume_ai", [
    "awaiting_staff_paused",
    "awaiting_staff_staff",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const disposition = validateTerminalDisposition(
    command.handoffDisposition,
    "resume_ai",
    conversation,
  );
  if (!disposition.ok) {
    return transitionFailure(disposition.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "resume_ai",
    "open",
    "ai",
    null,
    [statusChangedEvent(context.value.nextVersion, conversation.status, "open")],
    { handoffDisposition: "resume_ai" },
  );
};

export const resolveConversation = (
  conversation: Conversation,
  command: ResolveConversationCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "resolve_conversation", [
    "open_ai",
    "awaiting_lead_ai",
    "awaiting_lead_staff",
    "awaiting_staff_paused",
    "awaiting_staff_staff",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const resolutionCode = validateConversationResolutionCode(command.resolutionCode);
  if (!resolutionCode.ok) {
    return transitionFailure(resolutionCode.error);
  }

  if (conversation.activeHandoff === null) {
    if (command.handoffDisposition !== null) {
      return transitionFailure(invalidReference());
    }
  } else {
    const disposition = validateTerminalDisposition(
      command.handoffDisposition,
      "resolve_conversation",
      conversation,
    );
    if (!disposition.ok) {
      return transitionFailure(disposition.error);
    }
  }

  const payload = {
    conversation_status: "resolved",
    previous_conversation_status: conversation.status,
    resolution_code: resolutionCode.value,
  };
  if (!isSchemaValue(DomainEventPayloadSchemas["conversation.resolved"], payload)) {
    return transitionFailure(invalidReasonCode());
  }

  const event = createEventDraft<DomainEventFor<"conversation.resolved">>(
    "conversation.resolved",
    context.value.nextVersion,
    payload,
    EVENT_IDENTITIES["conversation.resolved"],
  );
  const transitionDetails: TransitionDetails =
    conversation.activeHandoff === null
      ? { reasonCode: resolutionCode.value }
      : {
          handoffDisposition: "resolve_conversation",
          reasonCode: resolutionCode.value,
        };

  return completeTransition(
    conversation,
    context.value,
    "resolve_conversation",
    "resolved",
    "paused",
    null,
    [event],
    transitionDetails,
  );
};

export const reopenConversation = (
  conversation: Conversation,
  command: ReopenConversationCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "reopen_conversation", [
    "resolved_paused",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const message = validateScopedReference(
    command.message,
    "messageId",
    (value): value is MessageId => isSchemaValue(MessageIdSchema, value),
    conversation.organizationId,
  );
  if (!message.ok) {
    return transitionFailure(message.error);
  }

  const approval = validateReopenApproval(command.reopenApproval, conversation.organizationId);
  if (!approval.ok) {
    return transitionFailure(approval.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "reopen_conversation",
    "open",
    "ai",
    null,
    [
      receivedEvent(context.value.nextVersion, message.value),
      statusChangedEvent(context.value.nextVersion, conversation.status, "open"),
    ],
    { messageId: message.value, policyId: approval.value.policyId },
  );
};

export const closeConversation = (
  conversation: Conversation,
  command: CloseConversationCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "close_conversation", ["resolved_paused"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const closureCode = validateConversationClosureCode(command.closureCode);
  if (!closureCode.ok) {
    return transitionFailure(closureCode.error);
  }

  const event = createEventDraft<DomainEventFor<"conversation.closed">>(
    "conversation.closed",
    context.value.nextVersion,
    {
      closure_code: closureCode.value,
      conversation_status: "closed",
      previous_conversation_status: "resolved",
    },
    EVENT_IDENTITIES["conversation.closed"],
  );

  return completeTransition(
    conversation,
    context.value,
    "close_conversation",
    "closed",
    "paused",
    null,
    [event],
    { reasonCode: closureCode.value },
  );
};

export const recordSuccessorHandoff = (
  conversation: Conversation,
  command: RecordSuccessorHandoffCommand,
): ConversationCommandResult => {
  const context = beginTransition(conversation, command, "record_successor_handoff", [
    "awaiting_staff_staff",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const disposition = validateSuccessorDisposition(command.handoffDisposition, conversation);
  if (!disposition.ok) {
    return transitionFailure(disposition.error);
  }

  return completeTransition(
    conversation,
    context.value,
    "record_successor_handoff",
    "awaiting_staff",
    "paused",
    disposition.value.successorHandoff,
    [
      automationModeChangedEvent(
        context.value.nextVersion,
        disposition.value.successorHandoff.handoffId,
        "staff",
        "paused",
      ),
    ],
    { handoffDisposition: "successor_handoff" },
  );
};
