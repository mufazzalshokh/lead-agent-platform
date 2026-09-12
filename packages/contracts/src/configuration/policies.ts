import Type from "typebox";

import {
  ResourceIdSchema,
  UserIdSchema,
  type ResourceId,
  type UserId,
} from "../shared/identifiers.js";
import { UtcTimestampSchema, type UtcTimestamp } from "../shared/time.js";
import { ResourceVersionSchema, type ResourceVersion } from "../shared/version.js";
import { embedSchema, embedSchemaAs, type JsonWire } from "./internal.js";
import {
  ConfigurationKeySchema,
  ContentHashSchema,
  type ConfigurationKey,
  type ContentHash,
} from "./primitives.js";
import { VersionedConfigurationStatusSchema } from "./prices.js";

export const BusinessPolicyTypeSchema = Type.Union(
  [
    Type.Literal("qualification"),
    Type.Literal("booking"),
    Type.Literal("handoff"),
    Type.Literal("safety"),
    Type.Literal("consent"),
  ],
  { $id: "BusinessPolicyType.v1" },
);
export type BusinessPolicyType = Type.Static<typeof BusinessPolicyTypeSchema>;

export const QualificationEvidenceKeySchema = Type.Union(
  [
    Type.Literal("service_interest"),
    Type.Literal("service_location_fit"),
    Type.Literal("positive_next_step_intent"),
    Type.Literal("contactability"),
  ],
  { $id: "QualificationEvidenceKey.v1" },
);
export type QualificationEvidenceKey = Type.Static<typeof QualificationEvidenceKeySchema>;

export const QualificationOutcomeSchema = Type.Union(
  [
    Type.Literal("qualified"),
    Type.Literal("incomplete"),
    Type.Literal("disqualified"),
    Type.Literal("handoff"),
  ],
  { $id: "QualificationOutcome.v1" },
);
export type QualificationOutcome = Type.Static<typeof QualificationOutcomeSchema>;

export const QualificationDisqualificationReasonSchema = Type.Union(
  [
    Type.Literal("service_not_offered"),
    Type.Literal("location_not_served"),
    Type.Literal("not_interested"),
    Type.Literal("outside_business_scope"),
    Type.Literal("spam_or_abuse"),
  ],
  { $id: "QualificationDisqualificationReason.v1" },
);
export type QualificationDisqualificationReason = Type.Static<
  typeof QualificationDisqualificationReasonSchema
>;

export const QualificationPolicyV1RulesSchema = Type.Object(
  {
    disqualification_reasons: Type.Tuple(
      [
        Type.Literal("service_not_offered"),
        Type.Literal("location_not_served"),
        Type.Literal("not_interested"),
        Type.Literal("outside_business_scope"),
        Type.Literal("spam_or_abuse"),
      ],
      { maxItems: 5, minItems: 5 },
    ),
    require_budget: Type.Literal(false, { default: false }),
    require_contactability: Type.Literal(true, { default: true }),
    require_medical_eligibility: Type.Literal(false, { default: false }),
    require_positive_next_step_intent: Type.Literal(true, { default: true }),
    require_preferred_time: Type.Literal(false, { default: false }),
    require_service_interest: Type.Literal(true, { default: true }),
    require_supported_service_location: Type.Literal(true, { default: true }),
  },
  {
    $id: "QualificationPolicyV1Rules.v1",
    additionalProperties: false,
    description:
      "Exact deterministic launch qualification rules; no executable evaluator or medical judgment.",
  },
);
export type QualificationPolicyV1Rules = Type.Static<typeof QualificationPolicyV1RulesSchema>;

const qualificationPolicyContentProperties = () => ({
  policy_type: Type.Literal("qualification"),
  rules: embedSchema(QualificationPolicyV1RulesSchema),
  schema_version: Type.Literal(1),
});

const policyRepresentationProperties = () => ({
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
  policy_id: embedSchemaAs<ResourceId>(ResourceIdSchema),
  policy_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
  published_by_user_id: Type.Union([embedSchemaAs<UserId>(UserIdSchema), Type.Null()]),
  status: embedSchema(VersionedConfigurationStatusSchema),
  version_no: embedSchemaAs<ResourceVersion>(ResourceVersionSchema),
});

const UnspecifiedBusinessPolicyTypeSchema = Type.Union([
  Type.Literal("booking"),
  Type.Literal("handoff"),
  Type.Literal("safety"),
  Type.Literal("consent"),
]);

export const BusinessPolicySchema = Type.Union(
  [
    Type.Object(
      {
        ...policyRepresentationProperties(),
        ...qualificationPolicyContentProperties(),
      },
      {
        "x-less-than-properties": [["effective_from", "effective_to"]],
        additionalProperties: false,
      },
    ),
    Type.Object(
      {
        ...policyRepresentationProperties(),
        policy_type: UnspecifiedBusinessPolicyTypeSchema,
        schema_version: Type.Integer({ maximum: 1_000_000, minimum: 1 }),
      },
      {
        "x-less-than-properties": [["effective_from", "effective_to"]],
        additionalProperties: false,
      },
    ),
  ],
  {
    $id: "BusinessPolicy.v1",
    description:
      "Business Policy metadata plus exact rules only for the concretely frozen qualification schema.",
  },
);
export type BusinessPolicy = Type.Static<typeof BusinessPolicySchema>;

export const CreateBusinessPolicyDraftInputSchema = Type.Object(
  {
    ...qualificationPolicyContentProperties(),
    policy_key: embedSchemaAs<ConfigurationKey>(ConfigurationKeySchema),
  },
  {
    $id: "CreateBusinessPolicyDraftInput.v1",
    additionalProperties: false,
    description: "Creates a non-authoritative, schema-versioned qualification policy draft.",
  },
);
export type CreateBusinessPolicyDraftInput = Type.Static<
  typeof CreateBusinessPolicyDraftInputSchema
>;

export const UpdateBusinessPolicyDraftInputSchema = Type.Object(
  qualificationPolicyContentProperties(),
  {
    $id: "UpdateBusinessPolicyDraftInput.v1",
    additionalProperties: false,
    description: "Replaces the exact content of a qualification policy draft.",
  },
);
export type UpdateBusinessPolicyDraftInput = Type.Static<
  typeof UpdateBusinessPolicyDraftInputSchema
>;

export const PublishBusinessPolicyInputSchema = Type.Object(
  {},
  {
    $id: "PublishBusinessPolicyInput.v1",
    additionalProperties: false,
    description: "Explicit immediate Business Policy publication command body.",
  },
);
export type PublishBusinessPolicyInput = Type.Static<typeof PublishBusinessPolicyInputSchema>;

export const RetireBusinessPolicyInputSchema = Type.Object(
  {},
  {
    $id: "RetireBusinessPolicyInput.v1",
    additionalProperties: false,
    description: "Explicit immediate idempotent Business Policy retirement command body.",
  },
);
export type RetireBusinessPolicyInput = Type.Static<typeof RetireBusinessPolicyInputSchema>;
