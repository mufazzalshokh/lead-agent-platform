import { AnalyticsApplicationError, type TenantAnalytics } from "@lead-agent/application";
import {
  OrganizationIdSchema,
  RequestIdSchema,
  StaffAnalyticsQuerySchema,
  StaffAnalyticsResponseSchema,
  isSchemaValue,
  type StaffAnalyticsQuery,
} from "@lead-agent/contracts";
import {
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type StaffAnalyticsDependencies = Readonly<{ analytics: TenantAnalytics }>;
export type StaffAnalyticsSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveReadSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

const requestId = (request: FastifyRequest): string => {
  const supplied = request.headers["x-request-id"];
  if (isSchemaValue(RequestIdSchema, supplied)) return supplied;
  return `request:${request.id}`;
};

export const registerStaffAnalytics = (
  api: FastifyInstance,
  dependencies: StaffAnalyticsDependencies,
  security: StaffAnalyticsSecurityBoundary,
): void => {
  api.get<{ Querystring: StaffAnalyticsQuery }>(
    "/v1/staff/analytics",
    {
      schema: {
        querystring: StaffAnalyticsQuerySchema,
        response: { 200: StaffAnalyticsResponseSchema },
      },
    },
    async (request, reply) => {
      const organization = request.headers["x-organization-context"];
      if (!isSchemaValue(OrganizationIdSchema, organization))
        throw new AnalyticsApplicationError("permission_denied");
      const authorization = await resolveAuthorizationContext(
        await security.resolveReadSession(request, reply),
        organization,
        security.authorizationResolver,
      );
      reply.header("cache-control", "private, no-store");
      return {
        data: await dependencies.analytics.read(authorization, request.query),
        meta: { request_id: requestId(request) },
      };
    },
  );
};
