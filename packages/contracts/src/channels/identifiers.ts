import Type from "typebox";

const createExternalIdentifierSchema = ($id: string, description: string, maxLength: number) =>
  Type.String({
    $id,
    description,
    maxLength,
    minLength: 1,
  });

export const ExternalChannelEventIdSchema = createExternalIdentifierSchema(
  "ExternalChannelEventId.v1",
  "Opaque provider/connection-scoped event identity used for replay detection; never tenant authority.",
  255,
);
export type ExternalChannelEventId = Type.Static<typeof ExternalChannelEventIdSchema>;

export const ExternalChannelAccountIdSchema = createExternalIdentifierSchema(
  "ExternalChannelAccountId.v1",
  "Opaque untrusted provider account reference; never tenant authority.",
  255,
);
export type ExternalChannelAccountId = Type.Static<typeof ExternalChannelAccountIdSchema>;

export const ExternalChannelConversationIdSchema = createExternalIdentifierSchema(
  "ExternalChannelConversationId.v1",
  "Opaque connection-scoped provider conversation/thread reference.",
  255,
);
export type ExternalChannelConversationId = Type.Static<typeof ExternalChannelConversationIdSchema>;

export const ExternalChannelMessageIdSchema = createExternalIdentifierSchema(
  "ExternalChannelMessageId.v1",
  "Opaque optional connection-scoped provider message reference used for duplicate detection.",
  255,
);
export type ExternalChannelMessageId = Type.Static<typeof ExternalChannelMessageIdSchema>;

export const ExternalChannelParticipantIdSchema = createExternalIdentifierSchema(
  "ExternalChannelParticipantId.v1",
  "Opaque untrusted external sender/recipient reference; it is not a local ContactId or authentication proof.",
  255,
);
export type ExternalChannelParticipantId = Type.Static<typeof ExternalChannelParticipantIdSchema>;

export const ProviderMediaReferenceSchema = createExternalIdentifierSchema(
  "ProviderMediaReference.v1",
  "Opaque untrusted provider media reference; it is not a trusted URL or fetch instruction.",
  1_000,
);
export type ProviderMediaReference = Type.Static<typeof ProviderMediaReferenceSchema>;

export const ChannelActionTokenSchema = createExternalIdentifierSchema(
  "ChannelActionToken.v1",
  "Opaque bounded application action token; adapters must not interpret it as provider method data.",
  512,
);
export type ChannelActionToken = Type.Static<typeof ChannelActionTokenSchema>;

export const ChannelIdempotencyKeySchema = Type.String({
  $id: "ChannelIdempotencyKey.v1",
  description: "Opaque bounded logical-send idempotency key containing no PII.",
  maxLength: 128,
  minLength: 8,
});
export type ChannelIdempotencyKey = Type.Static<typeof ChannelIdempotencyKeySchema>;
