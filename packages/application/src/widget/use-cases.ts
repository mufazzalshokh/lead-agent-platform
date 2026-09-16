import { createHash } from "node:crypto";

import {
  CanonicalInboundEventSchema,
  WidgetConversationCreateInputSchema,
  WidgetMessageCreateInputSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelConnectionId,
  type ConversationId,
  type MessageId,
  type OrganizationId,
  type ResourceId,
  type WidgetConversation,
  type WidgetConversationCreateInput,
  type WidgetMessage,
  type WidgetMessageCreateInput,
} from "@lead-agent/contracts";
import {
  WidgetOriginInvalidError,
  WidgetTokenInvalidError,
  createSecurityIdentifierFactory,
  normalizeWidgetOrigin,
  type SecurityIdentifierFactory,
  type WidgetRateLimiter,
  type WidgetTokenClaims,
  type WidgetTokenService,
} from "@lead-agent/security";

import type { InboundRouteResolver, TrustedInboundRoute } from "../channels/index.js";

import {
  createCanonicalInboundUseCases,
  type CanonicalInboundDataProtector,
  type CanonicalInboundResult,
  type PreparedCanonicalInbound,
} from "../conversations/inbound-use-cases.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$/u;
const ABSOLUTE_LIFETIME_MS = 2 * 60 * 60 * 1_000;

export type WidgetRoute = TrustedInboundRoute;
export type WidgetRouteResolver = InboundRouteResolver;

export type WidgetSessionAuthority = Readonly<{
  channelConnectionId: ChannelConnectionId;
  contactId: string | null;
  conversationId: ConversationId | null;
  expiresAt: Date;
  issuedAt: Date;
  lastSeenAt: Date;
  organizationId: OrganizationId;
  requestedLocale: "en" | "ru" | "uz";
  sessionId: ResourceId;
}>;

export type WidgetProtectedMessageRecord = Readonly<{
  bodyCiphertext: Uint8Array | null;
  channelConnectionId: ChannelConnectionId;
  conversationId: ConversationId;
  contentType: "attachment" | "quick_reply" | "text";
  createdAt: Date;
  direction: "inbound" | "outbound";
  id: MessageId;
  locale: "en" | "ru" | "uz" | null;
  redactedAt: Date | null;
  sequenceNo: number;
}>;

export interface WidgetCustomerDataRevealer {
  revealMessageBody(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      ciphertext: Uint8Array;
      contentType: "attachment" | "quick_reply" | "text";
      organizationId: OrganizationId;
    }>,
  ): string | null;
}

export interface WidgetPersistenceStore {
  createSession(
    input: Readonly<{
      channelConnectionId: ChannelConnectionId;
      expiresAt: Date;
      jtiHash: Uint8Array;
      now: Date;
      organizationId: OrganizationId;
      origin: string;
      participantLookupHash: Uint8Array;
      requestedLocale: "en" | "ru" | "uz";
      sessionId: ResourceId;
    }>,
  ): Promise<boolean>;
  acceptInitialInbound(
    input: Readonly<{
      claims: WidgetTokenClaims;
      idempotencyKeyHash: Uint8Array;
      newJtiHash: Uint8Array;
      now: Date;
      origin: string;
      prepared: PreparedCanonicalInbound;
      requestHash: Uint8Array;
    }>,
  ): Promise<CanonicalInboundResult>;
  acceptBoundInbound(
    input: Readonly<{
      claims: WidgetTokenClaims;
      idempotencyKeyHash: Uint8Array;
      now: Date;
      origin: string;
      prepared: PreparedCanonicalInbound;
      requestHash: Uint8Array;
    }>,
  ): Promise<CanonicalInboundResult>;
  authorize(
    input: Readonly<{
      claims: WidgetTokenClaims;
      now: Date;
      origin: string;
    }>,
  ): Promise<WidgetSessionAuthority | null>;
  getConversation(
    input: Readonly<{
      claims: WidgetTokenClaims;
      conversationId: ConversationId;
      now: Date;
      origin: string;
    }>,
  ): Promise<WidgetConversation | null>;
  listMessages(
    input: Readonly<{
      after: number;
      claims: WidgetTokenClaims;
      conversationId: ConversationId;
      limit: number;
      now: Date;
      origin: string;
    }>,
  ): Promise<Readonly<{ items: readonly WidgetProtectedMessageRecord[]; hasMore: boolean }> | null>;
}

export class WidgetApplicationError extends Error {
  constructor(
    public readonly code:
      | "business_rule_failed"
      | "channel_unavailable"
      | "idempotency_conflict"
      | "resource_not_found"
      | "token_invalid"
      | "validation_failed",
  ) {
    super(code);
    this.name = "WidgetApplicationError";
  }
}

export type WidgetUseCases = Readonly<{
  bootstrap(
    input: Readonly<{
      clientIp: string;
      origin: unknown;
      pageUrl: string;
      requestedLocale: "en" | "ru" | "uz";
      widgetKey: string;
    }>,
  ): Promise<Readonly<{ bearerToken: string; expiresAt: Date }>>;
  createConversation(
    input: Readonly<{
      bearerToken: string;
      body: WidgetConversationCreateInput;
      idempotencyKey: string;
      origin: unknown;
    }>,
  ): Promise<
    Readonly<{
      bearerToken: string;
      conversation: WidgetConversation;
      expiresAt: Date;
      messageId: MessageId;
      processingStatus: "accepted" | "suppressed";
      sequenceNo: number;
    }>
  >;
  getConversation(
    input: Readonly<{ bearerToken: string; conversationId: ConversationId; origin: unknown }>,
  ): Promise<WidgetConversation>;
  listMessages(
    input: Readonly<{
      after?: number;
      bearerToken: string;
      conversationId: ConversationId;
      limit?: number;
      origin: unknown;
    }>,
  ): Promise<Readonly<{ items: readonly WidgetMessage[]; hasMore: boolean }>>;
  postMessage(
    input: Readonly<{
      bearerToken: string;
      body: WidgetMessageCreateInput;
      conversationId: ConversationId;
      idempotencyKey: string;
      origin: unknown;
    }>,
  ): Promise<
    Readonly<{
      messageId: MessageId;
      processingStatus: "accepted" | "suppressed";
      sequenceNo: number;
    }>
  >;
}>;

const hash = (value: string): Uint8Array => createHash("sha256").update(value, "utf8").digest();
const hashRequest = (
  scope: string,
  body: WidgetConversationCreateInput | WidgetMessageCreateInput,
) =>
  hash(
    `${scope}\0${body.client_message_id}\0${body.kind}\0${body.locale_hint ?? ""}\0${body.text}`,
  );
const requireIdempotencyKey = (value: string): Uint8Array => {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) throw new WidgetApplicationError("validation_failed");
  return hash(value);
};
const mapInboundFailure = (result: CanonicalInboundResult): never => {
  const code = result.ok ? "business_rule_failed" : result.error.code;
  if (code === "channel_unavailable") throw new WidgetApplicationError("channel_unavailable");
  if (code === "persistence_conflict") throw new WidgetApplicationError("business_rule_failed");
  throw new WidgetApplicationError("validation_failed");
};
const canonicalEvent = (
  claims: WidgetTokenClaims,
  body: WidgetConversationCreateInput | WidgetMessageCreateInput,
  now: Date,
): CanonicalInboundEvent => {
  const participant = `widget:${claims.sessionId}`;
  const candidate: unknown = {
    channel: "widget",
    channel_connection_id: claims.channelConnectionId,
    content: { locale_hint: body.locale_hint, text: body.text, type: "text" },
    event_id: `widget-event:${Buffer.from(hash(`${claims.sessionId}\0${body.client_message_id}`)).toString("base64url")}`,
    external_account_id: null,
    external_conversation_id: participant,
    external_message_id: body.client_message_id,
    external_sender_id: participant,
    kind: "text",
    occurred_at: null,
    received_at: now.toISOString(),
  };
  if (!isSchemaValue(CanonicalInboundEventSchema, candidate)) {
    throw new WidgetApplicationError("validation_failed");
  }
  return candidate;
};

export const createWidgetUseCases = (
  dependencies: Readonly<{
    clock?: () => Date;
    dataProtector: CanonicalInboundDataProtector & WidgetCustomerDataRevealer;
    identifierFactory?: SecurityIdentifierFactory;
    persistence: WidgetPersistenceStore;
    rateLimiter: WidgetRateLimiter;
    routeResolver: WidgetRouteResolver;
    tokens: WidgetTokenService;
  }>,
): WidgetUseCases => {
  const clock = dependencies.clock ?? (() => new Date());
  const identifiers = dependencies.identifierFactory ?? createSecurityIdentifierFactory();
  const verifyRequest = async (
    bearerToken: string,
    rawOrigin: unknown,
    kind: "read" | "mutation",
  ) => {
    const now = clock();
    const origin = normalizeWidgetOrigin(rawOrigin);
    const claims = await dependencies.tokens.verify(bearerToken, now);
    if (claims.origin !== origin) throw new WidgetOriginInvalidError();
    dependencies.rateLimiter.consume([kind, claims.sessionId], kind === "read" ? 60 : 30);
    dependencies.rateLimiter.consume(["tenant-authenticated", claims.organizationId], 300);
    return { claims, now, origin } as const;
  };
  const authenticate = async (
    bearerToken: string,
    rawOrigin: unknown,
    kind: "read" | "mutation",
  ) => {
    const verified = await verifyRequest(bearerToken, rawOrigin, kind);
    const authority = await dependencies.persistence.authorize(verified);
    if (authority === null) throw new WidgetTokenInvalidError();
    return { authority, ...verified } as const;
  };
  const accept = async (
    mode: "initial" | "bound",
    token: string,
    rawOrigin: unknown,
    idempotencyKey: string,
    body: WidgetConversationCreateInput | WidgetMessageCreateInput,
    expectedConversationId?: ConversationId,
  ) => {
    const authenticated =
      mode === "initial"
        ? await verifyRequest(token, rawOrigin, "mutation")
        : await authenticate(token, rawOrigin, "mutation");
    if (mode === "initial" && authenticated.claims.conversationId !== null) {
      throw new WidgetApplicationError("business_rule_failed");
    }
    if (
      mode === "bound" &&
      (authenticated.claims.conversationId === null ||
        authenticated.claims.conversationId !== expectedConversationId)
    )
      throw new WidgetApplicationError("resource_not_found");
    const idempotencyKeyHash = requireIdempotencyKey(idempotencyKey);
    const event = canonicalEvent(authenticated.claims, body, authenticated.now);
    const newJti =
      mode === "initial"
        ? dependencies.tokens.deriveBoundJti(authenticated.claims.sessionId, idempotencyKey)
        : null;
    const canonical = createCanonicalInboundUseCases(
      {
        acceptInbound: (prepared) =>
          mode === "initial"
            ? dependencies.persistence.acceptInitialInbound({
                claims: authenticated.claims,
                idempotencyKeyHash,
                newJtiHash: dependencies.tokens.hashJti(newJti!),
                now: authenticated.now,
                origin: authenticated.origin,
                prepared,
                requestHash: hashRequest("widget.conversation.create.v1", body),
              })
            : dependencies.persistence.acceptBoundInbound({
                claims: authenticated.claims,
                idempotencyKeyHash,
                now: authenticated.now,
                origin: authenticated.origin,
                prepared,
                requestHash: hashRequest("widget.message.create.v1", body),
              }),
      },
      dependencies.dataProtector,
    );
    const result = await canonical.acceptInbound({
      context: {
        channelConnectionId: authenticated.claims.channelConnectionId,
        organizationId: authenticated.claims.organizationId,
      },
      event,
    });
    if (!result.ok) return mapInboundFailure(result);
    return { ...authenticated, newJti, receipt: result.value } as const;
  };
  return Object.freeze({
    bootstrap: async (input) => {
      const now = clock();
      const origin = normalizeWidgetOrigin(input.origin);
      dependencies.rateLimiter.consume(["bootstrap", input.clientIp, input.widgetKey, origin], 10);
      const route = await dependencies.routeResolver.resolveInboundRoute(
        "widget_key",
        hash(input.widgetKey),
      );
      if (route === null) throw new WidgetApplicationError("channel_unavailable");
      dependencies.rateLimiter.consume(["bootstrap-tenant", route.organizationId], 100);
      const sessionId = identifiers.issueResourceId(now);
      const participant = `widget:${sessionId}`;
      const protectedParticipant = await dependencies.dataProtector.protectParticipant({
        channelConnectionId: route.channelConnectionId,
        externalParticipantId: participant,
        identityType: "widget_participant",
        organizationId: route.organizationId,
      });
      const jti = dependencies.tokens.createJti();
      const expiresAt = new Date(now.getTime() + ABSOLUTE_LIFETIME_MS);
      const created = await dependencies.persistence.createSession({
        ...route,
        expiresAt,
        jtiHash: dependencies.tokens.hashJti(jti),
        now,
        origin,
        participantLookupHash: protectedParticipant.lookupHash,
        requestedLocale: input.requestedLocale,
        sessionId,
      });
      if (!created) throw new WidgetApplicationError("channel_unavailable");
      return Object.freeze({
        bearerToken: await dependencies.tokens.issue({
          ...route,
          conversationId: null,
          expiresAt,
          issuedAt: now,
          jti,
          origin,
          sessionId,
        }),
        expiresAt,
      });
    },
    createConversation: async ({ bearerToken, body, idempotencyKey, origin }) => {
      if (!isSchemaValue(WidgetConversationCreateInputSchema, body))
        throw new WidgetApplicationError("validation_failed");
      const accepted = await accept("initial", bearerToken, origin, idempotencyKey, body);
      const claims: WidgetTokenClaims = Object.freeze({
        ...accepted.claims,
        conversationId: accepted.receipt.conversationId,
        jti: accepted.newJti!,
      });
      const conversation = await dependencies.persistence.getConversation({
        claims,
        conversationId: accepted.receipt.conversationId,
        now: accepted.now,
        origin: accepted.origin,
      });
      if (conversation === null) throw new WidgetApplicationError("resource_not_found");
      return Object.freeze({
        bearerToken: await dependencies.tokens.issue(claims),
        conversation,
        expiresAt: claims.expiresAt,
        messageId: accepted.receipt.messageId,
        processingStatus:
          accepted.receipt.processingStatus === "suppressed"
            ? ("suppressed" as const)
            : ("accepted" as const),
        sequenceNo: accepted.receipt.messageSequenceNo,
      });
    },
    getConversation: async ({ bearerToken, conversationId, origin }) => {
      const {
        claims,
        now,
        origin: normalizedOrigin,
      } = await verifyRequest(bearerToken, origin, "read");
      const value = await dependencies.persistence.getConversation({
        claims,
        conversationId,
        now,
        origin: normalizedOrigin,
      });
      if (value === null) throw new WidgetApplicationError("resource_not_found");
      return value;
    },
    listMessages: async ({ after = 0, bearerToken, conversationId, limit = 50, origin }) => {
      const {
        claims,
        now,
        origin: normalizedOrigin,
      } = await verifyRequest(bearerToken, origin, "read");
      const page = await dependencies.persistence.listMessages({
        after,
        claims,
        conversationId,
        limit,
        now,
        origin: normalizedOrigin,
      });
      if (page === null) throw new WidgetApplicationError("resource_not_found");
      const items = page.items.map((message): WidgetMessage => {
        const bodyText =
          message.redactedAt !== null
            ? null
            : message.bodyCiphertext === null
              ? (() => {
                  throw new WidgetApplicationError("business_rule_failed");
                })()
              : dependencies.dataProtector.revealMessageBody({
                  channelConnectionId: message.channelConnectionId,
                  ciphertext: message.bodyCiphertext,
                  contentType: message.contentType,
                  organizationId: claims.organizationId,
                });
        return {
          body_text: bodyText,
          conversation_id: message.conversationId,
          created_at: message.createdAt.toISOString(),
          direction: message.direction,
          id: message.id,
          locale: message.locale,
          redacted_at: message.redactedAt?.toISOString() ?? null,
          sequence_no: message.sequenceNo,
        };
      });
      return Object.freeze({ hasMore: page.hasMore, items: Object.freeze(items) });
    },
    postMessage: async ({ bearerToken, body, conversationId, idempotencyKey, origin }) => {
      if (!isSchemaValue(WidgetMessageCreateInputSchema, body))
        throw new WidgetApplicationError("validation_failed");
      const accepted = await accept(
        "bound",
        bearerToken,
        origin,
        idempotencyKey,
        body,
        conversationId,
      );
      return Object.freeze({
        messageId: accepted.receipt.messageId,
        processingStatus:
          accepted.receipt.processingStatus === "suppressed"
            ? ("suppressed" as const)
            : ("accepted" as const),
        sequenceNo: accepted.receipt.messageSequenceNo,
      });
    },
  });
};
