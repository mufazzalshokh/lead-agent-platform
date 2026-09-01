import type { LocationId } from "@lead-agent/contracts";

import {
  recordStaffOwnership,
  recordSuccessorHandoff,
  resolveConversation,
  resumeAi,
  routeToHuman,
  type Conversation,
  type ConversationCommandContext,
  type ConversationCommandError,
  type ConversationEventDraft,
  type ConversationResolutionCode,
  type ConversationTransitionRecord,
} from "../conversations/index.js";
import {
  invariantViolation,
  type InvariantViolation,
  type TenantScopeViolation,
} from "../foundation/errors.js";
import { cloneAndFreeze, type DeepReadonly } from "../foundation/immutable.js";
import { failure, success, type Result } from "../foundation/result.js";
import {
  assignHandoff,
  cancelHandoff,
  claimAndStartHandoff,
  expireHandoff,
  requestHandoff,
  resolveHandoff,
  type AssignHandoffCommand,
  type CancelHandoffCommand,
  type ClaimAndStartHandoffCommand,
  type CreateHandoffCommand,
  type ExpireHandoffCommand,
  type Handoff,
  type HandoffCommandError,
  type HandoffCreationError,
  type HandoffEventDraft,
  type HandoffTransitionRecord,
  type ResolveHandoffCommand,
} from "../handoffs/index.js";
import { requireSameOrganization } from "../values/tenant.js";

type HandoffWorkflowEventDraft = ConversationEventDraft | HandoffEventDraft;
type HandoffWorkflowTransitionRecord = ConversationTransitionRecord | HandoffTransitionRecord;

type HandoffConversationWorkflowPlan = Readonly<{
  conversation: DeepReadonly<Conversation>;
  events: readonly DeepReadonly<HandoffWorkflowEventDraft>[];
  handoff: DeepReadonly<Handoff>;
  transitionRecords: readonly DeepReadonly<HandoffWorkflowTransitionRecord>[];
}>;

type SuccessorHandoffWorkflowPlan = HandoffConversationWorkflowPlan &
  Readonly<{
    successorHandoff: DeepReadonly<Handoff>;
  }>;

export type RequestHandoffWorkflowError = HandoffCreationError | ConversationCommandError;
export type StaffOwnershipWorkflowError = HandoffCommandError | ConversationCommandError;
export type TerminateHandoffWorkflowError = HandoffCommandError | ConversationCommandError;
export type SuccessorHandoffWorkflowError =
  HandoffCommandError | HandoffCreationError | ConversationCommandError;

export type StaffOwnershipAction =
  | Readonly<{ action: "assign"; command: AssignHandoffCommand }>
  | Readonly<{ action: "claim_and_start"; command: ClaimAndStartHandoffCommand }>;

export type TerminalHandoffAction =
  | Readonly<{ action: "cancelled"; command: CancelHandoffCommand }>
  | Readonly<{ action: "expired"; command: ExpireHandoffCommand }>
  | Readonly<{ action: "resolved"; command: ResolveHandoffCommand }>;

export type RequestHandoffWorkflowCommand = Readonly<{
  conversation: ConversationCommandContext;
  handoff: CreateHandoffCommand;
}>;

export type StaffOwnershipWorkflowCommand = Readonly<{
  conversation: ConversationCommandContext;
  handoff: StaffOwnershipAction;
}>;

export type ResumeAiHandoffWorkflowCommand = Readonly<{
  conversation: ConversationCommandContext;
  disposition: "resume_ai";
  handoff: TerminalHandoffAction;
}>;

export type ResolveConversationHandoffWorkflowCommand = Readonly<{
  conversation: ConversationCommandContext;
  disposition: "resolve_conversation";
  handoff: TerminalHandoffAction;
  resolutionCode: ConversationResolutionCode;
}>;

export type SuccessorHandoffWorkflowCommand = Readonly<{
  conversation: ConversationCommandContext;
  disposition: "successor_handoff";
  handoff: TerminalHandoffAction;
  successorHandoff: CreateHandoffCommand;
}>;

export type HandoffTerminalWorkflowCommand =
  | ResumeAiHandoffWorkflowCommand
  | ResolveConversationHandoffWorkflowCommand
  | SuccessorHandoffWorkflowCommand;

export type RequestHandoffWorkflowResult = Result<
  HandoffConversationWorkflowPlan,
  DeepReadonly<RequestHandoffWorkflowError>
>;

export type StaffOwnershipWorkflowResult = Result<
  HandoffConversationWorkflowPlan,
  DeepReadonly<StaffOwnershipWorkflowError>
>;

export type ResumeAiHandoffWorkflowResult = Result<
  HandoffConversationWorkflowPlan,
  DeepReadonly<TerminateHandoffWorkflowError>
>;

export type ResolveConversationHandoffWorkflowResult = Result<
  HandoffConversationWorkflowPlan,
  DeepReadonly<TerminateHandoffWorkflowError>
>;

export type SuccessorHandoffWorkflowResult = Result<
  SuccessorHandoffWorkflowPlan,
  DeepReadonly<SuccessorHandoffWorkflowError>
>;

const invalidReference = (): InvariantViolation<"invalid_reference"> =>
  invariantViolation("invalid_reference");

const workflowFailure = <Error>(error: Error) => failure(cloneAndFreeze(error));

const workflowSuccess = (
  handoff: Handoff,
  conversation: Conversation,
  events: readonly HandoffWorkflowEventDraft[],
  transitionRecords: readonly HandoffWorkflowTransitionRecord[],
) =>
  success(
    cloneAndFreeze({
      conversation,
      events,
      handoff,
      transitionRecords,
    }),
  );

const successorWorkflowSuccess = (
  handoff: Handoff,
  successorHandoff: Handoff,
  conversation: Conversation,
  events: readonly HandoffWorkflowEventDraft[],
  transitionRecords: readonly HandoffWorkflowTransitionRecord[],
) =>
  success(
    cloneAndFreeze({
      conversation,
      events,
      handoff,
      successorHandoff,
      transitionRecords,
    }),
  );

const validateHandoffConversationLink = (
  handoff: Pick<Handoff, "conversationId" | "handoffId" | "leadId" | "organizationId" | "status">,
  conversation: Conversation,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const sameOrganization = requireSameOrganization(
    handoff.organizationId,
    conversation.organizationId,
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return handoff.conversationId === conversation.conversationId &&
    handoff.leadId === conversation.leadId &&
    conversation.activeHandoff?.handoffId === handoff.handoffId &&
    conversation.activeHandoff.status === handoff.status
    ? success(undefined)
    : failure(invalidReference());
};

const validateNewHandoffConversationLink = (
  command: CreateHandoffCommand,
  conversation: Conversation,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const sameOrganization = requireSameOrganization(
    command.organizationId,
    conversation.organizationId,
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  return command.conversation.conversationId === conversation.conversationId &&
    command.lead.leadId === conversation.leadId
    ? success(undefined)
    : failure(invalidReference());
};

const validateSuccessorLink = (
  current: Handoff,
  successor: CreateHandoffCommand,
): Result<void, InvariantViolation<"invalid_reference"> | TenantScopeViolation> => {
  const sameOrganization = requireSameOrganization(
    current.organizationId,
    successor.organizationId,
  );
  if (!sameOrganization.ok) {
    return sameOrganization;
  }

  const successorLocationId: LocationId | null = successor.location?.locationId ?? null;
  return successor.handoffId !== current.handoffId &&
    successor.conversation.conversationId === current.conversationId &&
    successor.lead.leadId === current.leadId &&
    successorLocationId === current.locationId
    ? success(undefined)
    : failure(invalidReference());
};

const applyStaffOwnership = (handoff: Handoff, action: StaffOwnershipAction) => {
  switch (action.action) {
    case "assign":
      return assignHandoff(handoff, action.command);
    case "claim_and_start":
      return claimAndStartHandoff(handoff, action.command);
  }
};

const applyTerminalAction = (handoff: Handoff, action: TerminalHandoffAction) => {
  switch (action.action) {
    case "cancelled":
      return cancelHandoff(handoff, action.command);
    case "expired":
      return expireHandoff(handoff, action.command);
    case "resolved":
      return resolveHandoff(handoff, action.command);
  }
};

const requestedHandoffReference = (handoff: Handoff) => ({
  handoffId: handoff.handoffId,
  organizationId: handoff.organizationId,
  status: "requested" as const,
});

const staffOwnedHandoffReference = (handoff: Handoff) => ({
  handoffId: handoff.handoffId,
  organizationId: handoff.organizationId,
  status: handoff.status as "assigned" | "in_progress",
});

export const requestHandoffWorkflow = (
  conversation: Conversation,
  command: RequestHandoffWorkflowCommand,
): RequestHandoffWorkflowResult => {
  const linked = validateNewHandoffConversationLink(command.handoff, conversation);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }

  const handoffTransition = requestHandoff(command.handoff);
  if (!handoffTransition.ok) {
    return workflowFailure(handoffTransition.error);
  }

  const conversationTransition = routeToHuman(conversation, {
    ...command.conversation,
    handoff: requestedHandoffReference(handoffTransition.value.nextAggregate),
  });
  if (!conversationTransition.ok) {
    return workflowFailure(conversationTransition.error);
  }

  return workflowSuccess(
    handoffTransition.value.nextAggregate,
    conversationTransition.value.nextAggregate,
    [...handoffTransition.value.events, ...conversationTransition.value.events],
    [
      ...handoffTransition.value.transitionRecords,
      ...conversationTransition.value.transitionRecords,
    ],
  );
};

export const takeHandoffStaffOwnershipWorkflow = (
  handoff: Handoff,
  conversation: Conversation,
  command: StaffOwnershipWorkflowCommand,
): StaffOwnershipWorkflowResult => {
  const linked = validateHandoffConversationLink(handoff, conversation);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }

  const handoffTransition = applyStaffOwnership(handoff, command.handoff);
  if (!handoffTransition.ok) {
    return workflowFailure(handoffTransition.error);
  }

  const conversationTransition = recordStaffOwnership(conversation, {
    ...command.conversation,
    handoff: staffOwnedHandoffReference(handoffTransition.value.nextAggregate),
  });
  if (!conversationTransition.ok) {
    return workflowFailure(conversationTransition.error);
  }

  return workflowSuccess(
    handoffTransition.value.nextAggregate,
    conversationTransition.value.nextAggregate,
    [...handoffTransition.value.events, ...conversationTransition.value.events],
    [
      ...handoffTransition.value.transitionRecords,
      ...conversationTransition.value.transitionRecords,
    ],
  );
};

export const terminateHandoffAndResumeAiWorkflow = (
  handoff: Handoff,
  conversation: Conversation,
  command: ResumeAiHandoffWorkflowCommand,
): ResumeAiHandoffWorkflowResult => {
  const linked = validateHandoffConversationLink(handoff, conversation);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }
  if (command.disposition !== "resume_ai") {
    return workflowFailure(invalidReference());
  }

  const handoffTransition = applyTerminalAction(handoff, command.handoff);
  if (!handoffTransition.ok) {
    return workflowFailure(handoffTransition.error);
  }

  const conversationTransition = resumeAi(conversation, {
    ...command.conversation,
    handoffDisposition: {
      disposition: "resume_ai",
      organizationId: handoffTransition.value.nextAggregate.organizationId,
      terminalizedHandoffId: handoffTransition.value.nextAggregate.handoffId,
    },
  });
  if (!conversationTransition.ok) {
    return workflowFailure(conversationTransition.error);
  }

  return workflowSuccess(
    handoffTransition.value.nextAggregate,
    conversationTransition.value.nextAggregate,
    [...handoffTransition.value.events, ...conversationTransition.value.events],
    [
      ...handoffTransition.value.transitionRecords,
      ...conversationTransition.value.transitionRecords,
    ],
  );
};

export const terminateHandoffAndResolveConversationWorkflow = (
  handoff: Handoff,
  conversation: Conversation,
  command: ResolveConversationHandoffWorkflowCommand,
): ResolveConversationHandoffWorkflowResult => {
  const linked = validateHandoffConversationLink(handoff, conversation);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }
  if (command.disposition !== "resolve_conversation") {
    return workflowFailure(invalidReference());
  }

  const handoffTransition = applyTerminalAction(handoff, command.handoff);
  if (!handoffTransition.ok) {
    return workflowFailure(handoffTransition.error);
  }

  const conversationTransition = resolveConversation(conversation, {
    ...command.conversation,
    handoffDisposition: {
      disposition: "resolve_conversation",
      organizationId: handoffTransition.value.nextAggregate.organizationId,
      terminalizedHandoffId: handoffTransition.value.nextAggregate.handoffId,
    },
    resolutionCode: command.resolutionCode,
  });
  if (!conversationTransition.ok) {
    return workflowFailure(conversationTransition.error);
  }

  return workflowSuccess(
    handoffTransition.value.nextAggregate,
    conversationTransition.value.nextAggregate,
    [...handoffTransition.value.events, ...conversationTransition.value.events],
    [
      ...handoffTransition.value.transitionRecords,
      ...conversationTransition.value.transitionRecords,
    ],
  );
};

export const replaceHandoffWithSuccessorWorkflow = (
  handoff: Handoff,
  conversation: Conversation,
  command: SuccessorHandoffWorkflowCommand,
): SuccessorHandoffWorkflowResult => {
  const linked = validateHandoffConversationLink(handoff, conversation);
  if (!linked.ok) {
    return workflowFailure(linked.error);
  }
  if (command.disposition !== "successor_handoff") {
    return workflowFailure(invalidReference());
  }
  const successorLink = validateSuccessorLink(handoff, command.successorHandoff);
  if (!successorLink.ok) {
    return workflowFailure(successorLink.error);
  }

  const handoffTransition = applyTerminalAction(handoff, command.handoff);
  if (!handoffTransition.ok) {
    return workflowFailure(handoffTransition.error);
  }

  const successorTransition = requestHandoff(command.successorHandoff);
  if (!successorTransition.ok) {
    return workflowFailure(successorTransition.error);
  }

  const conversationTransition = recordSuccessorHandoff(conversation, {
    ...command.conversation,
    handoffDisposition: {
      disposition: "successor_handoff",
      organizationId: handoffTransition.value.nextAggregate.organizationId,
      successorHandoff: requestedHandoffReference(successorTransition.value.nextAggregate),
      terminalizedHandoffId: handoffTransition.value.nextAggregate.handoffId,
    },
  });
  if (!conversationTransition.ok) {
    return workflowFailure(conversationTransition.error);
  }

  return successorWorkflowSuccess(
    handoffTransition.value.nextAggregate,
    successorTransition.value.nextAggregate,
    conversationTransition.value.nextAggregate,
    [
      ...handoffTransition.value.events,
      ...successorTransition.value.events,
      ...conversationTransition.value.events,
    ],
    [
      ...handoffTransition.value.transitionRecords,
      ...successorTransition.value.transitionRecords,
      ...conversationTransition.value.transitionRecords,
    ],
  );
};
