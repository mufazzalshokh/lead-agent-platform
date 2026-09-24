import {
  CorrelationIdSchema,
  RequestIdSchema,
  ResourceIdSchema,
  ResourceVersionSchema,
  ThreadAutomationControlSchema,
  ThreadAutomationTransitionInputSchema,
  UtcTimestampSchema,
  isSchemaValue,
  type ChannelConnectionId,
  type CorrelationId,
  type OrganizationId,
  type RequestId,
  type ResourceId,
  type ThreadAutomationControl,
  type ThreadAutomationEligibilityState,
  type ThreadAutomationTransitionInput,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  createSecurityIdentifierFactory,
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";

export type SocialInboundChannel = "instagram" | "telegram";

type ThreadAutomationInboundContext = Readonly<{
  channelConnectionId: ChannelConnectionId;
  organizationId: OrganizationId;
}>;

export type InboundEligibilityDecision = Readonly<{
  controlId: ResourceId;
  state: ThreadAutomationEligibilityState;
  version: number;
}>;

export interface ThreadAutomationEligibilityStore {
  resolveInbound(
    input: Readonly<{
      channel: SocialInboundChannel;
      context: ThreadAutomationInboundContext;
      occurredAt: UtcTimestamp;
      threadHash: Uint8Array;
    }>,
  ): Promise<InboundEligibilityDecision>;
}

export type PreparedThreadAutomationTransition = Readonly<{
  authorization: AuthorizationContext;
  controlId: ResourceId;
  correlationId: CorrelationId;
  expectedVersion: number;
  input: ThreadAutomationTransitionInput;
  occurredAt: UtcTimestamp;
  requestId: RequestId;
}>;

export interface ThreadAutomationControlStore extends ThreadAutomationEligibilityStore {
  get(authorization: AuthorizationContext, controlId: ResourceId): Promise<ThreadAutomationControl>;
  transition(input: PreparedThreadAutomationTransition): Promise<ThreadAutomationControl>;
}

export type ThreadAutomationControlErrorCode =
  "permission_denied" | "resource_not_found" | "validation_failed" | "version_conflict";

export class ThreadAutomationControlError extends Error {
  constructor(public readonly code: ThreadAutomationControlErrorCode) {
    super(code);
    this.name = "ThreadAutomationControlError";
  }
}

export type ThreadAutomationControlUseCases = Readonly<{
  get(authorization: AuthorizationContext, controlId: ResourceId): Promise<ThreadAutomationControl>;
  transition(
    authorization: AuthorizationContext,
    controlId: ResourceId,
    expectedVersion: number,
    input: ThreadAutomationTransitionInput,
    requestId: string,
  ): Promise<ThreadAutomationControl>;
}>;

const requirePermission = (
  authorization: AuthorizationContext,
  permission: "conversations.manage" | "conversations.read",
): void => {
  if (!isAuthorizationContext(authorization) || !hasPermission(authorization.role, permission)) {
    throw new ThreadAutomationControlError("permission_denied");
  }
};

export const createThreadAutomationControlUseCases = (
  store: ThreadAutomationControlStore,
  clock: () => Date = () => new Date(),
): ThreadAutomationControlUseCases => {
  const identifiers = createSecurityIdentifierFactory();
  return Object.freeze({
    get: async (authorization, controlId) => {
      requirePermission(authorization, "conversations.read");
      if (!isSchemaValue(ResourceIdSchema, controlId)) {
        throw new ThreadAutomationControlError("validation_failed");
      }
      const value = await store.get(authorization, controlId);
      if (!isSchemaValue(ThreadAutomationControlSchema, value)) {
        throw new TypeError("Invalid thread automation control");
      }
      return value;
    },
    transition: async (authorization, controlId, expectedVersion, input, requestId) => {
      requirePermission(authorization, "conversations.manage");
      if (
        !isSchemaValue(ResourceIdSchema, controlId) ||
        !isSchemaValue(ResourceVersionSchema, expectedVersion) ||
        !isSchemaValue(ThreadAutomationTransitionInputSchema, input) ||
        !isSchemaValue(RequestIdSchema, requestId)
      ) {
        throw new ThreadAutomationControlError("validation_failed");
      }
      const now = clock();
      const occurredAt = now.toISOString();
      const correlationId: unknown = identifiers.issueResourceId(now);
      if (!isSchemaValue(UtcTimestampSchema, occurredAt)) {
        throw new TypeError("Invalid thread automation transition clock");
      }
      if (!isSchemaValue(CorrelationIdSchema, correlationId)) {
        throw new TypeError("Invalid thread automation transition correlation identifier");
      }
      const value = await store.transition({
        authorization,
        controlId,
        correlationId,
        expectedVersion,
        input,
        occurredAt,
        requestId,
      });
      if (!isSchemaValue(ThreadAutomationControlSchema, value)) {
        throw new TypeError("Invalid thread automation control");
      }
      return value;
    },
  });
};

export type ThreadAutomationControlKey = Readonly<{
  channelConnectionId: ChannelConnectionId;
  organizationId: OrganizationId;
  threadHash: Uint8Array;
}>;
