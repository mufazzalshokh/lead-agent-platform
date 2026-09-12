import Type from "typebox";

import {
  LocationIdSchema,
  ResourceIdSchema,
  ServiceIdSchema,
  UserIdSchema,
  type LocationId,
  type ResourceId,
  type ServiceId,
  type UserId,
} from "../shared/identifiers.js";
import { MoneySchema, type Money } from "../shared/money.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import { LocalizedTextSchema, type LocalizedText } from "./primitives.js";

export const ServicePriceTypeSchema = Type.Union(
  [
    Type.Literal("fixed"),
    Type.Literal("from"),
    Type.Literal("range"),
    Type.Literal("quote_required"),
  ],
  { $id: "ServicePriceType.v1" },
);
export type ServicePriceType = Type.Static<typeof ServicePriceTypeSchema>;

export const VersionedConfigurationStatusSchema = Type.Union(
  [Type.Literal("draft"), Type.Literal("published"), Type.Literal("retired")],
  { $id: "VersionedConfigurationStatus.v1" },
);
export type VersionedConfigurationStatus = Type.Static<typeof VersionedConfigurationStatusSchema>;

const nonNegativeMoney = () =>
  Type.Unsafe<JsonWire<Money>>({
    ...embedSchemaAs<JsonWire<Money>>(MoneySchema),
    "x-non-negative-money": true,
  });

const priceTerms = () =>
  Type.Union([
    Type.Object(
      { amount: nonNegativeMoney(), price_type: Type.Literal("fixed") },
      { additionalProperties: false },
    ),
    Type.Object(
      { minimum: nonNegativeMoney(), price_type: Type.Literal("from") },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        maximum: nonNegativeMoney(),
        minimum: nonNegativeMoney(),
        price_type: Type.Literal("range"),
      },
      { "x-money-range": true, additionalProperties: false },
    ),
    Type.Object(
      {
        currency: Type.String({ maxLength: 3, minLength: 3, pattern: "^[A-Z]{3}$" }),
        price_type: Type.Literal("quote_required"),
      },
      { additionalProperties: false },
    ),
  ]);

export const ServicePriceTermsSchema = Type.Unsafe<Type.Static<ReturnType<typeof priceTerms>>>({
  ...priceTerms(),
  $id: "ServicePriceTerms.v1",
});
export type ServicePriceTerms = Type.Static<typeof ServicePriceTermsSchema>;

const priceCandidateProperties = () => ({
  display_text_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
  location_id: Type.Union([embedSchemaAs<LocationId>(LocationIdSchema), Type.Null()]),
  pricing: embedSchema(ServicePriceTermsSchema),
});

export const ServicePriceRecordSchema = Type.Object(
  {
    ...priceCandidateProperties(),
    created_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_from: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    price_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    published_by_user_id: Type.Union([embedSchemaAs<UserId>(UserIdSchema), Type.Null()]),
    service_id: embedSchemaAs<ServiceId>(ServiceIdSchema),
    status: embedSchema(VersionedConfigurationStatusSchema),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "ServicePriceRecord.v1",
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
    description: "Exact Service price version with explicit draft/published/retired lifecycle.",
  },
);
export type ServicePriceRecord = Type.Static<typeof ServicePriceRecordSchema>;

export const CreateServicePriceDraftInputSchema = Type.Object(priceCandidateProperties(), {
  $id: "CreateServicePriceDraftInput.v1",
  additionalProperties: false,
  description: "Creates a non-authoritative Service price draft.",
});
export type CreateServicePriceDraftInput = Type.Static<typeof CreateServicePriceDraftInputSchema>;

export const UpdateServicePriceDraftInputSchema = Type.Object(priceCandidateProperties(), {
  $id: "UpdateServicePriceDraftInput.v1",
  additionalProperties: false,
  description: "Replaces the complete content of an existing non-authoritative price draft.",
});
export type UpdateServicePriceDraftInput = Type.Static<typeof UpdateServicePriceDraftInputSchema>;

export const PublishServicePriceInputSchema = Type.Object(
  {},
  {
    $id: "PublishServicePriceInput.v1",
    additionalProperties: false,
    description: "Explicit immediate price publication command body.",
  },
);
export type PublishServicePriceInput = Type.Static<typeof PublishServicePriceInputSchema>;

export const RetireServicePriceInputSchema = Type.Object(
  {},
  {
    $id: "RetireServicePriceInput.v1",
    additionalProperties: false,
    description: "Explicit immediate idempotent price retirement command body.",
  },
);
export type RetireServicePriceInput = Type.Static<typeof RetireServicePriceInputSchema>;
