import { createHash, timingSafeEqual } from "node:crypto";

import type { TelegramBusinessUseCases, TelegramNormalizedUpdate } from "@lead-agent/application";
import { TelegramApplicationError } from "@lead-agent/application";
import { OrganizationIdSchema, isSchemaValue, type OrganizationId } from "@lead-agent/contracts";
import {
  AuthorizationDeniedError,
  hasPermission,
  resolveAuthorizationContext,
  type AuthenticatedApplicationSession,
  type AuthorizationContext,
  type CurrentMembershipAuthorizationResolver,
} from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
const ORGANIZATION_HEADER = "x-organization-context";
const MAXIMUM_WEBHOOK_BYTES = 256 * 1_024;

export type TelegramWebhookDependencies = Readonly<{
  normalizeUpdate(raw: unknown): Promise<TelegramNormalizedUpdate> | TelegramNormalizedUpdate;
  processUpdate: TelegramBusinessUseCases["processUpdate"];
  webhookSecret: string;
}>;

export type StaffTelegramDependencies = Readonly<{
  useCases: Pick<TelegramBusinessUseCases, "beginOnboarding">;
}>;

export type StaffTelegramSecurityBoundary = Readonly<{
  authorizationResolver: CurrentMembershipAuthorizationResolver;
  resolveMutationSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedApplicationSession>;
}>;

const secretMatches = (expected: string, supplied: unknown): boolean => {
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  const suppliedHash = createHash("sha256")
    .update(typeof supplied === "string" ? supplied : "", "utf8")
    .digest();
  return typeof supplied === "string" && timingSafeEqual(expectedHash, suppliedHash);
};

export const registerTelegramWebhook = (
  api: FastifyInstance,
  dependencies: TelegramWebhookDependencies,
): void => {
  let processing = 0;
  api.post(
    "/v1/webhooks/telegram",
    {
      bodyLimit: MAXIMUM_WEBHOOK_BYTES,
      config: { logBody: false },
      schema: { body: { type: "object" } },
    },
    async (request, reply) => {
      if (!secretMatches(dependencies.webhookSecret, request.headers[WEBHOOK_SECRET_HEADER])) {
        return reply.code(401).send({ error: "authentication_required" });
      }
      if (processing >= 32) throw new Error("Telegram ingress capacity unavailable");
      processing += 1;
      try {
        const update = await dependencies.normalizeUpdate(request.body);
        const outcome = await dependencies.processUpdate(update);
        return reply.code(outcome.status === "accepted" ? 202 : 200).send({
          status: outcome.status,
        });
      } finally {
        processing -= 1;
      }
    },
  );
};

const requireOrganization = (request: FastifyRequest): OrganizationId => {
  const value = request.headers[ORGANIZATION_HEADER];
  if (!isSchemaValue(OrganizationIdSchema, value)) throw new AuthorizationDeniedError();
  return value;
};

export const registerStaffTelegramManagement = (
  api: FastifyInstance,
  dependencies: StaffTelegramDependencies,
  security: StaffTelegramSecurityBoundary,
): void => {
  const contexts = new WeakMap<FastifyRequest, AuthorizationContext>();
  api.post<{ Body: { display_name: string } }>(
    "/v1/staff/integrations/telegram/onboarding",
    {
      preValidation: async (request, reply) => {
        const session = await security.resolveMutationSession(request, reply);
        const authorization = await resolveAuthorizationContext(
          session,
          requireOrganization(request),
          security.authorizationResolver,
        );
        if (!hasPermission(authorization.role, "integrations.manage")) {
          throw new AuthorizationDeniedError();
        }
        contexts.set(request, authorization);
      },
      schema: {
        body: {
          additionalProperties: false,
          properties: { display_name: { maxLength: 200, minLength: 1, type: "string" } },
          required: ["display_name"],
          type: "object",
        },
      },
    },
    async (request, reply) => {
      const authorization = contexts.get(request);
      if (authorization === undefined) throw new AuthorizationDeniedError();
      const result = await dependencies.useCases.beginOnboarding({
        authorization,
        displayName: request.body.display_name,
      });
      return reply.code(201).send({
        channel_connection_id: result.channelConnectionId,
        onboarding_url: result.onboardingUrl,
      });
    },
  );
};

export const telegramHttpProblem = (
  error: unknown,
): Readonly<{ code: string; status: number }> | null => {
  if (!(error instanceof TelegramApplicationError)) return null;
  if (error.code === "permission_denied") return Object.freeze({ code: error.code, status: 403 });
  if (error.code === "validation_failed") return Object.freeze({ code: error.code, status: 400 });
  return Object.freeze({ code: "dependency_unavailable", status: 503 });
};
