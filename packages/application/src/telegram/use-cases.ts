import { createHash, randomBytes } from "node:crypto";

import {
  CanonicalInboundEventSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelConnectionId,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";

import type { InboundRouteResolver, TrustedInboundRoute } from "../channels/index.js";
import {
  createCanonicalInboundUseCases,
  type CanonicalInboundDataProtector,
  type CanonicalInboundPersistenceStore,
} from "../conversations/inbound-use-cases.js";

const DISPLAY_NAME_PATTERN = /^\S(?:.{0,198}\S)?$/u;
const ONBOARDING_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ONBOARDING_LIFETIME_MILLISECONDS = 15 * 60 * 1_000;

export type TelegramInboundContent = Extract<
  CanonicalInboundEvent["content"],
  { type: "attachment" | "quick_reply" | "text" }
>;

export type TelegramNormalizedUpdate =
  | Readonly<{
      kind: "onboarding_start";
      nonce: string;
      ownerUserId: string;
      updateId: string;
    }>
  | Readonly<{
      businessConnectionId: string;
      canReply: boolean;
      establishedAt: string;
      isEnabled: boolean;
      kind: "business_connection";
      ownerUserId: string;
      updateId: string;
    }>
  | Readonly<{
      businessConnectionId: string;
      chatId: string;
      content: TelegramInboundContent;
      kind: "business_message";
      messageId: string;
      occurredAt: string;
      senderIsBot: boolean;
      senderUserId: string;
      updateId: string;
    }>
  | Readonly<{
      businessConnectionId: string;
      callbackQueryId: string;
      chatId: string;
      content: Extract<TelegramInboundContent, { type: "quick_reply" }>;
      kind: "callback_query";
      occurredAt: string;
      senderIsBot: boolean;
      senderUserId: string;
      updateId: string;
    }>
  | Readonly<{ kind: "ignored"; updateId: string | null }>;

export type TelegramConnectionAuthority = Readonly<{
  businessConnectionId: string;
  canReply: boolean;
  isEnabled: boolean;
  ownerUserIdHash: Uint8Array;
}>;

export type TelegramOnboardingRecord = Readonly<{
  channelConnectionId: ChannelConnectionId;
}>;

export interface TelegramPersistenceStore {
  beginOnboarding(
    input: Readonly<{
      actor: AuthorizationContext;
      displayName: string;
      expiresAt: Date;
      nonceHash: Uint8Array;
      now: Date;
    }>,
  ): Promise<TelegramOnboardingRecord>;
  bindOwner(
    input: Readonly<{
      context: TrustedInboundRoute;
      newOwnerRouteHash: Uint8Array;
      nonceHash: Uint8Array;
      now: Date;
      ownerUserIdHash: Uint8Array;
    }>,
  ): Promise<boolean>;
  bindBusinessConnection(
    input: Readonly<{
      businessConnectionId: string;
      businessConnectionIdHash: Uint8Array;
      canReply: boolean;
      context: TrustedInboundRoute;
      establishedAt: Date;
      now: Date;
      ownerRouteHash: Uint8Array;
      ownerUserIdHash: Uint8Array;
    }>,
  ): Promise<boolean>;
  applyBusinessConnectionUpdate(
    input: Readonly<{
      businessConnectionId: string;
      businessConnectionIdHash: Uint8Array;
      canReply: boolean;
      context: TrustedInboundRoute;
      isEnabled: boolean;
      now: Date;
      ownerUserIdHash: Uint8Array;
    }>,
  ): Promise<boolean>;
  loadConnection(
    input: Readonly<{
      businessConnectionId: string;
      businessConnectionIdHash: Uint8Array;
      context: TrustedInboundRoute;
    }>,
  ): Promise<TelegramConnectionAuthority | null>;
}

export interface TelegramCallbackAcknowledger {
  answerCallbackQuery(callbackQueryId: string): Promise<void>;
}

export interface TelegramPlatformProvisioner {
  ensureWebhook(): Promise<void>;
}

export type TelegramWebhookOutcome = Readonly<{
  status: "accepted" | "duplicate" | "ignored";
}>;

export class TelegramApplicationError extends Error {
  constructor(
    public readonly code:
      "business_rule_failed" | "channel_unavailable" | "permission_denied" | "validation_failed",
  ) {
    super(code);
    this.name = "TelegramApplicationError";
  }
}

export type TelegramBusinessUseCases = Readonly<{
  beginOnboarding(
    input: Readonly<{
      authorization: AuthorizationContext;
      displayName: string;
    }>,
  ): Promise<Readonly<{ channelConnectionId: ChannelConnectionId; onboardingUrl: string }>>;
  processUpdate(update: TelegramNormalizedUpdate): Promise<TelegramWebhookOutcome>;
}>;

const sha256 = (value: string): Uint8Array => createHash("sha256").update(value, "utf8").digest();
export const telegramOwnerRouteHash = (ownerUserId: string): Uint8Array =>
  sha256(`telegram-owner:v1\0${ownerUserId}`);
export const telegramBusinessConnectionRouteHash = (businessConnectionId: string): Uint8Array =>
  sha256(`telegram-business-connection:v1\0${businessConnectionId}`);
const accountIdentity = (businessConnectionId: string): string =>
  `telegram-business:${Buffer.from(telegramBusinessConnectionRouteHash(businessConnectionId)).toString("base64url")}`;
export const telegramConversationIdentity = (
  businessConnectionId: string,
  chatId: string,
): string => `${accountIdentity(businessConnectionId)}:private:${chatId}`;
const scopedMessageIdentity = (
  businessConnectionId: string,
  chatId: string,
  messageId: string,
): string =>
  `telegram:${Buffer.from(sha256(`${businessConnectionId}\0${chatId}`)).toString("base64url")}:${messageId}`;

const ignored = (): TelegramWebhookOutcome => Object.freeze({ status: "ignored" });

export const createTelegramBusinessUseCases = (dependencies: {
  botUsername: string;
  callbackAcknowledger: TelegramCallbackAcknowledger;
  clock?: () => Date;
  dataProtector: CanonicalInboundDataProtector;
  onCallbackAcknowledgementFailure?: () => void;
  persistence: TelegramPersistenceStore;
  platformProvisioner: TelegramPlatformProvisioner;
  routeResolver: InboundRouteResolver;
  canonicalStore: CanonicalInboundPersistenceStore;
  randomNonce?: () => string;
}): TelegramBusinessUseCases => {
  const clock = dependencies.clock ?? (() => new Date());
  const randomNonce = dependencies.randomNonce ?? (() => randomBytes(32).toString("base64url"));
  const canonical = createCanonicalInboundUseCases(
    dependencies.canonicalStore,
    dependencies.dataProtector,
  );

  const route = async (hash: Uint8Array): Promise<TrustedInboundRoute | null> =>
    await dependencies.routeResolver.resolveInboundRoute("telegram_webhook", hash);

  const acceptCustomerUpdate = async (
    update: Extract<TelegramNormalizedUpdate, { kind: "business_message" | "callback_query" }>,
  ): Promise<TelegramWebhookOutcome> => {
    const businessHash = telegramBusinessConnectionRouteHash(update.businessConnectionId);
    const context = await route(businessHash);
    if (context === null) return ignored();
    const authority = await dependencies.persistence.loadConnection({
      businessConnectionId: update.businessConnectionId,
      businessConnectionIdHash: businessHash,
      context,
    });
    if (authority === null || !authority.isEnabled) return ignored();
    if (
      update.senderIsBot ||
      Buffer.from(authority.ownerUserIdHash).equals(
        Buffer.from(telegramOwnerRouteHash(update.senderUserId)),
      )
    ) {
      return ignored();
    }
    const externalMessageId =
      update.kind === "callback_query"
        ? `telegram:callback:${Buffer.from(sha256(update.callbackQueryId)).toString("base64url")}`
        : scopedMessageIdentity(update.businessConnectionId, update.chatId, update.messageId);
    const event: unknown = {
      channel: "telegram",
      channel_connection_id: context.channelConnectionId,
      content: update.content,
      event_id: `telegram:update:${update.updateId}`,
      external_account_id: accountIdentity(update.businessConnectionId),
      external_conversation_id: telegramConversationIdentity(
        update.businessConnectionId,
        update.chatId,
      ),
      external_message_id: externalMessageId,
      external_sender_id: update.senderUserId,
      kind: update.content.type,
      occurred_at: update.occurredAt,
      received_at: clock().toISOString(),
    };
    if (!isSchemaValue(CanonicalInboundEventSchema, event)) {
      throw new TelegramApplicationError("validation_failed");
    }
    const result = await canonical.acceptInbound({ context, event });
    if (!result.ok) {
      if (result.error.code === "channel_unavailable") {
        throw new TelegramApplicationError("channel_unavailable");
      }
      throw new TelegramApplicationError("business_rule_failed");
    }
    if (update.kind === "callback_query") {
      try {
        await dependencies.callbackAcknowledger.answerCallbackQuery(update.callbackQueryId);
      } catch {
        dependencies.onCallbackAcknowledgementFailure?.();
      }
    }
    return Object.freeze({ status: result.value.status });
  };

  return Object.freeze({
    beginOnboarding: async ({ authorization, displayName }) => {
      if (
        !isAuthorizationContext(authorization) ||
        !hasPermission(authorization.role, "integrations.manage")
      ) {
        throw new TelegramApplicationError("permission_denied");
      }
      if (!DISPLAY_NAME_PATTERN.test(displayName)) {
        throw new TelegramApplicationError("validation_failed");
      }
      await dependencies.platformProvisioner.ensureWebhook();
      const nonce = randomNonce();
      if (!ONBOARDING_NONCE_PATTERN.test(nonce)) {
        throw new TelegramApplicationError("business_rule_failed");
      }
      const now = clock();
      const record = await dependencies.persistence.beginOnboarding({
        actor: authorization,
        displayName,
        expiresAt: new Date(now.getTime() + ONBOARDING_LIFETIME_MILLISECONDS),
        nonceHash: sha256(nonce),
        now,
      });
      return Object.freeze({
        channelConnectionId: record.channelConnectionId,
        onboardingUrl: `https://t.me/${dependencies.botUsername}?start=${nonce}`,
      });
    },
    processUpdate: async (update) => {
      if (update.kind === "ignored") return ignored();
      const now = clock();
      if (update.kind === "onboarding_start") {
        const nonceHash = sha256(update.nonce);
        const context = await route(nonceHash);
        if (context === null) return ignored();
        const ownerUserIdHash = telegramOwnerRouteHash(update.ownerUserId);
        const bound = await dependencies.persistence.bindOwner({
          context,
          newOwnerRouteHash: ownerUserIdHash,
          nonceHash,
          now,
          ownerUserIdHash,
        });
        return bound ? Object.freeze({ status: "accepted" }) : ignored();
      }
      if (update.kind === "business_connection") {
        const establishedAt = new Date(update.establishedAt);
        if (!Number.isFinite(establishedAt.getTime())) {
          throw new TelegramApplicationError("validation_failed");
        }
        const businessHash = telegramBusinessConnectionRouteHash(update.businessConnectionId);
        const ownerHash = telegramOwnerRouteHash(update.ownerUserId);
        const existing = await route(businessHash);
        if (existing !== null) {
          const changed = await dependencies.persistence.applyBusinessConnectionUpdate({
            businessConnectionId: update.businessConnectionId,
            businessConnectionIdHash: businessHash,
            canReply: update.canReply,
            context: existing,
            isEnabled: update.isEnabled,
            now,
            ownerUserIdHash: ownerHash,
          });
          return changed ? Object.freeze({ status: "accepted" }) : ignored();
        }
        if (!update.isEnabled || !update.canReply) return ignored();
        const pending = await route(ownerHash);
        if (pending === null) return ignored();
        const bound = await dependencies.persistence.bindBusinessConnection({
          businessConnectionId: update.businessConnectionId,
          businessConnectionIdHash: businessHash,
          canReply: update.canReply,
          context: pending,
          establishedAt,
          now,
          ownerRouteHash: ownerHash,
          ownerUserIdHash: ownerHash,
        });
        return bound ? Object.freeze({ status: "accepted" }) : ignored();
      }
      return await acceptCustomerUpdate(update);
    },
  });
};
