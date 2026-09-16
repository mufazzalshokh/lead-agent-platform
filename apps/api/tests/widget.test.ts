import { describe, expect, it, vi } from "vitest";

import type { WidgetUseCases } from "@lead-agent/application";
import {
  WidgetConversationCreateResponseSchema,
  WidgetConversationResponseSchema,
  WidgetMessageCollectionResponseSchema,
  WidgetMessageCreateResponseSchema,
  WidgetSessionCreateResponseSchema,
  isSchemaValue,
  type ConversationId,
  type MessageId,
  type WidgetConversation,
  type WidgetMessage,
} from "@lead-agent/contracts";
import {
  WidgetOriginInvalidError,
  WidgetRateLimitError,
  WidgetTokenInvalidError,
} from "@lead-agent/security";
import { createApi } from "../src/app.js";

const CONVERSATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b" as ConversationId;
const OTHER_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c" as MessageId;
const MESSAGE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2d" as MessageId;
const NOW = new Date("2026-09-15T10:00:00.000Z");
const TOKEN = "x".repeat(100);
const ORIGIN = "https://clinic.example";
const conversation: WidgetConversation = {
  closed_at: null,
  id: CONVERSATION_ID,
  last_activity_at: NOW.toISOString(),
  preferred_locale: "uz",
  resolved_at: null,
  started_at: NOW.toISOString(),
  status: "open",
};
const visibleMessage: WidgetMessage = {
  body_text: "<b>plain data</b>",
  conversation_id: CONVERSATION_ID,
  created_at: NOW.toISOString(),
  direction: "inbound",
  id: MESSAGE_ID,
  locale: "uz",
  redacted_at: null,
  sequence_no: 1,
};

const dependencies = () => {
  const calls = { ai: 0 };
  const useCases: WidgetUseCases = {
    bootstrap: vi.fn(() =>
      Promise.resolve({
        bearerToken: TOKEN,
        expiresAt: new Date("2026-09-15T12:00:00.000Z"),
      }),
    ),
    createConversation: vi.fn(({ bearerToken, origin }) => {
      if (origin === "") throw new WidgetOriginInvalidError();
      if (bearerToken === "") throw new WidgetTokenInvalidError();
      return Promise.resolve({
        bearerToken: TOKEN,
        conversation,
        expiresAt: new Date("2026-09-15T12:00:00.000Z"),
        messageId: MESSAGE_ID,
        processingStatus: "accepted" as const,
        sequenceNo: 1,
      });
    }),
    getConversation: vi.fn(({ bearerToken, conversationId }) => {
      if (bearerToken === "") return Promise.reject(new WidgetTokenInvalidError());
      return conversationId === CONVERSATION_ID
        ? Promise.resolve(conversation)
        : Promise.reject(new Error("not found"));
    }),
    listMessages: vi.fn(() => Promise.resolve({ hasMore: false, items: [visibleMessage] })),
    postMessage: vi.fn(() =>
      Promise.resolve({
        messageId: OTHER_ID,
        processingStatus: "accepted" as const,
        sequenceNo: 2,
      }),
    ),
  };
  return { calls, useCases };
};
const headers = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  origin: ORIGIN,
  ...extra,
});

describe("S10 Widget Fastify API", () => {
  it("implements the five isolated Widget routes with safe headers and projections", async () => {
    const widget = dependencies();
    const api = createApi({ widget: { useCases: widget.useCases } });
    try {
      const bootstrap = await api.inject({
        method: "POST",
        url: "/v1/widget/sessions",
        headers: { origin: ORIGIN },
        payload: {
          page_url: "https://attacker.invalid/spoof",
          requested_locale: "uz",
          widget_key: "A".repeat(32),
        },
      });
      expect(bootstrap.statusCode).toBe(201);
      expect(bootstrap.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(bootstrap.headers["cache-control"]).toBe("no-store");
      const bootstrapBody: unknown = bootstrap.json();
      if (!isSchemaValue(WidgetSessionCreateResponseSchema, bootstrapBody))
        throw new TypeError("Expected valid Widget session response");
      expect(bootstrapBody.data).not.toHaveProperty("organization_id");

      const create = await api.inject({
        method: "POST",
        url: "/v1/widget/conversations",
        headers: headers({ "idempotency-key": "request-key-1" }),
        payload: {
          client_message_id: "browser.message-1",
          kind: "text",
          locale_hint: null,
          text: "Salom",
        },
      });
      expect(create.statusCode).toBe(201);
      const createBody: unknown = create.json();
      if (!isSchemaValue(WidgetConversationCreateResponseSchema, createBody))
        throw new TypeError("Expected valid Widget conversation response");
      expect(createBody.data.conversation).toEqual(conversation);

      const read = await api.inject({
        method: "GET",
        url: `/v1/widget/conversations/${CONVERSATION_ID}`,
        headers: headers(),
      });
      expect(read.statusCode).toBe(200);
      const readBody: unknown = read.json();
      if (!isSchemaValue(WidgetConversationResponseSchema, readBody))
        throw new TypeError("Expected valid Widget conversation read response");
      expect(readBody.data).not.toHaveProperty("contact_id");

      const messages = await api.inject({
        method: "GET",
        url: `/v1/widget/conversations/${CONVERSATION_ID}/messages?after=0&limit=50`,
        headers: headers(),
      });
      expect(messages.statusCode).toBe(200);
      const messageBody: unknown = messages.json();
      if (!isSchemaValue(WidgetMessageCollectionResponseSchema, messageBody))
        throw new TypeError("Expected valid Widget message collection response");
      expect(messageBody.data[0]).toEqual(
        expect.objectContaining({ body_text: "<b>plain data</b>" }),
      );
      expect(messageBody.data[0]).not.toHaveProperty("body_ciphertext");

      const post = await api.inject({
        method: "POST",
        url: `/v1/widget/conversations/${CONVERSATION_ID}/messages`,
        headers: headers({ "idempotency-key": "request-key-2" }),
        payload: {
          client_message_id: "browser.message-2",
          kind: "text",
          locale_hint: "en",
          text: "Hello",
        },
      });
      expect(post.statusCode).toBe(202);
      const postBody: unknown = post.json();
      if (!isSchemaValue(WidgetMessageCreateResponseSchema, postBody))
        throw new TypeError("Expected valid Widget message response");
      expect(postBody.data.message.sequence_no).toBe(2);
      expect(widget.calls.ai).toBe(0);
    } finally {
      await api.close();
    }
  }, 30_000);

  it("supports non-enumerating browser preflight and rejects arbitrary actual-request CORS", async () => {
    const widget = dependencies();
    const api = createApi({ widget: { useCases: widget.useCases } });
    try {
      const invalid = await api.inject({
        method: "POST",
        url: "/v1/widget/conversations",
        headers: { "idempotency-key": "request-key-1" },
        payload: {
          client_message_id: "browser.message-1",
          kind: "text",
          locale_hint: null,
          text: "Salom",
        },
      });
      expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
      expect(invalid.headers["cache-control"]).toBe("no-store");
      expect(invalid.headers).not.toHaveProperty("access-control-allow-origin");
      const oversized = await api.inject({
        method: "POST",
        url: "/v1/widget/sessions",
        headers: { "content-type": "application/json", origin: ORIGIN },
        payload: JSON.stringify({
          page_url: ORIGIN,
          requested_locale: "uz",
          widget_key: "A".repeat(33_000),
        }),
      });
      expect(oversized.statusCode).toBeGreaterThanOrEqual(400);
      expect(widget.useCases.bootstrap).not.toHaveBeenCalled();
      const preflight = await api.inject({
        method: "OPTIONS",
        url: "/v1/widget/sessions",
        headers: {
          "access-control-request-headers": "content-type, x-request-id",
          "access-control-request-method": "POST",
          origin: ORIGIN,
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(preflight.headers["access-control-allow-methods"]).toBe("GET, POST");
      expect(preflight.headers["access-control-allow-headers"]).toBe(
        "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
      );
      expect(preflight.headers["vary"]).toContain("Access-Control-Request-Method");
      expect(preflight.headers).not.toHaveProperty("access-control-allow-credentials");
      expect(widget.useCases.bootstrap).toHaveBeenCalledTimes(0);

      vi.mocked(widget.useCases.bootstrap).mockRejectedValueOnce(new WidgetOriginInvalidError());
      const unapproved = await api.inject({
        method: "POST",
        url: "/v1/widget/sessions",
        headers: { origin: "https://unknown.invalid" },
        payload: {
          page_url: "https://unknown.invalid",
          requested_locale: "uz",
          widget_key: "A".repeat(32),
        },
      });
      expect(unapproved.statusCode).toBe(403);
      expect(unapproved.headers).not.toHaveProperty("access-control-allow-origin");
    } finally {
      await api.close();
    }
  });

  it.each([
    [{ "access-control-request-method": "POST" }, 403],
    [{ "access-control-request-method": "POST", origin: "null" }, 403],
    [{ "access-control-request-method": "POST", origin: "http://clinic.example" }, 403],
    [{ "access-control-request-method": "POST", origin: "https://CLINIC.example" }, 403],
    [{ "access-control-request-method": "POST", origin: "https://clinic.example/path" }, 403],
    [{ "access-control-request-method": "DELETE", origin: ORIGIN }, 400],
    [
      {
        "access-control-request-headers": "content-type, x-tenant-id",
        "access-control-request-method": "POST",
        origin: ORIGIN,
      },
      400,
    ],
  ])(
    "rejects malformed or unsupported preflight capabilities %#",
    async (requestHeaders, status) => {
      const widget = dependencies();
      const api = createApi({ widget: { useCases: widget.useCases } });
      try {
        const response = await api.inject({
          method: "OPTIONS",
          url: "/v1/widget/sessions",
          headers: requestHeaders,
        });
        expect(response.statusCode).toBe(status);
        expect(response.headers).not.toHaveProperty("access-control-allow-origin");
        expect(response.headers).not.toHaveProperty("access-control-allow-credentials");
        expect(widget.useCases.bootstrap).not.toHaveBeenCalled();
      } finally {
        await api.close();
      }
    },
  );

  it("ignores tenant selectors in query strings and rejects authority or bearer smuggling", async () => {
    const widget = dependencies();
    const api = createApi({ widget: { useCases: widget.useCases } });
    try {
      const queryAttempt = await api.inject({
        method: "POST",
        url: `/v1/widget/sessions?organization_id=${CONVERSATION_ID}&channel_connection_id=${MESSAGE_ID}`,
        headers: { origin: ORIGIN },
        payload: {
          page_url: "https://attacker.invalid/spoof",
          requested_locale: "uz",
          widget_key: "A".repeat(32),
        },
      });
      expect(queryAttempt.statusCode).toBe(201);
      expect(widget.useCases.bootstrap).toHaveBeenCalledTimes(1);
      expect(vi.mocked(widget.useCases.bootstrap).mock.calls[0]?.[0]).not.toHaveProperty(
        "organization_id",
      );
      expect(vi.mocked(widget.useCases.bootstrap).mock.calls[0]?.[0]).not.toHaveProperty(
        "channel_connection_id",
      );

      const payloadAttempt = await api.inject({
        method: "POST",
        url: "/v1/widget/sessions",
        headers: { origin: ORIGIN },
        payload: {
          channel_connection_id: MESSAGE_ID,
          organization_id: CONVERSATION_ID,
          page_url: ORIGIN,
          requested_locale: "uz",
          widget_key: "A".repeat(32),
        },
      });
      expect(payloadAttempt.statusCode).toBe(400);
      expect(widget.useCases.bootstrap).toHaveBeenCalledTimes(1);

      const queryToken = await api.inject({
        method: "GET",
        url: `/v1/widget/conversations/${CONVERSATION_ID}?access_token=${TOKEN}`,
        headers: { origin: ORIGIN },
      });
      expect(queryToken.statusCode).toBe(401);
      expect(queryToken.headers).not.toHaveProperty("access-control-allow-origin");
    } finally {
      await api.close();
    }
  });

  it("returns deterministic rate metadata and does not trust forwarded client IP by default", async () => {
    const widget = dependencies();
    vi.mocked(widget.useCases.postMessage).mockRejectedValueOnce(new WidgetRateLimitError(17));
    const api = createApi({ widget: { useCases: widget.useCases } });
    try {
      const limited = await api.inject({
        method: "POST",
        url: `/v1/widget/conversations/${CONVERSATION_ID}/messages`,
        headers: headers({ "idempotency-key": "request-key-2" }),
        payload: {
          client_message_id: "browser.message-2",
          kind: "text",
          locale_hint: "en",
          text: "Hello",
        },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBe("17");

      await api.inject({
        method: "POST",
        url: "/v1/widget/sessions",
        headers: { origin: ORIGIN, "x-forwarded-for": "203.0.113.99" },
        payload: { page_url: ORIGIN, requested_locale: "uz", widget_key: "A".repeat(32) },
      });
      expect(widget.useCases.bootstrap).toHaveBeenLastCalledWith(
        expect.objectContaining({ clientIp: "127.0.0.1" }),
      );
    } finally {
      await api.close();
    }
  });
});
