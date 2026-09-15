import type {
  StaffConversationQueryUseCases,
  StaffQueryFailureCode,
  StaffQueryResult,
} from "@lead-agent/application";
import {
  OrganizationIdSchema,
  RequestIdSchema,
  StaffContactReadParamsSchema,
  StaffContactResponseSchema,
  StaffConversationCollectionResponseSchema,
  StaffConversationListQuerySchema,
  StaffConversationReadParamsSchema,
  StaffConversationResponseSchema,
  StaffLeadCollectionResponseSchema,
  StaffLeadListQuerySchema,
  StaffLeadReadParamsSchema,
  StaffLeadResponseSchema,
  StaffMessageCollectionResponseSchema,
  StaffMessageListQuerySchema,
  isSchemaValue,
  type OrganizationId,
  type RequestId,
  type StaffContactReadParams,
  type StaffConversationListQuery,
  type StaffConversationReadParams,
  type StaffLeadListQuery,
  type StaffLeadReadParams,
  type StaffMessageListQuery,
} from "@lead-agent/contracts";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const ORGANIZATION_HEADER = "x-organization-context";

export type StaffConversationDependencies = Readonly<{
  queries: StaffConversationQueryUseCases;
}>;

export type StaffConversationSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveReadSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

export class StaffConversationHttpError extends Error {
  public constructor(public readonly code: StaffQueryFailureCode) {
    super(code);
    this.name = "StaffConversationHttpError";
  }
}

const requireOrganization = (request: FastifyRequest): OrganizationId => {
  const value = request.headers[ORGANIZATION_HEADER];
  if (!isSchemaValue(OrganizationIdSchema, value)) {
    throw new StaffConversationHttpError("permission_denied");
  }
  return value;
};

const publicRequestId = (request: FastifyRequest): RequestId => {
  const supplied = request.headers["x-request-id"];
  if (typeof supplied === "string" && isSchemaValue(RequestIdSchema, supplied)) return supplied;
  const generated = `request:${request.id}`;
  if (!isSchemaValue(RequestIdSchema, generated)) throw new TypeError("Invalid request identifier");
  return generated;
};

const requireValue = <Value>(result: StaffQueryResult<Value>): Value => {
  if (!result.ok) throw new StaffConversationHttpError(result.error.code);
  return result.value;
};

const pageMeta = (request: FastifyRequest, nextCursor: string | null) =>
  nextCursor === null
    ? { has_more: false as const, next_cursor: null, request_id: publicRequestId(request) }
    : { has_more: true as const, next_cursor: nextCursor, request_id: publicRequestId(request) };

const authorize = async (
  request: FastifyRequest,
  reply: FastifyReply,
  security: StaffConversationSecurityBoundary,
) =>
  resolveAuthorizationContext(
    await security.resolveReadSession(request, reply),
    requireOrganization(request),
    security.authorizationResolver,
  );

export const registerStaffConversationQueries = (
  api: FastifyInstance,
  dependencies: StaffConversationDependencies,
  security: StaffConversationSecurityBoundary,
): void => {
  api.get<{ Params: StaffContactReadParams }>(
    "/v1/staff/contacts/:id",
    {
      schema: {
        params: StaffContactReadParamsSchema,
        response: { 200: StaffContactResponseSchema },
      },
    },
    async (request, reply) => ({
      data: requireValue(
        await dependencies.queries.getContact({
          authorization: await authorize(request, reply, security),
          input: request.params,
        }),
      ),
      meta: { request_id: publicRequestId(request) },
    }),
  );

  api.get<{ Querystring: StaffLeadListQuery }>(
    "/v1/staff/leads",
    {
      schema: {
        querystring: StaffLeadListQuerySchema,
        response: { 200: StaffLeadCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireValue(
        await dependencies.queries.listLeads({
          authorization: await authorize(request, reply, security),
          input: request.query,
        }),
      );
      return { data: page.items, meta: pageMeta(request, page.nextCursor) };
    },
  );

  api.get<{ Params: StaffLeadReadParams }>(
    "/v1/staff/leads/:id",
    { schema: { params: StaffLeadReadParamsSchema, response: { 200: StaffLeadResponseSchema } } },
    async (request, reply) => ({
      data: requireValue(
        await dependencies.queries.getLead({
          authorization: await authorize(request, reply, security),
          input: request.params,
        }),
      ),
      meta: { request_id: publicRequestId(request) },
    }),
  );

  api.get<{ Querystring: StaffConversationListQuery }>(
    "/v1/staff/conversations",
    {
      schema: {
        querystring: StaffConversationListQuerySchema,
        response: { 200: StaffConversationCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireValue(
        await dependencies.queries.listConversations({
          authorization: await authorize(request, reply, security),
          input: request.query,
        }),
      );
      return { data: page.items, meta: pageMeta(request, page.nextCursor) };
    },
  );

  api.get<{ Params: StaffConversationReadParams }>(
    "/v1/staff/conversations/:id",
    {
      schema: {
        params: StaffConversationReadParamsSchema,
        response: { 200: StaffConversationResponseSchema },
      },
    },
    async (request, reply) => ({
      data: requireValue(
        await dependencies.queries.getConversation({
          authorization: await authorize(request, reply, security),
          input: request.params,
        }),
      ),
      meta: { request_id: publicRequestId(request) },
    }),
  );

  api.get<{ Params: StaffConversationReadParams; Querystring: StaffMessageListQuery }>(
    "/v1/staff/conversations/:id/messages",
    {
      schema: {
        params: StaffConversationReadParamsSchema,
        querystring: StaffMessageListQuerySchema,
        response: { 200: StaffMessageCollectionResponseSchema },
      },
    },
    async (request, reply) => {
      const page = requireValue(
        await dependencies.queries.listMessages({
          authorization: await authorize(request, reply, security),
          conversationId: request.params.id,
          input: request.query,
        }),
      );
      return { data: page.items, meta: pageMeta(request, page.nextCursor) };
    },
  );
};
