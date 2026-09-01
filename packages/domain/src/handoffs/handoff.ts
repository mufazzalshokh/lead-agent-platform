import {
  AggregateVersionSchema,
  ConversationIdSchema,
  DomainEventPayloadSchemas,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  OrganizationIdSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type AggregateVersion,
  type ConversationId,
  type DomainEventPayloadByName,
  type HandoffId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type OrganizationId,
  type UtcTimestamp,
} from "@lead-agent/contracts";

import { invariantViolation, type InvariantViolation } from "../foundation/errors.js";
import { failure, success, type Result } from "../foundation/result.js";
import { compareUtcTimestamps } from "../values/time.js";

const HandoffStatusSchema =
  DomainEventPayloadSchemas["handoff.cancelled"].properties.previous_handoff_status;
const HandoffTriggerReasonSchema =
  DomainEventPayloadSchemas["handoff.requested"].properties.trigger_reason;
const HandoffReasonCodeSchema =
  DomainEventPayloadSchemas["handoff.cancelled"].properties.reason_code;
const HandoffResolutionCodeSchema =
  DomainEventPayloadSchemas["handoff.resolved"].properties.resolution_code;

const BOUNDED_CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MAX_BOUNDED_CODE_LENGTH = 100;

declare const handoffQueueKeyBrand: unique symbol;
declare const handoffReasonCodeBrand: unique symbol;
declare const handoffResolutionCodeBrand: unique symbol;

export type HandoffStatus =
  DomainEventPayloadByName["handoff.cancelled"]["previous_handoff_status"];
export type ActiveHandoffStatus = Extract<HandoffStatus, "assigned" | "in_progress" | "requested">;
export type TerminalHandoffStatus = Exclude<HandoffStatus, ActiveHandoffStatus>;
export type HandoffTriggerReason = DomainEventPayloadByName["handoff.requested"]["trigger_reason"];
export type HandoffQueueKey = string & {
  readonly [handoffQueueKeyBrand]: "HandoffQueueKey";
};
export type HandoffReasonCode = string & {
  readonly [handoffReasonCodeBrand]: "HandoffReasonCode";
};
export type HandoffResolutionCode = string & {
  readonly [handoffResolutionCodeBrand]: "HandoffResolutionCode";
};

export type Handoff = Readonly<{
  assignedAt: UtcTimestamp | null;
  assignedMembershipId: MembershipId | null;
  conversationId: ConversationId;
  handoffId: HandoffId;
  leadId: LeadId;
  locationId: LocationId | null;
  organizationId: OrganizationId;
  queueKey: HandoffQueueKey;
  requestedAt: UtcTimestamp;
  resolutionCode: HandoffResolutionCode | null;
  resolvedAt: UtcTimestamp | null;
  slaDueAt: UtcTimestamp;
  startedAt: UtcTimestamp | null;
  status: HandoffStatus;
  triggerReason: HandoffTriggerReason;
  version: AggregateVersion;
}>;

export type InvalidHandoff = InvariantViolation<"invalid_handoff">;
export type InvalidHandoffReasonCode = InvariantViolation<"invalid_reason_code">;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedCode = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= MAX_BOUNDED_CODE_LENGTH &&
  BOUNDED_CODE_PATTERN.test(value);

const isBefore = (left: UtcTimestamp, right: UtcTimestamp): boolean => {
  const comparison = compareUtcTimestamps(left, right);
  return comparison.ok && comparison.value < 0;
};

const isSameOrAfter = (value: UtcTimestamp, boundary: UtcTimestamp): boolean => {
  const comparison = compareUtcTimestamps(value, boundary);
  return comparison.ok && comparison.value >= 0;
};

const hasOrderedLifecycle = (handoff: Handoff): boolean => {
  if (!isBefore(handoff.requestedAt, handoff.slaDueAt)) {
    return false;
  }

  if (handoff.assignedAt !== null && !isSameOrAfter(handoff.assignedAt, handoff.requestedAt)) {
    return false;
  }

  if (
    handoff.startedAt !== null &&
    (handoff.assignedAt === null || !isSameOrAfter(handoff.startedAt, handoff.assignedAt))
  ) {
    return false;
  }

  return (
    handoff.resolvedAt === null ||
    (handoff.startedAt !== null && isSameOrAfter(handoff.resolvedAt, handoff.startedAt))
  );
};

const hasConsistentLifecycleShape = (handoff: Handoff): boolean => {
  switch (handoff.status) {
    case "requested":
      return (
        handoff.assignedMembershipId === null &&
        handoff.assignedAt === null &&
        handoff.startedAt === null &&
        handoff.resolvedAt === null &&
        handoff.resolutionCode === null
      );
    case "assigned":
      return (
        handoff.assignedMembershipId !== null &&
        handoff.assignedAt !== null &&
        handoff.startedAt === null &&
        handoff.resolvedAt === null &&
        handoff.resolutionCode === null
      );
    case "in_progress":
      return (
        handoff.assignedMembershipId !== null &&
        handoff.assignedAt !== null &&
        handoff.startedAt !== null &&
        handoff.resolvedAt === null &&
        handoff.resolutionCode === null
      );
    case "resolved":
      return (
        handoff.assignedMembershipId !== null &&
        handoff.assignedAt !== null &&
        handoff.startedAt !== null &&
        handoff.resolvedAt !== null &&
        handoff.resolutionCode !== null
      );
    case "cancelled":
    case "expired":
      return (
        handoff.resolvedAt === null &&
        handoff.resolutionCode === null &&
        ((handoff.assignedMembershipId === null &&
          handoff.assignedAt === null &&
          handoff.startedAt === null) ||
          (handoff.assignedMembershipId !== null && handoff.assignedAt !== null))
      );
  }
};

export const isHandoffStatus = (value: unknown): value is HandoffStatus =>
  isSchemaValue(HandoffStatusSchema, value);

export const isActiveHandoffStatus = (value: unknown): value is ActiveHandoffStatus =>
  value === "requested" || value === "assigned" || value === "in_progress";

export const isTerminalHandoffStatus = (value: unknown): value is TerminalHandoffStatus =>
  value === "resolved" || value === "cancelled" || value === "expired";

export const isHandoffTriggerReason = (value: unknown): value is HandoffTriggerReason =>
  isSchemaValue(HandoffTriggerReasonSchema, value);

export const isHandoffQueueKey = (value: unknown): value is HandoffQueueKey => isBoundedCode(value);

export const validateHandoffQueueKey = (value: unknown): Result<HandoffQueueKey, InvalidHandoff> =>
  isHandoffQueueKey(value) ? success(value) : failure(invariantViolation("invalid_handoff"));

export const isHandoffReasonCode = (value: unknown): value is HandoffReasonCode =>
  isSchemaValue(HandoffReasonCodeSchema, value);

export const validateHandoffReasonCode = (
  value: unknown,
): Result<HandoffReasonCode, InvalidHandoffReasonCode> =>
  isHandoffReasonCode(value) ? success(value) : failure(invariantViolation("invalid_reason_code"));

export const isHandoffResolutionCode = (value: unknown): value is HandoffResolutionCode =>
  isSchemaValue(HandoffResolutionCodeSchema, value);

export const validateHandoffResolutionCode = (
  value: unknown,
): Result<HandoffResolutionCode, InvalidHandoffReasonCode> =>
  isHandoffResolutionCode(value)
    ? success(value)
    : failure(invariantViolation("invalid_reason_code"));

export const validateHandoff = (handoff: Handoff): Result<Handoff, InvalidHandoff> => {
  if (
    !isRecord(handoff) ||
    !isSchemaValue(HandoffIdSchema, handoff["handoffId"]) ||
    !isSchemaValue(OrganizationIdSchema, handoff["organizationId"]) ||
    !isSchemaValue(ConversationIdSchema, handoff["conversationId"]) ||
    !isSchemaValue(LeadIdSchema, handoff["leadId"]) ||
    (handoff["locationId"] !== null && !isSchemaValue(LocationIdSchema, handoff["locationId"])) ||
    (handoff["assignedMembershipId"] !== null &&
      !isSchemaValue(MembershipIdSchema, handoff["assignedMembershipId"])) ||
    !isHandoffQueueKey(handoff["queueKey"]) ||
    !isSchemaValue(UtcTimestampSchema, handoff["requestedAt"]) ||
    !isSchemaValue(UtcTimestampSchema, handoff["slaDueAt"]) ||
    (handoff["assignedAt"] !== null && !isSchemaValue(UtcTimestampSchema, handoff["assignedAt"])) ||
    (handoff["startedAt"] !== null && !isSchemaValue(UtcTimestampSchema, handoff["startedAt"])) ||
    (handoff["resolvedAt"] !== null && !isSchemaValue(UtcTimestampSchema, handoff["resolvedAt"])) ||
    !isHandoffStatus(handoff["status"]) ||
    !isHandoffTriggerReason(handoff["triggerReason"]) ||
    (handoff["resolutionCode"] !== null && !isHandoffResolutionCode(handoff["resolutionCode"])) ||
    !isSchemaValue(AggregateVersionSchema, handoff["version"]) ||
    !hasOrderedLifecycle(handoff) ||
    !hasConsistentLifecycleShape(handoff)
  ) {
    return failure(invariantViolation("invalid_handoff"));
  }

  return success(handoff);
};
