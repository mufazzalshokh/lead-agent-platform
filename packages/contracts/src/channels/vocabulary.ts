import Type from "typebox";

export const ChannelTypeSchema = Type.Union(
  [
    Type.Literal("widget"),
    Type.Literal("telegram"),
    Type.Literal("instagram"),
    Type.Literal("whatsapp"),
  ],
  {
    $id: "ChannelType.v1",
    description:
      "Provider-neutral channel vocabulary. Instagram and WhatsApp are contract seams, not enabled V1 adapters.",
  },
);
export type ChannelType = Type.Static<typeof ChannelTypeSchema>;

export const InboundMessageKindSchema = Type.Union(
  [
    Type.Literal("text"),
    Type.Literal("quick_reply"),
    Type.Literal("attachment"),
    Type.Literal("delivery_status"),
    Type.Literal("unsupported"),
  ],
  {
    $id: "InboundMessageKind.v1",
    description: "Closed provider-neutral inbound event classification.",
  },
);
export type InboundMessageKind = Type.Static<typeof InboundMessageKindSchema>;

export const ChannelMediaKindSchema = Type.Union(
  [Type.Literal("image"), Type.Literal("document"), Type.Literal("audio"), Type.Literal("other")],
  {
    $id: "ChannelMediaKind.v1",
    description:
      "Untrusted attachment classification only; it never authorizes retrieval or processing.",
  },
);
export type ChannelMediaKind = Type.Static<typeof ChannelMediaKindSchema>;

export const ChannelTextFormatSchema = Type.Literal("plain_text", {
  $id: "ChannelTextFormat.v1",
  description: "The only formatting mode accepted by the current canonical outbound contract.",
});
export type ChannelTextFormat = Type.Static<typeof ChannelTextFormatSchema>;

export const ChannelFailureCategorySchema = Type.Union(
  [
    Type.Literal("invalid_recipient"),
    Type.Literal("authentication_failed"),
    Type.Literal("rate_limited"),
    Type.Literal("provider_unavailable"),
    Type.Literal("unsupported_content"),
    Type.Literal("permanent_rejection"),
  ],
  {
    $id: "ChannelFailureCategory.v1",
    description:
      "Stable internal channel-adapter failure category; it is separate from public API problem codes.",
  },
);
export type ChannelFailureCategory = Type.Static<typeof ChannelFailureCategorySchema>;
