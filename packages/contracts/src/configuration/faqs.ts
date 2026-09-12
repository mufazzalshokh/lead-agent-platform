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
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import {
  ConfigurationKeySchema,
  ContentHashSchema,
  LocalizedTextSchema,
  type ConfigurationKey,
  type ContentHash,
  type LocalizedText,
} from "./primitives.js";
import { VersionedConfigurationStatusSchema } from "./prices.js";

const faqContentProperties = () => ({
  answer_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
  location_id: Type.Union([embedSchemaAs<LocationId>(LocationIdSchema), Type.Null()]),
  question_i18n: embedSchemaAs<LocalizedText>(LocalizedTextSchema),
  service_id: Type.Union([embedSchemaAs<ServiceId>(ServiceIdSchema), Type.Null()]),
});

export const FaqSchema = Type.Object(
  {
    ...faqContentProperties(),
    content_hash: embedSchemaAs<ContentHash>(ContentHashSchema),
    created_at: embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
    effective_from: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    effective_to: Type.Union([
      embedSchemaAs<JsonWire<UtcTimestamp>>(UtcTimestampSchema),
      Type.Null(),
    ]),
    faq_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
    faq_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
    published_by_user_id: Type.Union([embedSchemaAs<UserId>(UserIdSchema), Type.Null()]),
    status: embedSchema(VersionedConfigurationStatusSchema),
    version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
  },
  {
    $id: "Faq.v1",
    "x-less-than-properties": [["effective_from", "effective_to"]],
    additionalProperties: false,
    description: "Exact FAQ version; localized prompt-like content remains untrusted data.",
  },
);
export type Faq = Type.Static<typeof FaqSchema>;

export const CreateFaqDraftInputSchema = Type.Object(
  {
    ...faqContentProperties(),
    faq_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
  },
  {
    $id: "CreateFaqDraftInput.v1",
    additionalProperties: false,
    description: "Creates a scoped, non-authoritative FAQ draft.",
  },
);
export type CreateFaqDraftInput = Type.Static<typeof CreateFaqDraftInputSchema>;

export const UpdateFaqDraftInputSchema = Type.Object(faqContentProperties(), {
  $id: "UpdateFaqDraftInput.v1",
  additionalProperties: false,
  description: "Replaces the complete localized content and scope of an FAQ draft.",
});
export type UpdateFaqDraftInput = Type.Static<typeof UpdateFaqDraftInputSchema>;

export const PublishFaqInputSchema = Type.Object(
  {},
  {
    $id: "PublishFaqInput.v1",
    additionalProperties: false,
    description: "Explicit immediate FAQ publication command body.",
  },
);
export type PublishFaqInput = Type.Static<typeof PublishFaqInputSchema>;

export const RetireFaqInputSchema = Type.Object(
  {},
  {
    $id: "RetireFaqInput.v1",
    additionalProperties: false,
    description: "Explicit immediate idempotent FAQ retirement command body.",
  },
);
export type RetireFaqInput = Type.Static<typeof RetireFaqInputSchema>;
