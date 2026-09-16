import { describe, expect, it, vi } from "vitest";
import {
  createProductionHandlerRegistry,
  createTelegramOutboundHandler,
} from "../../apps/worker/src/telegram-outbound.js";
import type { WorkerHandlerContext } from "../../apps/worker/src/handler-registry.js";
import { WorkerExecutionFailure } from "../../apps/worker/src/reliability-policy.js";
import { telegramConversationIdentity } from "../../packages/application/src/index.js";
import type {
  TelegramOutboundPersistenceStore,
  TelegramOutboundRecord,
} from "../../packages/database/src/index.js";
import {
  TelegramProviderError,
  type TelegramPlatformClient,
} from "../../packages/integrations/src/telegram/client.js";
import { dataProtection, IDS, NOW } from "./fixtures.js";

const context: WorkerHandlerContext = {
  attempt: { attemptNumber: 1, jobId: IDS.message, retryLimit: 5 },
  causationId: null,
  correlationId: IDS.message,
  identity: {
    handlerVersion: "v1",
    idempotencyKey: "logical-test-id",
    outboxEventId: IDS.message,
    providerIdempotencyKey: "logical-test-id",
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
const fixture = (overrides: Partial<TelegramOutboundRecord> = {}) => {
  const record: TelegramOutboundRecord = {
    bodyCiphertext: dataProtection.protectMessageBody({
      channelConnectionId: IDS.channel,
      content: { type: "text", text: "plain reply", locale_hint: null },
      contentType: "text",
      organizationId: IDS.organization,
    }).ciphertext,
    businessConnectionId: "business-test-1",
    canReply: true,
    channelConnectionId: IDS.channel,
    contentType: "text",
    deliveryStatus: "queued",
    externalThreadHash: dataProtection.threadHash({
      channelConnectionId: IDS.channel,
      externalConversationId: telegramConversationIdentity("business-test-1", "123"),
      organizationId: IDS.organization,
    }),
    lastInboundAt: new Date(NOW.getTime() - 1000),
    messageId: IDS.message,
    recipientCiphertext: dataProtection.protectContactIdentity({
      channelConnectionId: IDS.channel,
      identityType: "telegram_user",
      organizationId: IDS.organization,
      value: "123",
    }),
    ...overrides,
  };
  const load = vi.fn<TelegramOutboundPersistenceStore["load"]>((organizationId) =>
    Promise.resolve(organizationId === IDS.organization ? record : null),
  );
  const markSent = vi.fn(() => Promise.resolve(true));
  const markFailed = vi.fn(() => Promise.resolve(true));
  const sendMessage = vi.fn<TelegramPlatformClient["sendMessage"]>(() =>
    Promise.resolve({ messageId: "44" }),
  );
  const client: TelegramPlatformClient = {
    sendMessage,
    answerCallbackQuery: () => Promise.resolve(),
    getBusinessConnection: () =>
      Promise.resolve({
        id: "business-test-1",
        ownerUserId: "456",
        canReply: true,
        isEnabled: true,
      }),
    getMe: () => Promise.resolve({ id: "999", username: "SyntheticBusinessBot" }),
    getWebhookInfo: () => Promise.resolve({ allowedUpdates: [], url: "" }),
    setWebhook: () => Promise.resolve(),
  };
  const handler = createTelegramOutboundHandler({
    client,
    clock: () => NOW,
    dataProtection,
    store: { load, markFailed, markSent },
  });
  return { handler, load, markFailed, markSent, sendMessage };
};
describe("Telegram Business S8 outbound handler", () => {
  it("sends once logically to the verified business/customer thread and persists sent state", async () => {
    const test = fixture();
    await test.handler(context);
    expect(test.sendMessage).toHaveBeenCalledWith({
      businessConnectionId: "business-test-1",
      chatId: "123",
      text: "plain reply",
    });
    expect(test.markSent).toHaveBeenCalledWith(IDS.organization, IDS.message, "44");
    const sent = fixture({ deliveryStatus: "sent" });
    await sent.handler(context);
    expect(sent.sendMessage).not.toHaveBeenCalled();
  });
  it.each([
    { canReply: false },
    { lastInboundAt: null },
    { lastInboundAt: new Date(NOW.getTime() - 86400000) },
    { externalThreadHash: Buffer.alloc(32) },
  ])("fails closed for unavailable rights/window/recipient %j", async (overrides) => {
    const test = fixture(overrides);
    await expect(test.handler(context)).rejects.toMatchObject({ category: "PERMANENT_BUSINESS" });
    expect(test.sendMessage).not.toHaveBeenCalled();
    expect(test.markFailed).toHaveBeenCalled();
  });
  it("does not send a forged cross-tenant message ID", async () => {
    const test = fixture();
    await expect(
      test.handler({ ...context, organizationId: IDS.otherOrganization }),
    ).rejects.toMatchObject({ category: "TENANT_INTEGRITY" });
    expect(test.sendMessage).not.toHaveBeenCalled();
  });
  it("leaves Widget/non-Telegram delivery to its existing path", async () => {
    const test = fixture();
    test.load.mockResolvedValue({ kind: "not_telegram" });
    await test.handler(context);
    expect(test.sendMessage).not.toHaveBeenCalled();
    expect(test.markSent).not.toHaveBeenCalled();
  });
  it.each([
    ["rate_limited", false, "RATE_LIMITED"],
    ["authentication_failed", false, "RETRYABLE_INFRASTRUCTURE"],
    ["permanent_rejection", false, "PERMANENT_BUSINESS"],
    ["provider_unavailable", true, "AMBIGUOUS_EXTERNAL_EFFECT"],
  ] as const)("maps %s without pretending delivery", async (category, ambiguous, failure) => {
    const test = fixture();
    test.sendMessage.mockRejectedValue(new TelegramProviderError(category, ambiguous, 3000));
    await expect(test.handler(context)).rejects.toMatchObject({ category: failure });
    expect(test.markSent).not.toHaveBeenCalled();
  });
  it("preserves ambiguous external-send/persistence failures instead of promising exactly-once", async () => {
    const test = fixture();
    test.markSent.mockResolvedValue(false);
    await expect(test.handler(context)).rejects.toBeInstanceOf(WorkerExecutionFailure);
  });
  it("registers only the canonical queued-response handler", () => {
    const registry = createProductionHandlerRegistry({ telegramOutbound: fixture().handler });
    expect(registry.registrations).toHaveLength(1);
    expect(registry.activeQueues).toEqual(["outbound_message"]);
  });
});
