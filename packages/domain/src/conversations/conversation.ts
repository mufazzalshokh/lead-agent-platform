import {
  AggregateVersionSchema,
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  DomainEventPayloadSchemas,
  HandoffIdSchema,
  LeadIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type AggregateVersion,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type DomainEventPayloadByName,
  type HandoffId,
  type LeadId,
  type OrganizationId,
} from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";

const ConversationStatusSchema =
  DomainEventPayloadSchemas["conversation.status_changed"].properties.conversation_status;

export type ConversationStatus =
  DomainEventPayloadByName["conversation.status_changed"]["conversation_status"];

export type ConversationAutomationMode = "ai" | "paused" | "staff";

export type ActiveConversationHandoffStatus = "requested" | "assigned" | "in_progress";

export type ConversationHandoffReference = Readonly<{
  handoffId: HandoffId;
  organizationId: OrganizationId;
  status: ActiveConversationHandoffStatus;
}>;

export type Conversation = Readonly<{
  activeHandoff: ConversationHandoffReference | null;
  automationMode: ConversationAutomationMode;
  channelConnectionId: ChannelConnectionId;
  contactId: ContactId;
  conversationId: ConversationId;
  leadId: LeadId;
  organizationId: OrganizationId;
  status: ConversationStatus;
  version: AggregateVersion;
}>;

export type InvalidConversation = InvariantViolation<"invalid_conversation">;

const AUTOMATION_MODES = ["ai", "paused", "staff"] as const;
const ACTIVE_HANDOFF_STATUSES = ["requested", "assigned", "in_progress"] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isConversationStatus = (value: unknown): value is ConversationStatus =>
  isSchemaValue(ConversationStatusSchema, value);

export const isConversationAutomationMode = (value: unknown): value is ConversationAutomationMode =>
  AUTOMATION_MODES.some((automationMode) => automationMode === value);

export const isActiveConversationHandoffStatus = (
  value: unknown,
): value is ActiveConversationHandoffStatus =>
  ACTIVE_HANDOFF_STATUSES.some((status) => status === value);

const isValidHandoffReference = (
  value: unknown,
  organizationId: OrganizationId,
): value is ConversationHandoffReference =>
  isRecord(value) &&
  isSchemaValue(HandoffIdSchema, value["handoffId"]) &&
  isSchemaValue(OrganizationIdSchema, value["organizationId"]) &&
  value["organizationId"] === organizationId &&
  isActiveConversationHandoffStatus(value["status"]);

const hasConsistentLifecycleShape = (conversation: Conversation): boolean => {
  const handoff = conversation.activeHandoff;

  switch (conversation.status) {
    case "open":
      return conversation.automationMode === "ai" && handoff === null;
    case "awaiting_lead":
      return (
        (conversation.automationMode === "ai" && handoff === null) ||
        (conversation.automationMode === "staff" &&
          handoff !== null &&
          (handoff.status === "assigned" || handoff.status === "in_progress"))
      );
    case "awaiting_staff":
      return (
        (conversation.automationMode === "paused" && handoff?.status === "requested") ||
        (conversation.automationMode === "staff" &&
          handoff !== null &&
          (handoff.status === "assigned" || handoff.status === "in_progress"))
      );
    case "resolved":
    case "closed":
      return conversation.automationMode === "paused" && handoff === null;
  }
};

export const validateConversation = (
  conversation: Conversation,
): Result<Conversation, InvalidConversation> => {
  if (
    !isRecord(conversation) ||
    !isSchemaValue(ConversationIdSchema, conversation["conversationId"]) ||
    !isSchemaValue(OrganizationIdSchema, conversation["organizationId"]) ||
    !isSchemaValue(ChannelConnectionIdSchema, conversation["channelConnectionId"]) ||
    !isSchemaValue(ContactIdSchema, conversation["contactId"]) ||
    !isSchemaValue(LeadIdSchema, conversation["leadId"]) ||
    !isConversationStatus(conversation["status"]) ||
    !isConversationAutomationMode(conversation["automationMode"]) ||
    !isSchemaValue(AggregateVersionSchema, conversation["version"])
  ) {
    return failure(invariantViolation("invalid_conversation"));
  }

  const handoffIsValid =
    conversation.activeHandoff === null ||
    isValidHandoffReference(conversation.activeHandoff, conversation.organizationId);

  if (!handoffIsValid || !hasConsistentLifecycleShape(conversation)) {
    return failure(invariantViolation("invalid_conversation"));
  }

  return success(conversation);
};
