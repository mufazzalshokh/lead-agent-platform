import {
  StaffOperationError,
  ThreadAutomationControlError,
  type ThreadAutomationControlUseCases,
  type StaffOperations,
  type StaffWorkKind,
  type StaffOperation,
} from "@lead-agent/application";
import {
  StaffWorkListQuerySchema,
  StaffWorkParamsSchema,
  StaffWorkResponseSchema,
  StaffWorkCollectionResponseSchema,
  StaffAcceptAppointmentInputSchema,
  StaffRejectAppointmentInputSchema,
  StaffClaimHandoffInputSchema,
  StaffResolveHandoffInputSchema,
  StaffAcknowledgeInputSchema,
  StaffAttendanceInputSchema,
  StaffRevenueInputSchema,
  StaffMutationResponseSchema,
  StaffOutcomeCollectionResponseSchema,
  ThreadAutomationControlParamsSchema,
  ThreadAutomationControlResponseSchema,
  ThreadAutomationTransitionInputSchema,
  OrganizationIdSchema,
  RequestIdSchema,
  isSchemaValue,
  type StaffWorkListQuery,
  type ResourceId,
  type ThreadAutomationTransitionInput,
} from "@lead-agent/contracts";
import { resolveAuthorizationContext } from "@lead-agent/security";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  formatConfigurationEtag,
  parseConfigurationIfMatch,
  type StaffConfigurationSecurityBoundary,
} from "../configuration/plugin.js";

export type StaffOperationsDependencies = Readonly<{
  operations: StaffOperations;
  threadAutomation?: ThreadAutomationControlUseCases;
}>;
const requestId = (request: FastifyRequest): string => {
  const supplied = request.headers["x-request-id"];
  if (isSchemaValue(RequestIdSchema, supplied)) return supplied;
  return `request:${request.id}`;
};
export const registerStaffOperations = (
  api: FastifyInstance,
  dependencies: StaffOperationsDependencies,
  security: StaffConfigurationSecurityBoundary,
): void => {
  const authorize = async (request: FastifyRequest, reply: FastifyReply, mutation = false) => {
    const session = await (mutation
      ? security.resolveMutationSession(request, reply)
      : security.resolveReadSession(request, reply));
    const organization = request.headers["x-organization-context"];
    if (!isSchemaValue(OrganizationIdSchema, organization))
      throw new StaffOperationError("permission_denied");
    reply.header("cache-control", "no-store");
    return resolveAuthorizationContext(session, organization, security.authorizationResolver);
  };
  const resources: readonly (readonly [string, StaffWorkKind])[] = [
    ["inbox", "conversation"],
    ["handoffs", "handoff"],
    ["appointment-requests", "appointment_request"],
    ["notifications", "notification"],
  ];
  for (const [path, kind] of resources) {
    api.get<{ Querystring: StaffWorkListQuery }>(
      `/v1/staff/${path}`,
      {
        schema: {
          querystring: StaffWorkListQuerySchema,
          response: { 200: StaffWorkCollectionResponseSchema },
        },
      },
      async (request, reply) => {
        const page = await dependencies.operations.list(
          await authorize(request, reply),
          kind,
          request.query,
        );
        return {
          data: page.items,
          meta: {
            request_id: requestId(request),
            has_more: page.nextCursor !== null,
            next_cursor: page.nextCursor,
          },
        };
      },
    );
    // Conversation detail remains the existing V1/V2 S9/S11 reader; no identity version is changed here.
    if (kind === "conversation") continue;
    api.get<{ Params: { id: ResourceId } }>(
      `/v1/staff/${path}/:id`,
      { schema: { params: StaffWorkParamsSchema, response: { 200: StaffWorkResponseSchema } } },
      async (request, reply) => {
        const value = await dependencies.operations.get(
          await authorize(request, reply),
          kind,
          request.params.id,
        );
        reply.header("etag", formatConfigurationEtag(value.id, value.version));
        return { data: value, meta: { request_id: requestId(request) } };
      },
    );
  }
  const mutations = [
    ["appointment-requests", "appointment_request", "accept", StaffAcceptAppointmentInputSchema],
    ["appointment-requests", "appointment_request", "reject", StaffRejectAppointmentInputSchema],
    ["handoffs", "handoff", "claim", StaffClaimHandoffInputSchema],
    ["handoffs", "handoff", "resolve", StaffResolveHandoffInputSchema],
    ["notifications", "notification", "acknowledge", StaffAcknowledgeInputSchema],
    ["appointment-requests", "appointment_request", "attendance", StaffAttendanceInputSchema],
    [
      "appointment-requests",
      "appointment_request",
      "revenue-attributions",
      StaffRevenueInputSchema,
    ],
  ] as const;
  for (const [path, kind, route, schema] of mutations) {
    api.post<{ Params: { id: ResourceId }; Body: unknown }>(
      `/v1/staff/${path}/:id/${route}`,
      {
        schema: {
          params: StaffWorkParamsSchema,
          body: schema,
          response: { 200: StaffMutationResponseSchema, 202: StaffMutationResponseSchema },
        },
      },
      async (request, reply) => {
        const authorization = await authorize(request, reply, true),
          id = request.params.id;
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string") throw new StaffOperationError("validation_failed");
        const expected = parseConfigurationIfMatch(request.headers["if-match"], id);
        const action = route === "revenue-attributions" ? "revenue" : route;
        let operation: StaffOperation;
        // Narrow each validated input rather than casting untrusted JSON into a protected command.
        if (action === "accept" && isSchemaValue(StaffAcceptAppointmentInputSchema, request.body))
          operation = { action, input: request.body };
        else if (
          action === "reject" &&
          isSchemaValue(StaffRejectAppointmentInputSchema, request.body)
        )
          operation = { action, input: request.body };
        else if (action === "claim" && isSchemaValue(StaffClaimHandoffInputSchema, request.body))
          operation = { action, input: request.body };
        else if (
          action === "resolve" &&
          isSchemaValue(StaffResolveHandoffInputSchema, request.body)
        )
          operation = { action, input: request.body };
        else if (
          action === "acknowledge" &&
          isSchemaValue(StaffAcknowledgeInputSchema, request.body)
        )
          operation = { action, input: request.body };
        else if (action === "attendance" && isSchemaValue(StaffAttendanceInputSchema, request.body))
          operation = { action, input: request.body };
        else if (action === "revenue" && isSchemaValue(StaffRevenueInputSchema, request.body))
          operation = { action, input: request.body };
        else throw new StaffOperationError("validation_failed");
        const result = await dependencies.operations.mutate(
          authorization,
          kind,
          id,
          expected,
          key,
          operation,
          requestId(request),
          requestId(request),
        );
        reply.header("etag", formatConfigurationEtag(result.resource.id, result.resource.version));
        reply.code(action === "accept" ? 202 : 200);
        return { data: result, meta: { request_id: requestId(request) } };
      },
    );
  }
  for (const [path, kind] of [
    ["attendance", "attendance"],
    ["revenue-attributions", "revenue"],
  ] as const) {
    api.get<{ Params: { id: ResourceId }; Querystring: StaffWorkListQuery }>(
      `/v1/staff/appointment-requests/:id/${path}`,
      {
        schema: {
          params: StaffWorkParamsSchema,
          querystring: StaffWorkListQuerySchema,
          response: { 200: StaffOutcomeCollectionResponseSchema },
        },
      },
      async (request, reply) => {
        const page = await dependencies.operations.outcomes(
          await authorize(request, reply),
          request.params.id,
          kind,
          request.query,
        );
        return {
          data: page.items,
          meta: {
            request_id: requestId(request),
            has_more: page.nextCursor !== null,
            next_cursor: page.nextCursor,
          },
        };
      },
    );
  }

  if (dependencies.threadAutomation !== undefined) {
    const controls = dependencies.threadAutomation;
    api.get<{ Params: { id: ResourceId } }>(
      "/v1/staff/thread-automation-controls/:id",
      {
        schema: {
          params: ThreadAutomationControlParamsSchema,
          response: { 200: ThreadAutomationControlResponseSchema },
        },
      },
      async (request, reply) => {
        const value = await controls.get(await authorize(request, reply), request.params.id);
        reply.header("etag", formatConfigurationEtag(value.id, value.version));
        return { data: value, meta: { request_id: requestId(request) } };
      },
    );
    api.post<{ Params: { id: ResourceId }; Body: ThreadAutomationTransitionInput }>(
      "/v1/staff/thread-automation-controls/:id/transition",
      {
        schema: {
          params: ThreadAutomationControlParamsSchema,
          body: ThreadAutomationTransitionInputSchema,
          response: { 200: ThreadAutomationControlResponseSchema },
        },
      },
      async (request, reply) => {
        const id = request.params.id;
        if (!isSchemaValue(ThreadAutomationTransitionInputSchema, request.body)) {
          throw new ThreadAutomationControlError("validation_failed");
        }
        const value = await controls.transition(
          await authorize(request, reply, true),
          id,
          parseConfigurationIfMatch(request.headers["if-match"], id),
          request.body,
          requestId(request),
        );
        reply.header("etag", formatConfigurationEtag(value.id, value.version));
        return { data: value, meta: { request_id: requestId(request) } };
      },
    );
  }
};
