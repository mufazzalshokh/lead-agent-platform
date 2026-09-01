import {
  ActorRefSchema,
  AggregateVersionSchema,
  ConversationIdSchema,
  DomainEventSchemas,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  SchemaIdSchema,
  SchemaVersionSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ActorRef,
  type AggregateVersion,
  type ConversationId,
  type DomainEventFor,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type SchemaId,
  type SchemaVersion,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import {
  invariantViolation,
  invalidStateTransition,
  type ConcurrencyConflict,
  type InvalidStateTransition,
  type InvariantViolation,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import type { DomainEventDraft } from "../foundation/event-draft.js";
import { cloneAndFreeze } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  transitionFailure,
  transitionSuccess,
  type TransitionResult,
} from "../foundation/transition.js";
import {
  advanceAggregateVersion,
  incrementAggregateVersion,
  initialAggregateVersion,
} from "../foundation/version.js";
import { requireSameOrganization } from "../values/tenant.js";
import { compareUtcTimestamps } from "../values/time.js";
import {
  isHandoffQueueKey,
  isHandoffTriggerReason,
  validateHandoff,
  validateHandoffReasonCode,
  validateHandoffResolutionCode,
  type ActiveHandoffStatus,
  type Handoff,
  type HandoffQueueKey,
  type HandoffReasonCode,
  type HandoffResolutionCode,
  type HandoffStatus,
  type HandoffTriggerReason,
  type InvalidHandoff,
  type InvalidHandoffReasonCode,
} from "./handoff.js";

type HandoffEvent =
  | DomainEventFor<"handoff.requested">
  | DomainEventFor<"handoff.assigned">
  | DomainEventFor<"handoff.started">
  | DomainEventFor<"handoff.resolved">
  | DomainEventFor<"handoff.cancelled">
  | DomainEventFor<"handoff.expired">;

export type HandoffEventDraft = DomainEventDraft<HandoffEvent>;

export type HandoffConversationReference = Readonly<{
  conversationId: ConversationId;
  organizationId: OrganizationId;
}>;

export type HandoffLeadReference = Readonly<{
  leadId: LeadId;
  organizationId: OrganizationId;
}>;

export type HandoffLocationReference = Readonly<{
  locationId: LocationId;
  organizationId: OrganizationId;
}>;

export type HandoffAssigneeReference = Readonly<{
  membershipId: MembershipId;
  organizationId: OrganizationId;
}>;

export type HandoffCommandContext = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
}>;

export type CreateHandoffCommand = Readonly<{
  actor: ActorRef;
  conversation: HandoffConversationReference;
  handoffId: HandoffId;
  lead: HandoffLeadReference;
  location: HandoffLocationReference | null;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
  queueKey: HandoffQueueKey;
  slaDueAt: UtcTimestamp;
  triggerReason: HandoffTriggerReason;
}>;

export type AssignHandoffCommand = HandoffCommandContext &
  Readonly<{ assignee: HandoffAssigneeReference }>;

export type ClaimAndStartHandoffCommand = HandoffCommandContext &
  Readonly<{ assignee: HandoffAssigneeReference }>;

export type ReassignHandoffCommand = HandoffCommandContext &
  Readonly<{ assignee: HandoffAssigneeReference }>;

export type StartHandoffCommand = HandoffCommandContext &
  Readonly<{ starter: HandoffAssigneeReference }>;

export type ResolveHandoffCommand = HandoffCommandContext &
  Readonly<{
    resolutionCode: HandoffResolutionCode;
  }>;

export type CancelHandoffCommand = HandoffCommandContext &
  Readonly<{
    reasonCode: HandoffReasonCode;
  }>;

export type ExpireHandoffCommand = Readonly<{
  actor: ActorRef;
  expectedVersion: AggregateVersion;
  now: UtcTimestamp;
  organizationId: OrganizationId;
  reasonCode: HandoffReasonCode;
}>;

export type HandoffCommandName =
  | "request_handoff"
  | "assign_handoff"
  | "claim_and_start_handoff"
  | "reassign_handoff"
  | "start_handoff"
  | "resolve_handoff"
  | "cancel_handoff"
  | "expire_handoff";

export type ExistingHandoffCommandName = Exclude<HandoffCommandName, "request_handoff">;

export type HandoffTransitionRecord = Readonly<{
  actor: ActorRef;
  command: HandoffCommandName;
  fromAssigneeMembershipId: MembershipId | null;
  fromStatus: HandoffStatus | null;
  handoffId: HandoffId;
  occurredAt: UtcTimestamp;
  organizationId: OrganizationId;
  reasonCode: HandoffReasonCode | HandoffResolutionCode | null;
  toAssigneeMembershipId: MembershipId | null;
  toStatus: HandoffStatus;
  version: AggregateVersion;
}>;

type VersionError =
  | ConcurrencyConflict<AggregateVersion>
  | InvariantViolation<"invalid_version" | "version_overflow">;

export type HandoffCreationError =
  InvalidHandoff | InvariantViolation<"invalid_reference"> | TenantScopeViolation;

export type HandoffCommandError =
  | HandoffCreationError
  | InvalidHandoffReasonCode
  | InvariantViolation<"handoff_not_due">
  | InvalidStateTransition<HandoffStatus, ExistingHandoffCommandName>
  | VersionError;

export type HandoffCreationResult = TransitionResult<
  Handoff,
  HandoffEventDraft,
  HandoffCreationError,
  HandoffTransitionRecord
>;

export type HandoffCommandResult = TransitionResult<
  Handoff,
  HandoffEventDraft,
  HandoffCommandError,
  HandoffTransitionRecord
>;

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
  fromAssigneeMembershipId?: MembershipId | null;
  reasonCode?: HandoffReasonCode | HandoffResolutionCode;
  toAssigneeMembershipId?: MembershipId | null;
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
    throw new TypeError("Invalid canonical Handoff event identity");
  }

  return Object.freeze({ schemaId, schemaVersion });
};

const EVENT_IDENTITIES = Object.freeze({
  "handoff.assigned": eventIdentity(DomainEventSchemas["handoff.assigned"]),
  "handoff.cancelled": eventIdentity(DomainEventSchemas["handoff.cancelled"]),
  "handoff.expired": eventIdentity(DomainEventSchemas["handoff.expired"]),
  "handoff.requested": eventIdentity(DomainEventSchemas["handoff.requested"]),
  "handoff.resolved": eventIdentity(DomainEventSchemas["handoff.resolved"]),
  "handoff.started": eventIdentity(DomainEventSchemas["handoff.started"]),
});

const createEventDraft = <Event extends HandoffEvent>(
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

const invalidHandoff = (): InvalidHandoff => invariantViolation("invalid_handoff");

const handoffNotDue = (): InvariantViolation<"handoff_not_due"> =>
  invariantViolation("handoff_not_due");

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

const validateAssignee = (
  reference: unknown,
  organizationId: OrganizationId,
): Result<MembershipId, InvariantViolation<"invalid_reference"> | TenantScopeViolation> =>
  validateScopedReference(
    reference,
    "membershipId",
    (value): value is MembershipId => isSchemaValue(MembershipIdSchema, value),
    organizationId,
  );

const latestLifecycleTimestamp = (handoff: Handoff): UtcTimestamp =>
  handoff.startedAt ?? handoff.assignedAt ?? handoff.requestedAt;

const beginTransition = (
  handoff: Handoff,
  command: HandoffCommandContext,
  commandName: ExistingHandoffCommandName,
  allowedStatuses: readonly ActiveHandoffStatus[],
): Result<ValidTransitionContext, HandoffCommandError> => {
  const validHandoff = validateHandoff(handoff);
  if (!validHandoff.ok) {
    return validHandoff;
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
    handoff.organizationId,
    command["organizationId"],
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const nextVersion = advanceAggregateVersion(handoff.version, command["expectedVersion"]);
  if (!nextVersion.ok) {
    return nextVersion;
  }

  if (!allowedStatuses.includes(handoff.status as ActiveHandoffStatus)) {
    return failure(invalidStateTransition(handoff.status, commandName));
  }

  const occurrenceOrder = compareUtcTimestamps(
    command["occurredAt"],
    latestLifecycleTimestamp(handoff),
  );
  if (!occurrenceOrder.ok || occurrenceOrder.value < 0) {
    return failure(invalidHandoff());
  }

  return success(
    Object.freeze({
      actor: command["actor"],
      nextVersion: nextVersion.value,
      occurredAt: command["occurredAt"],
    }),
  );
};

const createTransitionRecord = (
  handoff: Pick<Handoff, "assignedMembershipId" | "handoffId" | "organizationId">,
  context: Readonly<{ actor: ActorRef; occurredAt: UtcTimestamp }>,
  command: HandoffCommandName,
  fromStatus: HandoffStatus | null,
  toStatus: HandoffStatus,
  version: AggregateVersion,
  details: TransitionDetails = {},
): HandoffTransitionRecord =>
  Object.freeze({
    actor: context.actor,
    command,
    fromAssigneeMembershipId: details.fromAssigneeMembershipId ?? handoff.assignedMembershipId,
    fromStatus,
    handoffId: handoff.handoffId,
    occurredAt: context.occurredAt,
    organizationId: handoff.organizationId,
    reasonCode: details.reasonCode ?? null,
    toAssigneeMembershipId: details.toAssigneeMembershipId ?? handoff.assignedMembershipId,
    toStatus,
    version,
  });

const completeTransition = (
  handoff: Handoff,
  context: ValidTransitionContext,
  command: ExistingHandoffCommandName,
  toStatus: HandoffStatus,
  event: HandoffEventDraft,
  changes: Partial<
    Pick<
      Handoff,
      "assignedAt" | "assignedMembershipId" | "resolutionCode" | "resolvedAt" | "startedAt"
    >
  > = {},
  details: TransitionDetails = {},
): HandoffCommandResult => {
  const nextHandoff: Handoff = {
    ...handoff,
    ...changes,
    status: toStatus,
    version: context.nextVersion,
  };
  const validNextHandoff = validateHandoff(nextHandoff);
  if (!validNextHandoff.ok) {
    return transitionFailure(validNextHandoff.error);
  }

  const record = createTransitionRecord(
    handoff,
    context,
    command,
    handoff.status,
    toStatus,
    context.nextVersion,
    details,
  );

  return transitionSuccess(nextHandoff, [event], [record]);
};

const assignedEvent = (
  version: AggregateVersion,
  assigneeMembershipId: MembershipId,
): HandoffEventDraft =>
  createEventDraft<DomainEventFor<"handoff.assigned">>(
    "handoff.assigned",
    version,
    { assignee_membership_id: assigneeMembershipId, handoff_status: "assigned" },
    EVENT_IDENTITIES["handoff.assigned"],
  );

const startedEvent = (
  version: AggregateVersion,
  assigneeMembershipId: MembershipId,
): HandoffEventDraft =>
  createEventDraft<DomainEventFor<"handoff.started">>(
    "handoff.started",
    version,
    { assignee_membership_id: assigneeMembershipId, handoff_status: "in_progress" },
    EVENT_IDENTITIES["handoff.started"],
  );

export const requestHandoff = (command: CreateHandoffCommand): HandoffCreationResult => {
  if (
    !isRecord(command) ||
    !isSchemaValue(ActorRefSchema, command["actor"]) ||
    !isSchemaValue(HandoffIdSchema, command["handoffId"]) ||
    !isSchemaValue(OrganizationIdSchema, command["organizationId"]) ||
    !isSchemaValue(UtcTimestampSchema, command["occurredAt"]) ||
    !isSchemaValue(UtcTimestampSchema, command["slaDueAt"]) ||
    !isHandoffQueueKey(command["queueKey"]) ||
    !isHandoffTriggerReason(command["triggerReason"])
  ) {
    return transitionFailure(invalidReference());
  }

  const conversation = validateScopedReference(
    command["conversation"],
    "conversationId",
    (value): value is ConversationId => isSchemaValue(ConversationIdSchema, value),
    command["organizationId"],
  );
  if (!conversation.ok) {
    return transitionFailure(conversation.error);
  }

  const lead = validateScopedReference(
    command["lead"],
    "leadId",
    (value): value is LeadId => isSchemaValue(LeadIdSchema, value),
    command["organizationId"],
  );
  if (!lead.ok) {
    return transitionFailure(lead.error);
  }

  let locationId: LocationId | null = null;
  if (command["location"] !== null) {
    const location = validateScopedReference(
      command["location"],
      "locationId",
      (value): value is LocationId => isSchemaValue(LocationIdSchema, value),
      command["organizationId"],
    );
    if (!location.ok) {
      return transitionFailure(location.error);
    }
    locationId = location.value;
  }

  const slaOrder = compareUtcTimestamps(command["occurredAt"], command["slaDueAt"]);
  if (!slaOrder.ok || slaOrder.value >= 0) {
    return transitionFailure(invalidHandoff());
  }

  const version = initialAggregateVersion();
  const handoff: Handoff = {
    assignedAt: null,
    assignedMembershipId: null,
    conversationId: conversation.value,
    handoffId: command["handoffId"],
    leadId: lead.value,
    locationId,
    organizationId: command["organizationId"],
    queueKey: command["queueKey"],
    requestedAt: command["occurredAt"],
    resolutionCode: null,
    resolvedAt: null,
    slaDueAt: command["slaDueAt"],
    startedAt: null,
    status: "requested",
    triggerReason: command["triggerReason"],
    version,
  };
  const validHandoff = validateHandoff(handoff);
  if (!validHandoff.ok) {
    return transitionFailure(validHandoff.error);
  }

  const event = createEventDraft<DomainEventFor<"handoff.requested">>(
    "handoff.requested",
    version,
    {
      conversation_id: conversation.value,
      handoff_status: "requested",
      lead_id: lead.value,
      trigger_reason: command["triggerReason"],
    },
    EVENT_IDENTITIES["handoff.requested"],
  );
  const record = createTransitionRecord(
    handoff,
    command,
    "request_handoff",
    null,
    "requested",
    version,
    { fromAssigneeMembershipId: null, toAssigneeMembershipId: null },
  );

  return transitionSuccess(handoff, [event], [record]);
};

export const assignHandoff = (
  handoff: Handoff,
  command: AssignHandoffCommand,
): HandoffCommandResult => {
  const assignee = validateAssignee(command.assignee, handoff.organizationId);
  if (!assignee.ok) {
    return transitionFailure(assignee.error);
  }

  const context = beginTransition(handoff, command, "assign_handoff", ["requested"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  return completeTransition(
    handoff,
    context.value,
    "assign_handoff",
    "assigned",
    assignedEvent(context.value.nextVersion, assignee.value),
    { assignedAt: context.value.occurredAt, assignedMembershipId: assignee.value },
    { fromAssigneeMembershipId: null, toAssigneeMembershipId: assignee.value },
  );
};

export const claimAndStartHandoff = (
  handoff: Handoff,
  command: ClaimAndStartHandoffCommand,
): HandoffCommandResult => {
  const assignee = validateAssignee(command.assignee, handoff.organizationId);
  if (!assignee.ok) {
    return transitionFailure(assignee.error);
  }

  const context = beginTransition(handoff, command, "claim_and_start_handoff", ["requested"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const startedVersion = incrementAggregateVersion(context.value.nextVersion);
  if (!startedVersion.ok) {
    return transitionFailure(startedVersion.error);
  }

  const nextHandoff: Handoff = {
    ...handoff,
    assignedAt: context.value.occurredAt,
    assignedMembershipId: assignee.value,
    startedAt: context.value.occurredAt,
    status: "in_progress",
    version: startedVersion.value,
  };
  const validNextHandoff = validateHandoff(nextHandoff);
  if (!validNextHandoff.ok) {
    return transitionFailure(validNextHandoff.error);
  }

  const assignmentRecord = createTransitionRecord(
    handoff,
    context.value,
    "claim_and_start_handoff",
    "requested",
    "assigned",
    context.value.nextVersion,
    { fromAssigneeMembershipId: null, toAssigneeMembershipId: assignee.value },
  );
  const startedRecord = createTransitionRecord(
    { ...handoff, assignedMembershipId: assignee.value },
    context.value,
    "claim_and_start_handoff",
    "assigned",
    "in_progress",
    startedVersion.value,
    {
      fromAssigneeMembershipId: assignee.value,
      toAssigneeMembershipId: assignee.value,
    },
  );

  return transitionSuccess(
    nextHandoff,
    [
      assignedEvent(context.value.nextVersion, assignee.value),
      startedEvent(startedVersion.value, assignee.value),
    ],
    [assignmentRecord, startedRecord],
  );
};

export const reassignHandoff = (
  handoff: Handoff,
  command: ReassignHandoffCommand,
): HandoffCommandResult => {
  const assignee = validateAssignee(command.assignee, handoff.organizationId);
  if (!assignee.ok) {
    return transitionFailure(assignee.error);
  }

  const context = beginTransition(handoff, command, "reassign_handoff", ["assigned"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  if (handoff.assignedMembershipId === assignee.value) {
    return transitionFailure(invalidReference());
  }

  return completeTransition(
    handoff,
    context.value,
    "reassign_handoff",
    "assigned",
    assignedEvent(context.value.nextVersion, assignee.value),
    { assignedAt: context.value.occurredAt, assignedMembershipId: assignee.value },
    {
      fromAssigneeMembershipId: handoff.assignedMembershipId,
      toAssigneeMembershipId: assignee.value,
    },
  );
};

export const startHandoff = (
  handoff: Handoff,
  command: StartHandoffCommand,
): HandoffCommandResult => {
  const starter = validateAssignee(command.starter, handoff.organizationId);
  if (!starter.ok) {
    return transitionFailure(starter.error);
  }

  const context = beginTransition(handoff, command, "start_handoff", ["assigned"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  if (handoff.assignedMembershipId !== starter.value) {
    return transitionFailure(invalidReference());
  }

  return completeTransition(
    handoff,
    context.value,
    "start_handoff",
    "in_progress",
    startedEvent(context.value.nextVersion, starter.value),
    { startedAt: context.value.occurredAt },
    {
      fromAssigneeMembershipId: starter.value,
      toAssigneeMembershipId: starter.value,
    },
  );
};

export const resolveHandoff = (
  handoff: Handoff,
  command: ResolveHandoffCommand,
): HandoffCommandResult => {
  const resolutionCode = validateHandoffResolutionCode(command.resolutionCode);
  if (!resolutionCode.ok) {
    return transitionFailure(resolutionCode.error);
  }

  const context = beginTransition(handoff, command, "resolve_handoff", ["in_progress"]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  if (context.value.actor.actor_type === "system") {
    return transitionFailure(invalidReference());
  }

  const event = createEventDraft<DomainEventFor<"handoff.resolved">>(
    "handoff.resolved",
    context.value.nextVersion,
    { handoff_status: "resolved", resolution_code: resolutionCode.value },
    EVENT_IDENTITIES["handoff.resolved"],
  );

  return completeTransition(
    handoff,
    context.value,
    "resolve_handoff",
    "resolved",
    event,
    { resolutionCode: resolutionCode.value, resolvedAt: context.value.occurredAt },
    { reasonCode: resolutionCode.value },
  );
};

export const cancelHandoff = (
  handoff: Handoff,
  command: CancelHandoffCommand,
): HandoffCommandResult => {
  const reasonCode = validateHandoffReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }

  const context = beginTransition(handoff, command, "cancel_handoff", [
    "requested",
    "assigned",
    "in_progress",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }

  const event = createEventDraft<DomainEventFor<"handoff.cancelled">>(
    "handoff.cancelled",
    context.value.nextVersion,
    {
      handoff_status: "cancelled",
      previous_handoff_status: handoff.status,
      reason_code: reasonCode.value,
    },
    EVENT_IDENTITIES["handoff.cancelled"],
  );

  return completeTransition(
    handoff,
    context.value,
    "cancel_handoff",
    "cancelled",
    event,
    {},
    { reasonCode: reasonCode.value },
  );
};

export const expireHandoff = (
  handoff: Handoff,
  command: ExpireHandoffCommand,
): HandoffCommandResult => {
  const reasonCode = validateHandoffReasonCode(command.reasonCode);
  if (!reasonCode.ok) {
    return transitionFailure(reasonCode.error);
  }
  if (!isRecord(command) || !isSchemaValue(UtcTimestampSchema, command["now"])) {
    return transitionFailure(invalidReference());
  }

  const normalizedCommand: HandoffCommandContext = {
    actor: command["actor"],
    expectedVersion: command["expectedVersion"],
    occurredAt: command["now"],
    organizationId: command["organizationId"],
  };
  const context = beginTransition(handoff, normalizedCommand, "expire_handoff", [
    "requested",
    "assigned",
    "in_progress",
  ]);
  if (!context.ok) {
    return transitionFailure(context.error);
  }
  if (context.value.actor.actor_type !== "system") {
    return transitionFailure(invalidReference());
  }

  const dueOrder = compareUtcTimestamps(command["now"], handoff.slaDueAt);
  if (!dueOrder.ok || dueOrder.value < 0) {
    return transitionFailure(handoffNotDue());
  }

  const event = createEventDraft<DomainEventFor<"handoff.expired">>(
    "handoff.expired",
    context.value.nextVersion,
    {
      handoff_status: "expired",
      previous_handoff_status: handoff.status,
      reason_code: reasonCode.value,
    },
    EVENT_IDENTITIES["handoff.expired"],
  );

  return completeTransition(
    handoff,
    context.value,
    "expire_handoff",
    "expired",
    event,
    {},
    { reasonCode: reasonCode.value },
  );
};
