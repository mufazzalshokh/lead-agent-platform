import Type from "typebox";

import {
  LocationIdSchema,
  ResourceIdSchema,
  UserIdSchema,
  type LocationId,
  type ResourceId,
  type UserId,
} from "../shared/identifiers.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import {
  ConfigurationCodeSchema,
  IanaTimeZoneSchema,
  LocalDateSchema,
  LocalTimeSchema,
  LocalizedTextSchema,
  PublishedConfigurationProvenanceSchema,
  type ConfigurationCode,
  type IanaTimeZone,
  type LocalDate,
  type LocalTime,
  type LocalizedText,
} from "./primitives.js";

export const ConfigurationRootStatusSchema = Type.Union(
  [Type.Literal("active"), Type.Literal("inactive")],
  { $id: "ConfigurationRootStatus.v1" },
);
export type ConfigurationRootStatus = Type.Static<typeof ConfigurationRootStatusSchema>;

export const LocationPublicContactSchema = Type.Object(
  {
    email: Type.Optional(Type.String({ format: "email", maxLength: 254, minLength: 3 })),
    phone: Type.Optional(Type.String({ maxLength: 64, minLength: 3, pattern: "^[^\\u0000]*$" })),
    website: Type.Optional(Type.String({ format: "uri", maxLength: 2_048, minLength: 8 })),
  },
  {
    $id: "LocationPublicContact.v1",
    additionalProperties: false,
    description:
      "Deliberately public Location contact fields; internal contact metadata is excluded.",
    maxProperties: 3,
  },
);
export type LocationPublicContact = Type.Static<typeof LocationPublicContactSchema>;

export const WeekdaySchema = Type.Integer({
  $id: "Weekday.v1",
  description: "ISO weekday where Monday is 1 and Sunday is 7.",
  maximum: 7,
  minimum: 1,
});
export type Weekday = Type.Static<typeof WeekdaySchema>;

export const BusinessHoursIntervalSchema = Type.Object(
  {
    closes_at_local: embedSchemaAs<LocalTime>(LocalTimeSchema),
    day_of_week: embedSchema(WeekdaySchema),
    opens_at_local: embedSchemaAs<LocalTime>(LocalTimeSchema),
    sequence_no: Type.Integer({ maximum: 32, minimum: 1 }),
  },
  {
    $id: "BusinessHoursInterval.v1",
    "x-less-than-properties": [["opens_at_local", "closes_at_local"]],
    additionalProperties: false,
    description: "One non-overnight Location-local opening interval.",
  },
);
export type BusinessHoursInterval = Type.Static<typeof BusinessHoursIntervalSchema>;

export const WeeklyBusinessHoursSchema = Type.Object(
  {
    intervals: Type.Array(embedSchema(BusinessHoursIntervalSchema), {
      maxItems: 224,
      uniqueItems: true,
    }),
  },
  {
    $id: "WeeklyBusinessHours.v1",
    additionalProperties: false,
    description: "Complete weekly schedule; a weekday with no interval is closed.",
  },
);
export type WeeklyBusinessHours = Type.Static<typeof WeeklyBusinessHoursSchema>;

export const LocationPublishedVersionSchema = Type.Object(
  {
    address_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    business_hours: embedSchema(WeeklyBusinessHoursSchema),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    provenance: embedSchema(PublishedConfigurationProvenanceSchema),
    public_contact: embedSchema(LocationPublicContactSchema),
    time_zone: embedSchemaAs<IanaTimeZone>(IanaTimeZoneSchema),
  },
  {
    $id: "LocationPublishedVersion.v1",
    additionalProperties: false,
    description: "Immutable authoritative Location presentation, time zone, and weekly hours.",
  },
);
export type LocationPublishedVersion = Type.Static<typeof LocationPublishedVersionSchema>;

export const LocationRootSchema = Type.Object(
  {
    code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema),
    current_version: Type.Union([embedSchema(LocationPublishedVersionSchema), Type.Null()]),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    status: embedSchema(ConfigurationRootStatusSchema),
    version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "LocationRoot.v1",
    additionalProperties: false,
    description: "Stable Location root with its exact current published snapshot when present.",
  },
);
export type LocationRoot = Type.Static<typeof LocationRootSchema>;

export const CreateLocationInputSchema = Type.Object(
  { code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema) },
  {
    $id: "CreateLocationInput.v1",
    additionalProperties: false,
    description: "Creates only an inactive stable Location root; it publishes no business facts.",
  },
);
export type CreateLocationInput = Type.Static<typeof CreateLocationInputSchema>;

export const PublishLocationInputSchema = Type.Object(
  {
    address_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    business_hours: embedSchema(WeeklyBusinessHoursSchema),
    name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    public_contact: embedSchema(LocationPublicContactSchema),
    time_zone: embedSchemaAs<IanaTimeZone>(IanaTimeZoneSchema),
  },
  {
    $id: "PublishLocationInput.v1",
    additionalProperties: false,
    description:
      "Complete immediate Location publication candidate; no persisted draft or schedule.",
  },
);
export type PublishLocationInput = Type.Static<typeof PublishLocationInputSchema>;

export const DeactivateLocationInputSchema = Type.Object(
  {},
  {
    $id: "DeactivateLocationInput.v1",
    additionalProperties: false,
    description: "Explicit immediate Location deactivation command body.",
  },
);
export type DeactivateLocationInput = Type.Static<typeof DeactivateLocationInputSchema>;

export const LocationClosureKindSchema = Type.Union(
  [Type.Literal("closed"), Type.Literal("override")],
  { $id: "LocationClosureKind.v1" },
);
export type LocationClosureKind = Type.Static<typeof LocationClosureKindSchema>;

export const LocationClosureStatusSchema = Type.Union(
  [Type.Literal("active"), Type.Literal("superseded"), Type.Literal("cancelled")],
  { $id: "LocationClosureStatus.v1" },
);
export type LocationClosureStatus = Type.Static<typeof LocationClosureStatusSchema>;

const closureCandidate = () =>
  Type.Union([
    Type.Object(
      {
        kind: Type.Literal("closed"),
        local_date: embedSchemaAs<LocalDate>(LocalDateSchema),
        reason_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        closes_at_local: embedSchemaAs<LocalTime>(LocalTimeSchema),
        kind: Type.Literal("override"),
        local_date: embedSchemaAs<LocalDate>(LocalDateSchema),
        opens_at_local: embedSchemaAs<LocalTime>(LocalTimeSchema),
        reason_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
      },
      {
        "x-less-than-properties": [["opens_at_local", "closes_at_local"]],
        additionalProperties: false,
      },
    ),
  ]);

export const LocationClosureRecordSchema = Type.Object(
  {
    closure_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    created_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    created_by_user_id: embedSchemaAs<UserId>(UserIdSchema),
    details: closureCandidate(),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    status: embedSchema(LocationClosureStatusSchema),
    supersedes_id: Type.Union([embedSchemaAs<ResourceId>(ResourceIdSchema), Type.Null()]),
  },
  {
    $id: "LocationClosureRecord.v1",
    additionalProperties: false,
    description: "Immutable Location closure or override with explicit lifecycle provenance.",
  },
);
export type LocationClosureRecord = Type.Static<typeof LocationClosureRecordSchema>;

export const CreateLocationClosureInputSchema = Type.Unsafe<
  Type.Static<ReturnType<typeof closureCandidate>>
>({ ...closureCandidate(), $id: "CreateLocationClosureInput.v1" });
export type CreateLocationClosureInput = Type.Static<typeof CreateLocationClosureInputSchema>;

export const SupersedeLocationClosureInputSchema = Type.Unsafe<
  Type.Static<ReturnType<typeof closureCandidate>>
>({ ...closureCandidate(), $id: "SupersedeLocationClosureInput.v1" });
export type SupersedeLocationClosureInput = Type.Static<typeof SupersedeLocationClosureInputSchema>;

export const CancelLocationClosureInputSchema = Type.Object(
  {},
  {
    $id: "CancelLocationClosureInput.v1",
    additionalProperties: false,
    description: "Explicit idempotent closure cancellation command body.",
  },
);
export type CancelLocationClosureInput = Type.Static<typeof CancelLocationClosureInputSchema>;
