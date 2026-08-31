import Type from "typebox";

declare const contractIdentifierBrand: unique symbol;

export type ContractIdentifier<Name extends string> = string & {
  readonly [contractIdentifierBrand]: Name;
};

const UUID_V7_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const OPERATION_ID_PATTERN = "^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$";
const SCHEMA_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z0-9_-]+)*\\.v[1-9][0-9]*$";

const createUuidV7Schema = <Name extends string>($id?: string) =>
  Type.Unsafe<ContractIdentifier<Name>>(
    Type.String({
      ...($id === undefined ? {} : { $id }),
      description: "Canonical lowercase RFC-variant UUIDv7 identifier.",
      maxLength: 36,
      minLength: 36,
      pattern: UUID_V7_PATTERN,
    }),
  );

const createOperationIdSchema = <Name extends string>($id: string) =>
  Type.Unsafe<ContractIdentifier<Name>>(
    Type.String({
      $id,
      description: "Bounded opaque operational identifier; never authorization evidence.",
      maxLength: 128,
      minLength: 8,
      pattern: OPERATION_ID_PATTERN,
    }),
  );

export const UuidV7Schema = createUuidV7Schema<"UuidV7">("UuidV7.v1");
export type UuidV7 = Type.Static<typeof UuidV7Schema>;

export const ResourceIdSchema = createUuidV7Schema<"ResourceId">("ResourceId.v1");
export type ResourceId = Type.Static<typeof ResourceIdSchema>;

export const OrganizationIdSchema = createUuidV7Schema<"OrganizationId">("OrganizationId.v1");
export type OrganizationId = Type.Static<typeof OrganizationIdSchema>;

export const UserIdSchema = createUuidV7Schema<"UserId">("UserId.v1");
export type UserId = Type.Static<typeof UserIdSchema>;

export const MembershipIdSchema = createUuidV7Schema<"MembershipId">("MembershipId.v1");
export type MembershipId = Type.Static<typeof MembershipIdSchema>;

export const LocationIdSchema = createUuidV7Schema<"LocationId">("LocationId.v1");
export type LocationId = Type.Static<typeof LocationIdSchema>;

export const ServiceIdSchema = createUuidV7Schema<"ServiceId">("ServiceId.v1");
export type ServiceId = Type.Static<typeof ServiceIdSchema>;

export const ContactIdSchema = createUuidV7Schema<"ContactId">("ContactId.v1");
export type ContactId = Type.Static<typeof ContactIdSchema>;

export const LeadIdSchema = createUuidV7Schema<"LeadId">("LeadId.v1");
export type LeadId = Type.Static<typeof LeadIdSchema>;

export const ConversationIdSchema = createUuidV7Schema<"ConversationId">("ConversationId.v1");
export type ConversationId = Type.Static<typeof ConversationIdSchema>;

export const MessageIdSchema = createUuidV7Schema<"MessageId">("MessageId.v1");
export type MessageId = Type.Static<typeof MessageIdSchema>;

export const AppointmentRequestIdSchema =
  createUuidV7Schema<"AppointmentRequestId">("AppointmentRequestId.v1");
export type AppointmentRequestId = Type.Static<typeof AppointmentRequestIdSchema>;

export const HandoffIdSchema = createUuidV7Schema<"HandoffId">("HandoffId.v1");
export type HandoffId = Type.Static<typeof HandoffIdSchema>;

export const ChannelConnectionIdSchema =
  createUuidV7Schema<"ChannelConnectionId">("ChannelConnectionId.v1");
export type ChannelConnectionId = Type.Static<typeof ChannelConnectionIdSchema>;

export const AiRunIdSchema = createUuidV7Schema<"AiRunId">("AiRunId.v1");
export type AiRunId = Type.Static<typeof AiRunIdSchema>;

export const EventIdSchema = createUuidV7Schema<"EventId">("EventId.v1");
export type EventId = Type.Static<typeof EventIdSchema>;

export const RequestIdSchema = createOperationIdSchema<"RequestId">("RequestId.v1");
export type RequestId = Type.Static<typeof RequestIdSchema>;

export const CorrelationIdSchema = createUuidV7Schema<"CorrelationId">("CorrelationId.v1");
export type CorrelationId = Type.Static<typeof CorrelationIdSchema>;

export const CausationIdSchema = createUuidV7Schema<"CausationId">("CausationId.v1");
export type CausationId = Type.Static<typeof CausationIdSchema>;

export const SchemaIdSchema = Type.Unsafe<ContractIdentifier<"SchemaId">>(
  Type.String({
    $id: "SchemaId.v1",
    description: "Versioned contract schema identifier ending in .vN.",
    maxLength: 128,
    minLength: 4,
    pattern: SCHEMA_ID_PATTERN,
  }),
);
export type SchemaId = Type.Static<typeof SchemaIdSchema>;

export const createActorIdSchema = () => createUuidV7Schema<"ActorId">();
