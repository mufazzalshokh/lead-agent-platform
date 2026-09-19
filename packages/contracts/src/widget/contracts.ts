import Type from "typebox";

import { withoutSchemaId } from "../api/embedding.js";
import {
  ConversationIdSchema,
  MessageIdSchema,
  RequestIdSchema,
  type ConversationId,
  type MessageId,
  type RequestId,
} from "../shared/identifiers.js";
import { LocaleSchema, type Locale } from "../shared/localization.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";

const SAFE_TEXT_PATTERN = "^[^\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]*$";
const CLIENT_MESSAGE_ID_PATTERN = "^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$";

type JsonWire<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends boolean
      ? boolean
      : Value extends null
        ? null
        : Value extends readonly (infer Item)[]
          ? JsonWire<Item>[]
          : Value extends object
            ? { readonly [Key in keyof Value]: JsonWire<Value[Key]> }
            : never;

const conversationId = () => withoutSchemaId<ConversationId>(ConversationIdSchema);
const messageId = () => withoutSchemaId<MessageId>(MessageIdSchema);
const locale = () => withoutSchemaId<Locale>(LocaleSchema);
const timestamp = () => withoutSchemaId<JsonWire<UtcTimestamp>>(UtcTimestampSchema);
const requestId = () => withoutSchemaId<RequestId>(RequestIdSchema);
const nullable = <Schema extends Type.TSchema>(schema: Schema) => Type.Union([schema, Type.Null()]);

const widgetKey = () => Type.String({ maxLength: 255, minLength: 32, pattern: "^[A-Za-z0-9_-]+$" });
const pageUrl = () => Type.String({ format: "uri", maxLength: 2_048, minLength: 8 });
const bearerToken = () =>
  Type.String({ maxLength: 4_096, minLength: 80, pattern: "^[A-Za-z0-9._-]+$" });
const exchangeGrant = () =>
  Type.String({
    maxLength: 2_048,
    minLength: 100,
    pattern: "^wex1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
  });
const httpsOrigin = () => Type.String({ format: "uri", maxLength: 2_048, minLength: 9 });
const clientMessageId = () =>
  Type.String({ maxLength: 128, minLength: 8, pattern: CLIENT_MESSAGE_ID_PATTERN });
const messageText = () =>
  Type.String({ maxLength: 4_000, minLength: 1, pattern: SAFE_TEXT_PATTERN });

export const WidgetSessionCreateInputSchema = Type.Object(
  {
    page_url: pageUrl(),
    requested_locale: locale(),
    widget_key: widgetKey(),
  },
  { $id: "WidgetSessionCreateInput.v1", additionalProperties: false },
);
export type WidgetSessionCreateInput = Type.Static<typeof WidgetSessionCreateInputSchema>;

export const WidgetEmbedGrantCreateInputSchema = Type.Object(
  {
    page_url: pageUrl(),
    requested_locale: locale(),
    widget_key: widgetKey(),
  },
  { $id: "WidgetEmbedGrantCreateInput.v1", additionalProperties: false },
);
export type WidgetEmbedGrantCreateInput = Type.Static<typeof WidgetEmbedGrantCreateInputSchema>;

export const WidgetEmbedGrantSchema = Type.Object(
  {
    exchange_grant: exchangeGrant(),
    expires_at: timestamp(),
    iframe_origin: httpsOrigin(),
    iframe_url: Type.String({ format: "uri", maxLength: 4_096, minLength: 12 }),
  },
  { $id: "WidgetEmbedGrant.v1", additionalProperties: false },
);
export type WidgetEmbedGrant = Type.Static<typeof WidgetEmbedGrantSchema>;

export const WidgetEmbedGrantCreateResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetEmbedGrant>(WidgetEmbedGrantSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetEmbedGrantCreateResponse.v1", additionalProperties: false },
);
export type WidgetEmbedGrantCreateResponse = Type.Static<
  typeof WidgetEmbedGrantCreateResponseSchema
>;

export const WidgetEmbedPolicyInputSchema = Type.Object(
  { exchange_grant: exchangeGrant() },
  { $id: "WidgetEmbedPolicyInput.v1", additionalProperties: false },
);
export type WidgetEmbedPolicyInput = Type.Static<typeof WidgetEmbedPolicyInputSchema>;

export const WidgetEmbedPolicySchema = Type.Object(
  {
    embedding_origin: httpsOrigin(),
    expires_at: timestamp(),
    iframe_origin: httpsOrigin(),
  },
  { $id: "WidgetEmbedPolicy.v1", additionalProperties: false },
);
export type WidgetEmbedPolicy = Type.Static<typeof WidgetEmbedPolicySchema>;

export const WidgetEmbedPolicyResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetEmbedPolicy>(WidgetEmbedPolicySchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetEmbedPolicyResponse.v1", additionalProperties: false },
);
export type WidgetEmbedPolicyResponse = Type.Static<typeof WidgetEmbedPolicyResponseSchema>;

export const WidgetEmbedSessionRedeemInputSchema = Type.Object(
  { exchange_grant: exchangeGrant() },
  { $id: "WidgetEmbedSessionRedeemInput.v1", additionalProperties: false },
);
export type WidgetEmbedSessionRedeemInput = Type.Static<typeof WidgetEmbedSessionRedeemInputSchema>;

export const WidgetPublicConfigurationSchema = Type.Object(
  {
    max_message_characters: Type.Literal(4_000),
    supported_locales: Type.Array(locale(), { maxItems: 3, minItems: 3, uniqueItems: true }),
  },
  { $id: "WidgetPublicConfiguration.v1", additionalProperties: false },
);
export type WidgetPublicConfiguration = Type.Static<typeof WidgetPublicConfigurationSchema>;

export const WidgetSessionSchema = Type.Object(
  {
    bearer_token: bearerToken(),
    configuration: withoutSchemaId<WidgetPublicConfiguration>(WidgetPublicConfigurationSchema),
    expires_at: timestamp(),
    idle_timeout_seconds: Type.Literal(1_800),
  },
  { $id: "WidgetSession.v1", additionalProperties: false },
);
export type WidgetSession = Type.Static<typeof WidgetSessionSchema>;

export const WidgetSessionCreateResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetSession>(WidgetSessionSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetSessionCreateResponse.v1", additionalProperties: false },
);
export type WidgetSessionCreateResponse = Type.Static<typeof WidgetSessionCreateResponseSchema>;

export const WidgetEmbedSessionRedeemResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetSession>(WidgetSessionSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetEmbedSessionRedeemResponse.v1", additionalProperties: false },
);
export type WidgetEmbedSessionRedeemResponse = Type.Static<
  typeof WidgetEmbedSessionRedeemResponseSchema
>;

export const WidgetTextMessageInputSchema = Type.Object(
  {
    client_message_id: clientMessageId(),
    kind: Type.Literal("text"),
    locale_hint: nullable(locale()),
    text: messageText(),
  },
  { $id: "WidgetTextMessageInput.v1", additionalProperties: false },
);
export type WidgetTextMessageInput = Type.Static<typeof WidgetTextMessageInputSchema>;

export const WidgetConversationCreateInputSchema = Type.Object(
  {
    client_message_id: clientMessageId(),
    kind: Type.Literal("text"),
    locale_hint: nullable(locale()),
    text: messageText(),
  },
  { $id: "WidgetConversationCreateInput.v1", additionalProperties: false },
);
export type WidgetConversationCreateInput = Type.Static<typeof WidgetConversationCreateInputSchema>;

export const WidgetMessageCreateInputSchema = Type.Object(
  {
    client_message_id: clientMessageId(),
    kind: Type.Literal("text"),
    locale_hint: nullable(locale()),
    text: messageText(),
  },
  { $id: "WidgetMessageCreateInput.v1", additionalProperties: false },
);
export type WidgetMessageCreateInput = Type.Static<typeof WidgetMessageCreateInputSchema>;

export const WidgetConversationReadParamsSchema = Type.Object(
  { id: conversationId() },
  { $id: "WidgetConversationReadParams.v1", additionalProperties: false },
);
export type WidgetConversationReadParams = Type.Static<typeof WidgetConversationReadParamsSchema>;

export const WidgetConversationSchema = Type.Object(
  {
    closed_at: nullable(timestamp()),
    id: conversationId(),
    last_activity_at: timestamp(),
    preferred_locale: locale(),
    resolved_at: nullable(timestamp()),
    started_at: timestamp(),
    status: Type.Union([
      Type.Literal("open"),
      Type.Literal("awaiting_lead"),
      Type.Literal("awaiting_staff"),
      Type.Literal("resolved"),
      Type.Literal("closed"),
    ]),
  },
  { $id: "WidgetConversation.v1", additionalProperties: false },
);
export type WidgetConversation = Type.Static<typeof WidgetConversationSchema>;

export const WidgetAcceptedMessageSchema = Type.Object(
  {
    id: messageId(),
    processing_status: Type.Union([Type.Literal("accepted"), Type.Literal("suppressed")]),
    sequence_no: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 }),
  },
  { $id: "WidgetAcceptedMessage.v1", additionalProperties: false },
);
export type WidgetAcceptedMessage = Type.Static<typeof WidgetAcceptedMessageSchema>;

export const WidgetConversationCreateResultSchema = Type.Object(
  {
    bearer_token: bearerToken(),
    conversation: withoutSchemaId<WidgetConversation>(WidgetConversationSchema),
    expires_at: timestamp(),
    message: withoutSchemaId<WidgetAcceptedMessage>(WidgetAcceptedMessageSchema),
  },
  { $id: "WidgetConversationCreateResult.v1", additionalProperties: false },
);
export type WidgetConversationCreateResult = Type.Static<
  typeof WidgetConversationCreateResultSchema
>;

export const WidgetConversationCreateResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetConversationCreateResult>(WidgetConversationCreateResultSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetConversationCreateResponse.v1", additionalProperties: false },
);
export type WidgetConversationCreateResponse = Type.Static<
  typeof WidgetConversationCreateResponseSchema
>;

export const WidgetConversationResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetConversation>(WidgetConversationSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetConversationResponse.v1", additionalProperties: false },
);
export type WidgetConversationResponse = Type.Static<typeof WidgetConversationResponseSchema>;

export const WidgetMessageCreateResultSchema = Type.Object(
  {
    conversation_id: conversationId(),
    message: withoutSchemaId<WidgetAcceptedMessage>(WidgetAcceptedMessageSchema),
  },
  { $id: "WidgetMessageCreateResult.v1", additionalProperties: false },
);
export type WidgetMessageCreateResult = Type.Static<typeof WidgetMessageCreateResultSchema>;

export const WidgetMessageCreateResponseSchema = Type.Object(
  {
    data: withoutSchemaId<WidgetMessageCreateResult>(WidgetMessageCreateResultSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetMessageCreateResponse.v1", additionalProperties: false },
);
export type WidgetMessageCreateResponse = Type.Static<typeof WidgetMessageCreateResponseSchema>;

export const WidgetMessageListQuerySchema = Type.Object(
  {
    after: Type.Optional(Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 0 })),
    limit: Type.Optional(Type.Integer({ default: 50, maximum: 100, minimum: 1 })),
  },
  { $id: "WidgetMessageListQuery.v1", additionalProperties: false },
);
export type WidgetMessageListQuery = Type.Static<typeof WidgetMessageListQuerySchema>;

export const WidgetMessageSchema = Type.Object(
  {
    body_text: nullable(messageText()),
    conversation_id: conversationId(),
    created_at: timestamp(),
    direction: Type.Union([Type.Literal("inbound"), Type.Literal("outbound")]),
    id: messageId(),
    locale: nullable(locale()),
    redacted_at: nullable(timestamp()),
    sequence_no: Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 }),
  },
  { $id: "WidgetMessage.v1", additionalProperties: false },
);
export type WidgetMessage = Type.Static<typeof WidgetMessageSchema>;

export const WidgetMessageCollectionResponseSchema = Type.Object(
  {
    data: Type.Array(withoutSchemaId<WidgetMessage>(WidgetMessageSchema), { maxItems: 100 }),
    meta: Type.Object(
      {
        has_more: Type.Boolean(),
        next_after: nullable(Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 1 })),
        request_id: requestId(),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "WidgetMessageCollectionResponse.v1", additionalProperties: false },
);
export type WidgetMessageCollectionResponse = Type.Static<
  typeof WidgetMessageCollectionResponseSchema
>;

export const WidgetTelemetryInputSchema = Type.Object(
  {
    duration_ms: Type.Integer({ minimum: 0, maximum: 300_000 }),
    kind: Type.Literal("meaningful_first_response"),
  },
  { $id: "WidgetTelemetryInput.v1", additionalProperties: false },
);
export type WidgetTelemetryInput = Type.Static<typeof WidgetTelemetryInputSchema>;

export const WidgetTelemetryResultSchema = Type.Object(
  { accepted: Type.Literal(true) },
  { $id: "WidgetTelemetryResult.v1", additionalProperties: false },
);
export const WidgetTelemetryResponseSchema = Type.Object(
  {
    data: withoutSchemaId(WidgetTelemetryResultSchema),
    meta: Type.Object({ request_id: requestId() }, { additionalProperties: false }),
  },
  { $id: "WidgetTelemetryResponse.v1", additionalProperties: false },
);
