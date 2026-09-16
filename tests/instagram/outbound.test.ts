import { describe, expect, it, vi } from "vitest";
import { createInstagramOutboundHandler } from "../../apps/worker/src/instagram-outbound.js";
import type { WorkerHandlerContext } from "../../apps/worker/src/handler-registry.js";
import {
  InstagramProviderError,
  instagramConversationIdentity,
  type InstagramPersistenceStore,
} from "../../packages/application/src/index.js";
import type {
  InstagramOutboundRecord,
  InstagramOutboundPersistenceStore,
} from "../../packages/database/src/index.js";
import type { InstagramPlatformClient } from "../../packages/integrations/src/index.js";
import { ACCOUNT_ID, CUSTOMER_ID, IDS, NOW, TOKEN, dataProtection } from "./fixtures.js";

const context: WorkerHandlerContext = {
  attempt: { attemptNumber: 1, jobId: IDS.message, retryLimit: 5 },
  causationId: null,
  correlationId: IDS.message,
  identity: {
    handlerVersion: "v1",
    idempotencyKey: "synthetic-logical-id",
    outboxEventId: IDS.message,
    providerIdempotencyKey: "synthetic-logical-id",
  },
  organizationId: IDS.organization,
  outboxEventId: IDS.message,
  signal: new AbortController().signal,
  tenant: { organizationId: IDS.organization },
  canonicalEvent: {
    aggregate_id: IDS.conversation,
    aggregate_type: "conversation",
    causation_id: null,
    correlation_id: IDS.message,
    event_id: IDS.message,
    event_type: "message.response_queued",
    organization_id: IDS.organization,
    payload: { message_id: IDS.message },
    schema_version: "1",
  },
};
const fixture = (overrides: Partial<InstagramOutboundRecord> = {}) => {
  const record: InstagramOutboundRecord = {
    accountId: ACCOUNT_ID,
    bodyCiphertext: dataProtection.protectMessageBody({
      organizationId: IDS.organization,
      channelConnectionId: IDS.channel,
      content: { type: "text", text: "plain reply", locale_hint: null },
      contentType: "text",
    }).ciphertext,
    channelConnectionId: IDS.channel,
    credentialReference: "testsecret://instagram/1",
    credentialVersion: 2,
    credentialExpiresAt: new Date(NOW.getTime() + 3600000),
    deliveryStatus: "queued",
    externalThreadHash: dataProtection.threadHash({
      organizationId: IDS.organization,
      channelConnectionId: IDS.channel,
      externalConversationId: instagramConversationIdentity(ACCOUNT_ID, CUSTOMER_ID),
    }),
    lastInboundAt: new Date(NOW.getTime() - 1000),
    messageId: IDS.message,
    recipientCiphertext: dataProtection.protectContactIdentity({
      organizationId: IDS.organization,
      channelConnectionId: IDS.channel,
      identityType: "instagram_user",
      value: CUSTOMER_ID,
    }),
    ...overrides,
  };
  const load = vi.fn<InstagramOutboundPersistenceStore["load"]>((organization) =>
    Promise.resolve(organization === IDS.organization ? record : null),
  );
  const markSent = vi.fn(() => Promise.resolve(true));
  const markFailed = vi.fn(() => Promise.resolve(true));
  const sendMessage = vi.fn<InstagramPlatformClient["sendMessage"]>(() =>
    Promise.resolve({ messageId: "mid.sent" }),
  );
  const disconnect = vi.fn<InstagramPersistenceStore["disconnect"]>(() =>
    Promise.resolve(record.credentialReference),
  );
  const deleteSecret = vi.fn(() => Promise.resolve());
  let now = NOW;
  const handler = createInstagramOutboundHandler({
    client: {
      sendMessage,
      exchangeCode: () => Promise.reject(new Error("Not used")),
      refreshToken: () => Promise.reject(new Error("Not used")),
      subscribeMessages: () => Promise.resolve(),
    },
    connections: {
      disconnect,
      activate: () => Promise.resolve(false),
      beginOnboarding: () => Promise.resolve(IDS.channel),
      loadConnection: () => Promise.resolve(null),
      replaceCredential: () => Promise.resolve(false),
    },
    credentials: {
      get: () => Promise.resolve(TOKEN),
      put: () => Promise.reject(new Error("Not used")),
      delete: deleteSecret,
    },
    dataProtection,
    store: { load, markSent, markFailed },
    clock: () => now,
  });
  return {
    handler,
    load,
    record,
    markSent,
    markFailed,
    sendMessage,
    disconnect,
    deleteSecret,
    setNow: (value: Date) => {
      now = value;
    },
  };
};
describe("Instagram finite S8 outbound worker boundary", () => {
  it("decrypts only trusted tenant recipient/thread, reloads before sending and records sent state", async () => {
    const test = fixture();
    await test.handler(context);
    expect(test.load).toHaveBeenCalledTimes(2);
    expect(test.sendMessage).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      recipientId: CUSTOMER_ID,
      text: "plain reply",
      token: TOKEN,
    });
    expect(test.markSent).toHaveBeenCalledWith(IDS.organization, IDS.message, "mid.sent");
  });
  it.each([
    { deliveryStatus: "failed" as const },
    { lastInboundAt: null },
    { lastInboundAt: new Date(NOW.getTime() - 86400000) },
    { credentialExpiresAt: NOW },
    { externalThreadHash: Buffer.alloc(32) },
    { bodyCiphertext: Uint8Array.of(1) },
    { recipientCiphertext: Uint8Array.of(1) },
  ])("fails closed before HTTP for unavailable/invalid records %j", async (overrides) => {
    const test = fixture(overrides);
    await expect(test.handler(context)).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("cannot send a forged cross-tenant message", async () => {
    const test = fixture();
    await expect(
      test.handler({ ...context, organizationId: IDS.otherOrganization }),
    ).rejects.toMatchObject({ category: "TENANT_INTEGRITY" });
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("does not send completed or non-Instagram messages", async () => {
    const test = fixture({ deliveryStatus: "sent" });
    await test.handler(context);
    expect(test.sendMessage).not.toHaveBeenCalled();
    test.load.mockResolvedValue({ kind: "not_instagram" });
    await test.handler(context);
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("rejects credential rotation between secret fetch and provider send", async () => {
    const test = fixture();
    test.load.mockResolvedValueOnce(test.record).mockResolvedValueOnce({
      ...test.record,
      credentialVersion: 3,
      credentialReference: "testsecret://instagram/2",
    });
    await expect(test.handler(context)).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("rechecks the 24-hour window after secret-store latency", async () => {
    const test = fixture();
    test.load
      .mockImplementationOnce(() => Promise.resolve(test.record))
      .mockImplementationOnce(() => {
        test.setNow(new Date(NOW.getTime() + 86400000));
        return Promise.resolve({
          ...test.record,
          credentialExpiresAt: new Date(NOW.getTime() + 172800000),
        });
      });
    await expect(test.handler(context)).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("revokes auth-failed credentials/routes with CAS and leaves the channel requiring reauthorization", async () => {
    const test = fixture();
    test.sendMessage.mockRejectedValue(new InstagramProviderError("authentication_failed", false));
    await expect(test.handler(context)).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
    expect(test.disconnect).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        revoked: true,
        context: { organizationId: IDS.organization, channelConnectionId: IDS.channel },
      }),
    );
    expect(test.deleteSecret).toHaveBeenCalledWith(test.record.credentialReference);
    expect(test.markSent).not.toHaveBeenCalled();
  });
  it.each([
    ["rate_limited", false, "RATE_LIMITED"],
    ["provider_unavailable", false, "RETRYABLE_INFRASTRUCTURE"],
    ["provider_unavailable", true, "AMBIGUOUS_EXTERNAL_EFFECT"],
    ["permanent_rejection", false, "PERMANENT_BUSINESS"],
  ] as const)(
    "maps %s failures without pretending delivery",
    async (category, ambiguous, expected) => {
      const test = fixture();
      test.sendMessage.mockRejectedValue(new InstagramProviderError(category, ambiguous, 3000));
      await expect(test.handler(context)).rejects.toMatchObject({ category: expected });
      expect(test.markSent).not.toHaveBeenCalled();
    },
  );
  it("treats post-send persistence failure as ambiguous external effect", async () => {
    const test = fixture();
    test.markSent.mockResolvedValue(false);
    await expect(test.handler(context)).rejects.toMatchObject({
      category: "AMBIGUOUS_EXTERNAL_EFFECT",
    });
  });
});
