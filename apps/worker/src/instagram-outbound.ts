import {
  InstagramProviderError,
  instagramConversationIdentity,
  type CredentialSecretStore,
  type InstagramPersistenceStore,
} from "@lead-agent/application";
import { MessageIdSchema, OrganizationIdSchema, isSchemaValue } from "@lead-agent/contracts";
import type { InstagramOutboundPersistenceStore } from "@lead-agent/database";
import type { InstagramPlatformClient } from "@lead-agent/integrations";
import type { CustomerDataProtection } from "@lead-agent/security";
import type { WorkerEventHandler } from "./handler-registry.js";
import { WorkerExecutionFailure } from "./reliability-policy.js";

export const createInstagramOutboundHandler =
  (
    dependencies: Readonly<{
      client: InstagramPlatformClient;
      credentials: CredentialSecretStore;
      connections: InstagramPersistenceStore;
      dataProtection: CustomerDataProtection;
      store: InstagramOutboundPersistenceStore;
      clock?: () => Date;
      onCredentialCleanupFailure?: () => void;
    }>,
  ): WorkerEventHandler =>
  async (context) => {
    if (context.signal.aborted) throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
    const messageId: unknown =
      typeof context.canonicalEvent.payload === "object" && context.canonicalEvent.payload !== null
        ? Reflect.get(context.canonicalEvent.payload, "message_id")
        : null;
    if (
      context.canonicalEvent.event_type !== "message.response_queued" ||
      !isSchemaValue(MessageIdSchema, messageId) ||
      !isSchemaValue(OrganizationIdSchema, context.organizationId)
    )
      throw new WorkerExecutionFailure("PERMANENT_VALIDATION");
    const organizationId = context.organizationId;
    const outbound = await dependencies.store.load(organizationId, messageId);
    if (outbound === null) throw new WorkerExecutionFailure("TENANT_INTEGRITY");
    if ("kind" in outbound || outbound.deliveryStatus === "sent") return;
    const permanent = async (): Promise<never> => {
      await dependencies.store.markFailed(organizationId, messageId);
      throw new WorkerExecutionFailure("PERMANENT_BUSINESS");
    };
    const now = (dependencies.clock ?? (() => new Date()))();
    if (
      outbound.deliveryStatus === "failed" ||
      outbound.credentialExpiresAt.getTime() <= now.getTime() ||
      outbound.lastInboundAt === null ||
      !Number.isFinite(outbound.lastInboundAt.getTime()) ||
      now.getTime() - outbound.lastInboundAt.getTime() >= 24 * 60 * 60 * 1000 ||
      outbound.lastInboundAt.getTime() > now.getTime() + 5 * 60 * 1000
    )
      return permanent();
    let recipient: string;
    let text: string | null;
    try {
      recipient = dependencies.dataProtection.revealContactIdentity({
        organizationId,
        channelConnectionId: outbound.channelConnectionId,
        ciphertext: outbound.recipientCiphertext,
        identityType: "instagram_user",
      });
      text = dependencies.dataProtection.revealMessageBody({
        organizationId,
        channelConnectionId: outbound.channelConnectionId,
        ciphertext: outbound.bodyCiphertext,
        contentType: "text",
      });
      const expected = dependencies.dataProtection.threadHash({
        organizationId,
        channelConnectionId: outbound.channelConnectionId,
        externalConversationId: instagramConversationIdentity(outbound.accountId, recipient),
      });
      if (!Buffer.from(expected).equals(Buffer.from(outbound.externalThreadHash)))
        return permanent();
    } catch {
      return permanent();
    }
    if (
      !/^[1-9][0-9]{0,31}$/u.test(recipient) ||
      text === null ||
      text.length < 1 ||
      Buffer.byteLength(text, "utf8") > 1000
    )
      return permanent();
    const token = await dependencies.credentials.get(outbound.credentialReference);
    if (token === null) return permanent();
    // Recheck the trusted channel and credential after secret I/O, immediately before sending.
    const current = await dependencies.store.load(organizationId, messageId);
    if (
      current === null ||
      "kind" in current ||
      current.credentialReference !== outbound.credentialReference ||
      current.credentialVersion !== outbound.credentialVersion ||
      current.accountId !== outbound.accountId ||
      !Buffer.from(current.externalThreadHash).equals(Buffer.from(outbound.externalThreadHash))
    )
      return permanent();
    if (current.deliveryStatus === "sent") return;
    if (
      current.channelConnectionId !== outbound.channelConnectionId ||
      !Buffer.from(current.recipientCiphertext).equals(Buffer.from(outbound.recipientCiphertext)) ||
      !Buffer.from(current.bodyCiphertext).equals(Buffer.from(outbound.bodyCiphertext)) ||
      current.credentialExpiresAt.getTime() <=
        (dependencies.clock ?? (() => new Date()))().getTime()
    )
      return permanent();
    if (current.deliveryStatus !== "queued") return permanent();
    const sendNow = (dependencies.clock ?? (() => new Date()))();
    if (
      current.lastInboundAt === null ||
      !Number.isFinite(current.lastInboundAt.getTime()) ||
      sendNow.getTime() - current.lastInboundAt.getTime() >= 24 * 60 * 60 * 1000 ||
      current.lastInboundAt.getTime() > sendNow.getTime() + 5 * 60 * 1000
    )
      return permanent();
    if (context.signal.aborted) throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
    let providerMessageId: string;
    try {
      providerMessageId = (
        await dependencies.client.sendMessage({
          accountId: current.accountId,
          recipientId: recipient,
          text,
          token,
        })
      ).messageId;
    } catch (error) {
      if (error instanceof InstagramProviderError) {
        if (error.category === "authentication_failed") {
          const revoked = await dependencies.connections.disconnect({
            context: { organizationId, channelConnectionId: current.channelConnectionId },
            expectedVersion: current.credentialVersion,
            revoked: true,
            now,
          });
          if (revoked !== null) {
            try {
              await dependencies.credentials.delete(revoked);
            } catch {
              (
                dependencies.onCredentialCleanupFailure ??
                (() => console.error("Instagram credential cleanup failed"))
              )();
            }
          }
          return permanent();
        }
        if (error.category === "rate_limited")
          throw new WorkerExecutionFailure("RATE_LIMITED", {
            retryAfterMilliseconds: error.retryAfterMilliseconds,
          });
        if (error.ambiguousExternalEffect)
          throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
        if (error.category === "provider_unavailable")
          throw new WorkerExecutionFailure("RETRYABLE_INFRASTRUCTURE");
        return permanent();
      }
      throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
    }
    if (!(await dependencies.store.markSent(organizationId, messageId, providerMessageId)))
      throw new WorkerExecutionFailure("AMBIGUOUS_EXTERNAL_EFFECT");
  };
