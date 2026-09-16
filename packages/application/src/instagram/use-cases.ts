import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CanonicalInboundEventSchema,
  ChannelConnectionIdSchema,
  isSchemaValue,
  type ChannelConnectionId,
} from "@lead-agent/contracts";
import {
  hasPermission,
  isAuthorizationContext,
  type AuthorizationContext,
} from "@lead-agent/security";
import {
  isCredentialSecretReference,
  type CredentialSecretStore,
  type InboundRouteResolver,
  type TrustedInboundRoute,
} from "../channels/index.js";
import {
  createCanonicalInboundUseCases,
  type CanonicalInboundDataProtector,
  type CanonicalInboundPersistenceStore,
} from "../conversations/index.js";
import {
  InstagramApplicationError,
  InstagramProviderError,
  type InstagramConnection,
  type InstagramInboundMessage,
  type InstagramOAuthClient,
  type InstagramPersistenceStore,
} from "./ports.js";

const hash = (value: string): Uint8Array => createHash("sha256").update(value, "utf8").digest();
export const instagramAccountRouteHash = (accountId: string): Uint8Array => hash(accountId);
export const instagramConversationIdentity = (accountId: string, customerId: string): string =>
  `instagram:${Buffer.from(instagramAccountRouteHash(accountId)).toString("base64url")}:private:${customerId}`;
const sameHash = (left: Uint8Array | null, right: Uint8Array): boolean =>
  left !== null && left.byteLength === right.byteLength && timingSafeEqual(left, right);
const requireStaff = (authorization: AuthorizationContext): void => {
  if (
    !isAuthorizationContext(authorization) ||
    !hasPermission(authorization.role, "integrations.manage")
  )
    throw new InstagramApplicationError("permission_denied");
};
const active = (
  connection: InstagramConnection | null,
  now: Date,
): connection is InstagramConnection & {
  accountId: string;
  credentialReference: string;
  expiresAt: string;
} =>
  connection?.status === "active" &&
  connection.accountId !== null &&
  connection.credentialReference !== null &&
  connection.expiresAt !== null &&
  Date.parse(connection.expiresAt) > now.getTime();

export type InstagramBusinessUseCases = Readonly<{
  beginOnboarding(
    input: Readonly<{ authorization: AuthorizationContext; displayName: string }>,
  ): Promise<Readonly<{ authorizationUrl: string }>>;
  completeOnboarding(input: Readonly<{ code: string; state: string }>): Promise<void>;
  disconnect(
    input: Readonly<{
      authorization: AuthorizationContext;
      channelConnectionId: ChannelConnectionId;
    }>,
  ): Promise<void>;
  refreshCredential(
    input: Readonly<{
      authorization: AuthorizationContext;
      channelConnectionId: ChannelConnectionId;
    }>,
  ): Promise<void>;
  processMessage(
    message: InstagramInboundMessage,
  ): Promise<Readonly<{ status: "accepted" | "duplicate" | "ignored" }>>;
}>;

export const createInstagramBusinessUseCases = (
  dependencies: Readonly<{
    appId: string;
    oauthRedirectUri: string;
    canonicalStore: CanonicalInboundPersistenceStore;
    dataProtector: CanonicalInboundDataProtector;
    credentials: CredentialSecretStore;
    oauth: InstagramOAuthClient;
    persistence: InstagramPersistenceStore;
    routeResolver: InboundRouteResolver;
    clock?: () => Date;
    randomState?: () => string;
    onCredentialCleanupFailure?: () => void;
  }>,
): InstagramBusinessUseCases => {
  const clock = dependencies.clock ?? (() => new Date());
  const canonical = createCanonicalInboundUseCases(
    dependencies.canonicalStore,
    dependencies.dataProtector,
  );
  const deleteCredential = async (reference: string): Promise<void> => {
    try {
      await dependencies.credentials.delete(reference);
    } catch {
      (
        dependencies.onCredentialCleanupFailure ??
        (() => console.error("Instagram credential cleanup failed"))
      )();
    }
  };
  const contextFor = (
    authorization: AuthorizationContext,
    channelConnectionId: ChannelConnectionId,
  ): TrustedInboundRoute => {
    requireStaff(authorization);
    if (!isSchemaValue(ChannelConnectionIdSchema, channelConnectionId))
      throw new InstagramApplicationError("validation_failed");
    return Object.freeze({ channelConnectionId, organizationId: authorization.organizationId });
  };
  return Object.freeze<InstagramBusinessUseCases>({
    beginOnboarding: async ({ authorization, displayName }) => {
      requireStaff(authorization);
      if (!/^\S(?:.{0,198}\S)?$/u.test(displayName))
        throw new InstagramApplicationError("validation_failed");
      const state = (dependencies.randomState ?? (() => randomBytes(32).toString("base64url")))();
      if (!/^[A-Za-z0-9_-]{43}$/u.test(state))
        throw new InstagramApplicationError("business_rule_failed");
      const now = clock();
      await dependencies.persistence.beginOnboarding({
        actor: authorization,
        displayName,
        stateHash: hash(state),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        now,
      });
      const parameters = new URLSearchParams({
        client_id: dependencies.appId,
        redirect_uri: dependencies.oauthRedirectUri,
        response_type: "code",
        scope: "instagram_business_basic,instagram_business_manage_messages",
        state,
        enable_fb_login: "false",
      });
      return Object.freeze({
        authorizationUrl: `https://www.instagram.com/oauth/authorize?${parameters.toString()}`,
      });
    },
    completeOnboarding: async ({ code, state }) => {
      if (!/^[A-Za-z0-9_-]{43}$/u.test(state) || !/^[A-Za-z0-9_.|-]{1,2048}$/u.test(code))
        throw new InstagramApplicationError("validation_failed");
      const stateHash = hash(state);
      const context = await dependencies.routeResolver.resolveInboundRoute(
        "instagram_webhook",
        stateHash,
      );
      if (context === null) throw new InstagramApplicationError("channel_unavailable");
      const pending = await dependencies.persistence.loadConnection(context);
      if (
        pending?.status !== "pending" ||
        !sameHash(pending.stateHash, stateHash) ||
        pending.onboardingExpiresAt === null ||
        Date.parse(pending.onboardingExpiresAt) <= clock().getTime()
      )
        throw new InstagramApplicationError("channel_unavailable");
      // Each persistence method owns only a short transaction. No provider/secret I/O occurs inside it.
      const verified = await dependencies.oauth.exchangeCode(code);
      await dependencies.oauth.subscribeMessages(verified.accountId, verified.token);
      const reference = await dependencies.credentials.put(verified.token);
      if (!isCredentialSecretReference(reference)) {
        await deleteCredential(reference);
        throw new InstagramApplicationError("business_rule_failed");
      }
      try {
        const now = clock();
        const changed = await dependencies.persistence.activate({
          context,
          stateHash,
          accountId: verified.accountId,
          accountHash: instagramAccountRouteHash(verified.accountId),
          credentialReference: reference,
          expiresAt: new Date(now.getTime() + verified.expiresInSeconds * 1000),
          now,
        });
        if (!changed) throw new InstagramApplicationError("channel_unavailable");
      } catch (error) {
        await deleteCredential(reference);
        if (error instanceof InstagramApplicationError) throw error;
        throw new InstagramApplicationError("business_rule_failed");
      }
    },
    disconnect: async ({ authorization, channelConnectionId }) => {
      const context = contextFor(authorization, channelConnectionId);
      if ((await dependencies.persistence.loadConnection(context)) === null)
        throw new InstagramApplicationError("channel_unavailable");
      const reference = await dependencies.persistence.disconnect({
        actor: authorization,
        context,
        now: clock(),
        revoked: false,
      });
      if (reference !== null) await deleteCredential(reference);
    },
    refreshCredential: async ({ authorization, channelConnectionId }) => {
      const context = contextFor(authorization, channelConnectionId);
      const current = await dependencies.persistence.loadConnection(context);
      if (!active(current, clock())) throw new InstagramApplicationError("channel_unavailable");
      if (
        current.credentialIssuedAt === null ||
        clock().getTime() - Date.parse(current.credentialIssuedAt) < 24 * 60 * 60 * 1000
      )
        throw new InstagramApplicationError("business_rule_failed");
      const token = await dependencies.credentials.get(current.credentialReference);
      if (token === null) throw new InstagramApplicationError("channel_unavailable");
      const refreshed = await dependencies.oauth
        .refreshToken(token)
        .catch(async (error: unknown) => {
          if (
            error instanceof InstagramProviderError &&
            error.category === "authentication_failed"
          ) {
            const revoked = await dependencies.persistence.disconnect({
              context,
              expectedVersion: current.credentialVersion,
              now: clock(),
              revoked: true,
            });
            if (revoked !== null) await deleteCredential(revoked);
          }
          throw error;
        });
      const reference = await dependencies.credentials.put(refreshed.token);
      if (!isCredentialSecretReference(reference)) {
        await deleteCredential(reference);
        throw new InstagramApplicationError("business_rule_failed");
      }
      try {
        const now = clock();
        if (
          !(await dependencies.persistence.replaceCredential({
            context,
            expectedReference: current.credentialReference,
            expectedVersion: current.credentialVersion,
            credentialReference: reference,
            expiresAt: new Date(now.getTime() + refreshed.expiresInSeconds * 1000),
            now,
          }))
        )
          throw new InstagramApplicationError("channel_unavailable");
      } catch (error) {
        await deleteCredential(reference);
        if (error instanceof InstagramApplicationError) throw error;
        throw new InstagramApplicationError("business_rule_failed");
      }
      await deleteCredential(current.credentialReference);
    },
    processMessage: async (message) => {
      if (
        !/^[1-9][0-9]{0,31}$/u.test(message.accountId) ||
        !/^[1-9][0-9]{0,31}$/u.test(message.customerId) ||
        message.customerId === message.accountId ||
        message.messageId.length < 1 ||
        message.messageId.length > 1024
      )
        throw new InstagramApplicationError("validation_failed");
      const context = await dependencies.routeResolver.resolveInboundRoute(
        "instagram_webhook",
        instagramAccountRouteHash(message.accountId),
      );
      if (context === null) return Object.freeze({ status: "ignored" });
      const connection = await dependencies.persistence.loadConnection(context);
      if (!active(connection, clock()) || connection.accountId !== message.accountId)
        return Object.freeze({ status: "ignored" });
      const messageHash = Buffer.from(
        hash(`${message.accountId}\0${message.customerId}\0${message.messageId}`),
      ).toString("base64url");
      const event: unknown = {
        channel: "instagram",
        channel_connection_id: context.channelConnectionId,
        content: message.content,
        event_id: `instagram:message:${messageHash}`,
        external_account_id: `instagram:${Buffer.from(instagramAccountRouteHash(message.accountId)).toString("base64url")}`,
        external_conversation_id: instagramConversationIdentity(
          message.accountId,
          message.customerId,
        ),
        external_message_id: `instagram:message:${messageHash}`,
        external_sender_id: message.customerId,
        kind: message.content.type,
        occurred_at: message.occurredAt,
        received_at: clock().toISOString(),
      };
      if (!isSchemaValue(CanonicalInboundEventSchema, event))
        throw new InstagramApplicationError("validation_failed");
      const result = await canonical.acceptInbound({ context, event });
      if (!result.ok)
        throw new InstagramApplicationError(
          result.error.code === "channel_unavailable"
            ? "channel_unavailable"
            : "business_rule_failed",
        );
      return Object.freeze({ status: result.value.status });
    },
  });
};
