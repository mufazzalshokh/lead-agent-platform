import { createHash } from "node:crypto";
import {
  StaffWorkItemSchema,
  StaffWorkListQuerySchema,
  StaffWorkParamsSchema,
  StaffAcceptAppointmentInputSchema,
  StaffRejectAppointmentInputSchema,
  StaffClaimHandoffInputSchema,
  StaffResolveHandoffInputSchema,
  StaffAcknowledgeInputSchema,
  StaffAttendanceInputSchema,
  StaffRevenueInputSchema,
  ConfigurationIdempotencyKeySchema,
  ResourceVersionSchema,
  UtcTimestampSchema,
  ResourceIdSchema,
  isSchemaValue,
  type StaffWorkItem,
  type StaffWorkListQuery,
  type StaffMutationResult,
  type StaffOutcome,
  type StaffAcceptAppointmentInput,
  type StaffRejectAppointmentInput,
  type StaffClaimHandoffInput,
  type StaffResolveHandoffInput,
  type StaffAttendanceInput,
  type StaffRevenueInput,
  type ResourceId,
  type OpaqueCursor,
  type UtcTimestamp,
} from "@lead-agent/contracts";
import {
  createSecurityIdentifierFactory,
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
  type TenantPermission,
} from "@lead-agent/security";
import type { PreparedIdempotency } from "../configuration/location-use-cases.js";
import type { StaffQueryCursorCodec } from "../conversations/staff-queries.js";
import { stableStaffQueryJson } from "../conversations/staff-queries.js";

export type StaffWorkKind = StaffWorkItem["kind"];
export type StaffOperation =
  | Readonly<{ action: "accept"; input: StaffAcceptAppointmentInput }>
  | Readonly<{ action: "reject"; input: StaffRejectAppointmentInput }>
  | Readonly<{ action: "claim"; input: StaffClaimHandoffInput }>
  | Readonly<{ action: "resolve"; input: StaffResolveHandoffInput }>
  | Readonly<{ action: "acknowledge"; input: Readonly<object> }>
  | Readonly<{ action: "attendance"; input: StaffAttendanceInput }>
  | Readonly<{ action: "revenue"; input: StaffRevenueInput }>;
export type StaffOperationCode =
  | "permission_denied"
  | "resource_not_found"
  | "validation_failed"
  | "version_conflict"
  | "idempotency_conflict"
  | "business_rule_failed";
export class StaffOperationError extends Error {
  constructor(public readonly code: StaffOperationCode) {
    super(code);
    this.name = "StaffOperationError";
  }
}
export type StaffPosition = Readonly<{ at: string; id: string }>;
export type StaffPreparedOperation = Readonly<{
  authorization: AuthorizationContext;
  kind: StaffWorkKind;
  id: ResourceId;
  expectedVersion: number;
  operation: StaffOperation;
  occurredAt: UtcTimestamp;
  requestId: string;
  correlationId: string;
  idempotency: PreparedIdempotency;
}>;
export interface StaffOperationsStore {
  list(
    input: Readonly<{
      authorization: AuthorizationContext;
      kind: StaffWorkKind;
      query: StaffWorkListQuery;
      after: StaffPosition | null;
      limit: number;
    }>,
  ): Promise<Readonly<{ items: readonly StaffWorkItem[]; next: StaffPosition | null }>>;
  get(
    input: Readonly<{ authorization: AuthorizationContext; kind: StaffWorkKind; id: ResourceId }>,
  ): Promise<StaffWorkItem>;
  outcomes(
    input: Readonly<{
      authorization: AuthorizationContext;
      id: ResourceId;
      kind: "attendance" | "revenue";
      after: StaffPosition | null;
      limit: number;
    }>,
  ): Promise<Readonly<{ items: readonly StaffOutcome[]; next: StaffPosition | null }>>;
  mutate(input: StaffPreparedOperation): Promise<StaffMutationResult>;
}
export const staffReadPermission = (kind: StaffWorkKind): TenantPermission =>
  kind === "appointment_request"
    ? "appointments.read"
    : kind === "handoff"
      ? "handoffs.read"
      : kind === "notification"
        ? "notifications.read"
        : "conversations.read";
export const staffMutationPermission = (operation: StaffOperation): TenantPermission =>
  operation.action === "claim" || operation.action === "resolve"
    ? "handoffs.manage"
    : operation.action === "acknowledge"
      ? "notifications.read"
      : operation.action === "attendance"
        ? "attendance.manage"
        : operation.action === "revenue"
          ? "revenue_attribution.manage"
          : "appointments.manage";
const requireAuthorization = (
  authorization: AuthorizationContext,
  permission: TenantPermission,
): void => {
  if (!isAuthorizationContext(authorization) || !hasPermission(authorization.role, permission))
    throw new StaffOperationError("permission_denied");
};
const digest = (value: string): Uint8Array => createHash("sha256").update(value).digest();
const timestamp = (value: Date): UtcTimestamp => {
  const text = value.toISOString();
  if (!isSchemaValue(UtcTimestampSchema, text)) throw new TypeError("Invalid staff timestamp");
  return text;
};
const schemas = {
  accept: StaffAcceptAppointmentInputSchema,
  reject: StaffRejectAppointmentInputSchema,
  claim: StaffClaimHandoffInputSchema,
  resolve: StaffResolveHandoffInputSchema,
  acknowledge: StaffAcknowledgeInputSchema,
  attendance: StaffAttendanceInputSchema,
  revenue: StaffRevenueInputSchema,
};
export const createStaffOperations = (
  store: StaffOperationsStore,
  cursor: StaffQueryCursorCodec,
  clock: () => Date = () => new Date(),
) => {
  const identifiers = createSecurityIdentifierFactory();
  const parseQuery = (query: StaffWorkListQuery) => {
    if (!isSchemaValue(StaffWorkListQuerySchema, query))
      throw new StaffOperationError("validation_failed");
  };
  const binding = (
    authorization: AuthorizationContext,
    kind: string,
    query: StaffWorkListQuery,
    id?: string,
  ) =>
    JSON.stringify([
      authorization.organizationId,
      authorization.membershipId,
      authorization.role,
      authorization.locationScope,
      [...authorization.allowedLocationIds].sort(),
      kind,
      query.view ?? "active",
      query.location_id ?? null,
      id ?? null,
    ]);
  const position = (
    value: OpaqueCursor | undefined,
    route: "staff_work" | "staff_outcomes",
    bound: string,
  ): StaffPosition | null => {
    if (value === undefined) return null;
    const decoded = cursor.decode(value, route, bound);
    if (
      decoded === null ||
      !isSchemaValue(UtcTimestampSchema, decoded["at"]) ||
      !isSchemaValue(ResourceIdSchema, decoded["id"])
    )
      throw new StaffOperationError("validation_failed");
    return { at: decoded["at"], id: decoded["id"] };
  };
  return Object.freeze({
    list: async (
      authorization: AuthorizationContext,
      kind: StaffWorkKind,
      query: StaffWorkListQuery,
    ) => {
      requireAuthorization(authorization, staffReadPermission(kind));
      parseQuery(query);
      const bound = binding(authorization, kind, query);
      const page = await store.list({
        authorization,
        kind,
        query,
        after: position(query.cursor, "staff_work", bound),
        limit: query.limit ?? 25,
      });
      if (!page.items.every((item) => isSchemaValue(StaffWorkItemSchema, item)))
        throw new TypeError("Invalid staff projection");
      return {
        items: page.items,
        nextCursor: page.next === null ? null : cursor.encode("staff_work", bound, page.next),
      };
    },
    get: async (authorization: AuthorizationContext, kind: StaffWorkKind, id: ResourceId) => {
      requireAuthorization(authorization, staffReadPermission(kind));
      if (!isSchemaValue(StaffWorkParamsSchema, { id }))
        throw new StaffOperationError("validation_failed");
      return store.get({ authorization, kind, id });
    },
    outcomes: async (
      authorization: AuthorizationContext,
      id: ResourceId,
      kind: "attendance" | "revenue",
      query: StaffWorkListQuery,
    ) => {
      requireAuthorization(authorization, "appointments.read");
      parseQuery(query);
      if (!isSchemaValue(ResourceIdSchema, id)) throw new StaffOperationError("validation_failed");
      const bound = binding(authorization, kind, query, id);
      const page = await store.outcomes({
        authorization,
        id,
        kind,
        after: position(query.cursor, "staff_outcomes", bound),
        limit: query.limit ?? 25,
      });
      return {
        items: page.items,
        nextCursor: page.next === null ? null : cursor.encode("staff_outcomes", bound, page.next),
      };
    },
    mutate: async (
      authorization: AuthorizationContext,
      kind: StaffWorkKind,
      id: ResourceId,
      expectedVersion: number,
      key: string,
      operation: StaffOperation,
      requestId: string,
      correlationId: string,
    ) => {
      requireAuthorization(authorization, staffMutationPermission(operation));
      const expectedKind =
        operation.action === "claim" || operation.action === "resolve"
          ? "handoff"
          : operation.action === "acknowledge"
            ? "notification"
            : "appointment_request";
      if (
        kind !== expectedKind ||
        !isSchemaValue(ResourceIdSchema, id) ||
        !isSchemaValue(ResourceVersionSchema, expectedVersion) ||
        !isSchemaValue(ConfigurationIdempotencyKeySchema, key) ||
        !isSchemaValue(schemas[operation.action], operation.input)
      )
        throw new StaffOperationError("validation_failed");
      const now = clock(),
        occurredAt = now.toISOString();
      if (!isSchemaValue(UtcTimestampSchema, occurredAt))
        throw new TypeError("Invalid staff operation clock");
      const scope = `s17:${kind}:${id}:${operation.action}`;
      const input: StaffPreparedOperation = {
        authorization,
        kind,
        id,
        expectedVersion,
        operation,
        occurredAt,
        requestId,
        correlationId,
        idempotency: {
          id: identifiers.issueResourceId(now),
          scope,
          keyHash: digest(key),
          principalIdHash: digest(authorization.userId),
          requestHash: digest(stableStaffQueryJson([id, expectedVersion, operation])),
          lockedUntil: timestamp(new Date(now.getTime() + 30_000)),
          expiresAt: timestamp(new Date(now.getTime() + 86_400_000)),
        },
      };
      return store.mutate({ ...input, correlationId: identifiers.issueResourceId(now) });
    },
  });
};
export type StaffOperations = ReturnType<typeof createStaffOperations>;
