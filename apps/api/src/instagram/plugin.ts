import {
  InstagramApplicationError,
  InstagramProviderError,
  type InstagramBusinessUseCases,
} from "@lead-agent/application";
import {
  ChannelConnectionIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
} from "@lead-agent/contracts";
import {
  normalizeInstagramWebhook,
  verifyInstagramWebhookChallenge,
  verifyInstagramWebhookSignature,
  INSTAGRAM_WEBHOOK_MAXIMUM_BYTES,
} from "@lead-agent/integrations";
import {
  AuthorizationDeniedError,
  hasPermission,
  resolveAuthorizationContext,
  type AuthorizationContext,
  type AuthenticatedApplicationSession,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type StaffInstagramSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveMutationSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

export type StaffInstagramDependencies = Readonly<{
  useCases: Pick<InstagramBusinessUseCases, "beginOnboarding" | "disconnect">;
}>;
export type InstagramWebhookDependencies = Readonly<{
  appSecret: string;
  webhookVerifyToken: string;
  useCases: Pick<InstagramBusinessUseCases, "completeOnboarding" | "processMessage">;
  clock?: () => Date;
}>;

export const instagramHttpProblem = (
  error: unknown,
): Readonly<{ code: string; status: number }> | null => {
  if (error instanceof InstagramProviderError)
    return Object.freeze({ code: "dependency_unavailable", status: 503 });
  if (!(error instanceof InstagramApplicationError)) return null;
  return error.code === "permission_denied"
    ? Object.freeze({ code: error.code, status: 403 })
    : error.code === "validation_failed"
      ? Object.freeze({ code: error.code, status: 400 })
      : Object.freeze({ code: "dependency_unavailable", status: 503 });
};

export const registerInstagramPublicRoutes = (
  api: FastifyInstance,
  dependencies: InstagramWebhookDependencies,
): void => {
  api.removeContentTypeParser("application/json");
  api.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );
  api.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    done(null, payload);
  });
  api.get("/v1/webhooks/instagram", async (request, reply) => {
    const challenge = verifyInstagramWebhookChallenge(
      request.query,
      dependencies.webhookVerifyToken,
    );
    return challenge === null
      ? reply.code(403).send({ error: "authentication_required" })
      : reply.type("text/plain; charset=utf-8").send(challenge);
  });
  let processing = 0;
  api.post(
    "/v1/webhooks/instagram",
    { bodyLimit: INSTAGRAM_WEBHOOK_MAXIMUM_BYTES, config: { logBody: false } },
    async (request, reply) => {
      // Neither JSON nor any routing identity is read until the exact bytes authenticate.
      if (
        !verifyInstagramWebhookSignature(
          request.body,
          request.headers["x-hub-signature-256"],
          dependencies.appSecret,
        )
      )
        return reply.code(401).send({ error: "authentication_required" });
      if (processing >= 32) return reply.code(503).send({ error: "dependency_unavailable" });
      processing += 1;
      try {
        const messages = normalizeInstagramWebhook(
          request.body,
          (dependencies.clock ?? (() => new Date()))(),
        );
        for (const message of messages) {
          try {
            await dependencies.useCases.processMessage(message);
          } catch (error) {
            if (
              !(error instanceof InstagramApplicationError) ||
              error.code !== "channel_unavailable"
            )
              throw error;
          }
        }
        return reply.code(200).send({ status: "accepted" });
      } finally {
        processing -= 1;
      }
    },
  );
  api.get<{ Querystring: { code: string; state: string } }>(
    "/v1/integrations/instagram/callback",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["code", "state"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 2048, pattern: "^[A-Za-z0-9_.|-]+$" },
            state: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]{43}$" },
          },
        },
      },
    },
    async (request, reply) => {
      await dependencies.useCases.completeOnboarding(request.query);
      return reply.code(200).send({ status: "connected" });
    },
  );
};

export const registerStaffInstagramManagement = (
  api: FastifyInstance,
  dependencies: StaffInstagramDependencies,
  security: StaffInstagramSecurityBoundary,
): void => {
  const contexts = new WeakMap<FastifyRequest, AuthorizationContext>();
  const authorize = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = await security.resolveMutationSession(request, reply);
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
  api.post<{ Body: { display_name: string } }>(
    "/v1/staff/integrations/instagram/onboarding",
    {
      preValidation: authorize,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["display_name"],
          properties: { display_name: { type: "string", minLength: 1, maxLength: 200 } },
        },
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: ["authorization_url"],
            properties: { authorization_url: { type: "string", maxLength: 4096 } },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await dependencies.useCases.beginOnboarding({
        authorization: context(request),
        displayName: request.body.display_name,
      });
      return reply.code(201).send({ authorization_url: result.authorizationUrl });
    },
  );
  api.post<{ Params: { id: ChannelConnectionId } }>(
    "/v1/staff/integrations/instagram/:id/disconnect",
    {
      preValidation: authorize,
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: ChannelConnectionIdSchema },
        },
        body: { type: "object", additionalProperties: false },
      },
    },
    async (request, reply) => {
      await dependencies.useCases.disconnect({
        authorization: context(request),
        channelConnectionId: request.params.id,
      });
      return reply.code(204).send();
    },
  );
};
