import type { AgentDecisionV1, Locale } from "@lead-agent/contracts";
import { evaluateGroundedDecision, groundingUncertaintyText } from "./grounded-answers.js";
import {
  groundingLocale,
  groundingNeed,
  groundingPreflight,
  normalizeGroundingQuery,
} from "./grounding-query.js";
import { createAIOrchestrator } from "./orchestrate.js";
import { medicalSafetyText } from "./medical-safety.js";
import { aiFallback } from "./policy.js";
import type {
  AIContextSnapshot,
  AIFallbackReason,
  AIOutcome,
  SalesEvidence,
  SalesResult,
} from "./ports.js";

export const SALES_FLOW_PROMPT_VERSION = "s15-qualification-handoff.v1";
export const salesLocale = (message: string, preferred: Locale): Locale => {
  const query = normalizeGroundingQuery(message);
  if (
    /\b(ertaga|yozil\w*|yozdir\w*|xohlay\w*|istay\w*|odam bilan|xodim bilan|qimmat|ha|salom)\b/u.test(
      query,
    )
  )
    return "uz";
  if (/\b(chelovek\w*|sotrudnik\w*|[hx]ochu|dorogo|zapis\w*|privet)\b/u.test(query)) return "ru";
  if (
    /\b(want|would like|interested|proceed|lets|book\w*|appointment|human|staff|hello|hi|expensive)\b/u.test(
      query,
    )
  )
    return "en";
  return groundingLocale(message, preferred);
};
export const EMPTY_SALES_EVIDENCE: SalesEvidence = Object.freeze({
  serviceId: null,
  locationId: null,
  positiveNextStep: false,
  serviceMessageId: null,
  locationMessageId: null,
  nextStepMessageId: null,
});

const humanRequest = (text: string): boolean =>
  /\b(odam bilan|inson bilan|operator|xodim bilan|human|real person|staff|chelovek\w*|sotrudnik\w*)\b/u.test(
    normalizeGroundingQuery(text),
  ) && !/\b(not|dont|ne nuzhen|kerak emas)\b/u.test(normalizeGroundingQuery(text));
const positiveNextStep = (text: string): boolean => {
  const query = normalizeGroundingQuery(text);
  if (/\b(not|dont|cannot|ne [hx]ochu|net|yoq|xohlamay\w*|istamay\w*|emas)\b/u.test(query))
    return false;
  return (
    /\b(want|would like|lets|book\w*|appointment|proceed|follow up|interested|[hx]ochu|zapis\w*|da|yes|zavtra|yozil\w*|yozdir\w*|xohlay\w*|istay\w*|boraman|kelaman|ha|ertaga)\b/u.test(
      query,
    ) &&
    !/\b(how|what|price|cost|narx\w*|qancha|nech\w*|pul|skolko|stoit|ochiq\w*|ishlay\w*|hours|open|rabota\w*)\b/u.test(
      query,
    )
  );
};

/** Medical remains first, including combined medical + human requests. Booking is only a boundary, not authority. */
export const salesPreflight = (snapshot: AIContextSnapshot): AIFallbackReason | null => {
  const grounding = groundingPreflight(snapshot.message);
  if (grounding === "medical_safety_response") return grounding;
  if (snapshot.policy.conversationStatus !== "open" || snapshot.policy.automationMode !== "ai")
    return "stale_context";
  const query = normalizeGroundingQuery(snapshot.message);
  if (
    grounding === "policy_denied" ||
    /\b(ignore\w*|system prompt|api key|secret\w*|database|all tenants|every company|adminman|barcha tenant\w*|hamma kompaniya\w*|mark me qualified|pretend|create staff handoff|meni malakali deb|qoidalarni unut)\b/u.test(
      query,
    )
  )
    return "policy_denied";
  return humanRequest(snapshot.message) ? "staff_requested" : null;
};

const namesMatch = (text: string, names: readonly string[]): boolean => {
  const query = ` ${normalizeGroundingQuery(text).replace(/\blaser\b/gu, "lazer")} `;
  return names.some((name) => {
    const normalized = normalizeGroundingQuery(name).replace(/\blaser\b/gu, "lazer");
    if (normalized.length < 3) return false;
    if (query.includes(` ${normalized} `)) return true;
    // Finite case endings, not fuzzy matching or model-invented entity aliases.
    return ["ni", "ga", "dan", "ning", "da", "a", "u", "om"].some((suffix) =>
      query.includes(` ${normalized}${suffix} `),
    );
  });
};

/** Only customer messages and previously validated evidence can populate qualification facts. */
export const resolveSalesEvidence = (snapshot: AIContextSnapshot): SalesEvidence => {
  const context = snapshot.sales;
  if (context === undefined) return EMPTY_SALES_EVIDENCE;
  let evidence = { ...context.stored };
  const entries = [
    ...snapshot.history.filter(
      (entry) => entry.role === "customer" && entry.sequence < snapshot.sourceSequence,
    ),
    {
      role: "customer" as const,
      sequence: snapshot.sourceSequence,
      text: snapshot.message,
      messageId: snapshot.sourceMessageId,
    },
  ].sort((a, b) => a.sequence - b.sequence);
  for (const entry of entries) {
    if (
      entry.messageId === undefined ||
      salesPreflight({ ...snapshot, message: entry.text }) !== null
    )
      continue;
    const services = context.services.filter((service) => namesMatch(entry.text, service.names));
    const locations = context.locations.filter((location) =>
      namesMatch(entry.text, location.names),
    );
    // Ambiguous mentions never silently switch or merge interests.
    if (
      services.length === 1 &&
      (evidence.serviceId === null || evidence.serviceId === services[0]?.id)
    ) {
      evidence = {
        ...evidence,
        serviceId: services[0]?.id ?? null,
        serviceMessageId: entry.messageId,
      };
    }
    if (
      locations.length === 1 &&
      (evidence.locationId === null || evidence.locationId === locations[0]?.id)
    ) {
      evidence = {
        ...evidence,
        locationId: locations[0]?.id ?? null,
        locationMessageId: entry.messageId,
      };
    }
    if (positiveNextStep(entry.text))
      evidence = { ...evidence, positiveNextStep: true, nextStepMessageId: entry.messageId };
  }
  return Object.freeze(evidence);
};

export const salesMissing = (
  snapshot: AIContextSnapshot,
  evidence = resolveSalesEvidence(snapshot),
): readonly string[] => {
  const context = snapshot.sales;
  if (context === undefined || context.policy === null) return ["published_policy"];
  const service = context.services.find((entry) => entry.id === evidence.serviceId);
  const missing: string[] = [];
  if (service === undefined) missing.push("service");
  else if (
    !service.locationIds.some(
      (id) =>
        context.locations.some((location) => location.id === id) &&
        (evidence.locationId === null || evidence.locationId === id),
    )
  )
    missing.push("location");
  if (!evidence.positiveNextStep) missing.push("next_step");
  if (!context.contactable) missing.push("contactability");
  return Object.freeze(missing);
};

const question = (locale: Locale, missing: string): string =>
  ({
    service: {
      uz: "Qaysi xizmat sizni qiziqtiryapti?",
      ru: "Какая услуга вас интересует?",
      en: "Which service are you interested in?",
    },
    location: {
      uz: "Qaysi filial sizga qulay?",
      ru: "Какой филиал вам удобнее?",
      en: "Which location works for you?",
    },
    next_step: {
      uz: "Shu xizmatga yozilishni rejalashtiryapsizmi?",
      ru: "Хотите записаться на эту услугу?",
      en: "Would you like to request this service?",
    },
    contactability: {
      uz: "Siz bilan bog'lanish uchun telefon raqamingizni yozasizmi?",
      ru: "Оставите номер телефона для связи?",
      en: "Could you share a phone number we can reach you on?",
    },
  })[missing]?.[locale] ?? "";
const boundary = (locale: Locale): string =>
  ({
    uz: "Xizmat bo'yicha ma'lumotlar yetarli. Hali sana yoki vaqt band qilinmadi.",
    ru: "Информации об услуге достаточно. Дата и время пока не забронированы.",
    en: "We have the information needed for this service. No date or time has been reserved.",
  })[locale];
const handoffText = (locale: Locale, explicit: boolean): string =>
  explicit
    ? {
        uz: "Albatta, xodim bilan suhbat uchun so'rovingiz yuborildi.",
        ru: "Конечно, ваш запрос на разговор с сотрудником передан.",
        en: "Of course, your request to speak with a staff member has been sent.",
      }[locale]
    : {
        uz: "Bu savolni aniqlashtirish uchun xodimga so'rov yuborildi.",
        ru: "Запрос передан сотруднику, чтобы уточнить этот вопрос.",
        en: "A request has been sent to a staff member to clarify this question.",
      }[locale];
const businessRedirectText = (locale: Locale): string =>
  ({
    uz: "Men faqat shu biznesning xizmatlari va uchrashuv so'rovlari bo'yicha yordam bera olaman. Sizni qaysi xizmat qiziqtiryapti?",
    ru: "Я могу помочь только с услугами этой компании и заявками на запись. Какая услуга вас интересует?",
    en: "I can only help with this business's services and appointment requests. Which service are you interested in?",
  })[locale];

export type SalesPlan = Readonly<{
  evidence: SalesEvidence;
  result: SalesResult;
  text: string | null;
  sources: AIContextSnapshot["policy"]["facts"][number]["reference"][];
  handoffReason:
    | "customer_requested"
    | "missing_authoritative_information"
    | "ai_unavailable"
    | "policy_blocked"
    | null;
}>;

export const evaluateSalesDecision = (
  decision: AgentDecisionV1,
  snapshot: AIContextSnapshot,
): AIOutcome => {
  const preflight = salesPreflight(snapshot);
  if (preflight !== null) return aiFallback(preflight);
  if (
    decision.intent === "medical_question" ||
    decision.safety.risk_flags.includes("medical_content")
  )
    return aiFallback("medical_safety_response");
  const evidence = resolveSalesEvidence(snapshot);
  // A model cannot manufacture customer facts, tenant identity, or escalation authority.
  if (
    (decision.extracted_facts.service_id !== null &&
      decision.extracted_facts.service_id !== evidence.serviceId &&
      !snapshot.sales?.services.some(
        (service) =>
          service.id === decision.extracted_facts.service_id &&
          namesMatch(snapshot.message, service.names),
      )) ||
    (decision.extracted_facts.location_id !== null &&
      decision.extracted_facts.location_id !== evidence.locationId &&
      !snapshot.sales?.locations.some(
        (location) =>
          location.id === decision.extracted_facts.location_id &&
          namesMatch(snapshot.message, location.names),
      )) ||
    [
      decision.extracted_facts.display_name,
      decision.extracted_facts.phone_raw,
      decision.extracted_facts.email_raw,
    ].some((value) => value !== null && !snapshot.message.includes(value)) ||
    decision.safety.risk_flags.some(
      (flag) => !["price_missing", "service_missing", "location_missing"].includes(flag),
    ) ||
    !decision.safety.safe_to_send ||
    decision.message.mode !== "send_candidate" ||
    decision.factual_claims.some(
      (claim) =>
        !snapshot.policy.facts.some(
          (fact) => JSON.stringify(fact.reference) === JSON.stringify(claim),
        ),
    )
  )
    return aiFallback("policy_denied");
  if (decision.action.type === "request_handoff") return aiFallback("policy_denied");
  if (["confirm_appointment", "decline_appointment"].includes(decision.action.type))
    return aiFallback("policy_denied");
  // No model wording or action is executed. S16 requests remain a typed application boundary.
  return Object.freeze({ kind: "decision", disposition: "candidate", applied: false, decision });
};

const asksBusinessQuestion = (message: string): boolean => {
  const query = normalizeGroundingQuery(message);
  return /\b(narx\w*|pul|qancha|nech\w*|price|cost|tsena|stoit|skolko|ochiq\w*|ishlay\w*|hours|open|rabota\w*|qayer\w*|where|adres\w*|manzil\w*|duration|davom|minut\w*|discount|chegirma|skidka|garanti\w*|guarantee|kafolat)\b/u.test(
    query,
  );
};

/** Deterministic terminal plan; database commit revalidates this under tenant locks. */
export const planSalesFlow = (snapshot: AIContextSnapshot, outcome: AIOutcome): SalesPlan => {
  const evidence = resolveSalesEvidence(snapshot),
    missing = salesMissing(snapshot, evidence);
  const locale = salesLocale(snapshot.message, snapshot.locale);
  const none = (reason: string): SalesPlan => ({
    evidence,
    result: { kind: "grounding_insufficient", reason, missing },
    text: null,
    sources: [],
    handoffReason: null,
  });
  const preflight = salesPreflight(snapshot);
  if (preflight === "medical_safety_response")
    return {
      evidence,
      result: { kind: "grounding_insufficient", reason: preflight, missing },
      text: medicalSafetyText(locale),
      sources: [],
      handoffReason: null,
    };
  if (preflight === "outside_business_scope")
    return {
      evidence,
      result: { kind: "grounding_insufficient", reason: preflight, missing },
      text: businessRedirectText(locale),
      sources: [],
      handoffReason: null,
    };
  if (outcome.kind === "fallback_required" && outcome.reason === "medical_safety_response")
    return {
      evidence,
      result: { kind: "grounding_insufficient", reason: outcome.reason, missing },
      text: medicalSafetyText(locale),
      sources: [],
      handoffReason: null,
    };
  if (preflight !== null && preflight !== "staff_requested") return none(preflight);
  if (
    outcome.kind === "fallback_required" &&
    ![
      "staff_requested",
      "provider_unavailable",
      "timeout",
      "refusal",
      "invalid_output",
      "grounding_insufficient",
    ].includes(outcome.reason)
  )
    return none(outcome.reason);
  if (outcome.kind === "decision" && outcome.disposition !== "candidate")
    return none("policy_denied");
  const explicit = preflight === "staff_requested";
  const unavailable =
    outcome.kind === "fallback_required" &&
    ["provider_unavailable", "timeout", "refusal", "invalid_output"].includes(outcome.reason);
  let text = "",
    sources: SalesPlan["sources"] = [];
  let insufficient = false;
  const changedInterest =
    (evidence.serviceId !== null &&
      snapshot.sales?.services.some(
        (service) =>
          service.id !== evidence.serviceId && namesMatch(snapshot.message, service.names),
      )) ||
    (evidence.locationId !== null &&
      snapshot.sales?.locations.some(
        (location) =>
          location.id !== evidence.locationId && namesMatch(snapshot.message, location.names),
      ));
  if (!changedInterest && asksBusinessQuestion(snapshot.message)) {
    const need = groundingNeed(snapshot.message);
    const grounded =
      outcome.kind === "decision"
        ? evaluateGroundedDecision(
            {
              ...outcome.decision,
              intent: "faq",
              action: { type: "none" },
              extracted_facts: {
                ...outcome.decision.extracted_facts,
                service_id: null,
                location_id: null,
              },
              safety: { ...outcome.decision.safety, risk_flags: [] },
            },
            snapshot,
          )
        : null;
    if (grounded?.kind === "decision") {
      text = grounded.decision.message.draft_text ?? "";
      sources = grounded.decision.factual_claims;
    } else if (need === "price" && missing.includes("service"))
      text = groundingUncertaintyText(locale);
    else insufficient = true;
  }
  const handoffReason = explicit
    ? "customer_requested"
    : unavailable
      ? "ai_unavailable"
      : changedInterest ||
          missing.includes("contactability") ||
          (missing.includes("location") &&
            (evidence.locationId !== null ||
              snapshot.sales?.services.find((service) => service.id === evidence.serviceId)
                ?.locationIds.length === 0))
        ? "policy_blocked"
        : insufficient || missing.includes("published_policy")
          ? "missing_authoritative_information"
          : null;
  if (handoffReason !== null) {
    const combined = [text, handoffText(locale, explicit)].filter(Boolean).join("\n");
    const fits = new TextEncoder().encode(combined).length <= 1_000;
    return {
      evidence,
      result: { kind: "handoff_requested", reason: handoffReason, missing },
      text: fits ? combined : handoffText(locale, explicit),
      sources: fits ? sources : [],
      handoffReason,
    };
  }
  const first = missing[0];
  if (
    !text &&
    /^(salom|assalomu alaykum|hello|hi|privet)$/u.test(normalizeGroundingQuery(snapshot.message))
  )
    text = { uz: "Salom!", ru: "Здравствуйте!", en: "Hello!" }[locale];
  const followup = first === undefined ? boundary(locale) : question(locale, first);
  // Objections are acknowledged without inventing discounts, promises, or pressure.
  if (!text && /\b(expensive|dorogo|qimmat)\b/u.test(normalizeGroundingQuery(snapshot.message)))
    text = {
      uz: "Tushunarli. Narx bo'yicha qo'shimcha chegirma va'da qila olmaymiz.",
      ru: "Понимаю. Обещать дополнительную скидку мы не можем.",
      en: "Understood. We cannot promise an additional discount.",
    }[locale];
  const reply = [text, followup].filter(Boolean).join("\n");
  if (!reply || (locale === "uz" && /[а-яёқғўҳ]/iu.test(reply)))
    return none("grounding_insufficient");
  if (new TextEncoder().encode(reply).length > 1_000)
    return {
      evidence,
      result: { kind: "handoff_requested", reason: "policy_blocked", missing },
      text: handoffText(locale, false),
      sources: [],
      handoffReason: "policy_blocked",
    };
  return {
    evidence,
    result: {
      kind: first === undefined ? "appointment_boundary" : "qualification_incomplete",
      reason: null,
      missing,
    },
    text: reply,
    sources,
    handoffReason: null,
  };
};

export const createSalesFlowOrchestrator = (
  options: Parameters<typeof createAIOrchestrator>[0],
) => {
  const orchestrator = createAIOrchestrator({
    ...options,
    preflight: salesPreflight,
    evaluateDecision: evaluateSalesDecision,
  });
  return Object.freeze({
    run: async (...args: Parameters<typeof orchestrator.run>): Promise<SalesResult> => {
      const outcome = await orchestrator.run(...args);
      return (
        outcome.salesResult ?? {
          kind: "grounding_insufficient",
          reason: outcome.kind === "fallback_required" ? outcome.reason : "policy_denied",
          missing: [],
        }
      );
    },
  });
};
