import Type from "typebox";

import { ChannelConnectionIdSchema, type ChannelConnectionId } from "../shared/identifiers.js";
import { LocaleSchema } from "../shared/localization.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import {
  ChannelActionTokenSchema,
  ExternalChannelAccountIdSchema,
  ExternalChannelConversationIdSchema,
  ExternalChannelEventIdSchema,
  ExternalChannelMessageIdSchema,
  ExternalChannelParticipantIdSchema,
  ProviderMediaReferenceSchema,
  type ExternalChannelAccountId,
  type ExternalChannelConversationId,
  type ExternalChannelEventId,
  type ExternalChannelMessageId,
  type ExternalChannelParticipantId,
} from "./identifiers.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import { ChannelMediaKindSchema, ChannelTypeSchema, type ChannelType } from "./vocabulary.js";

export const InboundTextContentSchema = Type.Object(
  {
    locale_hint: Type.Optional(Type.Union([embedSchema(LocaleSchema), Type.Null()])),
    text: Type.String({ maxLength: 4_000, minLength: 1 }),
    type: Type.Literal("text"),
  },
  {
    $id: "InboundTextContent.v1",
    additionalProperties: false,
    description: "Untrusted Unicode customer text; never authorization or executable instructions.",
  },
);
export type InboundTextContent = Type.Static<typeof InboundTextContentSchema>;

export const InboundQuickReplyContentSchema = Type.Object(
  {
    action_token: embedSchema(ChannelActionTokenSchema),
    display_text: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    type: Type.Literal("quick_reply"),
  },
  {
    $id: "InboundQuickReplyContent.v1",
    additionalProperties: false,
    description: "Provider-neutral quick-reply selection; policy must validate its opaque token.",
  },
);
export type InboundQuickReplyContent = Type.Static<typeof InboundQuickReplyContentSchema>;

export const InboundAttachmentContentSchema = Type.Object(
  {
    caption: Type.Optional(Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()])),
    media_kind: embedSchema(ChannelMediaKindSchema),
    provider_media_ref: embedSchema(ProviderMediaReferenceSchema),
    type: Type.Literal("attachment"),
  },
  {
    $id: "InboundAttachmentContent.v1",
    additionalProperties: false,
    description:
      "Quarantined untrusted attachment metadata only; this contract performs no download, storage, scan, OCR, or AI ingestion.",
  },
);
export type InboundAttachmentContent = Type.Static<typeof InboundAttachmentContentSchema>;

export const InboundDeliveryStatusContentSchema = Type.Object(
  {
    provider_status: Type.Optional(
      Type.Union([Type.String({ maxLength: 100, minLength: 1 }), Type.Null()]),
    ),
    type: Type.Literal("delivery_status"),
  },
  {
    $id: "InboundDeliveryStatusContent.v1",
    additionalProperties: false,
    description: "Untrusted provider delivery classification metadata.",
  },
);
export type InboundDeliveryStatusContent = Type.Static<typeof InboundDeliveryStatusContentSchema>;

export const InboundUnsupportedContentSchema = Type.Object(
  {
    provider_status: Type.Optional(
      Type.Union([Type.String({ maxLength: 100, minLength: 1 }), Type.Null()]),
    ),
    type: Type.Literal("unsupported"),
  },
  {
    $id: "InboundUnsupportedContent.v1",
    additionalProperties: false,
    description:
      "Bounded classification for provider content that core application code cannot process.",
  },
);
export type InboundUnsupportedContent = Type.Static<typeof InboundUnsupportedContentSchema>;

export const InboundChannelContentSchema = Type.Union(
  [
    InboundTextContentSchema,
    InboundQuickReplyContentSchema,
    InboundAttachmentContentSchema,
    InboundDeliveryStatusContentSchema,
    InboundUnsupportedContentSchema,
  ],
  {
    $id: "InboundChannelContent.v1",
    description: "Runtime-discriminated provider-neutral inbound content.",
  },
);
export type InboundChannelContent = Type.Static<typeof InboundChannelContentSchema>;

const inboundBaseProperties = () => ({
  channel: embedSchemaAs<ChannelType>(ChannelTypeSchema),
  channel_connection_id: embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
  event_id: embedSchemaAs<ExternalChannelEventId>(ExternalChannelEventIdSchema),
  external_account_id: Type.Optional(
    Type.Union([
      embedSchemaAs<ExternalChannelAccountId>(ExternalChannelAccountIdSchema),
      Type.Null(),
    ]),
  ),
  external_conversation_id: embedSchemaAs<ExternalChannelConversationId>(
    ExternalChannelConversationIdSchema,
  ),
  external_message_id: Type.Optional(
    Type.Union([
      embedSchemaAs<ExternalChannelMessageId>(ExternalChannelMessageIdSchema),
      Type.Null(),
    ]),
  ),
  external_sender_id: embedSchemaAs<ExternalChannelParticipantId>(
    ExternalChannelParticipantIdSchema,
  ),
  occurred_at: Type.Union([embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema), Type.Null()]),
  received_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
});

const createInboundVariant = <
  const Kind extends "text" | "quick_reply" | "attachment" | "delivery_status" | "unsupported",
  ContentSchema extends Type.TSchema,
>(
  kind: Kind,
  contentSchema: ContentSchema,
) =>
  Type.Object(
    {
      ...inboundBaseProperties(),
      content: embedSchema(contentSchema),
      kind: Type.Literal(kind),
    },
    { additionalProperties: false },
  );

const CanonicalInboundTextEventSchema = createInboundVariant("text", InboundTextContentSchema);
const CanonicalInboundQuickReplyEventSchema = createInboundVariant(
  "quick_reply",
  InboundQuickReplyContentSchema,
);
const CanonicalInboundAttachmentEventSchema = createInboundVariant(
  "attachment",
  InboundAttachmentContentSchema,
);
const CanonicalInboundDeliveryStatusEventSchema = createInboundVariant(
  "delivery_status",
  InboundDeliveryStatusContentSchema,
);
const CanonicalInboundUnsupportedEventSchema = createInboundVariant(
  "unsupported",
  InboundUnsupportedContentSchema,
);

export const CanonicalInboundEventSchema = Type.Union(
  [
    CanonicalInboundTextEventSchema,
    CanonicalInboundQuickReplyEventSchema,
    CanonicalInboundAttachmentEventSchema,
    CanonicalInboundDeliveryStatusEventSchema,
    CanonicalInboundUnsupportedEventSchema,
  ],
  {
    $id: "CanonicalInboundEvent.v1",
    description:
      "Untrusted provider-neutral inbound event. Organization authority is intentionally absent and must be resolved from a verified channel connection.",
  },
);
export type CanonicalInboundEvent = Type.Static<typeof CanonicalInboundEventSchema>;

export type CanonicalInboundTextEvent = Extract<CanonicalInboundEvent, { kind: "text" }>;
export type CanonicalInboundQuickReplyEvent = Extract<
  CanonicalInboundEvent,
  { kind: "quick_reply" }
>;
export type CanonicalInboundAttachmentEvent = Extract<
  CanonicalInboundEvent,
  { kind: "attachment" }
>;
export type CanonicalInboundDeliveryStatusEvent = Extract<
  CanonicalInboundEvent,
  { kind: "delivery_status" }
>;
export type CanonicalInboundUnsupportedEvent = Extract<
  CanonicalInboundEvent,
  { kind: "unsupported" }
>;
