import type { Locale } from "@lead-agent/contracts";
import type { AIFact, AIContextSnapshot, GroundingPresentation } from "./ports.js";

const normalizeHeader = (text: string): string =>
  text.normalize("NFKC").replace(/[‘’ʼ]/gu, "'").replace(/\s+/gu, " ").trim();
const priceQualifier = (price: Extract<GroundingPresentation, { kind: "price" }>): string => {
  const headers = price.duplicateHeaders.map(normalizeHeader);
  // Only a complete leading sentence identical to a canonical price header is
  // redundant. Unknown wording, conditions and different amounts stay verbatim.
  for (const ending of price.qualifier.matchAll(/\./gu)) {
    const end = ending.index + 1;
    if (headers.includes(normalizeHeader(price.qualifier.slice(0, end))))
      return price.qualifier.slice(end).trim();
  }
  return price.qualifier;
};
const durationText = (minutes: number, locale: Locale): string =>
  ({
    uz: `taxminan ${minutes} daqiqa`,
    ru: `около ${minutes} минут`,
    en: `about ${minutes} minutes`,
  })[locale];
const durationSentence = (name: string, minutes: number, locale: Locale): string =>
  ({
    uz: `${name} ${durationText(minutes, locale)} davom etadi.`,
    ru: `${name} занимает ${durationText(minutes, locale)}.`,
    en: `${name} takes ${durationText(minutes, locale)}.`,
  })[locale];
const presentation = (entry: AIFact, locale: Locale): GroundingPresentation | undefined => {
  const bound = entry.grounding?.presentation;
  const value = bound?.sourceText === entry.text ? bound.value : undefined;
  // Default-language fallback retains its original approved text and notice;
  // presentation must not invent a translated service name or qualifier.
  return value?.locale === locale && value.kind === entry.grounding?.need ? value : undefined;
};

/** Shared channel-independent wording after citation/safety/completeness checks. */
export const renderGroundedFacts = (facts: readonly AIFact[], locale: Locale): string => {
  const consumed = new Set<AIFact>();
  const replies: string[] = [];
  for (const entry of facts) {
    if (consumed.has(entry)) continue;
    const value = presentation(entry, locale);
    if (value?.kind === "price") {
      const prices = facts.filter((fact) => {
        const other = presentation(fact, locale);
        return other?.kind === "price" && other.serviceId === value.serviceId;
      });
      const duration =
        prices.length === 1
          ? facts.find((fact) => {
              const other = presentation(fact, locale);
              return (
                other?.kind === "duration" &&
                other.serviceId === value.serviceId &&
                other.name === value.name
              );
            })
          : undefined;
      const timing = duration === undefined ? undefined : presentation(duration, locale);
      let summary = `${value.name} — ${value.value}.`;
      if (
        timing?.kind === "duration" &&
        duration !== undefined &&
        value.priceType !== "quote_required"
      ) {
        summary = `${value.name} — ${value.value}, ${durationText(timing.minutes, locale)}.`;
        consumed.add(duration);
      }
      replies.push([summary, priceQualifier(value)].filter(Boolean).join(" "));
    } else if (value?.kind === "duration") {
      replies.push(durationSentence(value.name, value.minutes, locale));
    } else replies.push(entry.text);
  }
  return replies.join("\n\n");
};

export const initialGroundingGreeting = (snapshot: AIContextSnapshot, locale: Locale): string => {
  if (snapshot.history.length > 0) return "";
  const patterns = {
    uz: /^(salom|assalomu alaykum)(?:[\s,!:.]|$)/iu,
    ru: /^(здравствуйте|привет|добрый день)(?:[\s,!:.]|$)/iu,
    en: /^(hello|hi)(?:[\s,!:.]|$)/iu,
  };
  return patterns[locale].test(snapshot.message.trim())
    ? { uz: "Salom!", ru: "Здравствуйте!", en: "Hello!" }[locale]
    : "";
};
