import Type from "typebox";

import {
  ChannelConnectionIdSchema,
  ConversationIdSchema,
  MessageIdSchema,
  OrganizationIdSchema,
  type ChannelConnectionId,
  type ConversationId,
  type MessageId,
  type OrganizationId,
} from "../shared/identifiers.js";
import { LocaleSchema } from "../shared/localization.js";
import {
  ChannelActionTokenSchema,
  ChannelIdempotencyKeySchema,
  ExternalChannelParticipantIdSchema,
} from "./identifiers.js";
import { embedSchema, embedSchemaAs } from "./internal.js";

export const OutboundQuickReplySchema = Type.Object(
  {
    action_token: embedSchema(ChannelActionTokenSchema),
    label: Type.String({ maxLength: 80, minLength: 1 }),
  },
  {
    $id: "OutboundQuickReply.v1",
    additionalProperties: false,
    description: "Bounded portable quick-reply choice with an opaque application token.",
  },
);
export type OutboundQuickReply = Type.Static<typeof OutboundQuickReplySchema>;

export const OutboundChannelContentSchema = Type.Object(
  {
    locale: embedSchema(LocaleSchema),
    quick_replies: Type.Optional(
      Type.Array(embedSchema(OutboundQuickReplySchema), {
        maxItems: 5,
      }),
    ),
    text: Type.String({ maxLength: 4_000, minLength: 1 }),
  },
  {
    $id: "OutboundChannelContent.v1",
    additionalProperties: false,
    description: "Portable plain-text outbound content; provider rendering remains adapter-local.",
  },
);
export type OutboundChannelContent = Type.Static<typeof OutboundChannelContentSchema>;

export const SendChannelMessageSchema = Type.Object(
  {
    channel_connection_id: embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
    content: embedSchema(OutboundChannelContentSchema),
    conversation_id: embedSchemaAs<ConversationId>(ConversationIdSchema),
    idempotency_key: embedSchema(ChannelIdempotencyKeySchema),
    organization_id: embedSchemaAs<OrganizationId>(OrganizationIdSchema),
    recipient: embedSchema(ExternalChannelParticipantIdSchema),
    reply_to_message_id: Type.Optional(
      Type.Union([embedSchemaAs<MessageId>(MessageIdSchema), Type.Null()]),
    ),
  },
  {
    $id: "SendChannelMessage.v1",
    additionalProperties: false,
    description:
      "Trusted-application outbound intent. Provenance and organization fields require independent authorization and never grant it by schema validation alone.",
  },
);
export type SendChannelMessage = Type.Static<typeof SendChannelMessageSchema>;
