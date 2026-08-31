import Type from "typebox";

import { embedSchema } from "./internal.js";
import { ChannelMediaKindSchema, ChannelTextFormatSchema } from "./vocabulary.js";

export const ChannelCapabilitiesSchema = Type.Object(
  {
    max_quick_replies: Type.Integer({ maximum: 5, minimum: 0 }),
    max_text_length: Type.Integer({ maximum: 4_000, minimum: 1 }),
    supported_attachment_media_kinds: Type.Array(embedSchema(ChannelMediaKindSchema), {
      maxItems: 4,
      uniqueItems: true,
    }),
    supported_text_formats: Type.Array(embedSchema(ChannelTextFormatSchema), {
      maxItems: 1,
      minItems: 1,
      uniqueItems: true,
    }),
    supports_delivery_status: Type.Boolean(),
    supports_message_edit: Type.Boolean(),
  },
  {
    $id: "ChannelCapabilities.v1",
    additionalProperties: false,
    description:
      "Bounded provider-neutral adapter capabilities. This representation does not implement negotiation or grant permission to send.",
  },
);
export type ChannelCapabilities = Type.Static<typeof ChannelCapabilitiesSchema>;
