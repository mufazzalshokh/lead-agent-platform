import Type from "typebox";

import {
  LocationIdSchema,
  ServiceIdSchema,
  type LocationId,
  type ServiceId,
} from "../shared/identifiers.js";
import { embedSchema, embedSchemaAs } from "./internal.js";
import { ConfigurationRootStatusSchema } from "./locations.js";
import { BusinessPolicyTypeSchema } from "./policies.js";
import { ServicePriceTypeSchema, VersionedConfigurationStatusSchema } from "./prices.js";

export const LocationListFilterSchema = Type.Object(
  { status: Type.Optional(embedSchema(ConfigurationRootStatusSchema)) },
  {
    $id: "LocationListFilter.v1",
    additionalProperties: false,
    description: "Finite Location list filters; pagination uses the shared opaque cursor.",
  },
);
export type LocationListFilter = Type.Static<typeof LocationListFilterSchema>;

export const ServiceListFilterSchema = Type.Object(
  {
    location_id: Type.Optional(embedSchemaAs<LocationId>(LocationIdSchema)),
    status: Type.Optional(embedSchema(ConfigurationRootStatusSchema)),
  },
  {
    $id: "ServiceListFilter.v1",
    additionalProperties: false,
    description: "Finite Service list filters with optional authorized Location projection.",
  },
);
export type ServiceListFilter = Type.Static<typeof ServiceListFilterSchema>;

export const ServicePriceListFilterSchema = Type.Object(
  {
    location_id: Type.Optional(embedSchemaAs<LocationId>(LocationIdSchema)),
    price_type: Type.Optional(embedSchema(ServicePriceTypeSchema)),
    status: Type.Optional(embedSchema(VersionedConfigurationStatusSchema)),
  },
  {
    $id: "ServicePriceListFilter.v1",
    additionalProperties: false,
    description: "Finite Service price lifecycle, type, and Location filters.",
  },
);
export type ServicePriceListFilter = Type.Static<typeof ServicePriceListFilterSchema>;

export const FaqListFilterSchema = Type.Object(
  {
    location_id: Type.Optional(embedSchemaAs<LocationId>(LocationIdSchema)),
    service_id: Type.Optional(embedSchemaAs<ServiceId>(ServiceIdSchema)),
    status: Type.Optional(embedSchema(VersionedConfigurationStatusSchema)),
  },
  {
    $id: "FaqListFilter.v1",
    additionalProperties: false,
    description: "Finite FAQ lifecycle and applicability filters.",
  },
);
export type FaqListFilter = Type.Static<typeof FaqListFilterSchema>;

export const BusinessPolicyListFilterSchema = Type.Object(
  {
    policy_type: Type.Optional(embedSchema(BusinessPolicyTypeSchema)),
    status: Type.Optional(embedSchema(VersionedConfigurationStatusSchema)),
  },
  {
    $id: "BusinessPolicyListFilter.v1",
    additionalProperties: false,
    description: "Finite Business Policy type and lifecycle filters.",
  },
);
export type BusinessPolicyListFilter = Type.Static<typeof BusinessPolicyListFilterSchema>;
