import Type from "typebox";

import { AgentDecisionActionSchema } from "./actions.js";
import { AgentExtractedFactsSchema, AgentFactualClaimSchema } from "./facts.js";
import { embedSchema } from "./internal.js";
import {
  AgentDecisionLanguageSchema,
  AgentIntentSchema,
  AgentMessageModeSchema,
  AgentRiskFlagSchema,
} from "./vocabulary.js";

export const AgentDecisionMessageSchema = Type.Object(
  {
    draft_text: Type.Union([Type.String({ maxLength: 4_000 }), Type.Null()]),
    mode: embedSchema(AgentMessageModeSchema),
  },
  {
    $id: "AgentDecisionMessage.v1",
    additionalProperties: false,
    description:
      "Untrusted generated customer wording. It is plain text candidate data, not business authority or trusted HTML.",
  },
);
export type AgentDecisionMessage = Type.Static<typeof AgentDecisionMessageSchema>;

export const AgentDecisionSafetySchema = Type.Object(
  {
    risk_flags: Type.Array(embedSchema(AgentRiskFlagSchema), {
      maxItems: 10,
    }),
    safe_to_send: Type.Boolean({
      description:
        "Advisory model assessment only; deterministic application safety policy makes the send decision.",
    }),
  },
  {
    $id: "AgentDecisionSafety.v1",
    additionalProperties: false,
    description: "Closed advisory safety information for deterministic policy evaluation.",
  },
);
export type AgentDecisionSafety = Type.Static<typeof AgentDecisionSafetySchema>;

/**
 * Canonical AgentDecision V1 wire contract.
 *
 * This entire value is untrusted model output. A schema-valid decision does not
 * authenticate a tenant or actor, validate cited facts, authorize an action,
 * prove availability, establish a price, or permit any protected side effect.
 */
export const AgentDecisionV1Schema = Type.Object(
  {
    action: embedSchema(AgentDecisionActionSchema),
    confidence: Type.Number({ maximum: 1, minimum: 0 }),
    extracted_facts: embedSchema(AgentExtractedFactsSchema),
    factual_claims: Type.Array(embedSchema(AgentFactualClaimSchema), {
      maxItems: 12,
    }),
    intent: embedSchema(AgentIntentSchema),
    language: embedSchema(AgentDecisionLanguageSchema),
    message: embedSchema(AgentDecisionMessageSchema),
    safety: embedSchema(AgentDecisionSafetySchema),
    schema_version: Type.Literal("1"),
  },
  {
    $id: "AgentDecision.v1",
    additionalProperties: false,
    description:
      "Canonical untrusted AgentDecision V1 proposal. Deterministic policy and application validation remain mandatory.",
  },
);
export type AgentDecisionV1 = Type.Static<typeof AgentDecisionV1Schema>;
