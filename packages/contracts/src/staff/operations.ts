import Type from "typebox";
import { withoutSchemaId } from "../api/embedding.js";
import { createCollectionEnvelopeSchema, createSuccessEnvelopeSchema } from "../api/envelopes.js";
import { OpaqueCursorSchema, PageSizeSchema } from "../api/pagination.js";
import {
  ResourceIdSchema,
  ConversationIdSchema,
  ContactIdSchema,
  LeadIdSchema,
  LocationIdSchema,
  ServiceIdSchema,
  MembershipIdSchema,
  ChannelConnectionIdSchema,
} from "../shared/identifiers.js";
import { UtcTimestampSchema } from "../shared/time.js";
import { ResourceVersionSchema } from "../shared/version.js";
import { CurrencyCodeSchema } from "../shared/money.js";

const embed = <S extends Type.TSchema>(schema: S) => withoutSchemaId<Type.Static<S>>(schema);
const nullable = <S extends Type.TSchema>(schema: S) => Type.Union([embed(schema), Type.Null()]);
const code = () =>
  Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$" });
const kind = () =>
  Type.Union([
    Type.Literal("conversation"),
    Type.Literal("handoff"),
    Type.Literal("appointment_request"),
    Type.Literal("notification"),
  ]);
const preference = Type.Object(
  {
    start_at: nullable(UtcTimestampSchema),
    end_at: nullable(UtcTimestampSchema),
    time_zone: Type.String({ minLength: 1, maxLength: 100 }),
    local_start: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    precision: Type.Union(
      ["exact", "part_of_day", "date_only", "free_text"].map((value) => Type.Literal(value)),
    ),
  },
  { additionalProperties: false },
);

/** Private work context only. Identity and messages use the existing versioned staff readers. */
export const StaffWorkItemSchema = Type.Object(
  {
    id: embed(ResourceIdSchema),
    kind: kind(),
    status: code(),
    version: embed(ResourceVersionSchema),
    actionable: Type.Boolean(),
    activity_at: embed(UtcTimestampSchema),
    conversation_id: nullable(ConversationIdSchema),
    contact_id: nullable(ContactIdSchema),
    lead_id: nullable(LeadIdSchema),
    channel_connection_id: nullable(ChannelConnectionIdSchema),
    location_id: nullable(LocationIdSchema),
    service_id: nullable(ServiceIdSchema),
    assigned_membership_id: nullable(MembershipIdSchema),
    conversation_version: nullable(ResourceVersionSchema),
    handoff_id: nullable(ResourceIdSchema),
    handoff_status: Type.Union([code(), Type.Null()]),
    appointment_request_id: nullable(ResourceIdSchema),
    appointment_status: Type.Union([code(), Type.Null()]),
    preferences: Type.Array(preference, { maxItems: 20 }),
    start_at: nullable(UtcTimestampSchema),
    end_at: nullable(UtcTimestampSchema),
    recipient_read_at: nullable(UtcTimestampSchema),
    acknowledgment_supported: Type.Boolean(),
  },
  { $id: "StaffWorkItem.v1", additionalProperties: false },
);
export type StaffWorkItem = Type.Static<typeof StaffWorkItemSchema>;
export const StaffWorkListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(embed(OpaqueCursorSchema)),
    limit: Type.Optional(embed(PageSizeSchema)),
    view: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("history")])),
    location_id: Type.Optional(embed(LocationIdSchema)),
  },
  { $id: "StaffWorkListQuery.v1", additionalProperties: false },
);
export type StaffWorkListQuery = Type.Static<typeof StaffWorkListQuerySchema>;
export const StaffWorkParamsSchema = Type.Object(
  { id: embed(ResourceIdSchema) },
  { $id: "StaffWorkParams.v1", additionalProperties: false },
);
export const StaffWorkResponseSchema = createSuccessEnvelopeSchema(
  StaffWorkItemSchema,
  "StaffWorkResponse.v1",
);
export const StaffWorkCollectionResponseSchema = createCollectionEnvelopeSchema(
  StaffWorkItemSchema,
  "StaffWorkCollectionResponse.v1",
);

export const StaffAcceptAppointmentInputSchema = Type.Object(
  {
    start_at: embed(UtcTimestampSchema),
    end_at: embed(UtcTimestampSchema),
  },
  { $id: "StaffAcceptAppointmentInput.v1", additionalProperties: false },
);
export const StaffRejectAppointmentInputSchema = Type.Object(
  { reason_code: code() },
  { $id: "StaffRejectAppointmentInput.v1", additionalProperties: false },
);
export const StaffClaimHandoffInputSchema = Type.Object(
  { conversation_version: embed(ResourceVersionSchema) },
  { $id: "StaffClaimHandoffInput.v1", additionalProperties: false },
);
export const StaffResolveHandoffInputSchema = Type.Object(
  {
    conversation_version: embed(ResourceVersionSchema),
    resolution_code: code(),
    disposition: Type.Union([Type.Literal("resume_ai"), Type.Literal("resolve_conversation")]),
  },
  { $id: "StaffResolveHandoffInput.v1", additionalProperties: false },
);
export const StaffAcknowledgeInputSchema = Type.Object(
  {},
  { $id: "StaffAcknowledgeInput.v1", additionalProperties: false },
);

export const StaffAttendanceInputSchema = Type.Object(
  {
    outcome: Type.Union([
      Type.Literal("attended"),
      Type.Literal("did_not_attend"),
      Type.Literal("unknown"),
    ]),
    occurred_at: Type.Optional(embed(UtcTimestampSchema)),
    supersedes_attendance_id: Type.Optional(embed(ResourceIdSchema)),
    reason_code: Type.Optional(code()),
  },
  { $id: "StaffAttendanceInput.v1", additionalProperties: false },
);
export const StaffRevenueInputSchema = Type.Union(
  [
    Type.Object(
      {
        entry_type: Type.Union([Type.Literal("charge"), Type.Literal("adjustment")]),
        amount_minor: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        currency: embed(CurrencyCodeSchema),
        category_code: code(),
        recognized_at: embed(UtcTimestampSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        entry_type: Type.Literal("reversal"),
        reverses_attribution_id: embed(ResourceIdSchema),
        reason_code: code(),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "StaffRevenueInput.v1" },
);
export const StaffOutcomeSchema = Type.Object(
  {
    id: embed(ResourceIdSchema),
    appointment_request_id: embed(ResourceIdSchema),
    kind: Type.Union([Type.Literal("attendance"), Type.Literal("revenue")]),
    recorded_at: embed(UtcTimestampSchema),
    recorded_by_membership_id: embed(MembershipIdSchema),
    outcome: Type.Union([code(), Type.Null()]),
    amount_minor: Type.Union([
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ]),
    currency: nullable(CurrencyCodeSchema),
    entry_type: Type.Union([code(), Type.Null()]),
    is_current: Type.Union([Type.Boolean(), Type.Null()]),
    supersedes_id: nullable(ResourceIdSchema),
    reason_code: Type.Union([code(), Type.Null()]),
  },
  { $id: "StaffOutcome.v1", additionalProperties: false },
);
export const StaffOutcomeCollectionResponseSchema = createCollectionEnvelopeSchema(
  StaffOutcomeSchema,
  "StaffOutcomeCollectionResponse.v1",
);
export const StaffMutationResultSchema = Type.Object(
  {
    resource: embed(StaffWorkItemSchema),
    outcome_id: nullable(ResourceIdSchema),
  },
  { $id: "StaffMutationResult.v1", additionalProperties: false },
);
export const StaffMutationResponseSchema = createSuccessEnvelopeSchema(
  StaffMutationResultSchema,
  "StaffMutationResponse.v1",
);
export type StaffMutationResult = Type.Static<typeof StaffMutationResultSchema>;
export type StaffOutcome = Type.Static<typeof StaffOutcomeSchema>;
export type StaffAcceptAppointmentInput = Type.Static<typeof StaffAcceptAppointmentInputSchema>;
export type StaffRejectAppointmentInput = Type.Static<typeof StaffRejectAppointmentInputSchema>;
export type StaffClaimHandoffInput = Type.Static<typeof StaffClaimHandoffInputSchema>;
export type StaffResolveHandoffInput = Type.Static<typeof StaffResolveHandoffInputSchema>;
export type StaffAttendanceInput = Type.Static<typeof StaffAttendanceInputSchema>;
export type StaffRevenueInput = Type.Static<typeof StaffRevenueInputSchema>;
