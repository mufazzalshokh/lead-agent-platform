import {
  AgentFactualClaimSchema,
  PublishedBusinessKnowledgeV2Schema,
  isSchemaValue,
  type AgentFactualClaim,
  type Locale,
  type LocalizedText,
  type Money,
  type PublishedBusinessKnowledgeV2,
  type ServiceId,
  type LocationId,
} from "@lead-agent/contracts";
import type { AIFact, GroundingNeed } from "./ports.js";
import { AI_CONTEXT_LIMITS } from "./context.js";
import {
  groundingLocale,
  groundingNeed,
  groundingPreflight,
  lexicalScore,
  normalizeGroundingQuery,
} from "./grounding-query.js";

const localized = (value: LocalizedText, locale: Locale): string | null => value[locale] ?? null;
const reference = (
  kind: AgentFactualClaim["claim_kind"],
  type: AgentFactualClaim["source_type"],
  id: string,
  version: number,
): AgentFactualClaim => {
  const candidate: unknown = {
    claim_kind: kind,
    source_type: type,
    source_id: id,
    source_version: version,
  };
  if (!isSchemaValue(AgentFactualClaimSchema, candidate))
    throw new TypeError("Invalid grounding provenance");
  return Object.freeze(candidate);
};
const fact = (
  ref: AgentFactualClaim,
  text: string,
  locale: Locale,
  need: GroundingNeed,
  subject: string,
): AIFact =>
  Object.freeze({ reference: ref, text, grounding: Object.freeze({ locale, need, subject }) });

// Integer-only conversion from canonical minor units; Intl supplies currency scale,
// never the model. This is presentation, not pricing arithmetic.
const moneyText = (
  money: Readonly<{ amount_minor: Money["amount_minor"]; currency: string }>,
): string => {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency: money.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const amount = BigInt(money.amount_minor),
    scale = 10n ** BigInt(digits);
  const whole = (amount / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  const fraction = (amount % scale).toString().padStart(digits, "0");
  return `${whole}${digits > 0 && amount % scale !== 0n ? `.${fraction}` : ""} ${money.currency}`;
};
const words = Object.freeze({
  uz: {
    price: "narxi",
    from: "dan boshlab",
    quote: "Aniq narx uchun tasdiqlangan taklif kerak",
    duration: "Taxminiy davomiylik",
    minutes: "daqiqa",
    hours: "Ish vaqti",
    address: "Manzil",
  },
  ru: {
    price: "стоимость",
    from: "от",
    quote: "Точная цена требует согласованного предложения",
    duration: "Ориентировочная длительность",
    minutes: "минут",
    hours: "Часы работы",
    address: "Адрес",
  },
  en: {
    price: "price",
    from: "from",
    quote: "An approved quote is required for the exact price",
    duration: "Approximate duration",
    minutes: "minutes",
    hours: "Business hours",
    address: "Address",
  },
});
const days = Object.freeze({
  uz: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"],
  ru: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
});
const requestedDay = (query: string): number | null => {
  const normalized = normalizeGroundingQuery(query);
  const aliases = [
    "dushanba|monday|ponedel",
    "seshanba|tuesday|vtorn",
    "chorshanba|wednesday|sreda",
    "payshanba|thursday|chetverg",
    "juma|friday|pyatn",
    "shanba|saturday|subbot",
    "yakshanba|sunday|voskresen",
  ];
  return (
    aliases.findIndex((alias) => new RegExp(`\\b(${alias})\\w*\\b`, "u").test(normalized)) + 1 ||
    null
  );
};

/** Input is an already tenant-qualified, runtime-validated published projection.
 * Nothing from customer text becomes a fact; it only ranks approved sources. */
type GroundingQuery = Readonly<{
  message: string;
  locale: Locale;
  serviceId?: ServiceId | null;
  locationId?: LocationId | null;
  defaultLocale?: Locale;
}>;
const selectExactLocaleFacts = (
  knowledge: PublishedBusinessKnowledgeV2,
  query: GroundingQuery,
  locale: Locale,
): readonly AIFact[] => {
  if (
    !isSchemaValue(PublishedBusinessKnowledgeV2Schema, knowledge) ||
    groundingPreflight(query.message) !== null
  )
    return [];
  const need = groundingNeed(query.message);
  const candidates = knowledge.services.map((service) => ({
    service,
    score: lexicalScore(
      query.message,
      Object.values(service.name_i18n).join(" ") + " " + service.code,
    ),
  }));
  const hasNamedService = candidates.some(({ score }) => score > 0);
  const ranked = candidates
    .filter(
      ({ service, score }) =>
        score > 0 ||
        (!hasNamedService && query.serviceId != null && service.service_id === query.serviceId),
    )
    .sort((a, b) => b.score - a.score || a.service.service_id.localeCompare(b.service.service_id));
  // Do not silently truncate a multi-service question.
  if (ranked.length > 4) return [];
  const selected = ranked.map(({ service }) => service);
  const facts: AIFact[] = [];
  const primary: AIFact[] = [];
  const matchingFaqs = knowledge.faqs
    .filter(
      (faq) =>
        (faq.service_id === null ||
          selected.some((service) => service.service_id === faq.service_id)) &&
        (query.locationId == null ||
          faq.location_id === null ||
          faq.location_id === query.locationId),
    )
    .map((faq) => ({
      faq,
      score: lexicalScore(query.message, Object.values(faq.question_i18n).join(" ")),
    }))
    .filter(
      ({ faq, score }) =>
        score >= 2 ||
        Object.values(faq.question_i18n).some(
          (question) =>
            normalizeGroundingQuery(question) === normalizeGroundingQuery(query.message),
        ) ||
        (need === "hours" && requestedDay(query.message) !== null && score >= 1),
    )
    .sort((a, b) => b.score - a.score || a.faq.faq_id.localeCompare(b.faq.faq_id));
  const topFaq = matchingFaqs[0];
  if ((need === "faq" || need === "hours" || need === "service") && topFaq !== undefined) {
    const answer = localized(topFaq.faq.answer_i18n, locale);
    if (
      answer === null ||
      matchingFaqs.some(
        ({ faq, score }) => score === topFaq.score && localized(faq.answer_i18n, locale) !== answer,
      )
    )
      return [];
    primary.push(
      fact(
        reference("faq", "faq", topFaq.faq.faq_id, topFaq.faq.version_no),
        answer,
        locale,
        need,
        topFaq.faq.faq_key,
      ),
    );
  } else if (need === "hours" || need === "location") {
    const locations = knowledge.locations.filter(
      (location) => query.locationId == null || location.location_id === query.locationId,
    );
    if (locations.length !== 1) return [];
    const location = locations[0];
    if (location === undefined) return [];
    const name = localized(location.name_i18n, locale);
    if (name === null) return [];
    if (need === "location") {
      const address = localized(location.address_i18n, locale);
      if (address === null) return [];
      primary.push(
        fact(
          reference("location", "location", location.location_id, location.root_version),
          `${name}. ${words[locale].address}: ${address}.`,
          locale,
          need,
          location.location_id,
        ),
      );
    } else {
      // Day-specific/holiday claims need positive approved evidence. A missing day
      // is NOT a closed-day fact. Dates and overrides are left to exact approved FAQs.
      if (
        /\b(bugun|ertaga|today|tomorrow|segodnya|zavtra|holiday|bayram)\b/u.test(
          normalizeGroundingQuery(query.message),
        )
      )
        return [];
      const day = requestedDay(query.message),
        intervals = location.business_hours.filter(
          (hour) => day === null || hour.day_of_week === day,
        );
      if (intervals.length === 0) return [];
      const schedule = intervals
        .map(
          (hour) =>
            `${days[locale][hour.day_of_week - 1]} ${hour.opens_at_local}–${hour.closes_at_local}`,
        )
        .join("; ");
      primary.push(
        fact(
          reference("hours", "location", location.location_id, location.root_version),
          `${name}. ${words[locale].hours}: ${schedule} (${location.time_zone}).`,
          locale,
          need,
          location.location_id,
        ),
      );
    }
  } else if (need !== "faq") {
    if (selected.length === 0) return [];
    for (const service of selected) {
      const name = localized(service.name_i18n, locale);
      if (name === null || service.location_offerings.length === 0) return [];
      const serviceRef = reference("service", "service", service.service_id, service.root_version);
      if (need === "price") {
        const resolutions = service.price_resolutions.filter(
          (resolution) => query.locationId == null || resolution.location_id === query.locationId,
        );
        if (
          resolutions.length === 0 ||
          resolutions.some((resolution) => resolution.prices.length === 0)
        )
          return [];
        const prices = resolutions[0]?.prices ?? [];
        const signature = (entries: typeof prices): string =>
          JSON.stringify(
            entries
              .map((entry) => ({ pricing: entry.pricing, display: entry.display_text_i18n }))
              .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          );
        if (resolutions.some((resolution) => signature(resolution.prices) !== signature(prices)))
          return [];
        facts.push(fact(serviceRef, name, locale, "service", service.service_id));
        for (const price of prices) {
          const qualifier = localized(price.display_text_i18n, locale);
          if (qualifier === null) return [];
          const terms = price.pricing;
          const value =
            terms.price_type === "fixed"
              ? moneyText(terms.amount)
              : terms.price_type === "from"
                ? `${words[locale].from} ${moneyText(terms.minimum)}`
                : terms.price_type === "range"
                  ? `${moneyText(terms.minimum)} – ${moneyText(terms.maximum)}`
                  : words[locale].quote;
          primary.push(
            fact(
              reference("price", "service_price", price.price_id, price.version_no),
              `${name} ${words[locale].price}: ${value}. ${qualifier}`,
              locale,
              need,
              `${service.service_id}:${terms.price_type === "quote_required" ? terms.currency : terms.price_type === "fixed" ? terms.amount.currency : terms.minimum.currency}`,
            ),
          );
        }
      } else if (need === "duration") {
        if (service.duration_guidance_minutes === null) return [];
        primary.push(
          fact(
            serviceRef,
            `${name}. ${words[locale].duration}: ${service.duration_guidance_minutes} ${words[locale].minutes}.`,
            locale,
            need,
            service.service_id,
          ),
        );
      } else {
        const description = localized(service.description_i18n, locale),
          disclaimer = localized(service.disclaimer_i18n, locale);
        if (description === null || disclaimer === null) return [];
        primary.push(
          fact(
            serviceRef,
            `${name}. ${description} ${disclaimer}`,
            locale,
            need,
            service.service_id,
          ),
        );
      }
    }
  }
  const result = [...facts, ...primary];
  if (
    primary.length === 0 ||
    result.length > Math.min(12, AI_CONTEXT_LIMITS.facts) ||
    result.some(
      (entry) =>
        entry.text.length === 0 ||
        entry.text.length > AI_CONTEXT_LIMITS.factCharacters ||
        groundingPreflight(entry.text) !== null ||
        (locale === "uz" && /[а-яёқғўҳ]/iu.test(entry.text)),
    ) ||
    result.reduce(
      (sum, entry) => sum + entry.text.length + JSON.stringify(entry.reference).length,
      0,
    ) > 12_000
  )
    return [];
  return Object.freeze(result);
};

export const selectGroundingFacts = (
  knowledge: PublishedBusinessKnowledgeV2,
  query: GroundingQuery,
): readonly AIFact[] => {
  const locale = groundingLocale(query.message, query.locale);
  const exact = selectExactLocaleFacts(knowledge, query, locale);
  if (exact.length > 0 || query.defaultLocale === undefined || query.defaultLocale === locale)
    return exact;
  const fallback = selectExactLocaleFacts(knowledge, query, query.defaultLocale);
  const notice = {
    uz: "Tasdiqlangan ma'lumot boshqa tilda",
    ru: "Подтверждённая информация на другом языке",
    en: "Approved information is in another language",
  }[locale];
  const result = fallback.map((entry) =>
    Object.freeze({
      ...entry,
      text: `${notice} (${query.defaultLocale}): ${entry.text}`,
      ...(entry.grounding === undefined
        ? {}
        : { grounding: Object.freeze({ ...entry.grounding, locale }) }),
    }),
  );
  // No invented translation and no Cyrillic output in the Uzbek Latin surface.
  return result.some(
    (entry) =>
      entry.text.length > AI_CONTEXT_LIMITS.factCharacters ||
      (locale === "uz" && /[а-яёқғўҳ]/iu.test(entry.text)),
  )
    ? []
    : Object.freeze(result);
};
