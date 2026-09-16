import { describe, expect, it, vi } from "vitest";
import { normalizeTelegramUpdate } from "../../packages/integrations/src/telegram/normalizer.js";
import {
  createTelegramPlatformClient,
  createTelegramPlatformProvisioner,
  TelegramProviderError,
} from "../../packages/integrations/src/telegram/client.js";
import { loadTelegramPlatformConfig } from "../../packages/config/src/index.js";
import { businessMessage, NONCE, NOW, platformConfig } from "./fixtures.js";

describe("Telegram Business normalization", () => {
  it("maps multilingual text as data with stable provider identities", () => {
    expect(normalizeTelegramUpdate(businessMessage(), NOW)).toMatchObject({
      kind: "business_message",
      chatId: "123",
      senderUserId: "123",
      messageId: "7",
      updateId: "100",
      content: { type: "text", locale_hint: null, text: "Salom / Привет / Hello <b>data</b>" },
    });
  });
  it.each(["group", "supergroup", "channel"])("ignores %s customer traffic", (type) => {
    expect(normalizeTelegramUpdate(businessMessage({ chat: { id: 123, type } }), NOW).kind).toBe(
      "ignored",
    );
  });
  it.each([
    { id: 123, is_bot: true },
    { id: 456, is_bot: false },
    { id: 0, is_bot: false },
  ])("rejects unsafe customer actors %j", (from) => {
    const result = normalizeTelegramUpdate(businessMessage({ from }), NOW);
    expect(
      result.kind === "ignored" || (result.kind === "business_message" && result.senderIsBot),
    ).toBe(true);
  });
  it("marks Business bot echoes and ignores ordinary bot lead traffic", () => {
    expect(
      normalizeTelegramUpdate(
        businessMessage({ sender_business_bot: { id: 999, is_bot: true } }),
        NOW,
      ),
    ).toMatchObject({ senderIsBot: true });
    expect(
      normalizeTelegramUpdate(
        {
          update_id: 1,
          message: {
            text: "new lead",
            chat: { id: 123, type: "private" },
            from: { id: 123, is_bot: false },
          },
        },
        NOW,
      ).kind,
    ).toBe("ignored");
  });
  it("allows only exact human private /start onboarding", () => {
    const message = {
      text: `/start ${NONCE}`,
      chat: { id: 123, type: "private" },
      from: { id: 123, is_bot: false },
    };
    expect(normalizeTelegramUpdate({ update_id: 1, message }, NOW)).toMatchObject({
      kind: "onboarding_start",
      nonce: NONCE,
    });
    expect(
      normalizeTelegramUpdate(
        { update_id: 1, message: { ...message, text: `/start@OtherBot ${NONCE}` } },
        NOW,
      ).kind,
    ).toBe("ignored");
    expect(
      normalizeTelegramUpdate(
        { update_id: 1, message: { ...message, from: { id: 123, is_bot: true } } },
        NOW,
      ).kind,
    ).toBe("ignored");
  });
  it.each([
    ["photo", [{ file_id: "opaque-image" }], "image"],
    ["document", { file_id: "opaque-doc" }, "document"],
    ["voice", { file_id: "opaque-audio" }, "audio"],
    ["video", { file_id: "opaque-video" }, "other"],
  ])("keeps %s metadata only", (key, value, mediaKind) => {
    expect(
      normalizeTelegramUpdate(
        businessMessage({ text: undefined, [String(key)]: value, caption: "caption" }),
        NOW,
      ),
    ).toMatchObject({ content: { type: "attachment", media_kind: mediaKind, caption: "caption" } });
  });
  it("rejects malformed root and future/stale timestamps", () => {
    expect(() => normalizeTelegramUpdate({}, NOW)).toThrow("validation_failed");
    expect(
      normalizeTelegramUpdate(businessMessage({ date: NOW.getTime() / 1000 + 3600 }), NOW).kind,
    ).toBe("ignored");
    expect(normalizeTelegramUpdate(businessMessage({ date: 1 }), NOW).kind).toBe("ignored");
  });
  it("accepts rights changes on an old Business Connection", () => {
    expect(
      normalizeTelegramUpdate(
        {
          update_id: 1,
          business_connection: {
            id: "business-test-1",
            user: { id: 456, is_bot: false },
            date: Date.UTC(2025, 0, 1) / 1000,
            is_enabled: false,
          },
        },
        NOW,
      ),
    ).toMatchObject({ kind: "business_connection", isEnabled: false, canReply: false });
  });
  it("bounds callbacks by bytes and same verified private participant", () => {
    const callback = {
      id: "callback-1",
      from: { id: 123, is_bot: false },
      message: businessMessage().business_message,
      data: "я".repeat(32),
    };
    expect(normalizeTelegramUpdate({ update_id: 2, callback_query: callback }, NOW)).toMatchObject({
      kind: "callback_query",
      occurredAt: NOW.toISOString(),
    });
    for (const data of ["", "я".repeat(33)])
      expect(
        normalizeTelegramUpdate({ update_id: 2, callback_query: { ...callback, data } }, NOW).kind,
      ).toBe("ignored");
    expect(
      normalizeTelegramUpdate(
        { update_id: 2, callback_query: { ...callback, from: { id: 456, is_bot: false } } },
        NOW,
      ).kind,
    ).toBe("ignored");
  });
});

describe("Narrow Telegram platform client", () => {
  const postedBody = (options: Parameters<typeof fetch>[1]): unknown => {
    const body: unknown = options?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    return JSON.parse(body);
  };
  const response = (result: unknown, status = 200) =>
    new Response(
      JSON.stringify(
        status === 200
          ? { ok: true, result }
          : {
              ok: false,
              error_code: status,
              description: "sensitive provider prose",
              parameters: { retry_after: 3 },
            },
      ),
      { status },
    );
  it("sends on behalf of the business into the same customer DM without parse_mode", async () => {
    const transport = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        response({
          message_id: 8,
          business_connection_id: "business-test-1",
          chat: { id: 123, type: "private" },
        }),
      ),
    );
    const client = createTelegramPlatformClient(platformConfig, transport);
    expect(
      await client.sendMessage({
        businessConnectionId: "business-test-1",
        chatId: "123",
        text: "<b>plain data</b>",
      }),
    ).toEqual({ messageId: "8" });
    const options = transport.mock.calls[0]?.[1];
    expect(postedBody(options)).toEqual({
      business_connection_id: "business-test-1",
      chat_id: "123",
      text: "<b>plain data</b>",
    });
  });
  it.each([
    [401, "authentication_failed"],
    [403, "permanent_rejection"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [400, "unsupported_content"],
  ])("sanitizes provider %i", async (status, category) => {
    const client = createTelegramPlatformClient(platformConfig, () =>
      Promise.resolve(response(null, Number(status))),
    );
    await expect(
      client.sendMessage({ businessConnectionId: "business-test-1", chatId: "123", text: "hello" }),
    ).rejects.toMatchObject({
      category,
      message: "Telegram provider request failed",
      ...(status === 429 ? { retryAfterMilliseconds: 3000 } : {}),
    });
  });
  it("does not leak token-bearing network exceptions", async () => {
    const client = createTelegramPlatformClient(platformConfig, () =>
      Promise.reject(new Error(`token ${platformConfig.botToken}`)),
    );
    await expect(
      client.sendMessage({ businessConnectionId: "business-test-1", chatId: "123", text: "hello" }),
    ).rejects.toMatchObject({
      message: "Telegram provider request failed",
      ambiguousExternalEffect: true,
    });
  });
  it("bounds timeout, response bodies and malformed successes", async () => {
    const timeoutClient = createTelegramPlatformClient(
      platformConfig,
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), {
            once: true,
          });
        }),
    );
    await expect(
      timeoutClient.sendMessage({
        businessConnectionId: "business-test-1",
        chatId: "123",
        text: "hello",
      }),
    ).rejects.toBeInstanceOf(TelegramProviderError);
    for (const body of ["not json", "x".repeat(65537), JSON.stringify({ ok: true, result: {} })]) {
      const client = createTelegramPlatformClient(platformConfig, () =>
        Promise.resolve(new Response(body)),
      );
      await expect(
        client.sendMessage({
          businessConnectionId: "business-test-1",
          chatId: "123",
          text: "hello",
        }),
      ).rejects.toMatchObject({ category: "provider_unavailable", ambiguousExternalEffect: true });
    }
  });
  it("rejects invalid outbound size, cold username targets and callback byte lengths before fetch", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createTelegramPlatformClient(platformConfig, transport);
    for (const input of [
      { text: "x".repeat(4001), chatId: "123" },
      { text: "hello", chatId: "@untrusted" },
      { text: "hello", chatId: "123", quickReplies: [{ label: "a", actionToken: "я".repeat(33) }] },
    ])
      await expect(
        client.sendMessage({ businessConnectionId: "business-test-1", ...input }),
      ).rejects.toMatchObject({ category: "unsupported_content" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("fails closed for non-byte provider response chunks", async () => {
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue("not a byte buffer");
        controller.close();
      },
    });
    const malformedResponse = new Response();
    // Deliberately malformed transport double; normal Response construction rejects this body type.
    Object.defineProperty(malformedResponse, "body", { value: stream });
    const client = createTelegramPlatformClient(platformConfig, () =>
      Promise.resolve(malformedResponse),
    );
    await expect(
      client.sendMessage({ businessConnectionId: "business-test-1", chatId: "123", text: "hello" }),
    ).rejects.toMatchObject({ category: "provider_unavailable", ambiguousExternalEffect: true });
  });
  it("provisions only the approved webhook update set", async () => {
    const bodies: unknown[] = [];
    const client = createTelegramPlatformClient(platformConfig, (url, options) => {
      if (typeof url !== "string") throw new Error("Expected the fixed Bot API request URL");
      bodies.push(postedBody(options));
      return Promise.resolve(
        response(
          url.endsWith("getMe")
            ? {
                id: 999,
                username: platformConfig.botUsername,
                is_bot: true,
                can_connect_to_business: true,
              }
            : url.endsWith("getWebhookInfo")
              ? {
                  url: platformConfig.webhookUrl,
                  allowed_updates: [
                    "message",
                    "business_connection",
                    "business_message",
                    "callback_query",
                  ],
                }
              : true,
        ),
      );
    });
    await createTelegramPlatformProvisioner(client, platformConfig).ensureWebhook();
    expect(bodies[1]).toEqual({
      allowed_updates: ["message", "business_connection", "business_message", "callback_query"],
      secret_token: platformConfig.webhookSecret,
      url: platformConfig.webhookUrl,
    });
  });
  it("validates platform secret/config without embedding tenant credentials", () => {
    expect(() => loadTelegramPlatformConfig({})).toThrow();
    const config = loadTelegramPlatformConfig({
      TELEGRAM_BOT_TOKEN: ["999999", "x".repeat(30)].join(":"),
      TELEGRAM_BOT_USERNAME: platformConfig.botUsername,
      TELEGRAM_WEBHOOK_SECRET: platformConfig.webhookSecret,
      TELEGRAM_WEBHOOK_URL: platformConfig.webhookUrl,
    });
    expect(config.webhookUrl).toBe(platformConfig.webhookUrl);
  });
});
