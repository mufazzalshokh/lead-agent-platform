import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createWidgetUseCases,
  WidgetApplicationError,
  type WidgetPersistenceStore,
} from "../../packages/application/src/index.js";
import { createWidgetSecurityConfig } from "../../packages/config/src/index.js";
import type {
  CanonicalInboundEvent,
  ChannelConnectionId,
  ContactId,
  ConversationId,
  LeadId,
  MessageId,
  OrganizationId,
  WidgetConversation,
} from "../../packages/contracts/src/index.js";
import {
  createWidgetRateLimiter,
  createWidgetTokenService,
  WidgetRateLimitError,
  type WidgetRateLimiter,
  type WidgetTokenClaims,
} from "../../packages/security/src/index.js";

const ORGANIZATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b" as OrganizationId;
const CHANNEL_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c" as ChannelConnectionId;
const CONVERSATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2d" as ConversationId;
const OTHER_CONVERSATION_ID = "0193f1a8-7f65-7c28-a434-a10796c41c31" as ConversationId;
const CONTACT_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2e" as ContactId;
const LEAD_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2f" as LeadId;
const MESSAGE_ID = "0193f1a8-7f65-7c28-a434-a10796c41c30" as MessageId;
const NOW = new Date("2026-09-15T10:00:00.000Z");
const ORIGIN = "https://clinic.example";
const KEY = Buffer.alloc(32, 3).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest();
const conversation: WidgetConversation = {
  closed_at: null,
  id: CONVERSATION_ID,
  last_activity_at: NOW.toISOString(),
  preferred_locale: "uz",
  resolved_at: null,
  started_at: NOW.toISOString(),
  status: "open",
};

const fixture = (
  options: Readonly<{
    corruptFirstMessage?: boolean;
    rateLimiter?: WidgetRateLimiter;
  }> = {},
) => {
  let createdSessions = 0;
  let acceptedInitial = 0;
  let acceptedBound = 0;
  let revealedMessages = 0;
  let preparedEvent: CanonicalInboundEvent | undefined;
  const tokens = createWidgetTokenService(createWidgetSecurityConfig(KEY));
  let authorityClaims: WidgetTokenClaims | null = null;
  const persistence: WidgetPersistenceStore = {
    createSession: () => {
      createdSessions += 1;
      return Promise.resolve(true);
    },
    acceptInitialInbound: (input) => {
      acceptedInitial += 1;
      preparedEvent = input.prepared.event;
      authorityClaims = {
        ...input.claims,
        conversationId: CONVERSATION_ID,
        jti: tokens.deriveBoundJti(input.claims.sessionId, "request-key-1"),
      };
      return Promise.resolve({
        ok: true,
        value: {
          contactId: CONTACT_ID,
          contactWasCreated: true,
          conversationId: CONVERSATION_ID,
          conversationWasCreated: true,
          leadId: LEAD_ID,
          leadWasCreated: true,
          messageId: MESSAGE_ID,
          messageSequenceNo: 1,
          processingStatus: "accepted",
          status: "accepted",
        },
      });
    },
    acceptBoundInbound: (input) => {
      acceptedBound += 1;
      preparedEvent = input.prepared.event;
      return Promise.resolve({
        ok: true,
        value: {
          contactId: CONTACT_ID,
          contactWasCreated: false,
          conversationId: CONVERSATION_ID,
          conversationWasCreated: false,
          leadId: LEAD_ID,
          leadWasCreated: false,
          messageId: MESSAGE_ID,
          messageSequenceNo: 2,
          processingStatus: "accepted",
          status: "accepted",
        },
      });
    },
    authorize: ({ claims }) => {
      if (authorityClaims !== null && claims.jti !== authorityClaims.jti)
        return Promise.resolve(null);
      return Promise.resolve({
        channelConnectionId: claims.channelConnectionId,
        contactId: authorityClaims === null ? null : CONTACT_ID,
        conversationId: claims.conversationId,
        expiresAt: claims.expiresAt,
        issuedAt: claims.issuedAt,
        lastSeenAt: NOW,
        organizationId: claims.organizationId,
        requestedLocale: "uz",
        sessionId: claims.sessionId,
      });
    },
    getConversation: ({ conversationId }) =>
      Promise.resolve(conversationId === CONVERSATION_ID ? conversation : null),
    listMessages: ({ conversationId }) =>
      Promise.resolve(
        conversationId === CONVERSATION_ID
          ? {
              hasMore: false,
              items: [
                {
                  bodyCiphertext: options.corruptFirstMessage ? null : Buffer.from("cipher"),
                  channelConnectionId: CHANNEL_ID,
                  contentType: "text",
                  conversationId: CONVERSATION_ID,
                  createdAt: NOW,
                  direction: "inbound",
                  id: MESSAGE_ID,
                  locale: "uz",
                  redactedAt: null,
                  sequenceNo: 1,
                },
                {
                  bodyCiphertext: null,
                  channelConnectionId: CHANNEL_ID,
                  contentType: "text",
                  conversationId: CONVERSATION_ID,
                  createdAt: NOW,
                  direction: "outbound",
                  id: MESSAGE_ID,
                  locale: "uz",
                  redactedAt: NOW,
                  sequenceNo: 2,
                },
              ],
            }
          : null,
      ),
  };
  const useCases = createWidgetUseCases({
    clock: () => NOW,
    dataProtector: {
      protectContent: ({ content }) => ({
        bodyCiphertext: Buffer.from("cipher"),
        bodyHash: digest(JSON.stringify(content)),
      }),
      protectParticipant: ({ externalParticipantId }) => ({
        hashKeyVersion: 1,
        lookupHash: digest(externalParticipantId),
        valueCiphertext: Buffer.from(externalParticipantId),
      }),
      revealMessageBody: () => {
        revealedMessages += 1;
        return "<script>text only</script>";
      },
      threadHash: ({ externalConversationId }) => digest(externalConversationId),
    },
    persistence,
    rateLimiter:
      options.rateLimiter ??
      createWidgetRateLimiter({ clock: () => NOW, salt: Buffer.alloc(32, 5) }),
    routeResolver: {
      resolveWidgetRoute: () =>
        Promise.resolve({
          channelConnectionId: CHANNEL_ID,
          organizationId: ORGANIZATION_ID,
        }),
    },
    tokens,
  });
  return {
    counts: () => ({ acceptedBound, acceptedInitial, createdSessions }),
    prepared: () => preparedEvent,
    reveals: () => revealedMessages,
    tokens,
    useCases,
  };
};

describe("S10 Widget application use cases", () => {
  it("bootstraps a short-lived session without creating business entities", async () => {
    const test = fixture();
    const issued = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: "https://spoof.invalid/tenant",
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    expect(test.counts()).toEqual({ acceptedBound: 0, acceptedInitial: 0, createdSessions: 1 });
    await expect(test.tokens.verify(issued.bearerToken, NOW)).resolves.toMatchObject({
      conversationId: null,
      organizationId: ORGANIZATION_ID,
      origin: ORIGIN,
    });
    expect(issued.expiresAt).toEqual(new Date("2026-09-15T12:00:00.000Z"));
  });

  it("maps the first text to canonical Widget input and rotates conversation authority", async () => {
    const test = fixture();
    const bootstrap = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: "https://clinic.example",
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    const created = await test.useCases.createConversation({
      bearerToken: bootstrap.bearerToken,
      body: {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: null,
        text: "Salom",
      },
      idempotencyKey: "request-key-1",
      origin: ORIGIN,
    });
    expect(created.conversation.id).toBe(CONVERSATION_ID);
    expect(test.counts().acceptedInitial).toBe(1);
    expect(test.prepared()).toMatchObject({
      channel: "widget",
      external_message_id: "browser.message-1",
      occurred_at: null,
    });
    expect(test.prepared()?.external_sender_id).toMatch(/^widget:/);
    await expect(test.tokens.verify(created.bearerToken, NOW)).resolves.toMatchObject({
      conversationId: CONVERSATION_ID,
    });
  });

  it("accepts later text only for the token-bound Conversation", async () => {
    const test = fixture();
    const bootstrap = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: ORIGIN,
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    const created = await test.useCases.createConversation({
      bearerToken: bootstrap.bearerToken,
      body: {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: "uz",
        text: "Salom",
      },
      idempotencyKey: "request-key-1",
      origin: ORIGIN,
    });
    await expect(
      test.useCases.postMessage({
        bearerToken: created.bearerToken,
        body: {
          client_message_id: "browser.message-2",
          kind: "text",
          locale_hint: "uz",
          text: "Narxi?",
        },
        conversationId: CONVERSATION_ID,
        idempotencyKey: "request-key-2",
        origin: ORIGIN,
      }),
    ).resolves.toMatchObject({ sequenceNo: 2 });
    await expect(
      test.useCases.postMessage({
        bearerToken: created.bearerToken,
        body: {
          client_message_id: "browser.message-3",
          kind: "text",
          locale_hint: null,
          text: "X",
        },
        conversationId: OTHER_CONVERSATION_ID,
        idempotencyKey: "request-key-3",
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("reveals only authorized customer-visible messages and preserves redaction", async () => {
    const test = fixture();
    const bootstrap = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: ORIGIN,
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    const created = await test.useCases.createConversation({
      bearerToken: bootstrap.bearerToken,
      body: {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: null,
        text: "Salom",
      },
      idempotencyKey: "request-key-1",
      origin: ORIGIN,
    });
    const page = await test.useCases.listMessages({
      bearerToken: created.bearerToken,
      conversationId: CONVERSATION_ID,
      origin: ORIGIN,
    });
    expect(page.items.map(({ body_text }) => body_text)).toEqual([
      "<script>text only</script>",
      null,
    ]);
    expect(test.reveals()).toBe(1);
    await expect(
      test.useCases.listMessages({
        bearerToken: created.bearerToken,
        conversationId: OTHER_CONVERSATION_ID,
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
    expect(test.reveals()).toBe(1);
    await expect(
      test.useCases.getConversation({
        bearerToken: created.bearerToken,
        conversationId: OTHER_CONVERSATION_ID,
        origin: ORIGIN,
      }),
    ).rejects.toBeInstanceOf(WidgetApplicationError);
  });

  it("fails safely before reveal when a non-redacted protected message is corrupt", async () => {
    const test = fixture({ corruptFirstMessage: true });
    const bootstrap = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: ORIGIN,
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    const created = await test.useCases.createConversation({
      bearerToken: bootstrap.bearerToken,
      body: {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: null,
        text: "Salom",
      },
      idempotencyKey: "request-key-1",
      origin: ORIGIN,
    });
    await expect(
      test.useCases.listMessages({
        bearerToken: created.bearerToken,
        conversationId: CONVERSATION_ID,
        origin: ORIGIN,
      }),
    ).rejects.toMatchObject({ code: "business_rule_failed" });
    expect(test.reveals()).toBe(0);
  });

  it("applies the frozen Widget rate budgets and rejects before persistence", async () => {
    const consumed: [readonly string[], number][] = [];
    const limiter: WidgetRateLimiter = {
      consume: (keyParts, limit) => consumed.push([keyParts, limit]),
      size: () => consumed.length,
    };
    const test = fixture({ rateLimiter: limiter });
    const bootstrap = await test.useCases.bootstrap({
      clientIp: "127.0.0.1",
      origin: ORIGIN,
      pageUrl: ORIGIN,
      requestedLocale: "uz",
      widgetKey: "A".repeat(32),
    });
    const created = await test.useCases.createConversation({
      bearerToken: bootstrap.bearerToken,
      body: {
        client_message_id: "browser.message-1",
        kind: "text",
        locale_hint: null,
        text: "Salom",
      },
      idempotencyKey: "request-key-1",
      origin: ORIGIN,
    });
    await test.useCases.getConversation({
      bearerToken: created.bearerToken,
      conversationId: CONVERSATION_ID,
      origin: ORIGIN,
    });
    expect(consumed.map(([parts, limit]) => [parts[0], limit])).toEqual([
      ["bootstrap", 10],
      ["bootstrap-tenant", 100],
      ["mutation", 30],
      ["tenant-authenticated", 300],
      ["read", 60],
      ["tenant-authenticated", 300],
    ]);

    const denied = fixture({
      rateLimiter: {
        consume: () => {
          throw new WidgetRateLimitError(60);
        },
        size: () => 0,
      },
    });
    await expect(
      denied.useCases.bootstrap({
        clientIp: "127.0.0.1",
        origin: ORIGIN,
        pageUrl: ORIGIN,
        requestedLocale: "uz",
        widgetKey: "A".repeat(32),
      }),
    ).rejects.toBeInstanceOf(WidgetRateLimitError);
    expect(denied.counts()).toEqual({ acceptedBound: 0, acceptedInitial: 0, createdSessions: 0 });
  });
});
