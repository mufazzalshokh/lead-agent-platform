import {
  AgentDecisionV1Schema,
  isSchemaValue,
  type AgentDecisionV1,
  type AgentFactualClaim,
} from "@lead-agent/contracts";
import type {
  AIFact,
  AIPolicyContext,
  AIOutcome,
  AIModelPolicyRejection,
  AIExtractionRejectionField,
} from "./ports.js";

export const aiFallback = (
  reason: Extract<AIOutcome, { kind: "fallback_required" }>["reason"],
  modelRejection?: AIModelPolicyRejection,
  extractionRejectionFields?: readonly AIExtractionRejectionField[],
): AIOutcome =>
  Object.freeze({
    kind: "fallback_required",
    reason,
    applied: false,
    ...(modelRejection === undefined ? {} : { modelRejection }),
    ...(modelRejection === "untrusted_extraction" && extractionRejectionFields !== undefined
      ? { extractionRejectionFields: Object.freeze([...extractionRejectionFields]) }
      : {}),
  });
export const validateAgentDecision = (value: unknown): value is AgentDecisionV1 =>
  isSchemaValue(AgentDecisionV1Schema, value);
/** Validated JSON references are identities, not serialization/property order. */
export const countUnmatchedCitations = (
  claims: readonly AgentFactualClaim[],
  facts: readonly AIFact[],
): number =>
  claims.filter(
    (claim) =>
      !facts.some(
        ({ reference }) =>
          reference.claim_kind === claim.claim_kind &&
          reference.source_type === claim.source_type &&
          reference.source_id === claim.source_id &&
          reference.source_version === claim.source_version,
      ),
  ).length;
export const evaluateAIDecision = (
  decision: AgentDecisionV1,
  context: AIPolicyContext,
): AIOutcome => {
  if (context.automationMode !== "ai" || context.conversationStatus !== "open")
    return aiFallback("stale_context");
  const references = context.facts.map((fact) => fact.reference);
  if (countUnmatchedCitations(decision.factual_claims, context.facts) > 0)
    return aiFallback("stale_context");
  const extracted = decision.extracted_facts;
  if (
    (extracted.service_id !== null &&
      !references.some(
        (ref) => ref.source_type === "service" && String(ref.source_id) === extracted.service_id,
      )) ||
    (extracted.location_id !== null &&
      !references.some(
        (ref) => ref.source_type === "location" && String(ref.source_id) === extracted.location_id,
      ))
  )
    return aiFallback("policy_denied");
  if (new Set(decision.safety.risk_flags).size !== decision.safety.risk_flags.length)
    return aiFallback("policy_denied");
  const action = decision.action;
  if (
    action.type === "request_information" &&
    (!context.missingFields.includes(action.field) ||
      (action.field === "phone" && context.contactableWithoutPhone))
  )
    return aiFallback("policy_denied");
  if (action.type === "confirm_appointment" || action.type === "decline_appointment") {
    const target = context.appointments.find(
      (appointment) => appointment.id === action.appointment_request_id,
    );
    if (
      target === undefined ||
      !target.boundToConversation ||
      !target.customerConfirmationBound ||
      target.state !== "awaiting_customer_confirmation" ||
      target.version < 1 ||
      target.offerVersion < 1
    )
      return aiFallback("policy_denied");
  }
  if (
    decision.safety.risk_flags.length > 0 ||
    !decision.safety.safe_to_send ||
    decision.message.mode === "use_safe_template"
  )
    return aiFallback("policy_denied");
  // This is a proposal, never an execution or authorization to send prose.
  return Object.freeze({
    kind: "decision",
    decision,
    disposition: decision.message.mode === "suppress" ? "suppress" : "candidate",
    applied: false,
  });
};
