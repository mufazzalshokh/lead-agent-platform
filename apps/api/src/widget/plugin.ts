import {
  ProblemSchema,
  WidgetEmbedGrantCreateInputSchema,
  WidgetEmbedGrantCreateResponseSchema,
  WidgetEmbedPolicyInputSchema,
  WidgetEmbedPolicyResponseSchema,
  WidgetEmbedSessionRedeemInputSchema,
  WidgetEmbedSessionRedeemResponseSchema,
  WidgetConversationCreateInputSchema,
  WidgetConversationCreateResponseSchema,
  WidgetConversationReadParamsSchema,
  WidgetConversationResponseSchema,
  WidgetMessageCollectionResponseSchema,
  WidgetMessageCreateInputSchema,
  WidgetMessageCreateResponseSchema,
  WidgetMessageListQuerySchema,
  WidgetSessionCreateInputSchema,
  WidgetSessionCreateResponseSchema,
  WidgetTelemetryInputSchema,
  WidgetTelemetryResponseSchema,
  type RequestId,
  type WidgetEmbedGrantCreateInput,
  type WidgetEmbedPolicyInput,
  type WidgetEmbedSessionRedeemInput,
  type WidgetConversationCreateInput,
  type WidgetConversationReadParams,
  type WidgetMessageCreateInput,
  type WidgetMessageListQuery,
  type WidgetSessionCreateInput,
  type WidgetTelemetryInput,
} from "@lead-agent/contracts";
import { WidgetApplicationError, type WidgetUseCases } from "@lead-agent/application";
import type { OperationalMetrics } from "@lead-agent/observability";
import { WidgetOriginInvalidError, normalizeWidgetOrigin } from "@lead-agent/security";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const BODY_LIMIT = 32 * 1_024;
const PREFLIGHT_METHODS = new Set(["GET", "POST"]);
const PREFLIGHT_HEADERS = new Set([
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
]);
export type WidgetDependencies = Readonly<{
  metrics?: OperationalMetrics;
  useCases: WidgetUseCases;
}>;
const requestId = (request: FastifyRequest): RequestId => `request:${request.id}` as RequestId;
const originOf = (request: FastifyRequest): string =>
  typeof request.headers.origin === "string" ? request.headers.origin : "";
const bearerOf = (request: FastifyRequest): string => {
  const value = request.headers.authorization;
  return typeof value === "string" && /^Bearer [A-Za-z0-9._-]{80,4096}$/u.test(value)
    ? value.slice(7)
    : "";
};
const idempotencyOf = (request: FastifyRequest): string => {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : "";
};
const requirePreflightOrigin = (request: FastifyRequest): string => {
  const rawOrigin = request.headers.origin;
  const origin = normalizeWidgetOrigin(rawOrigin);
  if (rawOrigin !== origin) throw new WidgetOriginInvalidError();
  return origin;
};
const requirePreflightCapabilities = (request: FastifyRequest): void => {
  const method = request.headers["access-control-request-method"];
  if (typeof method !== "string" || !PREFLIGHT_METHODS.has(method)) {
    throw new WidgetApplicationError("validation_failed");
  }
  const requestedHeaders = request.headers["access-control-request-headers"];
  if (requestedHeaders === undefined) return;
  if (typeof requestedHeaders !== "string") {
    throw new WidgetApplicationError("validation_failed");
  }
  const names = requestedHeaders.split(",").map((name) => name.trim().toLowerCase());
  if (names.some((name) => name.length === 0 || !PREFLIGHT_HEADERS.has(name))) {
    throw new WidgetApplicationError("validation_failed");
  }
};
const secureResponse = (reply: FastifyReply, origin: string): void => {
  reply.header("access-control-allow-origin", origin);
  reply.header("cache-control", "no-store");
  reply.header("referrer-policy", "no-referrer");
  reply.header("vary", "Origin");
};

export const registerWidgetRoutes = (
  api: FastifyInstance,
  dependencies: WidgetDependencies,
): void => {
  api.options("/v1/widget/*", async (request, reply) => {
    const origin = requirePreflightOrigin(request);
    requirePreflightCapabilities(request);
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-methods", "GET, POST");
    reply.header(
      "access-control-allow-headers",
      "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
    );
    reply.header("cache-control", "no-store");
    reply.header("vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
    await reply.code(204).send();
  });

  api.post<{ Body: WidgetEmbedGrantCreateInput }>(
    "/v1/widget/embed-grants",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetEmbedGrantCreateInputSchema,
        response: {
          201: WidgetEmbedGrantCreateResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const issued = await dependencies.useCases.createEmbedGrant({
        clientIp: request.ip,
        origin,
        pageUrl: request.body.page_url,
        requestedLocale: request.body.requested_locale,
        widgetKey: request.body.widget_key,
      });
      secureResponse(reply, origin);
      return await reply.code(201).send({
        data: {
          exchange_grant: issued.exchangeGrant,
          expires_at: issued.expiresAt.toISOString(),
          iframe_origin: issued.iframeOrigin,
          iframe_url: issued.iframeUrl,
        },
        meta: { request_id: requestId(request) },
      });
    },
  );

  api.post<{ Body: WidgetEmbedPolicyInput }>(
    "/v1/widget/embed-policy",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetEmbedPolicyInputSchema,
        response: {
          200: WidgetEmbedPolicyResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const policy = dependencies.useCases.inspectEmbedGrant({
        exchangeGrant: request.body.exchange_grant,
      });
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      return {
        data: {
          embedding_origin: policy.embeddingOrigin,
          expires_at: policy.expiresAt.toISOString(),
          iframe_origin: policy.iframeOrigin,
        },
        meta: { request_id: requestId(request) },
      };
    },
  );

  api.post<{ Body: WidgetEmbedSessionRedeemInput }>(
    "/v1/widget/embed-sessions/redeem",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetEmbedSessionRedeemInputSchema,
        response: {
          201: WidgetEmbedSessionRedeemResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const issued = await dependencies.useCases.redeemEmbedSession({
        exchangeGrant: request.body.exchange_grant,
        origin,
      });
      secureResponse(reply, origin);
      return await reply.code(201).send({
        data: {
          bearer_token: issued.bearerToken,
          configuration: { max_message_characters: 4_000, supported_locales: ["uz", "ru", "en"] },
          expires_at: issued.expiresAt.toISOString(),
          idle_timeout_seconds: 1_800,
        },
        meta: { request_id: requestId(request) },
      });
    },
  );

  api.post<{ Body: WidgetSessionCreateInput }>(
    "/v1/widget/sessions",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetSessionCreateInputSchema,
        response: {
          201: WidgetSessionCreateResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const issued = await dependencies.useCases.bootstrap({
        clientIp: request.ip,
        origin,
        pageUrl: request.body.page_url,
        requestedLocale: request.body.requested_locale,
        widgetKey: request.body.widget_key,
      });
      secureResponse(reply, origin);
      return await reply.code(201).send({
        data: {
          bearer_token: issued.bearerToken,
          configuration: { max_message_characters: 4_000, supported_locales: ["uz", "ru", "en"] },
          expires_at: issued.expiresAt.toISOString(),
          idle_timeout_seconds: 1_800,
        },
        meta: { request_id: requestId(request) },
      });
    },
  );

  api.post<{ Body: WidgetConversationCreateInput }>(
    "/v1/widget/conversations",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetConversationCreateInputSchema,
        response: {
          201: WidgetConversationCreateResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const created = await dependencies.useCases.createConversation({
        bearerToken: bearerOf(request),
        body: request.body,
        idempotencyKey: idempotencyOf(request),
        origin,
      });
      secureResponse(reply, origin);
      return await reply.code(201).send({
        data: {
          bearer_token: created.bearerToken,
          conversation: created.conversation,
          expires_at: created.expiresAt.toISOString(),
          message: {
            id: created.messageId,
            processing_status: created.processingStatus,
            sequence_no: created.sequenceNo,
          },
        },
        meta: { request_id: requestId(request) },
      });
    },
  );

  api.get<{ Params: WidgetConversationReadParams }>(
    "/v1/widget/conversations/:id",
    {
      schema: {
        params: WidgetConversationReadParamsSchema,
        response: {
          200: WidgetConversationResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const conversation = await dependencies.useCases.getConversation({
        bearerToken: bearerOf(request),
        conversationId: request.params.id,
        origin,
      });
      secureResponse(reply, origin);
      return { data: conversation, meta: { request_id: requestId(request) } };
    },
  );

  api.get<{ Params: WidgetConversationReadParams; Querystring: WidgetMessageListQuery }>(
    "/v1/widget/conversations/:id/messages",
    {
      schema: {
        params: WidgetConversationReadParamsSchema,
        querystring: WidgetMessageListQuerySchema,
        response: {
          200: WidgetMessageCollectionResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const after = request.query.after;
      const limit = request.query.limit;
      const page = await dependencies.useCases.listMessages({
        ...(after === undefined ? {} : { after }),
        bearerToken: bearerOf(request),
        conversationId: request.params.id,
        ...(limit === undefined ? {} : { limit }),
        origin,
      });
      secureResponse(reply, origin);
      const last = page.items.at(-1);
      return {
        data: page.items,
        meta: {
          has_more: page.hasMore,
          next_after: page.hasMore && last !== undefined ? last.sequence_no : null,
          request_id: requestId(request),
        },
      };
    },
  );

  api.post<{ Body: WidgetMessageCreateInput; Params: WidgetConversationReadParams }>(
    "/v1/widget/conversations/:id/messages",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetMessageCreateInputSchema,
        params: WidgetConversationReadParamsSchema,
        response: {
          202: WidgetMessageCreateResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      const accepted = await dependencies.useCases.postMessage({
        bearerToken: bearerOf(request),
        body: request.body,
        conversationId: request.params.id,
        idempotencyKey: idempotencyOf(request),
        origin,
      });
      secureResponse(reply, origin);
      return await reply.code(202).send({
        data: {
          conversation_id: request.params.id,
          message: {
            id: accepted.messageId,
            processing_status: accepted.processingStatus,
            sequence_no: accepted.sequenceNo,
          },
        },
        meta: { request_id: requestId(request) },
      });
    },
  );

  api.post<{ Body: WidgetTelemetryInput }>(
    "/v1/widget/telemetry",
    {
      bodyLimit: BODY_LIMIT,
      schema: {
        body: WidgetTelemetryInputSchema,
        response: {
          202: WidgetTelemetryResponseSchema,
          "4xx": ProblemSchema,
          "5xx": ProblemSchema,
        },
      },
    },
    async (request, reply) => {
      const origin = originOf(request);
      await dependencies.useCases.recordTelemetry({
        bearerToken: bearerOf(request),
        body: request.body,
        origin,
      });
      secureResponse(reply, origin);
      return await reply.code(202).send({
        data: { accepted: true },
        meta: { request_id: requestId(request) },
      });
    },
  );
};
