import {
  MessageIdSchema,
  OrganizationIdSchema,
  isSchemaValue,
  type MessageId,
  type OrganizationId,
} from "@lead-agent/contracts";
import { telegramConversationIdentity } from "@lead-agent/application";
import type { TelegramOutboundPersistenceStore } from "@lead-agent/database";
import { TelegramProviderError, type TelegramPlatformClient } from "@lead-agent/integrations";
import type { CustomerDataProtection } from "@lead-agent/security";

import { createWorkerHandlerRegistry, type WorkerEventHandler } from "./handler-registry.js";
import { WorkerExecutionFailure } from "./reliability-policy.js";

const TELEGRAM_REPLY_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000;
const TELEGRAM_USER_ID_PATTERN = /^[1-9][0-9]{0,15}$/u;

const requireMessageId = (payload: unknown): MessageId => {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new WorkerExecutionFailure("PERMANENT_VALIDATION");
  }
  const messageId: unknown = Reflect.get(payload, "message_id");
  if (!isSchemaValue(MessageIdSchema, messageId)) {
    throw new WorkerExecutionFailure("PERMANENT_VALIDATION");
  }
  return messageId;
};

const permanentFailure = async (
  store: TelegramOutboundPersistenceStore,
  organizationId: OrganizationId,
  messageId: MessageId,
): Promise<never> => {
  await store.markFailed(organizationId, messageId);
  throw new WorkerExecutionFailure("PERMANENT_BUSINESS");
};

const providerFailure = async (
  error: TelegramProviderError,
  store: TelegramOutboundPersistenceStore,
  organizationId: OrganizationId,
  messageId: MessageId,
): Promise<never> => {
  if (error.category === "rate_limited") {
    throw new WorkerExecutionFailure("RATE_LIMITED", {
      retryAfterMilliseconds: error.retryAfterMilliseconds,
    });
  }
  if (error.ambiguousExternalEffect) {
    throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
  }
  if (error.category === "provider_unavailable" || error.category === "authentication_failed") {
    throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
  }
  return await permanentFailure(store, organizationId, messageId);
};

export const createTelegramOutboundHandler = (dependencies: {
  client: TelegramPlatformClient;
  clock?: () => Date;
  dataProtection: CustomerDataProtection;
  store: TelegramOutboundPersistenceStore;
}): WorkerEventHandler => {
  const clock = dependencies.clock ?? (() => new Date());
  return async (context) => {
    if (context.signal.aborted) throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
    if (
      context.canonicalEvent.event_type !== "message.response_queued" ||
      !isSchemaValue(OrganizationIdSchema, context.organizationId)
    ) {
      throw new WorkerExecutionFailure("PERMANENT_VALIDATION");
    }
    const organizationId = context.organizationId;
    const messageId = requireMessageId(context.canonicalEvent.payload);
    const outbound = await dependencies.store.load(organizationId, messageId);
    if (outbound === null) throw new WorkerExecutionFailure("TENANT_INTEGRITY");
    if ("kind" in outbound) return;
    if (outbound.deliveryStatus === "sent") return;
    if (outbound.deliveryStatus === "failed") {
      throw new WorkerExecutionFailure("PERMANENT_BUSINESS");
    }
    const now = clock();
    if (
      !outbound.canReply ||
      outbound.lastInboundAt === null ||
      now.getTime() - outbound.lastInboundAt.getTime() >= TELEGRAM_REPLY_WINDOW_MILLISECONDS
    ) {
      return await permanentFailure(dependencies.store, organizationId, messageId);
    }
    const recipient = dependencies.dataProtection.revealContactIdentity({
      channelConnectionId: outbound.channelConnectionId,
      ciphertext: outbound.recipientCiphertext,
      identityType: "telegram_user",
      organizationId,
    });
    const text = dependencies.dataProtection.revealMessageBody({
      channelConnectionId: outbound.channelConnectionId,
      ciphertext: outbound.bodyCiphertext,
      contentType: outbound.contentType,
      organizationId,
    });
    const expectedThreadHash = dependencies.dataProtection.threadHash({
      channelConnectionId: outbound.channelConnectionId,
      externalConversationId: telegramConversationIdentity(
        outbound.businessConnectionId,
        recipient,
      ),
      organizationId,
    });
    if (
      !Buffer.from(expectedThreadHash).equals(Buffer.from(outbound.externalThreadHash)) ||
      !TELEGRAM_USER_ID_PATTERN.test(recipient) ||
      text === null ||
      text.length > 4_000
    ) {
      return await permanentFailure(dependencies.store, organizationId, messageId);
    }
    let providerMessageId: string;
    try {
      providerMessageId = (
        await dependencies.client.sendMessage({
          businessConnectionId: outbound.businessConnectionId,
          chatId: recipient,
          text,
        })
      ).messageId;
    } catch (error) {
      if (error instanceof TelegramProviderError) {
        return await providerFailure(error, dependencies.store, organizationId, messageId);
      }
      throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
    }
    if (!(await dependencies.store.markSent(organizationId, messageId, providerMessageId))) {
      throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
    }
  };
};

export const createProductionHandlerRegistry = (dependencies: {
  telegramOutbound: WorkerEventHandler;
  instagramOutbound?: WorkerEventHandler;
  aiMessage?: WorkerEventHandler;
}) =>
  createWorkerHandlerRegistry([
    ...(dependencies.aiMessage === undefined
      ? []
      : [
          {
            eventType: "message.received",
            handler: dependencies.aiMessage,
            handlerVersion: "v1",
            queue: "ai",
            schemaVersion: "1",
          },
        ]),
    {
      eventType: "message.response_queued",
      handler:
        dependencies.instagramOutbound === undefined
          ? dependencies.telegramOutbound
          : async (context: Parameters<WorkerEventHandler>[0]) => {
              await dependencies.telegramOutbound(context);
              await dependencies.instagramOutbound?.(context);
            },
      handlerVersion: "v1",
      queue: "outbound_message",
      schemaVersion: "1",
    },
  ]);
