import Type from "typebox";
import { withoutSchemaId } from "../api/embedding.js";
import { UtcTimestampSchema } from "../shared/time.js";

const embed = <S extends Type.TSchema>(schema: S) => withoutSchemaId<Type.Static<S>>(schema);
const count = () => Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableCount = () => Type.Union([count(), Type.Null()]);

export const StaffAnalyticsQuerySchema = Type.Object(
  {
    from: embed(UtcTimestampSchema),
    to: embed(UtcTimestampSchema),
    group_by: Type.Optional(Type.Literal("day")),
  },
  { $id: "StaffAnalyticsQuery.v1", additionalProperties: false },
);
export type StaffAnalyticsQuery = Type.Static<typeof StaffAnalyticsQuerySchema>;

export const AnalyticsLatencySummarySchema = Type.Object(
  {
    count: count(),
    p50_ms: nullableCount(),
    p75_ms: nullableCount(),
    p90_ms: nullableCount(),
    p95_ms: nullableCount(),
    p99_ms: nullableCount(),
    max_ms: nullableCount(),
    within_3_seconds: count(),
    within_5_seconds: count(),
    within_10_seconds: count(),
    within_30_seconds: count(),
    within_60_seconds: count(),
    over_60_seconds: count(),
  },
  { $id: "AnalyticsLatencySummary.v1", additionalProperties: false },
);
export type AnalyticsLatencySummary = Type.Static<typeof AnalyticsLatencySummarySchema>;

export const AnalyticsChannelBreakdownSchema = Type.Object(
  {
    channel: Type.Union([
      Type.Literal("widget"),
      Type.Literal("telegram"),
      Type.Literal("instagram"),
    ]),
    appointment_requests: count(),
    confirmed_appointments: count(),
    conversations: count(),
    inbound_meaningful_messages: count(),
    leads: count(),
  },
  { $id: "AnalyticsChannelBreakdown.v1", additionalProperties: false },
);
export type AnalyticsChannelBreakdown = Type.Static<typeof AnalyticsChannelBreakdownSchema>;

export const AnalyticsDailyBucketSchema = Type.Object(
  {
    local_date: Type.String({ minLength: 10, maxLength: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    appointment_requests: count(),
    confirmed_appointments: count(),
    leads: count(),
  },
  { $id: "AnalyticsDailyBucket.v1", additionalProperties: false },
);
export type AnalyticsDailyBucket = Type.Static<typeof AnalyticsDailyBucketSchema>;

const funnel = Type.Object(
  {
    appointment_requests: count(),
    attended: count(),
    awaiting_customer_confirmation: count(),
    confirmed_appointments: count(),
    conversations: count(),
    handoffs: count(),
    inbound_meaningful_messages: count(),
    leads: count(),
    qualified_leads: count(),
    staff_accepted: count(),
    unique_contacts: count(),
  },
  { additionalProperties: false },
);
const rate = Type.Union([Type.Integer({ minimum: 0, maximum: 10_000 }), Type.Null()]);
const revenue = Type.Object(
  {
    available: Type.Boolean(),
    amounts: Type.Array(
      Type.Object(
        {
          amount_minor: Type.Integer({
            minimum: Number.MIN_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
          }),
          currency: Type.String({ minLength: 3, maxLength: 3, pattern: "^[A-Z]{3}$" }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 32 },
    ),
  },
  { additionalProperties: false },
);

export const StaffAnalyticsSchema = Type.Object(
  {
    range: Type.Object(
      {
        from: embed(UtcTimestampSchema),
        to: embed(UtcTimestampSchema),
        time_zone: Type.String({ minLength: 1, maxLength: 255 }),
        boundary: Type.Literal("from_inclusive_to_exclusive"),
      },
      { additionalProperties: false },
    ),
    funnel,
    conversion_basis_points: Type.Object(
      {
        appointment_request_to_staff_accepted: rate,
        appointment_request_to_confirmed: rate,
        confirmed_to_attended: rate,
        lead_to_appointment_request: rate,
        lead_to_attended: rate,
        lead_to_confirmed: rate,
        staff_accepted_to_confirmed: rate,
      },
      { additionalProperties: false },
    ),
    channels: Type.Array(embed(AnalyticsChannelBreakdownSchema), { maxItems: 3 }),
    daily: Type.Array(embed(AnalyticsDailyBucketSchema), { maxItems: 367 }),
    latency: Type.Object(
      {
        acknowledgement: embed(AnalyticsLatencySummarySchema),
        platform_meaningful_raw: embed(AnalyticsLatencySummarySchema),
        platform_meaningful_normal_availability: embed(AnalyticsLatencySummarySchema),
        external_message_to_submit_raw: embed(AnalyticsLatencySummarySchema),
        external_message_to_submit_normal_availability: embed(AnalyticsLatencySummarySchema),
        widget_customer_render: embed(AnalyticsLatencySummarySchema),
      },
      { additionalProperties: false },
    ),
    usage: Type.Object(
      {
        automated_messages: count(),
        automation_rate_basis_points: rate,
      },
      { additionalProperties: false },
    ),
    recorded_attributed_revenue: revenue,
  },
  { $id: "StaffAnalytics.v1", additionalProperties: false },
);
export type StaffAnalytics = Type.Static<typeof StaffAnalyticsSchema>;

export const StaffAnalyticsResponseSchema = Type.Object(
  {
    data: embed(StaffAnalyticsSchema),
    meta: Type.Object(
      { request_id: Type.String({ minLength: 1, maxLength: 255 }) },
      { additionalProperties: false },
    ),
  },
  { $id: "StaffAnalyticsResponse.v1", additionalProperties: false },
);
export type StaffAnalyticsResponse = Type.Static<typeof StaffAnalyticsResponseSchema>;
