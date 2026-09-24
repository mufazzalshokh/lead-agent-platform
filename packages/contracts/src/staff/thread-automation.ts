import Type from "typebox";

import { withoutSchemaId } from "../api/embedding.js";
import { createSuccessEnvelopeSchema } from "../api/envelopes.js";
import {
  ChannelConnectionIdSchema,
  MembershipIdSchema,
  ResourceIdSchema,
} from "../shared/identifiers.js";
import { UtcTimestampSchema } from "../shared/time.js";
import { ResourceVersionSchema } from "../shared/version.js";

const embed = <S extends Type.TSchema>(schema: S) => withoutSchemaId<Type.Static<S>>(schema);

export const ThreadAutomationEligibilityStateSchema = Type.Union(
  [
    Type.Literal("business_eligible"),
    Type.Literal("excluded_personal"),
    Type.Literal("uncertain"),
    Type.Literal("staff_only"),
  ],
  { $id: "ThreadAutomationEligibilityState.v1" },
);
export type ThreadAutomationEligibilityState = Type.Static<
  typeof ThreadAutomationEligibilityStateSchema
>;

export const ThreadAutomationDecisionSourceSchema = Type.Union(
  [
    Type.Literal("system_default"),
    Type.Literal("staff"),
    Type.Literal("owner_configuration"),
    Type.Literal("provider_rule"),
    Type.Literal("platform_policy"),
  ],
  { $id: "ThreadAutomationDecisionSource.v1" },
);
export type ThreadAutomationDecisionSource = Type.Static<
  typeof ThreadAutomationDecisionSourceSchema
>;

export const ThreadAutomationControlSchema = Type.Object(
  {
    id: embed(ResourceIdSchema),
    channel_connection_id: embed(ChannelConnectionIdSchema),
    eligibility_state: embed(ThreadAutomationEligibilityStateSchema),
    decision_source: embed(ThreadAutomationDecisionSourceSchema),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
    }),
    decided_by_membership_id: Type.Union([embed(MembershipIdSchema), Type.Null()]),
    version: embed(ResourceVersionSchema),
    created_at: embed(UtcTimestampSchema),
    updated_at: embed(UtcTimestampSchema),
  },
  { $id: "ThreadAutomationControl.v1", additionalProperties: false },
);
export type ThreadAutomationControl = Type.Static<typeof ThreadAutomationControlSchema>;

export const ThreadAutomationControlParamsSchema = Type.Object(
  { id: embed(ResourceIdSchema) },
  { $id: "ThreadAutomationControlParams.v1", additionalProperties: false },
);

export const ThreadAutomationTransitionInputSchema = Type.Object(
  {
    eligibility_state: embed(ThreadAutomationEligibilityStateSchema),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
    }),
  },
  { $id: "ThreadAutomationTransitionInput.v1", additionalProperties: false },
);
export type ThreadAutomationTransitionInput = Type.Static<
  typeof ThreadAutomationTransitionInputSchema
>;

export const ThreadAutomationControlResponseSchema = createSuccessEnvelopeSchema(
  ThreadAutomationControlSchema,
  "ThreadAutomationControlResponse.v1",
);
