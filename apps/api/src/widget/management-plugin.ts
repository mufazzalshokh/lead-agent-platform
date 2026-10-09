import type { WidgetManagementUseCases } from "@lead-agent/application";
import { OrganizationIdSchema, isSchemaValue } from "@lead-agent/contracts";
import {
  AuthorizationDeniedError,
  hasPermission,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type StaffWidgetManagementDependencies = Readonly<{
  useCases: WidgetManagementUseCases;
}>;

export type StaffWidgetManagementSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveMutationSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
  resolveReadSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

const statusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { enum: ["active", "not_configured"] },
    publishable_key: { type: "string", minLength: 43, maxLength: 43 },
    website_origin: { type: "string", maxLength: 2048 },
  },
} as const;

export const registerStaffWidgetManagement = (
  api: FastifyInstance,
  dependencies: StaffWidgetManagementDependencies,
  security: StaffWidgetManagementSecurityBoundary,
): void => {
  const contexts = new WeakMap<FastifyRequest, AuthorizationContext>();
  const authorize = async (
    request: FastifyRequest,
    reply: FastifyReply,
    mutation: boolean,
  ): Promise<void> => {
    const session = mutation
      ? await security.resolveMutationSession(request, reply)
      : await security.resolveReadSession(request, reply);
    const organization = request.headers["x-organization-context"];
    if (!isSchemaValue(OrganizationIdSchema, organization)) throw new AuthorizationDeniedError();
    const context = await resolveAuthorizationContext(
      session,
      organization,
      security.authorizationResolver,
    );
    if (!hasPermission(context.role, "integrations.manage")) throw new AuthorizationDeniedError();
    contexts.set(request, context);
  };
  const context = (request: FastifyRequest): AuthorizationContext => {
    const value = contexts.get(request);
    if (value === undefined) throw new AuthorizationDeniedError();
    return value;
  };

  api.get(
    "/v1/staff/integrations/widget",
    {
      preValidation: async (request, reply) => await authorize(request, reply, false),
      schema: { response: { 200: statusResponseSchema } },
    },
    async (request) => {
      const configured = await dependencies.useCases.get({ authorization: context(request) });
      return configured === null
        ? { status: "not_configured" as const }
        : {
            publishable_key: configured.publishableKey,
            status: "active" as const,
            website_origin: configured.websiteOrigin,
          };
    },
  );

  api.post<{ Body: { website_origin: string } }>(
    "/v1/staff/integrations/widget/setup",
    {
      preValidation: async (request, reply) => await authorize(request, reply, true),
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["website_origin"],
          properties: {
            website_origin: { type: "string", minLength: 9, maxLength: 2048 },
          },
        },
        response: { 201: statusResponseSchema },
      },
    },
    async (request, reply) => {
      const configured = await dependencies.useCases.configure({
        authorization: context(request),
        websiteOrigin: request.body.website_origin,
      });
      return reply.code(201).send({
        publishable_key: configured.publishableKey,
        status: "active",
        website_origin: configured.websiteOrigin,
      });
    },
  );
};
