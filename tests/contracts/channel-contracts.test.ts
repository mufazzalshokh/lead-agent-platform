import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ApiErrorCodeSchema,
  CanonicalInboundEventSchema,
  ChannelActionTokenSchema,
  ChannelCapabilitiesSchema,
  ChannelFailureCategorySchema,
  ChannelIdempotencyKeySchema,
  ChannelMediaKindSchema,
  ChannelTextFormatSchema,
  ChannelTypeSchema,
  ExternalChannelAccountIdSchema,
  ExternalChannelConversationIdSchema,
  ExternalChannelEventIdSchema,
  ExternalChannelMessageIdSchema,
  ExternalChannelParticipantIdSchema,
  InboundAttachmentContentSchema,
  InboundChannelContentSchema,
  InboundDeliveryStatusContentSchema,
  InboundMessageKindSchema,
  InboundQuickReplyContentSchema,
  InboundTextContentSchema,
  InboundUnsupportedContentSchema,
  OutboundChannelContentSchema,
  OutboundQuickReplySchema,
  ProviderMediaReferenceSchema,
  SchemaIdSchema,
  SendChannelMessageSchema,
  isSchemaValue,
  type CanonicalInboundEvent,
  type ChannelFailureCategory,
  type ChannelType,
  type ContactId,
  type ConversationId,
  type InboundMessageKind,
  type OrganizationId,
  type SendChannelMessage,
} from "../../packages/contracts/src/index.js";

const ID = "0193f1a8-7f65-7c28-a434-a10796c41c2b";
const OTHER_ID = "0193f1a8-7f65-7c28-a434-a10796c41c2c";
const RECEIVED_AT = "2026-08-30T12:34:56.123Z";

const CHANNEL_TYPES = [
  "widget",
  "telegram",
  "instagram",
  "whatsapp",
] as const satisfies readonly ChannelType[];

const INBOUND_KINDS = [
  "text",
  "quick_reply",
  "attachment",
  "delivery_status",
  "unsupported",
] as const satisfies readonly InboundMessageKind[];

const MEDIA_KINDS = ["image", "document", "audio", "other"] as const;

const FAILURE_CATEGORIES = [
  "invalid_recipient",
  "authentication_failed",
  "rate_limited",
  "provider_unavailable",
  "unsupported_content",
  "permanent_rejection",
] as const satisfies readonly ChannelFailureCategory[];

const CONTENT_FIXTURES = {
  attachment: {
    caption: "Reference image",
    media_kind: "image",
    provider_media_ref: "media:opaque-provider-reference",
    type: "attachment",
  },
  delivery_status: {
    provider_status: "delivered",
    type: "delivery_status",
  },
  quick_reply: {
    action_token: "confirmation:opaque-token",
    display_text: "Confirm",
    type: "quick_reply",
  },
  text: {
    locale_hint: "uz",
    text: "Salom, қабул қилиш учун вақт керак 👋",
    type: "text",
  },
  unsupported: {
    provider_status: null,
    type: "unsupported",
  },
} as const satisfies Record<InboundMessageKind, unknown>;

const CONTENT_SCHEMAS = {
  attachment: InboundAttachmentContentSchema,
  delivery_status: InboundDeliveryStatusContentSchema,
  quick_reply: InboundQuickReplyContentSchema,
  text: InboundTextContentSchema,
  unsupported: InboundUnsupportedContentSchema,
} as const;

const createInboundEvent = (
  kind: InboundMessageKind,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel: "widget",
  channel_connection_id: ID,
  content: CONTENT_FIXTURES[kind],
  event_id: "event:provider:42",
  external_account_id: null,
  external_conversation_id: "thread:provider:42",
  external_message_id: "message:provider:42",
  external_sender_id: "participant:provider:42",
  kind,
  occurred_at: null,
  received_at: RECEIVED_AT,
  ...overrides,
});

const createOutboundMessage = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  channel_connection_id: ID,
  content: {
    locale: "en",
    text: "Your request was received for staff review.",
  },
  conversation_id: OTHER_ID,
  idempotency_key: "send:message:42",
  organization_id: ID,
  recipient: "participant:provider:42",
  ...overrides,
});

const withoutMember = (candidate: Record<string, unknown>, member: string) => {
  const clone = structuredClone(candidate);
  Reflect.deleteProperty(clone, member);
  return clone;
};

const schemaIdOf = (schema: object, label: string) => {
  const schemaId: unknown = Reflect.get(schema, "$id");

  if (typeof schemaId !== "string") {
    throw new TypeError(`Missing schema ID for ${label}`);
  }

  return schemaId;
};

const channelSchemas = [
  ChannelTypeSchema,
  InboundMessageKindSchema,
  ChannelMediaKindSchema,
  ChannelTextFormatSchema,
  ChannelFailureCategorySchema,
  ExternalChannelEventIdSchema,
  ExternalChannelAccountIdSchema,
  ExternalChannelConversationIdSchema,
  ExternalChannelMessageIdSchema,
  ExternalChannelParticipantIdSchema,
  ProviderMediaReferenceSchema,
  ChannelActionTokenSchema,
  ChannelIdempotencyKeySchema,
  InboundTextContentSchema,
  InboundQuickReplyContentSchema,
  InboundAttachmentContentSchema,
  InboundDeliveryStatusContentSchema,
  InboundUnsupportedContentSchema,
  InboundChannelContentSchema,
  CanonicalInboundEventSchema,
  OutboundQuickReplySchema,
  OutboundChannelContentSchema,
  SendChannelMessageSchema,
  ChannelCapabilitiesSchema,
] as const;

describe("channel contract source of truth", () => {
  it("publishes unique versioned schema IDs and JSON-serializable schemas", () => {
    const schemaIds = channelSchemas.map((schema) => ("$id" in schema ? schema.$id : undefined));

    expect(schemaIds).toHaveLength(new Set(schemaIds).size);
    expect(schemaIds.every((schemaId) => isSchemaValue(SchemaIdSchema, schemaId))).toBe(true);

    for (const schema of channelSchemas) {
      expect(() => JSON.stringify(schema)).not.toThrow();
    }
  });

  it("retains the exact canonical Stage 0 schema identities", () => {
    expect(schemaIdOf(CanonicalInboundEventSchema, "canonical inbound event")).toBe(
      "CanonicalInboundEvent.v1",
    );
    expect(schemaIdOf(SendChannelMessageSchema, "send channel message")).toBe(
      "SendChannelMessage.v1",
    );
    expect(schemaIdOf(ChannelCapabilitiesSchema, "channel capabilities")).toBe(
      "ChannelCapabilities.v1",
    );
    expect(schemaIdOf(ChannelFailureCategorySchema, "channel failure category")).toBe(
      "ChannelFailureCategory.v1",
    );
  });

  it("derives the public TypeScript contract from runtime schemas", () => {
    expectTypeOf<CanonicalInboundEvent["channel"]>().toEqualTypeOf<ChannelType>();
    expectTypeOf<CanonicalInboundEvent["kind"]>().toEqualTypeOf<InboundMessageKind>();
    expectTypeOf<CanonicalInboundEvent["external_sender_id"]>().not.toEqualTypeOf<ContactId>();
    expectTypeOf<SendChannelMessage["organization_id"]>().toEqualTypeOf<OrganizationId>();
    expectTypeOf<SendChannelMessage["conversation_id"]>().toEqualTypeOf<ConversationId>();
  });
});

describe("provider-neutral channel vocabulary", () => {
  it.each(CHANNEL_TYPES)("accepts frozen channel type %s", (channel) => {
    expect(isSchemaValue(ChannelTypeSchema, channel)).toBe(true);
    expect(
      isSchemaValue(CanonicalInboundEventSchema, createInboundEvent("text", { channel })),
    ).toBe(true);
  });

  it.each(["email", "sms", "voice", "web", "Telegram", "", null, 1])(
    "rejects unknown channel type %j",
    (channel) => {
      expect(isSchemaValue(ChannelTypeSchema, channel)).toBe(false);
      expect(
        isSchemaValue(CanonicalInboundEventSchema, createInboundEvent("text", { channel })),
      ).toBe(false);
    },
  );

  it.each(MEDIA_KINDS)("accepts frozen media classification %s", (mediaKind) => {
    expect(isSchemaValue(ChannelMediaKindSchema, mediaKind)).toBe(true);
  });

  it.each(FAILURE_CATEGORIES)("accepts internal channel failure category %s", (category) => {
    expect(isSchemaValue(ChannelFailureCategorySchema, category)).toBe(true);
    expect(isSchemaValue(ApiErrorCodeSchema, category)).toBe(category === "rate_limited");
  });

  it.each(["internal_error", "validation_failed", "webhook_signature_invalid", "timeout", ""])(
    "does not mix API/provider errors into the channel failure vocabulary: %s",
    (category) => {
      expect(isSchemaValue(ChannelFailureCategorySchema, category)).toBe(false);
    },
  );
});

describe("canonical inbound channel events", () => {
  it.each(INBOUND_KINDS)("accepts and runtime-discriminates %s content", (kind) => {
    const event = createInboundEvent(kind);

    expect(isSchemaValue(InboundMessageKindSchema, kind)).toBe(true);
    expect(isSchemaValue(CONTENT_SCHEMAS[kind], CONTENT_FIXTURES[kind])).toBe(true);
    expect(isSchemaValue(InboundChannelContentSchema, CONTENT_FIXTURES[kind])).toBe(true);
    expect(isSchemaValue(CanonicalInboundEventSchema, event)).toBe(true);
  });

  it.each(CHANNEL_TYPES)("round-trips %s inbound events through JSON", (channel) => {
    for (const kind of INBOUND_KINDS) {
      const roundTripped: unknown = JSON.parse(
        JSON.stringify(createInboundEvent(kind, { channel })),
      );

      expect(isSchemaValue(CanonicalInboundEventSchema, roundTripped)).toBe(true);
    }
  });

  it("preserves Unicode text without provider-specific normalization", () => {
    const text = "O‘zbekcha — Русский — English — 👩🏽‍⚕️";
    const event = createInboundEvent("text", {
      content: { locale_hint: null, text, type: "text" },
    });
    const roundTripped = JSON.parse(JSON.stringify(event)) as {
      content: { text: string };
    };

    expect(roundTripped.content.text).toBe(text);
    expect(isSchemaValue(CanonicalInboundEventSchema, roundTripped)).toBe(true);
  });

  it("supports absent provider message/account IDs while retaining required replay identity", () => {
    const withoutOptionalIds = createInboundEvent("unsupported");
    Reflect.deleteProperty(withoutOptionalIds, "external_account_id");
    Reflect.deleteProperty(withoutOptionalIds, "external_message_id");

    expect(isSchemaValue(CanonicalInboundEventSchema, withoutOptionalIds)).toBe(true);
    expect(
      isSchemaValue(
        CanonicalInboundEventSchema,
        createInboundEvent("unsupported", {
          external_account_id: null,
          external_message_id: null,
        }),
      ),
    ).toBe(true);
  });

  it.each([null, RECEIVED_AT])(
    "accepts canonical nullable provider occurrence time %j",
    (value) => {
      expect(
        isSchemaValue(
          CanonicalInboundEventSchema,
          createInboundEvent("text", { occurred_at: value }),
        ),
      ).toBe(true);
    },
  );

  it("rejects every mismatched kind/content discriminant pair", () => {
    for (const kind of INBOUND_KINDS) {
      for (const contentKind of INBOUND_KINDS) {
        const accepted = isSchemaValue(
          CanonicalInboundEventSchema,
          createInboundEvent(kind, { content: CONTENT_FIXTURES[contentKind] }),
        );

        expect(accepted, `${kind} accepted ${contentKind} content`).toBe(kind === contentKind);
      }
    }
  });

  it.each([
    "event_id",
    "channel",
    "channel_connection_id",
    "external_conversation_id",
    "external_sender_id",
    "kind",
    "occurred_at",
    "received_at",
    "content",
  ])("rejects an inbound event missing required member %s", (member) => {
    expect(
      isSchemaValue(CanonicalInboundEventSchema, withoutMember(createInboundEvent("text"), member)),
    ).toBe(false);
  });

  it.each([
    { event_id: "" },
    { event_id: "e".repeat(256) },
    { external_account_id: "a".repeat(256) },
    { external_conversation_id: "" },
    { external_conversation_id: "c".repeat(256) },
    { external_message_id: "m".repeat(256) },
    { external_message_id: 42 },
    { external_sender_id: "" },
    { external_sender_id: "s".repeat(256) },
    { channel_connection_id: "550e8400-e29b-41d4-a716-446655440000" },
    { channel_connection_id: "not-a-uuid" },
    { received_at: "2026-08-30T17:34:56+05:00" },
    { received_at: "2026-02-30T12:34:56Z" },
    { occurred_at: "yesterday" },
  ])("rejects malformed or oversized inbound identity/time fields %#", (override) => {
    expect(isSchemaValue(CanonicalInboundEventSchema, createInboundEvent("text", override))).toBe(
      false,
    );
  });

  it.each([
    { content: { text: "hello", type: "unknown" }, kind: "text" },
    { content: { text: "hello", type: "text" }, kind: "unknown" },
    { content: { text: "", type: "text" }, kind: "text" },
    { content: { text: "t".repeat(4_001), type: "text" }, kind: "text" },
    {
      content: {
        media_kind: "video",
        provider_media_ref: "media:42",
        type: "attachment",
      },
      kind: "attachment",
    },
    {
      content: {
        media_kind: "image",
        provider_media_ref: "m".repeat(1_001),
        type: "attachment",
      },
      kind: "attachment",
    },
    {
      content: { action_token: "a".repeat(513), type: "quick_reply" },
      kind: "quick_reply",
    },
    {
      content: { provider_status: "s".repeat(101), type: "delivery_status" },
      kind: "delivery_status",
    },
  ])("rejects unknown, empty, or oversized inbound content %#", (override) => {
    expect(isSchemaValue(CanonicalInboundEventSchema, createInboundEvent("text", override))).toBe(
      false,
    );
  });
});

describe("canonical outbound channel messages", () => {
  it.each([
    createOutboundMessage(),
    createOutboundMessage({ reply_to_message_id: null }),
    createOutboundMessage({ reply_to_message_id: OTHER_ID }),
    createOutboundMessage({
      content: {
        locale: "ru",
        quick_replies: [
          { action_token: "confirm:offer:42", label: "Подтвердить" },
          { action_token: "decline:offer:42", label: "Отказаться" },
        ],
        text: "Пожалуйста, подтвердите предложенное время.",
      },
    }),
  ])("accepts portable outbound representation %#", (message) => {
    expect(isSchemaValue(SendChannelMessageSchema, message)).toBe(true);
    expect(isSchemaValue(SendChannelMessageSchema, JSON.parse(JSON.stringify(message)))).toBe(true);
  });

  it.each([
    "organization_id",
    "conversation_id",
    "channel_connection_id",
    "recipient",
    "content",
    "idempotency_key",
  ])("rejects an outbound message missing required member %s", (member) => {
    expect(
      isSchemaValue(SendChannelMessageSchema, withoutMember(createOutboundMessage(), member)),
    ).toBe(false);
  });

  it.each([
    { organization_id: "not-a-uuid" },
    { conversation_id: "550e8400-e29b-41d4-a716-446655440000" },
    { channel_connection_id: "not-a-uuid" },
    { recipient: "" },
    { recipient: "r".repeat(256) },
    { idempotency_key: "short" },
    { idempotency_key: "i".repeat(129) },
    { reply_to_message_id: "not-a-uuid" },
  ])("rejects malformed or oversized outbound routing field %#", (override) => {
    expect(isSchemaValue(SendChannelMessageSchema, createOutboundMessage(override))).toBe(false);
  });

  it.each([
    { locale: "de", text: "Hello" },
    { locale: "en", text: "" },
    { locale: "en", text: "t".repeat(4_001) },
    {
      locale: "en",
      quick_replies: Array.from({ length: 6 }, (_, index) => ({
        action_token: `action:${index}`,
        label: `Choice ${index}`,
      })),
      text: "Choose",
    },
    {
      locale: "en",
      quick_replies: [{ action_token: "action:42", label: "l".repeat(81) }],
      text: "Choose",
    },
    {
      locale: "en",
      quick_replies: [{ action_token: "a".repeat(513), label: "Choice" }],
      text: "Choose",
    },
  ])("rejects malformed or oversized outbound content %#", (content) => {
    expect(isSchemaValue(SendChannelMessageSchema, createOutboundMessage({ content }))).toBe(false);
  });
});

describe("channel capabilities", () => {
  const capabilities = {
    max_quick_replies: 5,
    max_text_length: 4_000,
    supported_attachment_media_kinds: ["image", "document"],
    supported_text_formats: ["plain_text"],
    supports_delivery_status: true,
    supports_message_edit: false,
  };

  it("accepts a closed, bounded provider-neutral capability declaration", () => {
    expect(isSchemaValue(ChannelCapabilitiesSchema, capabilities)).toBe(true);
    expect(isSchemaValue(ChannelCapabilitiesSchema, JSON.parse(JSON.stringify(capabilities)))).toBe(
      true,
    );
  });

  it.each([
    { ...capabilities, max_quick_replies: -1 },
    { ...capabilities, max_quick_replies: 6 },
    { ...capabilities, max_text_length: 0 },
    { ...capabilities, max_text_length: 4_001 },
    { ...capabilities, supported_attachment_media_kinds: ["video"] },
    {
      ...capabilities,
      supported_attachment_media_kinds: ["image", "image"],
    },
    {
      ...capabilities,
      supported_attachment_media_kinds: Array.from({ length: 1_000 }, () => "image"),
    },
    { ...capabilities, supported_text_formats: [] },
    { ...capabilities, supported_text_formats: ["html"] },
    { ...capabilities, supported_text_formats: ["plain_text", "html"] },
    { ...capabilities, supports_delivery_status: "yes" },
    { ...capabilities, provider: "telegram" },
  ])("rejects malformed, excessive, or provider-specific capabilities %#", (candidate) => {
    expect(isSchemaValue(ChannelCapabilitiesSchema, candidate)).toBe(false);
  });
});

describe("channel contract tenant and provider isolation", () => {
  const forbiddenInboundFields = [
    "organization_id",
    "organizationId",
    "tenant_id",
    "tenantId",
    "role",
    "permissions",
    "isAdmin",
    "platformOperator",
    "membershipId",
    "authorization",
    "accessToken",
    "session",
    "cookie",
    "secret",
    "providerBody",
    "providerResponse",
    "rawProviderPayload",
    "webhookBody",
    "signature",
    "headers",
    "sql",
    "query",
    "constraint",
    "stack",
    "debug",
    "rawInput",
    "databaseRow",
  ] as const;

  it.each(forbiddenInboundFields)("rejects inbound authority/provider field %s", (field) => {
    const event = {
      ...createInboundEvent("text"),
      [field]: field === "organization_id" ? ID : { injected: true },
    };

    expect(isSchemaValue(CanonicalInboundEventSchema, event)).toBe(false);
  });

  it.each([
    "organizationId",
    "tenant_id",
    "tenantId",
    "role",
    "permissions",
    "isAdmin",
    "platformOperator",
    "membershipId",
    "authorization",
    "accessToken",
    "session",
    "cookie",
    "secret",
    "providerBody",
    "providerResponse",
    "rawProviderPayload",
    "webhookBody",
    "signature",
    "headers",
    "sql",
    "query",
    "constraint",
    "stack",
    "debug",
    "rawInput",
    "databaseRow",
  ])("rejects outbound authority/provider field %s beyond required provenance", (field) => {
    expect(
      isSchemaValue(SendChannelMessageSchema, {
        ...createOutboundMessage(),
        [field]: { injected: true },
      }),
    ).toBe(false);
  });

  it.each([
    {
      content: {
        ...CONTENT_FIXTURES.text,
        authorization: { role: "owner", tenant_id: ID },
      },
      kind: "text",
    },
    {
      content: {
        ...CONTENT_FIXTURES.attachment,
        fetch_url: "http://127.0.0.1/private",
      },
      kind: "attachment",
    },
    {
      content: {
        ...CONTENT_FIXTURES.attachment,
        metadata: { providerBody: { secret: "hidden" } },
      },
      kind: "attachment",
    },
    {
      content: {
        ...CONTENT_FIXTURES.quick_reply,
        provider_method: "deleteWebhook",
      },
      kind: "quick_reply",
    },
  ])("rejects nested authority, fetch, metadata, and provider-method smuggling %#", (override) => {
    expect(isSchemaValue(CanonicalInboundEventSchema, createInboundEvent("text", override))).toBe(
      false,
    );
  });

  it.each([
    {
      content: {
        locale: "en",
        organization_id: ID,
        text: "Hello",
      },
    },
    {
      content: {
        locale: "en",
        quick_replies: [
          {
            action_token: "action:42",
            label: "Confirm",
            provider_method: "sendMessage",
          },
        ],
        text: "Hello",
      },
    },
    {
      content: {
        html: "<script>alert(1)</script>",
        locale: "en",
        text: "Hello",
      },
    },
  ])("rejects nested outbound authority or provider-specific behavior %#", (override) => {
    expect(isSchemaValue(SendChannelMessageSchema, createOutboundMessage(override))).toBe(false);
  });

  it.each([
    JSON.parse(
      `{"channel":"widget","channel_connection_id":"${ID}","content":{"type":"text","text":"hello"},"event_id":"event:42","external_conversation_id":"thread:42","external_sender_id":"sender:42","kind":"text","occurred_at":null,"received_at":"${RECEIVED_AT}","__proto__":{"polluted":true}}`,
    ),
    {
      ...createInboundEvent("text"),
      metadata: Object.fromEntries(
        Array.from({ length: 1_000 }, (_, index) => [`provider_field_${index}`, true]),
      ),
    },
  ])("rejects prototype-pollution-shaped or arbitrary breadth input %#", (candidate) => {
    expect(isSchemaValue(CanonicalInboundEventSchema, candidate)).toBe(false);
  });

  it.each([
    { ...createInboundEvent("text"), received_at: new Date(RECEIVED_AT) },
    { ...createInboundEvent("text"), event_id: 1n },
    { ...createInboundEvent("text"), content: new Map([["type", "text"]]) },
    { ...createInboundEvent("text"), content: new Set(["text"]) },
    { ...createInboundEvent("text"), content: undefined },
    { ...createInboundEvent("text"), content: () => "text" },
  ])("rejects non-JSON wire inbound value %#", (candidate) => {
    expect(isSchemaValue(CanonicalInboundEventSchema, candidate)).toBe(false);
  });
});
