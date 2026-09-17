import { AgentDecisionV1Schema, isSchemaValue, type AgentDecisionV1 } from "@lead-agent/contracts";
import type { AIPolicyContext, AIOutcome } from "./ports.js";

export const aiFallback = (
  reason: Extract<AIOutcome, { kind: "fallback_required" }>["reason"],
): AIOutcome => Object.freeze({ kind: "fallback_required", reason, applied: false });
export const validateAgentDecision = (value: unknown): value is AgentDecisionV1 =>
  isSchemaValue(AgentDecisionV1Schema, value);
export const evaluateAIDecision = (
  decision: AgentDecisionV1,
  context: AIPolicyContext,
): AIOutcome => {
  if (context.automationMode !== "ai" || context.conversationStatus !== "open")
    return aiFallback("stale_context");
  const references = context.facts.map((fact) => fact.reference);
  if (
    decision.factual_claims.some(
      (claim) =>
        !references.some(
          (reference) =>
            reference.claim_kind === claim.claim_kind &&
            reference.source_type === claim.source_type &&
            reference.source_id === claim.source_id &&
            reference.source_version === claim.source_version,
        ),
    )
  )
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
