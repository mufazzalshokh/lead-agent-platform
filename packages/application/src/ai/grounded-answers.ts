import type { AgentDecisionV1, AgentFactualClaim, Locale } from "@lead-agent/contracts";
import { createAIOrchestrator } from "./orchestrate.js";
import { aiFallback, evaluateAIDecision } from "./policy.js";
import { groundingLocale, groundingNeed, groundingPreflight } from "./grounding-query.js";
import type { AIContextSnapshot, AIFallbackReason, AIOutcome } from "./ports.js";

export const GROUNDED_ANSWER_PROMPT_VERSION = "s14-grounded-answers.v1";
export type GroundedAnswerResult =
  | Readonly<{
      kind: "grounded_answer";
      text: string;
      locale: Locale;
      sources: readonly AgentFactualClaim[];
      protectedActionApplied: false;
    }>
  | Readonly<{
      kind: "grounding_insufficient";
      reason: AIFallbackReason;
      protectedActionApplied: false;
    }>;

export const evaluateGroundedDecision = (
  decision: AgentDecisionV1,
  snapshot: AIContextSnapshot,
): AIOutcome => {
  const preflight = groundingPreflight(snapshot.message);
  if (preflight !== null) return aiFallback(preflight);
  if (
    decision.intent === "medical_question" ||
    decision.safety.risk_flags.includes("medical_content")
  )
    return aiFallback("medical_safety_response");
  if (["booking_request", "booking_confirmation", "booking_decline"].includes(decision.intent))
    return aiFallback("booking_availability_unapproved");
  if (
    decision.action.type !== "none" ||
    !["faq", "pricing", "service_inquiry", "other"].includes(decision.intent)
  )
    return aiFallback("policy_denied");
  if (
    snapshot.policy.facts.length === 0 &&
    decision.safety.risk_flags.every(
      (flag) => flag === "price_missing" || flag === "service_missing",
    )
  )
    return aiFallback("grounding_insufficient");
  const policy = evaluateAIDecision(decision, snapshot.policy);
  if (policy.kind !== "decision" || policy.disposition !== "candidate") return policy;
  const locale = groundingLocale(snapshot.message, snapshot.locale),
    need = groundingNeed(snapshot.message);
  if (decision.language !== locale) return aiFallback("grounding_insufficient");
  const facts = snapshot.policy.facts.filter(
    (entry) => entry.grounding?.locale === locale && entry.grounding.need === need,
  );
  if (
    facts.length === 0 ||
    facts.some((entry, index) =>
      facts.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          entry.grounding?.subject === other.grounding?.subject &&
          entry.text !== other.text,
      ),
    )
  )
    return aiFallback("grounding_insufficient");
  const text = facts.map((entry) => entry.text).join("\n");
  if (
    text.length === 0 ||
    new TextEncoder().encode(text).length > 1_000 ||
    snapshot.policy.facts.length > 12 ||
    (locale === "uz" && /[а-яёқғўҳ]/iu.test(text))
  )
    return aiFallback("grounding_insufficient");
  // Citation validation is not prose validation. NONE of the raw draft is sent.
  // Approved text/templates replace it, including uncited invented numbers/claims.
  return Object.freeze({
    kind: "decision",
    disposition: "candidate",
    applied: false,
    decision: Object.freeze({
      ...decision,
      factual_claims: snapshot.policy.facts.map((entry) => entry.reference),
      message: Object.freeze({ draft_text: text, mode: "send_candidate" }),
    }),
  });
};

export const groundingUncertaintyText = (locale: Locale): string =>
  ({
    uz: "Bu savol bo'yicha yetarli tasdiqlangan ma'lumot topilmadi.",
    ru: "По этому вопросу недостаточно подтверждённой информации.",
    en: "There is not enough approved information to answer this question.",
  })[locale];

export const createGroundedAnswerOrchestrator = (
  options: Parameters<typeof createAIOrchestrator>[0],
) => {
  const orchestrator = createAIOrchestrator({
    ...options,
    preflight: (snapshot) => groundingPreflight(snapshot.message),
    evaluateDecision: evaluateGroundedDecision,
  });
  return Object.freeze({
    run: async (...args: Parameters<typeof orchestrator.run>): Promise<GroundedAnswerResult> => {
      const outcome = await orchestrator.run(...args);
      if (
        outcome.kind === "fallback_required" ||
        outcome.disposition !== "candidate" ||
        outcome.decision.message.draft_text === null ||
        outcome.decision.language === "unknown"
      )
        return Object.freeze({
          kind: "grounding_insufficient",
          reason: outcome.kind === "fallback_required" ? outcome.reason : "grounding_insufficient",
          protectedActionApplied: false,
        });
      return Object.freeze({
        kind: "grounded_answer",
        text: outcome.decision.message.draft_text,
        locale: outcome.decision.language,
        sources: outcome.decision.factual_claims,
        protectedActionApplied: false,
      });
    },
  });
};
