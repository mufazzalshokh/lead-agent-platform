import { describe, expect, it, vi } from "vitest";
import { createInstagramPlatformClient } from "../../packages/integrations/src/instagram/client.js";
import { loadInstagramPlatformConfig } from "../../packages/config/src/index.js";
import { ACCOUNT_ID, CUSTOMER_ID, TOKEN, instagramConfig } from "./fixtures.js";

const response = (
  value: unknown,
  status = 200,
  headers?: NonNullable<ConstructorParameters<typeof Response>[1]>["headers"],
) => new Response(JSON.stringify(value), { status, ...(headers === undefined ? {} : { headers }) });
const short = {
  data: [
    {
      access_token: TOKEN,
      user_id: "111",
      permissions: "instagram_business_basic,instagram_business_manage_messages",
    },
  ],
};
const long = { access_token: TOKEN, token_type: "bearer", expires_in: 5_184_000 };
const profile = { data: [{ user_id: ACCOUNT_ID, id: "111", account_type: "Business" }] };
const requestUrl = (value: Parameters<typeof fetch>[0] | undefined): string => {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.href;
  if (value instanceof Request) return value.url;
  throw new Error("Expected concrete request URL");
};
const requestBody = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof URLSearchParams) return value.toString();
  throw new Error("Expected concrete request body");
};
const fixture = (payloads: readonly unknown[] = [short, long, profile]) => {
  let index = 0;
  const request = vi.fn<typeof fetch>(() => Promise.resolve(response(payloads[index++])));
  return { request, client: createInstagramPlatformClient(instagramConfig, request) };
};
describe("Instagram Login official endpoint boundary", () => {
  it("rejects malformed response-stream chunks without treating a send as confirmed", async () => {
    const malformed = new Response();
    Object.defineProperty(malformed, "body", {
      value: {
        getReader: () => ({
          read: () => Promise.resolve({ done: false, value: "not a byte chunk" }),
          releaseLock: () => undefined,
        }),
      },
    });
    const request = vi.fn<typeof fetch>(() => Promise.resolve(malformed));
    const client = createInstagramPlatformClient(instagramConfig, request);
    await expect(
      client.sendMessage({
        accountId: ACCOUNT_ID,
        recipientId: CUSTOMER_ID,
        text: "Hello",
        token: TOKEN,
      }),
    ).rejects.toMatchObject({ category: "provider_unavailable", ambiguousExternalEffect: true });
  });
  it("maps canonical professional user_id, not the app-scoped id, using the minimum scopes", async () => {
    const test = fixture();
    expect(await test.client.exchangeCode("synthetic-code")).toEqual({
      accountId: ACCOUNT_ID,
      expiresInSeconds: long.expires_in,
      token: TOKEN,
    });
    expect(test.request.mock.calls.map(([url]) => new URL(requestUrl(url)).hostname)).toEqual([
      "api.instagram.com",
      "graph.instagram.com",
      "graph.instagram.com",
    ]);
    const form = test.request.mock.calls[0]?.[1]?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) throw new Error("Expected OAuth form");
    expect(form.get("redirect_uri")).toBe(instagramConfig.oauthRedirectUri);
    expect(test.request.mock.calls[2]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
    });
    for (const [, init] of test.request.mock.calls) expect(init?.redirect).toBe("error");
  });
  it.each(["Media_Creator", "BUSINESS", "MEDIA_CREATOR"])(
    "accepts professional %s",
    async (type) => {
      expect(
        (
          await fixture([
            short,
            long,
            { user_id: ACCOUNT_ID, account_type: type },
          ]).client.exchangeCode("code")
        ).accountId,
      ).toBe(ACCOUNT_ID);
    },
  );
  it.each(["PERSONAL", "unknown", null])("rejects unsupported account type %s", async (type) => {
    await expect(
      fixture([short, long, { user_id: ACCOUNT_ID, account_type: type }]).client.exchangeCode(
        "code",
      ),
    ).rejects.toMatchObject({ category: "authentication_failed" });
  });
  it("rejects missing manage-messages permission before long-token exchange", async () => {
    const test = fixture([
      { data: [{ ...short.data[0], permissions: "instagram_business_basic" }] },
    ]);
    await expect(test.client.exchangeCode("code")).rejects.toMatchObject({
      category: "authentication_failed",
    });
    expect(test.request).toHaveBeenCalledOnce();
  });
  it("does not substitute app-scoped id when canonical user_id is missing", async () => {
    await expect(
      fixture([short, long, { id: ACCOUNT_ID, account_type: "Business" }]).client.exchangeCode(
        "code",
      ),
    ).rejects.toMatchObject({ category: "authentication_failed" });
  });
  it("subscribes messages before treating the connection as usable", async () => {
    const test = fixture([{ success: true }]);
    await test.client.subscribeMessages(ACCOUNT_ID, TOKEN);
    expect(requestUrl(test.request.mock.calls[0]?.[0])).toBe(
      `https://graph.instagram.com/v25.0/${ACCOUNT_ID}/subscribed_apps`,
    );
    expect(requestBody(test.request.mock.calls[0]?.[1]?.body)).toBe("subscribed_fields=messages");
    await expect(
      fixture([{ success: false }]).client.subscribeMessages(ACCOUNT_ID, TOKEN),
    ).rejects.toMatchObject({ category: "permanent_rejection" });
  });
  it("refreshes through the fixed endpoint without tenant-supplied hosts", async () => {
    const test = fixture([long]);
    expect(await test.client.refreshToken(TOKEN)).toEqual({
      token: TOKEN,
      expiresInSeconds: long.expires_in,
    });
    expect(new URL(requestUrl(test.request.mock.calls[0]?.[0])).pathname).toBe(
      "/refresh_access_token",
    );
  });
  it("sends plain Unicode text to one explicit recipient with bearer auth", async () => {
    const test = fixture([{ recipient_id: CUSTOMER_ID, message_id: "mid.synthetic" }]);
    const text = "Salom / Привет / Hello <b>data</b>";
    expect(
      await test.client.sendMessage({
        accountId: ACCOUNT_ID,
        recipientId: CUSTOMER_ID,
        text,
        token: TOKEN,
      }),
    ).toEqual({ messageId: "mid.synthetic" });
    const [url, init] = test.request.mock.calls[0] ?? [];
    expect(requestUrl(url)).not.toContain(TOKEN);
    const body: unknown = JSON.parse(requestBody(init?.body));
    expect(body).toEqual({
      recipient: { id: CUSTOMER_ID },
      message: { text },
    });
  });
  it.each(["x".repeat(1001), "я".repeat(501), "😀".repeat(251), ""])(
    "rejects invalid UTF-8 byte length before sending",
    async (text) => {
      const test = fixture();
      await expect(
        test.client.sendMessage({
          accountId: ACCOUNT_ID,
          recipientId: CUSTOMER_ID,
          text,
          token: TOKEN,
        }),
      ).rejects.toMatchObject({ category: "unsupported_content" });
      expect(test.request).not.toHaveBeenCalled();
    },
  );
  it.each([
    [401, 190, "authentication_failed", false],
    [429, 4, "rate_limited", false],
    [400, 100, "permanent_rejection", false],
    [503, 2, "provider_unavailable", true],
  ] as const)(
    "maps %s without exposing provider text",
    async (status, code, category, ambiguous) => {
      const request = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          response({ error: { code, message: `private ${TOKEN}` } }, status, {
            "retry-after": "3",
          }),
        ),
      );
      const client = createInstagramPlatformClient(instagramConfig, request);
      await expect(
        client.sendMessage({
          accountId: ACCOUNT_ID,
          recipientId: CUSTOMER_ID,
          text: "reply",
          token: TOKEN,
        }),
      ).rejects.toMatchObject({
        category,
        ambiguousExternalEffect: ambiguous,
        message: "Instagram provider request failed",
      });
    },
  );
  it("marks an unknown recipient response as ambiguous instead of claiming delivery", async () => {
    await expect(
      fixture([{ recipient_id: "111", message_id: "mid" }]).client.sendMessage({
        accountId: ACCOUNT_ID,
        recipientId: CUSTOMER_ID,
        text: "reply",
        token: TOKEN,
      }),
    ).rejects.toMatchObject({ ambiguousExternalEffect: true });
  });
  it("bounds network timeout and oversized provider responses", async () => {
    const request = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("private network failure")),
            { once: true },
          ),
        ),
    );
    await expect(
      createInstagramPlatformClient(instagramConfig, request).sendMessage({
        accountId: ACCOUNT_ID,
        recipientId: CUSTOMER_ID,
        text: "reply",
        token: TOKEN,
      }),
    ).rejects.toMatchObject({ category: "provider_unavailable", ambiguousExternalEffect: true });
    const oversized = vi.fn<typeof fetch>(() => Promise.resolve(new Response("x".repeat(65_537))));
    await expect(
      createInstagramPlatformClient(instagramConfig, oversized).refreshToken(TOKEN),
    ).rejects.toMatchObject({ category: "provider_unavailable" });
  });
  it("requires a pinned Graph version and safe exact callback path", () => {
    const environment = {
      INSTAGRAM_APP_ID: instagramConfig.appId,
      INSTAGRAM_APP_SECRET: instagramConfig.appSecret,
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: instagramConfig.webhookVerifyToken,
      INSTAGRAM_GRAPH_API_VERSION: "v25.0",
      INSTAGRAM_OAUTH_REDIRECT_URI: instagramConfig.oauthRedirectUri,
    };
    expect(loadInstagramPlatformConfig(environment).graphApiVersion).toBe("v25.0");
    for (const patch of [
      { INSTAGRAM_GRAPH_API_VERSION: "latest" },
      {
        INSTAGRAM_OAUTH_REDIRECT_URI:
          "https://user:password@example.test/v1/integrations/instagram/callback",
      },
      { INSTAGRAM_OAUTH_REDIRECT_URI: `${instagramConfig.oauthRedirectUri}?next=evil` },
      { INSTAGRAM_OAUTH_REDIRECT_URI: "https://[invalid" },
    ])
      expect(() => loadInstagramPlatformConfig({ ...environment, ...patch })).toThrow();
  });
});
