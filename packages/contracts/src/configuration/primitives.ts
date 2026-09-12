import Type from "typebox";

import {
  ResourceIdSchema,
  UserIdSchema,
  type ResourceId,
  type UserId,
} from "../shared/identifiers.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchemaAs, type JsonWire } from "./internal.js";

const localizedValue = (maximum: number) =>
  Type.String({ maxLength: maximum, minLength: 1, pattern: "^[^\\u0000]*$" });

export const LocalizedTextSchema = Type.Object(
  {
    en: Type.Optional(localizedValue(4_000)),
    ru: Type.Optional(localizedValue(4_000)),
    uz: Type.Optional(localizedValue(4_000)),
  },
  {
    $id: "LocalizedText.v1",
    additionalProperties: false,
    description: "Non-empty localized business text using only supported V1 locale keys.",
    maxProperties: 3,
    minProperties: 1,
  },
);
export type LocalizedText = Type.Static<typeof LocalizedTextSchema>;

export const IanaTimeZoneSchema = Type.String({
  $id: "IanaTimeZone.v1",
  "x-iana-time-zone": true,
  description: "Runtime-validated named IANA time zone; numeric UTC offsets are not accepted.",
  maxLength: 255,
  minLength: 3,
  pattern: "^(?:UTC|[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)+)$",
});
export type IanaTimeZone = Type.Static<typeof IanaTimeZoneSchema>;

export const LocalDateSchema = Type.String({
  $id: "LocalDate.v1",
  "x-local-date": true,
  description: "Valid proleptic Gregorian local calendar date in YYYY-MM-DD form.",
  maxLength: 10,
  minLength: 10,
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
});
export type LocalDate = Type.Static<typeof LocalDateSchema>;

export const LocalTimeSchema = Type.String({
  $id: "LocalTime.v1",
  description: "Location-local wall-clock time at whole-second precision.",
  maxLength: 8,
  minLength: 8,
  pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$",
});
export type LocalTime = Type.Static<typeof LocalTimeSchema>;

export const ConfigurationCodeSchema = Type.String({
  $id: "ConfigurationCode.v1",
  description: "Stable normalized Location or Service code.",
  maxLength: 64,
  minLength: 1,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
});
export type ConfigurationCode = Type.Static<typeof ConfigurationCodeSchema>;

export const ConfigurationKeySchema = Type.String({
  $id: "ConfigurationKey.v1",
  description: "Stable normalized FAQ or Business Policy key.",
  maxLength: 128,
  minLength: 1,
  pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
});
export type ConfigurationKey = Type.Static<typeof ConfigurationKeySchema>;

export const ContentHashSchema = Type.String({
  $id: "ContentHash.v1",
  description: "Lowercase hexadecimal digest identifying exact published content.",
  maxLength: 256,
  minLength: 2,
  pattern: "^(?:[0-9a-f]{2}){1,128}$",
});
export type ContentHash = Type.Static<typeof ContentHashSchema>;

export const ConfigurationIdempotencyKeySchema = Type.String({
  $id: "ConfigurationIdempotencyKey.v1",
  description: "Opaque bounded non-PII key for retry-safe configuration commands.",
  maxLength: 128,
  minLength: 8,
  pattern: "^[A-Za-z0-9](?:[A-Za-z0-9._:-]{6,126}[A-Za-z0-9])$",
});
export type ConfigurationIdempotencyKey = Type.Static<typeof ConfigurationIdempotencyKeySchema>;

export const PublishedConfigurationProvenanceSchema = Type.Object(
  {
    content_hash: embedSchemaAs<ContentHash>(ContentHashSchema),
    published_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    published_by_user_id: embedSchemaAs<UserId>(UserIdSchema),
    record_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "PublishedConfigurationProvenance.v1",
    additionalProperties: false,
    description: "Minimum immutable provenance for an authoritative published snapshot.",
  },
);
export type PublishedConfigurationProvenance = Type.Static<
  typeof PublishedConfigurationProvenanceSchema
>;

export const EffectiveIntervalSchema = Type.Object(
  {
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
  },
  {
    $id: "EffectiveInterval.v1",
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
    description: "Half-open effective interval; a null end remains open.",
  },
);
export type EffectiveInterval = Type.Static<typeof EffectiveIntervalSchema>;
