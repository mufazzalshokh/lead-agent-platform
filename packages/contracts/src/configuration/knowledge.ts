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
import { LocaleSchema, type Locale } from "../shared/localization.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import { BusinessHoursIntervalSchema, LocationPublicContactSchema } from "./locations.js";
import { QualificationPolicyV1RulesSchema } from "./policies.js";
import { ServicePriceTermsSchema } from "./prices.js";
import {
  ConfigurationCodeSchema,
  ConfigurationKeySchema,
  ContentHashSchema,
  IanaTimeZoneSchema,
  LocalDateSchema,
  LocalTimeSchema,
  LocalizedTextSchema,
  PublishedConfigurationProvenanceSchema,
  type ConfigurationCode,
  type ConfigurationKey,
  type ContentHash,
  type IanaTimeZone,
  type LocalDate,
  type LocalTime,
  type LocalizedText,
} from "./primitives.js";

export const PublishedBusinessKnowledgeRequestSchema = Type.Object(
  {
    effective_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    locale: embedSchemaAs<Locale>(LocaleSchema),
    location_ids: Type.Optional(
      Type.Array(embedSchemaAs<LocationId>(LocationIdSchema), {
        maxItems: 100,
        minItems: 1,
        uniqueItems: true,
      }),
    ),
  },
  {
    $id: "PublishedBusinessKnowledgeRequest.v1",
    additionalProperties: false,
    description:
      "One effective instant and optional authorized Location projection for a trusted read.",
  },
);
export type PublishedBusinessKnowledgeRequest = Type.Static<
  typeof PublishedBusinessKnowledgeRequestSchema
>;

const activeClosure = Type.Union([
  Type.Object(
    {
      closure_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
      kind: Type.Literal("closed"),
      local_date: embedSchemaAs<LocalDate>(LocalDateSchema),
      reason_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      closes_at_local: embedSchemaAs<LocalTime>(LocalTimeSchema),
      closure_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
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

const trustedLocation = Type.Object(
  {
    address_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    business_hours: Type.Array(embedSchema(BusinessHoursIntervalSchema), { maxItems: 224 }),
    closures: Type.Array(activeClosure, { maxItems: 366 }),
    code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
    name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    provenance: embedSchema(PublishedConfigurationProvenanceSchema),
    public_contact: embedSchema(LocationPublicContactSchema),
    root_version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
    time_zone: embedSchemaAs<IanaTimeZone>(IanaTimeZoneSchema),
  },
  { additionalProperties: false },
);

const activeServiceLocation = Type.Object(
  {
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    location_id: embedSchemaAs<LocationId>(LocationIdSchema),
  },
  {
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
  },
);

const publishedPrice = Type.Object(
  {
    display_text_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    location_id: Type.Union([embedSchemaAs<LocationId>(LocationIdSchema), Type.Null()]),
    price_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    pricing: embedSchema(ServicePriceTermsSchema),
    published_by_user_id: embedSchemaAs<UserId>(UserIdSchema),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
  },
);

const trustedService = Type.Object(
  {
    code: embedSchemaAs<ConfigurationCode>(ConfigurationCodeSchema),
    description_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    disclaimer_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    duration_guidance_minutes: Type.Union([
      Type.Integer({ maximum: 10_080, minimum: 1 }),
      Type.Null(),
    ]),
    location_offerings: Type.Array(activeServiceLocation, { maxItems: 100 }),
    name_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    prices: Type.Array(publishedPrice, { maxItems: 300 }),
    provenance: embedSchema(PublishedConfigurationProvenanceSchema),
    root_version: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
    service_id: embedSchemaAs<ServiceId>(ServiceIdSchema),
  },
  { additionalProperties: false },
);

const publishedFaq = Type.Object(
  {
    answer_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    content_hash: embedSchemaAs<ContentHash>(ContentHashSchema),
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    faq_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    faq_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
    location_id: Type.Union([embedSchemaAs<LocationId>(LocationIdSchema), Type.Null()]),
    published_by_user_id: embedSchemaAs<UserId>(UserIdSchema),
    question_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
    service_id: Type.Union([embedSchemaAs<ServiceId>(ServiceIdSchema), Type.Null()]),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
  },
);

const publishedQualificationPolicy = Type.Object(
  {
    content_hash: embedSchemaAs<ContentHash>(ContentHashSchema),
    effective_from: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    policy_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    policy_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
    policy_type: Type.Literal("qualification"),
    published_by_user_id: embedSchemaAs<UserId>(UserIdSchema),
    rules: embedSchema(QualificationPolicyV1RulesSchema),
    schema_version: Type.Literal(1),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
  },
);

export const PublishedBusinessKnowledgeSchema = Type.Object(
  {
    effective_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    faqs: Type.Array(publishedFaq, { maxItems: 500 }),
    locale: embedSchemaAs<Locale>(LocaleSchema),
    locations: Type.Array(trustedLocation, { maxItems: 100 }),
    policies: Type.Array(publishedQualificationPolicy, { maxItems: 50 }),
    services: Type.Array(trustedService, { maxItems: 500 }),
  },
  {
    $id: "PublishedBusinessKnowledge.v1",
    additionalProperties: false,
    description:
      "Location-scoped authoritative business knowledge at one instant; drafts and availability claims are impossible.",
  },
);
export type PublishedBusinessKnowledge = Type.Static<typeof PublishedBusinessKnowledgeSchema>;
