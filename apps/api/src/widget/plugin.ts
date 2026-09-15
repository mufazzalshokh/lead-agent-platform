import {
  ProblemSchema,
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
  type RequestId,
  type WidgetConversationCreateInput,
  type WidgetConversationReadParams,
  type WidgetMessageCreateInput,
  type WidgetMessageListQuery,
  type WidgetSessionCreateInput,
} from "@lead-agent/contracts";
import type { WidgetUseCases } from "@lead-agent/application";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const BODY_LIMIT = 32 * 1_024;
export type WidgetDependencies = Readonly<{ useCases: WidgetUseCases }>;
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
  api.options("/v1/widget/*", async (_request, reply) => {
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header(
      "access-control-allow-headers",
      "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
    );
    reply.header("cache-control", "no-store");
    reply.header("vary", "Origin");
    await reply.code(204).send();
  });

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
};
