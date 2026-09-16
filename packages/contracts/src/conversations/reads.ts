import Type from "typebox";

import { createCollectionEnvelopeSchema, createSuccessEnvelopeSchema } from "../api/envelopes.js";
import { OpaqueCursorSchema, PageSizeSchema } from "../api/pagination.js";
import { withoutSchemaId } from "../api/embedding.js";
import {
  ChannelConnectionIdSchema,
  ContactIdSchema,
  ConversationIdSchema,
  HandoffIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  MembershipIdSchema,
  MessageIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  type ChannelConnectionId,
  type ContactId,
  type ConversationId,
  type LeadId,
  type LocationId,
  type MembershipId,
  type MessageId,
  type ResourceId,
} from "../shared/identifiers.js";
import { LocaleSchema } from "../shared/localization.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const BOUNDED_CODE_PATTERN = "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$";
const CAMPAIGN_KEY_PATTERN = "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$";
const NON_NULL_TEXT_PATTERN = "^[^\\u0000]+$";

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

const embedSchemaAs = <Value>(schema: Type.TSchema) => withoutSchemaId<Value>(schema);
const embedSchema = <Schema extends Type.TSchema>(schema: Schema) =>
  embedSchemaAs<Type.Static<Schema>>(schema);
const nullable = <Schema extends Type.TSchema>(schema: Schema) =>
  Type.Union([embedSchema(schema), Type.Null()]);
const embeddedTimestamp = () => embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema);
const nullableTimestamp = () => Type.Union([embeddedTimestamp(), Type.Null()]);
const nullableResourceId = () => nullable(ResourceIdSchema);

export const StaffContactStatusSchema = Type.Union(
  [Type.Literal("active"), Type.Literal("anonymized"), Type.Literal("blocked")],
  { $id: "StaffContactStatus.v1" },
);
export type StaffContactStatus = Type.Static<typeof StaffContactStatusSchema>;

export const StaffContactIdentityTypeSchema = Type.Union(
  [
    Type.Literal("widget_participant"),
    Type.Literal("telegram_user"),
    Type.Literal("phone"),
    Type.Literal("email"),
  ],
  { $id: "StaffContactIdentityType.v1" },
);
export type StaffContactIdentityType = Type.Static<typeof StaffContactIdentityTypeSchema>;

export const StaffContactIdentityValidationStatusSchema = Type.Union(
  [
    Type.Literal("unverified"),
    Type.Literal("valid"),
    Type.Literal("verified"),
    Type.Literal("invalid"),
  ],
  { $id: "StaffContactIdentityValidationStatus.v1" },
);
export type StaffContactIdentityValidationStatus = Type.Static<
  typeof StaffContactIdentityValidationStatusSchema
>;

export const StaffContactIdentityStatusSchema = Type.Union(
  [Type.Literal("active"), Type.Literal("withdrawn"), Type.Literal("anonymized")],
  { $id: "StaffContactIdentityStatus.v1" },
);
export type StaffContactIdentityStatus = Type.Static<typeof StaffContactIdentityStatusSchema>;

const identityProjection = <IdentitySchema extends Type.TSchema, ValueSchema extends Type.TSchema>(
  value: ValueSchema,
  identityType: IdentitySchema,
) =>
  Type.Object(
    {
      channel_connection_id: nullable(ChannelConnectionIdSchema),
      display_redacted: Type.Union([
        Type.String({ maxLength: 255, minLength: 1, pattern: NON_NULL_TEXT_PATTERN }),
        Type.Null(),
      ]),
      id: embedSchemaAs<ResourceId>(ResourceIdSchema),
      identity_type: embedSchema(identityType),
      status: embedSchema(StaffContactIdentityStatusSchema),
      validation_status: embedSchema(StaffContactIdentityValidationStatusSchema),
      value,
      verified_at: nullableTimestamp(),
    },
    { additionalProperties: false },
  );

const NullableIdentityValueSchema = Type.Union([
  Type.String({ maxLength: 8_192, minLength: 1, pattern: NON_NULL_TEXT_PATTERN }),
  Type.Null(),
]);
const MaskedIdentitySchema = identityProjection(Type.Null(), StaffContactIdentityTypeSchema);
const SensitiveIdentitySchema = identityProjection(
  NullableIdentityValueSchema,
  StaffContactIdentityTypeSchema,
);

export const StaffContactIdentitySchema = Type.Object(SensitiveIdentitySchema.properties, {
  $id: "StaffContactIdentity.v1",
  additionalProperties: false,
  description:
    "Authorized Contact identity projection containing only safe display data and an optional decrypted value.",
});
export type StaffContactIdentity = Type.Static<typeof StaffContactIdentitySchema>;

const contactProjection = <IdentitySchema extends Type.TSchema>(input: {
  readonly displayName: Type.TSchema;
  readonly identities: IdentitySchema;
  readonly sensitiveFieldsVisible: boolean;
  readonly status: Type.TSchema;
  readonly anonymizedAt: Type.TSchema;
}) =>
  Type.Object(
    {
      anonymized_at: input.anonymizedAt,
      created_at: embeddedTimestamp(),
      display_name: input.displayName,
      first_seen_at: embeddedTimestamp(),
      id: embedSchemaAs<ContactId>(ContactIdSchema),
      identities: Type.Array(input.identities, { maxItems: 64 }),
      last_seen_at: embeddedTimestamp(),
      preferred_locale: nullable(LocaleSchema),
      sensitive_fields_visible: Type.Literal(input.sensitiveFieldsVisible),
      status: input.status,
      updated_at: embeddedTimestamp(),
      version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
    },
    { additionalProperties: false },
  );

const ActiveContactStatusSchema = Type.Union([Type.Literal("active"), Type.Literal("blocked")]);
const NullableDisplayNameSchema = Type.Union([
  Type.String({ maxLength: 8_192, minLength: 1, pattern: NON_NULL_TEXT_PATTERN }),
  Type.Null(),
]);

export const StaffContactSchema = Type.Union(
  [
    contactProjection({
      anonymizedAt: Type.Null(),
      displayName: Type.Null(),
      identities: MaskedIdentitySchema,
      sensitiveFieldsVisible: false,
      status: ActiveContactStatusSchema,
    }),
    contactProjection({
      anonymizedAt: Type.Null(),
      displayName: NullableDisplayNameSchema,
      identities: SensitiveIdentitySchema,
      sensitiveFieldsVisible: true,
      status: ActiveContactStatusSchema,
    }),
    contactProjection({
      anonymizedAt: embeddedTimestamp(),
      displayName: Type.Null(),
      identities: MaskedIdentitySchema,
      sensitiveFieldsVisible: false,
      status: Type.Literal("anonymized"),
    }),
    contactProjection({
      anonymizedAt: embeddedTimestamp(),
      displayName: Type.Null(),
      identities: MaskedIdentitySchema,
      sensitiveFieldsVisible: true,
      status: Type.Literal("anonymized"),
    }),
  ],
  {
    $id: "StaffContact.v1",
    description:
      "Tenant-authorized Contact projection with permission-bound sensitive fields and fail-closed anonymization.",
  },
);
export type StaffContact = Type.Static<typeof StaffContactSchema>;

export const StaffContactReadParamsSchema = Type.Object(
  { id: embedSchemaAs<ContactId>(ContactIdSchema) },
  { $id: "StaffContactReadParams.v1", additionalProperties: false },
);
export type StaffContactReadParams = Type.Static<typeof StaffContactReadParamsSchema>;

export const StaffContactResponseSchema = createSuccessEnvelopeSchema(
  StaffContactSchema,
  "StaffContactResponse.v1",
);
export type StaffContactResponse = Type.Static<typeof StaffContactResponseSchema>;

export const StaffLeadStatusSchema = Type.Union(
  [
    Type.Literal("new"),
    Type.Literal("engaged"),
    Type.Literal("qualified"),
    Type.Literal("booking_requested"),
    Type.Literal("converted"),
    Type.Literal("disqualified"),
    Type.Literal("closed"),
  ],
  { $id: "StaffLeadStatus.v1" },
);
export type StaffLeadStatus = Type.Static<typeof StaffLeadStatusSchema>;

const NullableBoundedCodeSchema = Type.Union([
  Type.String({ maxLength: 100, minLength: 1, pattern: BOUNDED_CODE_PATTERN }),
  Type.Null(),
]);

export const StaffLeadSchema = Type.Object(
  {
    assigned_membership_id: nullable(MembershipIdSchema),
    booking_requested_at: nullableTimestamp(),
    campaign_key: Type.Union([
      Type.String({ maxLength: 128, minLength: 1, pattern: CAMPAIGN_KEY_PATTERN }),
      Type.Null(),
    ]),
    closed_at: nullableTimestamp(),
    closed_reason: NullableBoundedCodeSchema,
    contact_id: embedSchemaAs<ContactId>(ContactIdSchema),
    converted_at: nullableTimestamp(),
    created_at: embeddedTimestamp(),
    engaged_at: nullableTimestamp(),
    id: embedSchemaAs<LeadId>(LeadIdSchema),
    location_id: nullable(LocationIdSchema),
    qualification_policy_id: nullableResourceId(),
    qualification_reason_codes: Type.Array(
      Type.String({ maxLength: 100, minLength: 1, pattern: BOUNDED_CODE_PATTERN }),
      { maxItems: 16 },
    ),
    qualified_at: nullableTimestamp(),
    service_id: nullable(ServiceIdSchema),
    source_channel_connection_id: embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
    status: embedSchema(StaffLeadStatusSchema),
    updated_at: embeddedTimestamp(),
    version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "StaffLead.v1",
    additionalProperties: false,
    description: "Tenant- and Location-authorized Lead staff projection.",
  },
);
export type StaffLead = Type.Static<typeof StaffLeadSchema>;

export const StaffLeadListQuerySchema = Type.Object(
  {
    assigned_membership_id: Type.Optional(embedSchemaAs<MembershipId>(MembershipIdSchema)),
    created_from: Type.Optional(embeddedTimestamp()),
    created_to: Type.Optional(embeddedTimestamp()),
    cursor: Type.Optional(
      embedSchemaAs<JsonWire<Type.Static<typeof OpaqueCursorSchema>>>(OpaqueCursorSchema),
    ),
    limit: Type.Optional(embedSchema(PageSizeSchema)),
    location_id: Type.Optional(embedSchemaAs<LocationId>(LocationIdSchema)),
    status: Type.Optional(embedSchema(StaffLeadStatusSchema)),
  },
  {
    $id: "StaffLeadListQuery.v1",
    "x-less-than-properties": [["created_from", "created_to"]],
    additionalProperties: false,
    description: "Finite Lead filters and keyset pagination ordered by created_at DESC, id DESC.",
  },
);
export type StaffLeadListQuery = Type.Static<typeof StaffLeadListQuerySchema>;

export const StaffLeadReadParamsSchema = Type.Object(
  { id: embedSchemaAs<LeadId>(LeadIdSchema) },
  { $id: "StaffLeadReadParams.v1", additionalProperties: false },
);
export type StaffLeadReadParams = Type.Static<typeof StaffLeadReadParamsSchema>;

export const StaffLeadResponseSchema = createSuccessEnvelopeSchema(
  StaffLeadSchema,
  "StaffLeadResponse.v1",
);
export type StaffLeadResponse = Type.Static<typeof StaffLeadResponseSchema>;

export const StaffLeadCollectionResponseSchema = createCollectionEnvelopeSchema(
  StaffLeadSchema,
  "StaffLeadCollectionResponse.v1",
);
export type StaffLeadCollectionResponse = Type.Static<typeof StaffLeadCollectionResponseSchema>;

export const StaffConversationStatusSchema = Type.Union(
  [
    Type.Literal("open"),
    Type.Literal("awaiting_lead"),
    Type.Literal("awaiting_staff"),
    Type.Literal("resolved"),
    Type.Literal("closed"),
  ],
  { $id: "StaffConversationStatus.v1" },
);
export type StaffConversationStatus = Type.Static<typeof StaffConversationStatusSchema>;

export const StaffConversationAutomationModeSchema = Type.Union(
  [Type.Literal("ai"), Type.Literal("paused"), Type.Literal("staff")],
  { $id: "StaffConversationAutomationMode.v1" },
);
export type StaffConversationAutomationMode = Type.Static<
  typeof StaffConversationAutomationModeSchema
>;

export const StaffConversationParticipantSchema = Type.Object(
  {
    contact_id: embedSchemaAs<ContactId>(ContactIdSchema),
    display_redacted: Type.Union([
      Type.String({ maxLength: 255, minLength: 1, pattern: NON_NULL_TEXT_PATTERN }),
      Type.Null(),
    ]),
    identity_type: nullable(StaffContactIdentityTypeSchema),
  },
  {
    $id: "StaffConversationParticipant.v1",
    additionalProperties: false,
    description: "Safe participant summary that never contains raw or decrypted identity data.",
  },
);
export type StaffConversationParticipant = Type.Static<typeof StaffConversationParticipantSchema>;

export const StaffConversationSchema = Type.Object(
  {
    active_handoff_id: nullable(HandoffIdSchema),
    automation_mode: embedSchema(StaffConversationAutomationModeSchema),
    channel_connection_id: embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
    closed_at: nullableTimestamp(),
    contact_id: embedSchemaAs<ContactId>(ContactIdSchema),
    created_at: embeddedTimestamp(),
    id: embedSchemaAs<ConversationId>(ConversationIdSchema),
    last_activity_at: embeddedTimestamp(),
    lead_id: embedSchemaAs<LeadId>(LeadIdSchema),
    participant: embedSchema(StaffConversationParticipantSchema),
    preferred_locale: embedSchema(LocaleSchema),
    resolved_at: nullableTimestamp(),
    started_at: embeddedTimestamp(),
    status: embedSchema(StaffConversationStatusSchema),
    updated_at: embeddedTimestamp(),
    version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "StaffConversation.v1",
    additionalProperties: false,
    description: "Tenant- and Location-authorized Conversation staff projection.",
  },
);
export type StaffConversation = Type.Static<typeof StaffConversationSchema>;

export const StaffConversationListQuerySchema = Type.Object(
  {
    assigned_membership_id: Type.Optional(embedSchemaAs<MembershipId>(MembershipIdSchema)),
    channel_connection_id: Type.Optional(
      embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
    ),
    cursor: Type.Optional(
      embedSchemaAs<JsonWire<Type.Static<typeof OpaqueCursorSchema>>>(OpaqueCursorSchema),
    ),
    limit: Type.Optional(embedSchema(PageSizeSchema)),
    status: Type.Optional(embedSchema(StaffConversationStatusSchema)),
  },
  {
    $id: "StaffConversationListQuery.v1",
    additionalProperties: false,
    description:
      "Finite Conversation filters and keyset pagination ordered by last_activity_at DESC, id DESC.",
  },
);
export type StaffConversationListQuery = Type.Static<typeof StaffConversationListQuerySchema>;

export const StaffConversationReadParamsSchema = Type.Object(
  { id: embedSchemaAs<ConversationId>(ConversationIdSchema) },
  { $id: "StaffConversationReadParams.v1", additionalProperties: false },
);
export type StaffConversationReadParams = Type.Static<typeof StaffConversationReadParamsSchema>;

export const StaffConversationResponseSchema = createSuccessEnvelopeSchema(
  StaffConversationSchema,
  "StaffConversationResponse.v1",
);
export type StaffConversationResponse = Type.Static<typeof StaffConversationResponseSchema>;

export const StaffConversationCollectionResponseSchema = createCollectionEnvelopeSchema(
  StaffConversationSchema,
  "StaffConversationCollectionResponse.v1",
);
export type StaffConversationCollectionResponse = Type.Static<
  typeof StaffConversationCollectionResponseSchema
>;

export const StaffMessageDirectionSchema = Type.Union(
  [Type.Literal("inbound"), Type.Literal("outbound"), Type.Literal("staff_internal")],
  { $id: "StaffMessageDirection.v1" },
);
export type StaffMessageDirection = Type.Static<typeof StaffMessageDirectionSchema>;

export const StaffMessageSenderTypeSchema = Type.Union(
  [Type.Literal("customer"), Type.Literal("member"), Type.Literal("system")],
  { $id: "StaffMessageSenderType.v1" },
);
export type StaffMessageSenderType = Type.Static<typeof StaffMessageSenderTypeSchema>;

export const StaffMessageProcessingStatusSchema = Type.Union(
  [
    Type.Literal("accepted"),
    Type.Literal("processing"),
    Type.Literal("processed"),
    Type.Literal("failed"),
    Type.Literal("suppressed"),
  ],
  { $id: "StaffMessageProcessingStatus.v1" },
);
export type StaffMessageProcessingStatus = Type.Static<typeof StaffMessageProcessingStatusSchema>;

export const StaffMessageDeliveryStatusSchema = Type.Union(
  [
    Type.Literal("not_applicable"),
    Type.Literal("queued"),
    Type.Literal("sent"),
    Type.Literal("delivered"),
    Type.Literal("failed"),
  ],
  { $id: "StaffMessageDeliveryStatus.v1" },
);
export type StaffMessageDeliveryStatus = Type.Static<typeof StaffMessageDeliveryStatusSchema>;

const messageProjection = <
  BodyText extends Type.TSchema,
  DeliveryStatus extends Type.TSchema,
  Direction extends Type.TSchema,
  RedactedAt extends Type.TSchema,
  SenderMembershipId extends Type.TSchema,
  SenderType extends Type.TSchema,
>(input: {
  readonly bodyText: BodyText;
  readonly deliveryStatus: DeliveryStatus;
  readonly direction: Direction;
  readonly redactedAt: RedactedAt;
  readonly senderMembershipId: SenderMembershipId;
  readonly senderType: SenderType;
}) =>
  Type.Object(
    {
      body_text: input.bodyText,
      channel_connection_id: embedSchemaAs<ChannelConnectionId>(ChannelConnectionIdSchema),
      content_type: Type.String({
        maxLength: 32,
        minLength: 1,
        pattern: NON_NULL_TEXT_PATTERN,
      }),
      conversation_id: embedSchemaAs<ConversationId>(ConversationIdSchema),
      created_at: embeddedTimestamp(),
      delivery_status: input.deliveryStatus,
      direction: input.direction,
      id: embedSchemaAs<MessageId>(MessageIdSchema),
      locale: nullable(LocaleSchema),
      processing_status: embedSchema(StaffMessageProcessingStatusSchema),
      redacted_at: input.redactedAt,
      reply_to_message_id: nullable(MessageIdSchema),
      sender_membership_id: input.senderMembershipId,
      sender_type: input.senderType,
      sequence_no: Type.Integer({ maximum: MAX_SAFE_INTEGER, minimum: 1 }),
    },
    { additionalProperties: false },
  );

const UnredactedBodySchema = Type.Union([
  Type.String({ maxLength: 65_536, minLength: 1, pattern: NON_NULL_TEXT_PATTERN }),
  Type.Null(),
]);
const AnyDeliveryStatusSchema = embedSchema(StaffMessageDeliveryStatusSchema);
const customerInboundSender = {
  deliveryStatus: Type.Literal("not_applicable"),
  direction: Type.Literal("inbound"),
  senderMembershipId: Type.Null(),
  senderType: Type.Literal("customer"),
} as const;
const memberOutboundSender = {
  deliveryStatus: AnyDeliveryStatusSchema,
  direction: Type.Literal("outbound"),
  senderMembershipId: embedSchemaAs<MembershipId>(MembershipIdSchema),
  senderType: Type.Literal("member"),
} as const;
const memberInternalSender = {
  deliveryStatus: Type.Literal("not_applicable"),
  direction: Type.Literal("staff_internal"),
  senderMembershipId: embedSchemaAs<MembershipId>(MembershipIdSchema),
  senderType: Type.Literal("member"),
} as const;
const systemOutboundSender = {
  deliveryStatus: AnyDeliveryStatusSchema,
  direction: Type.Literal("outbound"),
  senderMembershipId: Type.Null(),
  senderType: Type.Literal("system"),
} as const;

export const StaffMessageSchema = Type.Union(
  [
    messageProjection({
      bodyText: UnredactedBodySchema,
      redactedAt: Type.Null(),
      ...customerInboundSender,
    }),
    messageProjection({
      bodyText: Type.Null(),
      redactedAt: embeddedTimestamp(),
      ...customerInboundSender,
    }),
    messageProjection({
      bodyText: UnredactedBodySchema,
      redactedAt: Type.Null(),
      ...memberOutboundSender,
    }),
    messageProjection({
      bodyText: Type.Null(),
      redactedAt: embeddedTimestamp(),
      ...memberOutboundSender,
    }),
    messageProjection({
      bodyText: UnredactedBodySchema,
      redactedAt: Type.Null(),
      ...memberInternalSender,
    }),
    messageProjection({
      bodyText: Type.Null(),
      redactedAt: embeddedTimestamp(),
      ...memberInternalSender,
    }),
    messageProjection({
      bodyText: UnredactedBodySchema,
      redactedAt: Type.Null(),
      ...systemOutboundSender,
    }),
    messageProjection({
      bodyText: Type.Null(),
      redactedAt: embeddedTimestamp(),
      ...systemOutboundSender,
    }),
  ],
  {
    $id: "StaffMessage.v1",
    description:
      "Authorized staff Message projection with strict sender shape and fail-closed redaction.",
  },
);
export type StaffMessage = Type.Static<typeof StaffMessageSchema>;

export const StaffMessageListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(
      embedSchemaAs<JsonWire<Type.Static<typeof OpaqueCursorSchema>>>(OpaqueCursorSchema),
    ),
    limit: Type.Optional(embedSchema(PageSizeSchema)),
  },
  {
    $id: "StaffMessageListQuery.v1",
    additionalProperties: false,
    description: "Conversation-bound keyset pagination ordered by sequence_no ASC, id ASC.",
  },
);
export type StaffMessageListQuery = Type.Static<typeof StaffMessageListQuerySchema>;

export const StaffMessageCollectionResponseSchema = createCollectionEnvelopeSchema(
  StaffMessageSchema,
  "StaffMessageCollectionResponse.v1",
);
export type StaffMessageCollectionResponse = Type.Static<
  typeof StaffMessageCollectionResponseSchema
>;
export const StaffContactIdentityTypeV2Schema = Type.Union(
  [
    Type.Literal("widget_participant"),
    Type.Literal("telegram_user"),
    Type.Literal("instagram_user"),
    Type.Literal("phone"),
    Type.Literal("email"),
  ],
  { $id: "StaffContactIdentityType.v2" },
);
export type StaffContactIdentityTypeV2 = Type.Static<typeof StaffContactIdentityTypeV2Schema>;
const MaskedIdentityV2Schema = identityProjection(Type.Null(), StaffContactIdentityTypeV2Schema);
const SensitiveIdentityV2Schema = identityProjection(
  NullableIdentityValueSchema,
  StaffContactIdentityTypeV2Schema,
);
export const StaffContactIdentityV2Schema = Type.Object(SensitiveIdentityV2Schema.properties, {
  $id: "StaffContactIdentity.v2",
  additionalProperties: false,
});
export type StaffContactIdentityV2 = Type.Static<typeof StaffContactIdentityV2Schema>;
export const StaffContactV2Schema = Type.Union(
  [
    contactProjection({
      anonymizedAt: Type.Null(),
      displayName: Type.Null(),
      identities: MaskedIdentityV2Schema,
      sensitiveFieldsVisible: false,
      status: ActiveContactStatusSchema,
    }),
    contactProjection({
      anonymizedAt: Type.Null(),
      displayName: NullableDisplayNameSchema,
      identities: SensitiveIdentityV2Schema,
      sensitiveFieldsVisible: true,
      status: ActiveContactStatusSchema,
    }),
    contactProjection({
      anonymizedAt: embeddedTimestamp(),
      displayName: Type.Null(),
      identities: MaskedIdentityV2Schema,
      sensitiveFieldsVisible: false,
      status: Type.Literal("anonymized"),
    }),
    contactProjection({
      anonymizedAt: embeddedTimestamp(),
      displayName: Type.Null(),
      identities: MaskedIdentityV2Schema,
      sensitiveFieldsVisible: true,
      status: Type.Literal("anonymized"),
    }),
  ],
  {
    $id: "StaffContact.v2",
    description:
      "Tenant-authorized Contact projection with permission-bound sensitive fields and fail-closed anonymization.",
  },
);
export type StaffContactV2 = Type.Static<typeof StaffContactV2Schema>;
export const StaffContactResponseV2Schema = createSuccessEnvelopeSchema(
  StaffContactV2Schema,
  "StaffContactResponse.v2",
);
export type StaffContactResponseV2 = Type.Static<typeof StaffContactResponseV2Schema>;
export const StaffConversationParticipantV2Schema = Type.Object(
  {
    ...StaffConversationParticipantSchema.properties,
    identity_type: nullable(StaffContactIdentityTypeV2Schema),
  },
  { $id: "StaffConversationParticipant.v2", additionalProperties: false },
);
export type StaffConversationParticipantV2 = Type.Static<
  typeof StaffConversationParticipantV2Schema
>;
export const StaffConversationV2Schema = Type.Object(
  {
    ...StaffConversationSchema.properties,
    participant: embedSchema(StaffConversationParticipantV2Schema),
  },
  { $id: "StaffConversation.v2", additionalProperties: false },
);
export type StaffConversationV2 = Type.Static<typeof StaffConversationV2Schema>;
export const StaffConversationResponseV2Schema = createSuccessEnvelopeSchema(
  StaffConversationV2Schema,
  "StaffConversationResponse.v2",
);
export type StaffConversationResponseV2 = Type.Static<typeof StaffConversationResponseV2Schema>;
export const StaffConversationCollectionResponseV2Schema = createCollectionEnvelopeSchema(
  StaffConversationV2Schema,
  "StaffConversationCollectionResponse.v2",
);
export type StaffConversationCollectionResponseV2 = Type.Static<
  typeof StaffConversationCollectionResponseV2Schema
>;
