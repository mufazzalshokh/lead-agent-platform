import type { Locale } from "@lead-agent/contracts";
import type { AIFallbackReason, GroundingNeed } from "./ports.js";

// Retrieval-only normalization. Original customer/history text is never rewritten.
const cyrillic: Readonly<Record<string, string>> = Object.freeze({
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "x",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sh",
  ъ: "",
  ы: "i",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  қ: "q",
  ғ: "g",
  ў: "o",
  ҳ: "h",
});
export const normalizeGroundingQuery = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[а-яёқғўҳ]/gu, (letter) => cyrillic[letter] ?? letter)
    .replace(/[’‘ʻʼ`']/gu, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .trim();

export const groundingLocale = (message: string, preferred: Locale): Locale => {
  const normalized = normalizeGroundingQuery(message);
  if (
    /[қғўҳ]/iu.test(message) ||
    /\b(narx\w*|qancha|nech\w*|pul|bormi|ochiq\w*|ishlay\w*|yakshanba|xizmat\w*|davom|qayer\w*)\b/u.test(
      normalized,
    )
  )
    return "uz";
  if (
    /\b(skolko|stoit|tsena|zavtra|svobodno|rabota\w*|voskresen\w*|skidka|adres|chas\w*)\b/u.test(
      normalized,
    )
  )
    return "ru";
  if (
    /\b(price|cost|open|hours|sunday|service|where|duration|discount|how|what|available)\b/u.test(
      normalized,
    )
  )
    return "en";
  return preferred;
};

export const groundingPreflight = (message: string): AIFallbackReason | null => {
  const query = normalizeGroundingQuery(message);
  // Conservative stop words, NOT diagnosis or an urgency classifier. Model medical
  // intent/risk flags are a second fail-closed gate; no medical text is rendered.
  if (
    /\b(pain\w*|bleed\w*|swollen|symptom\w*|emergency|urgent|medication|treatment|diagnos\w*|chest|breath\w*|bolit|bol\w*|krov\w*|otek\w*|simptom\w*|sroch\w*|lekar\w*|lech\w*|dish\w*|ogri\w*|qon\w*|shish\w*|nafas\w*|tez yordam|dori\w*|davola\w*|hush\w*)\b/u.test(
      query,
    )
  )
    return "medical_safety_wording_unapproved";
  if (
    /\b(available|availability|slot\w*|reserve|book\w*|appointment|svobodno|zapis\w*|bron\w*|band qil\w*|bosh joy|uchrashuv)\b/u.test(
      query,
    )
  )
    return "booking_availability_unapproved";
  if (
    /\b(ignore\w*|system prompt|api key|secret\w*|database|all tenants|every company|adminman|barcha tenant\w*|hamma kompaniya\w*)\b/u.test(
      query,
    )
  )
    return "policy_denied";
  return null;
};

export const groundingNeed = (message: string): GroundingNeed => {
  const query = normalizeGroundingQuery(message);
  if (/\b(minut\w*|duration|davom|dlitel\w*)\b/u.test(query)) return "duration";
  if (/\b(narx\w*|pul|qancha|nech\w*|tsena|stoit|skolko|price|cost)\b/u.test(query)) return "price";
  if (
    /\b(ochiq\w*|ishlay\w*|yakshanba|shanba|dushanba|seshanba|chorshanba|payshanba|juma|bugun|ertaga|open|hours|sunday|monday|today|tomorrow|rabota\w*|voskresen\w*|chas\w*)\b/u.test(
      query,
    )
  )
    return "hours";
  if (/\b(qayer\w*|manzil\w*|address|where|adres\w*)\b/u.test(query)) return "location";
  if (/\b(discount|skidka|chegirma|policy|siyosat|garanti\w*|guarantee|kafolat)\b/u.test(query))
    return "faq";
  return "service";
};

const stopWords = new Set([
  "oka",
  "aka",
  "shu",
  "bu",
  "the",
  "a",
  "is",
  "are",
  "you",
  "does",
  "what",
  "how",
  "of",
  "on",
  "in",
  "kun",
  "kuni",
  "kunlari",
  "mi",
  "bormi",
  "nechi",
  "necha",
  "qancha",
  "pul",
  "narx",
  "narxi",
  "price",
  "cost",
  "skolko",
  "stoit",
  "xizmat",
  "xizmati",
  "service",
]);
export const groundingTokens = (message: string): readonly string[] => [
  ...new Set(
    normalizeGroundingQuery(message)
      .split(" ")
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
  ),
];
export const lexicalScore = (query: string, text: string): number => {
  const terms = groundingTokens(query),
    candidates = groundingTokens(text);
  return terms.reduce(
    (score, term) =>
      score +
      (candidates.some(
        (candidate) =>
          term === candidate ||
          (Math.min(term.length, candidate.length) >= 5 &&
            (term.startsWith(candidate) || candidate.startsWith(term))) ||
          (term === "lazer" && candidate === "laser") ||
          (term === "laser" && candidate === "lazer"),
      )
        ? 1
        : 0),
    0,
  );
};
