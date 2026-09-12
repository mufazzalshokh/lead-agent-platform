import Type from "typebox";

import {
  LocationIdSchema,
  ServiceIdSchema,
  type LocationId,
  type ServiceId,
} from "../shared/identifiers.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import { ConfigurationRootStatusSchema } from "./locations.js";
import {
  ConfigurationCodeSchema,
  LocalizedTextSchema,
  PublishedConfigurationProvenanceSchema,
  type ConfigurationCode,
  type LocalizedText,
} from "./primitives.js";

export const ServicePublishedVersionSchema = Type.Object(
  {
    description_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    disclaimer_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    duration_guidance_minutes: Type.Union([
      Type.Integer({ maximum: 10_080, minimum: 1 }),
      Type.Null(),
    ]),
    name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    provenance: embedSchema(PublishedConfigurationProvenanceSchema),
    service_id: embedSchemaAs<ServiceId>(ServiceIdSchema),
  },
  {
    $id: "ServicePublishedVersion.v1",
    additionalProperties: false,
    description: "Immutable localized Service facts; it carries no availability claim.",
  },
);
export type ServicePublishedVersion = Type.Static<typeof ServicePublishedVersionSchema>;

export const ServiceRootSchema = Type.Object(
  {
    code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema),
    current_version: Type.Union([embedSchema(ServicePublishedVersionSchema), Type.Null()]),
    service_id: embedSchemaAs<ServiceId>(ServiceIdSchema),
    status: embedSchema(ConfigurationRootStatusSchema),
    version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "ServiceRoot.v1",
    additionalProperties: false,
    description: "Stable Service root with its exact current published snapshot when present.",
  },
);
export type ServiceRoot = Type.Static<typeof ServiceRootSchema>;

export const CreateServiceInputSchema = Type.Object(
  { code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema) },
  {
    $id: "CreateServiceInput.v1",
    additionalProperties: false,
    description: "Creates only an inactive stable Service root; it publishes no facts or price.",
  },
);
export type CreateServiceInput = Type.Static<typeof CreateServiceInputSchema>;

const servicePublicationProperties = () => ({
  description_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
  disclaimer_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
  duration_guidance_minutes: Type.Union([
    Type.Integer({ maximum: 10_080, minimum: 1 }),
    Type.Null(),
  ]),
  name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
});

export const PublishServiceInputSchema = Type.Object(servicePublicationProperties(), {
  $id: "PublishServiceInput.v1",
  additionalProperties: false,
  description: "Complete immediate Service publication candidate; no persisted draft or schedule.",
});
export type PublishServiceInput = Type.Static<typeof PublishServiceInputSchema>;

export const DeactivateServiceInputSchema = Type.Object(
  {},
  {
    $id: "DeactivateServiceInput.v1",
    additionalProperties: false,
    description: "Explicit immediate Service deactivation command body.",
  },
);
export type DeactivateServiceInput = Type.Static<typeof DeactivateServiceInputSchema>;

export const ServiceLocationStatusSchema = Type.Union(
  [Type.Literal("active"), Type.Literal("inactive")],
  { $id: "ServiceLocationStatus.v1" },
);
export type ServiceLocationStatus = Type.Static<typeof ServiceLocationStatusSchema>;

export const ServiceLocationRecordSchema = Type.Object(
  {
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    service_id: embedSchemaAs<ServiceId>(ServiceIdSchema),
    status: embedSchema(ServiceLocationStatusSchema),
  },
  {
    $id: "ServiceLocationRecord.v1",
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
    description: "Effective Service-to-Location offering record; not an appointment-slot claim.",
  },
);
export type ServiceLocationRecord = Type.Static<typeof ServiceLocationRecordSchema>;

export const ChangeServiceLocationInputSchema = Type.Object(
  {
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    status: embedSchema(ServiceLocationStatusSchema),
  },
  {
    $id: "ChangeServiceLocationInput.v1",
    additionalProperties: false,
    description:
      "Immediate Service/Location lifecycle change with no client-selected effective time.",
  },
);
export type ChangeServiceLocationInput = Type.Static<typeof ChangeServiceLocationInputSchema>;
